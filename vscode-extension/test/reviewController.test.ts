import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ProcessRunnerError } from "../src/ai/processRunner";

const Module = require("node:module") as { _load: (...args: any[]) => unknown };
const load = Module._load;
const disposable = { dispose() {} };
const posted: any[] = [];
let receive: (message: unknown) => void = () => {};
let trusted = true;
const vscode = {
  ProgressLocation: { Notification: 15 },
  EndOfLine: { LF: 1, CRLF: 2 },
  languages: { getLanguages: () => Promise.resolve(["javascript", "plaintext", "typescript"]) },
  Range: class { constructor(readonly start: unknown, readonly end: unknown) {} },
  WorkspaceEdit: class {
    readonly entries: Array<{ uri: unknown; range: { start: unknown; end: unknown }; text: string }> = [];
    replace(uri: unknown, range: { start: unknown; end: unknown }, text: string) { this.entries.push({ uri, range, text }); }
  },
  TextEditorRevealType: { AtTop: 1 },
  Uri: { joinPath: (...parts: string[]) => parts.join("/") },
  workspace: { get isTrusted() { return trusted; }, applyEdit: async (_edit: unknown) => false },
  window: {
    visibleTextEditors: [],
    createWebviewPanel: () => {
      let panelDisposed = false;
      let onDidDisposeListener: (() => void) | undefined;
      const webviewObj = {
        html: "",
        asWebviewUri: () => "asset",
        onDidReceiveMessage: (listener: typeof receive) => { receive = listener; return disposable; },
        postMessage: (message: unknown) => { posted.push(message); return Promise.resolve(true); },
      };
      return {
        // VS Code marks a panel disposed before onDidDispose fires; webview/reveal throw from then on.
        get webview() {
          if (panelDisposed) throw new Error("Webview is disposed");
          return webviewObj;
        },
        onDidDispose: (listener: () => void) => { onDidDisposeListener = listener; return disposable; },
        reveal() {
          if (panelDisposed) throw new Error("Webview is disposed");
        },
        dispose() {
          if (panelDisposed) return;
          panelDisposed = true;
          onDidDisposeListener?.();
        },
      };
    },
    withProgress: (_options: unknown, task: (progress: unknown, token: unknown) => Promise<unknown>) => task({}, { onCancellationRequested: () => disposable }),
  },
};
Module._load = (request: string, ...args: any[]) => request === "vscode" ? vscode : load(request, ...args);
const { ReviewController } = require("../src/reviewController") as typeof import("../src/reviewController");
const { REVIEW_LIMITS } = require("../src/review/validate") as typeof import("../src/review/validate");
const { reviewWebviewHtml } = require("../src/webview/reviewWebview") as typeof import("../src/webview/reviewWebview");
const { settingsWebviewHtml } = require("../src/webview/settingsWebview") as typeof import("../src/webview/settingsWebview");
const { createMarkdownRenderer } = require("../src/webview/markdownRenderer") as typeof import("../src/webview/markdownRenderer");
Module._load = load;

function controller(source: string, runner: import("../src/reviewController").AnalysisRunner = async () => ({ title: "Draft", level1: [], level2: [] })) {
  posted.length = 0;
  const document = {
    uri: { toString: () => "file:///draft.md" }, fileName: "/draft.md", languageId: "markdown", version: 1, getText: () => source,
  };
  return new ReviewController(document as any, "extension" as any, runner, () => {}, 2 as any);
}

test("a second Analyze request while one is running is a no-op, not a cancel", async () => {
  let signal: AbortSignal | undefined;
  let started!: () => void;
  let finish!: (value: unknown) => void;
  const runnerStarted = new Promise<void>((resolve) => { started = resolve; });
  const active = controller("Draft", async (_request, nextSignal) => {
    signal = nextSignal;
    started();
    return new Promise((resolve) => { finish = resolve; });
  });
  const first = active.analyze();
  try {
    await runnerStarted;
    await active.analyze();
    assert.equal(signal!.aborted, false);
    assert.equal(posted.at(-1).model.state, "analyzing");
    active.cancelAnalysis();
    assert.equal(signal!.aborted, true);
  } finally {
    finish({ title: "Draft", level1: [], level2: [] });
    try {
      await first;
    } finally {
      active.dispose();
    }
  }
});

test("an explicit re-analyze runs again on an unchanged, already-analyzed document (see R4-06)", async () => {
  let calls = 0;
  const active = controller("Draft", async () => { calls += 1; return { title: "Draft", level1: [], level2: [] }; });
  try {
    await active.analyze();
    assert.equal(calls, 1);
    assert.equal(posted.at(-1).model.canAnalyze, true);
    await active.analyze();
    assert.equal(calls, 2);
  } finally {
    active.dispose();
  }
});

test("closing the panel mid-analysis tears the controller down instead of throwing", async () => {
  let started!: () => void;
  let finish!: (value: unknown) => void;
  const runnerStarted = new Promise<void>((resolve) => { started = resolve; });
  posted.length = 0;
  const document = {
    uri: { toString: () => "file:///closing.md" }, fileName: "/closing.md", languageId: "markdown", version: 1, getText: () => "Draft",
  };
  let disposedCallbackCount = 0;
  const active = new ReviewController(document as any, "extension" as any, async () => {
    started();
    return new Promise((resolve) => { finish = resolve; });
  }, () => { disposedCallbackCount += 1; }, 2 as any);
  const analysis = active.analyze();
  await runnerStarted;
  // VS Code fires onDidDispose (and marks the panel disposed) when the user closes the tab.
  assert.doesNotThrow(() => (active as any).panel.dispose());
  assert.equal(disposedCallbackCount, 1);
  assert.doesNotThrow(() => active.onDocumentChanged({ document, contentChanges: [] } as any));
  assert.doesNotThrow(() => active.onEditorVisibleRanges({ textEditor: { document }, visibleRanges: [{ start: { line: 0 }, end: { line: 0 } }] } as any));
  finish({ title: "Draft", level1: [], level2: [] });
  await assert.doesNotReject(analysis);
  assert.doesNotThrow(() => active.dispose());
  assert.equal(disposedCallbackCount, 1);
});

test("oversized documents never enter the webview model", () => {
  const active = controller("x".repeat(REVIEW_LIMITS.source + 1));
  receive({ type: "ready" });
  const model = posted.at(-1).model;
  assert.equal(model.currentSource, "");
  assert.equal(model.canAnalyze, false);
  assert.deepEqual(model.level1, []);
  assert.equal(model.error.message, "Document is too large or complex to analyze.");
  active.dispose();
});

test("structurally complex Markdown is rejected before any CLI is spawned", async () => {
  let called = false;
  const active = controller("*".repeat(1025), async () => { called = true; return { title: "Draft", level1: [], level2: [] }; });
  try {
    receive({ type: "ready" });
    assert.equal(posted.at(-1).model.canAnalyze, false);
    await active.analyze();
    assert.equal(called, false);
    assert.equal(posted.at(-1).model.error.message, "Document is too large or complex to analyze.");
  } finally {
    active.dispose();
  }
});

test("a save event leaves review state untouched, but a real edit reconciles it", async () => {
  let source = "Draft";
  const document: any = {
    uri: { toString: () => "file:///save.md" }, fileName: "/save.md", languageId: "markdown", version: 1,
    getText: () => source,
  };
  const active = new ReviewController(document, "extension" as any, async () => (
    { title: "Draft", level1: [{ from: "Draft", options: ["Drafted"], note: "Word" }], level2: [] }
  ), () => {}, 2 as any);
  try {
    await active.analyze();
    assert.equal(posted.at(-1).model.state, "ready");
    const countBeforeSave = posted.length;
    // A save fires onDidChangeTextDocument with no content changes and no version bump.
    active.onDocumentChanged({ document, contentChanges: [] } as any);
    assert.equal(posted.length, countBeforeSave);
    assert.equal(posted.at(-1).model.state, "ready");
    assert.equal(posted.at(-1).model.level1.length, 1);
    source = "Draft!";
    document.version += 1;
    active.onDocumentChanged({ document, contentChanges: [{ range: {} as any, rangeOffset: 5, rangeLength: 0, text: "!" }] } as any);
    assert.equal(posted.at(-1).model.state, "modified");
  } finally {
    active.dispose();
  }
});

test("an autosave notification during apply does not falsely mark it conflicted, and apply needs no visible editor", async () => {
  let source = "Draft";
  const document: any = {
    uri: { toString: () => "file:///apply.md" }, fileName: "/apply.md", languageId: "markdown", version: 1,
    getText: () => source, positionAt: (offset: number) => offset,
  };
  const active = new ReviewController(document, "extension" as any, async () => (
    { title: "Draft", level1: [{ from: "Draft", options: ["Drafted"], note: "Word" }], level2: [] }
  ), () => {}, 2 as any);
  (vscode.window as any).visibleTextEditors = []; // apply must not require a visible source editor
  (vscode.workspace as any).applyEdit = async (edit: any) => {
    // A dirty-state/save notification can arrive before VS Code reports the real edit; it must not conflict the apply.
    active.onDocumentChanged({ document, contentChanges: [] } as any);
    for (const item of edit.entries) {
      const contentChanges = [{ range: {} as any, rangeOffset: item.range.start, rangeLength: item.range.end - item.range.start, text: item.text }];
      source = source.slice(0, item.range.start) + item.text + source.slice(item.range.end);
      document.version += 1;
      active.onDocumentChanged({ document, contentChanges } as any);
    }
    return true;
  };
  try {
    await active.analyze();
    receive({ type: "acceptAll", level: 1 });
    await active.apply();
    assert.equal(posted.at(-1).model.state, "applied");
    assert.equal(posted.at(-1).model.error, undefined);
    assert.equal(source, "Drafted");
  } finally {
    (vscode.workspace as any).applyEdit = async () => false;
    active.dispose();
  }
});

test("review presence distinguishes zero-result analysis from initial and applied states", async () => {
  const active = controller("Draft");
  try {
    receive({ type: "ready" });
    assert.equal(posted.at(-1).model.hasReview, false);
    await active.analyze();
    assert.equal(posted.at(-1).model.hasReview, true);
    assert.equal(posted.at(-1).model.state, "ready");
    (active as any).review = undefined;
    (active as any).state = "applied";
    (active as any).postState();
    assert.equal(posted.at(-1).model.hasReview, false);
  } finally {
    active.dispose();
  }
});

test("prior reviews remain present while a re-analysis is running", async () => {
  let calls = 0;
  let startSecond!: () => void;
  let finishSecond!: () => void;
  const secondStarted = new Promise<void>((resolve) => { startSecond = resolve; });
  const active = controller("Draft", async () => {
    if (calls++ === 0) return { title: "Draft", level1: [{ from: "Draft", options: ["Drafted"], note: "Word" }], level2: [] };
    startSecond();
    await new Promise<void>((resolve) => { finishSecond = resolve; });
    return { title: "Draft", level1: [], level2: [] };
  });
  try {
    await active.analyze();
    (active as any).review.currentDocumentVersion += 1;
    const next = active.analyze();
    await secondStarted;
    assert.equal(posted.at(-1).model.hasReview, true);
    assert.equal(posted.at(-1).model.state, "analyzing");
    active.cancelAnalysis();
    finishSecond();
    await next;
  } finally {
    active.dispose();
  }
});

test("analysis failures hide parser and CLI diagnostics", async () => {
  const active = controller("Draft", async () => { throw new Error("agent response is not valid JSON: provider detail"); });
  try {
    await active.analyze();
    assert.equal(posted.at(-1).model.error.message, "Analysis failed. Try switching models or retrying.");
  } finally {
    active.dispose();
  }
});

test("a missing AI client surfaces its authored message with an openSettings action", async () => {
  const active = controller("Draft", async () => {
    throw new ProcessRunnerError("launch", "No supported AI client is available. Install and sign in to Claude Code, Codex, or GitHub Copilot CLI.");
  });
  try {
    await active.analyze();
    assert.equal(posted.at(-1).model.error.message, "No supported AI client is available. Install and sign in to Claude Code, Codex, or GitHub Copilot CLI.");
    assert.equal(posted.at(-1).model.error.action, "openSettings");
  } finally {
    active.dispose();
  }
});

test("an unsupported Codex CLI version surfaces its authored message with an openSettings action", async () => {
  const active = controller("Draft", async () => {
    throw new ProcessRunnerError("launch", "Codex is unavailable: codex-cli 0.200.0 has not been safety-reviewed. sharp-pen currently supports Codex CLI 0.155.1.");
  });
  try {
    await active.analyze();
    assert.equal(posted.at(-1).model.error.message, "Codex is unavailable: codex-cli 0.200.0 has not been safety-reviewed. sharp-pen currently supports Codex CLI 0.155.1.");
    assert.equal(posted.at(-1).model.error.action, "openSettings");
  } finally {
    active.dispose();
  }
});

test("a CLI timeout surfaces its authored message with a retry action", async () => {
  const active = controller("Draft", async () => {
    throw new ProcessRunnerError("timeout", "Codex timed out. Check its sign-in and selected model, then try again.");
  });
  try {
    await active.analyze();
    assert.equal(posted.at(-1).model.error.message, "Codex timed out. Check its sign-in and selected model, then try again.");
    assert.equal(posted.at(-1).model.error.action, "analyze");
  } finally {
    active.dispose();
  }
});

test("a document edit during analysis surfaces the authored stale-document message, not a generic failure", async () => {
  let source = "Draft";
  const document: any = {
    uri: { toString: () => "file:///stale.md" }, fileName: "/stale.md", languageId: "markdown", version: 1,
    getText: () => source,
  };
  let started!: () => void;
  let finish!: (value: unknown) => void;
  const runnerStarted = new Promise<void>((resolve) => { started = resolve; });
  const active = new ReviewController(document, "extension" as any, async () => {
    started();
    return new Promise((resolve) => { finish = resolve; });
  }, () => {}, 2 as any);
  try {
    const analysis = active.analyze();
    await runnerStarted;
    source = "Draft!";
    document.version += 1;
    active.onDocumentChanged({ document, contentChanges: [{ range: {} as any, rangeOffset: 5, rangeLength: 0, text: "!" }] } as any);
    finish({ title: "Draft", level1: [], level2: [] });
    await analysis;
    assert.equal(posted.at(-1).model.error.message, "Document changed during analysis. Re-analyze to refresh suggestions.");
    assert.equal(posted.at(-1).model.error.action, "analyze");
  } finally {
    active.dispose();
  }
});

test("suggestions that could not be placed surface a separate notice instead of a blocking error", async () => {
  const active = controller("Draft", async () => ({
    title: "Draft",
    level1: [{ from: "Draft", options: ["Drafted"], note: "Word" }, { from: "missing text", options: ["found"], note: "Ghost" }],
    level2: [],
  }));
  try {
    await active.analyze();
    const model = posted.at(-1).model;
    assert.equal(model.notice, "1 suggestion could not be placed and was skipped.");
    assert.equal(model.error, undefined);
    assert.equal(model.state, "ready");
  } finally {
    active.dispose();
  }
});

test("re-analyzing with staged choices reports how many were discarded (see R5-06)", async () => {
  const active = controller("Teh here", async () => (
    { title: "Draft", level1: [
      { from: "Teh", options: ["The"], note: "Spelling" },
      { from: "here", options: ["there"], note: "Word choice" },
    ], level2: [] }
  ));
  try {
    await active.analyze();
    receive({ type: "choose", suggestionId: "l1-1", option: 0 });
    receive({ type: "choose", suggestionId: "l1-2", option: 0 });
    assert.equal(active.stagedChoiceCount(), 2);
    await active.analyze();
    assert.equal(posted.at(-1).model.notice, "2 staged choices were discarded by re-analysis.");
    assert.equal(active.stagedChoiceCount(), 0);
  } finally {
    active.dispose();
  }
});

test("re-analyzing with no staged choices posts no discard notice", async () => {
  const active = controller("Teh here", async () => (
    { title: "Draft", level1: [{ from: "Teh", options: ["The"], note: "Spelling" }], level2: [] }
  ));
  try {
    await active.analyze();
    await active.analyze();
    assert.equal(posted.at(-1).model.notice, undefined);
  } finally {
    active.dispose();
  }
});

test("cancelling a re-analysis restores the previous skipped-suggestions notice (see R4-12)", async () => {
  const document: any = {
    uri: { toString: () => "file:///notice.md" }, fileName: "/notice.md", languageId: "markdown", version: 1,
    getText: () => "Draft",
  };
  let callCount = 0;
  let started!: () => void;
  let finish!: (value: unknown) => void;
  const runnerStarted = new Promise<void>((resolve) => { started = resolve; });
  posted.length = 0;
  const active = new ReviewController(document, "extension" as any, async () => {
    callCount += 1;
    if (callCount === 1) return { title: "Draft", level1: [{ from: "Draft", options: ["Drafted"], note: "Word" }, { from: "missing text", options: ["found"], note: "Ghost" }], level2: [] };
    started();
    return new Promise((resolve) => { finish = resolve; });
  }, () => {}, 2 as any);
  try {
    await active.analyze();
    assert.equal(posted.at(-1).model.notice, "1 suggestion could not be placed and was skipped.");
    document.version += 1;
    active.onDocumentChanged({ document, contentChanges: [{ range: {} as any, rangeOffset: 5, rangeLength: 0, text: "!" }] } as any);
    const second = active.analyze();
    await runnerStarted;
    active.cancelAnalysis();
    assert.equal(posted.at(-1).model.notice, "1 suggestion could not be placed and was skipped.");
    finish({ title: "Draft", level1: [], level2: [] });
    await second;
  } finally {
    active.dispose();
  }
});

test("stagedChoiceCount excludes explicit keeps, which Apply would never discard (see R4-11)", async () => {
  const active = controller("Teh here", async () => (
    { title: "Draft", level1: [
      { from: "Teh", options: ["The"], note: "Spelling" },
      { from: "here", options: ["there"], note: "Word choice" },
    ], level2: [] }
  ));
  try {
    await active.analyze();
    receive({ type: "choose", suggestionId: "l1-1", option: 0 });
    receive({ type: "choose", suggestionId: "l1-2", option: null });
    assert.equal(active.stagedChoiceCount(), 1);
  } finally {
    active.dispose();
  }
});

test("retargeting to a same-format document (a language-id churn, not a real close) keeps the review and staged choices (see R5-04)", async () => {
  const document: any = {
    uri: { toString: () => "file:///notes.md" }, fileName: "/notes.md", languageId: "markdown", version: 1, getText: () => "Teh here",
  };
  const active = new ReviewController(document, "extension" as any, async () => (
    { title: "Draft", level1: [{ from: "Teh", options: ["The"], note: "Spelling" }], level2: [] }
  ), () => {}, 2 as any);
  try {
    await active.analyze();
    receive({ type: "choose", suggestionId: "l1-1", option: 0 });
    assert.equal(active.stagedChoiceCount(), 1);
    const reopened: any = { ...document, languageId: "markdown" };
    active.retarget(reopened);
    assert.equal(active.stagedChoiceCount(), 1);
    assert.equal(posted.at(-1).model.hasReview, true);
    assert.equal(posted.at(-1).model.level1[0].decision, 0);
  } finally {
    active.dispose();
  }
});

test("retargeting across a Markdown/plain-text format change clears the review, since its offsets no longer apply (see R5-04)", async () => {
  const document: any = {
    uri: { toString: () => "file:///notes.txt" }, fileName: "/notes.txt", languageId: "plaintext", version: 1, getText: () => "Teh here",
  };
  const active = new ReviewController(document, "extension" as any, async () => (
    { title: "Draft", level1: [{ from: "Teh", options: ["The"], note: "Spelling" }], level2: [] }
  ), () => {}, 2 as any);
  try {
    await active.analyze();
    receive({ type: "choose", suggestionId: "l1-1", option: 0 });
    assert.equal(active.stagedChoiceCount(), 1);
    const reopened: any = { ...document, languageId: "markdown" };
    active.retarget(reopened);
    assert.equal(active.stagedChoiceCount(), 0);
    assert.equal(posted.at(-1).model.hasReview, false);
    assert.equal(posted.at(-1).model.state, "empty");
  } finally {
    active.dispose();
  }
});

test("Markdown front matter is dropped from the webview model's render range so it can't render as a bogus heading (see R5-05)", () => {
  const active = controller("---\ntitle: Post\ntags: [a, b]\n---\n\n# Heading\n");
  receive({ type: "ready" });
  const model = posted.at(-1).model;
  assert.equal(model.frontMatterEnd, "---\ntitle: Post\ntags: [a, b]\n---\n".length);
  active.dispose();
});

test("plain-text documents never report a front-matter range, even with a leading '---' line", () => {
  const document: any = {
    uri: { toString: () => "file:///notes.txt" }, fileName: "/notes.txt", languageId: "plaintext", version: 1,
    getText: () => "---\ntitle: Post\n---\n",
  };
  const active = new ReviewController(document, "extension" as any, async () => ({ title: "Draft", level1: [], level2: [] }), () => {}, 2 as any);
  receive({ type: "ready" });
  assert.equal(posted.at(-1).model.frontMatterEnd, 0);
  active.dispose();
});

test("an edit that lands while sharp-pen is applying marks the review conflicted, not silently applied", async () => {
  let source = "Draft";
  const document: any = {
    uri: { toString: () => "file:///conflict.md" }, fileName: "/conflict.md", languageId: "markdown", version: 1,
    getText: () => source, positionAt: (offset: number) => offset,
  };
  const active = new ReviewController(document, "extension" as any, async () => (
    { title: "Draft", level1: [{ from: "Draft", options: ["Drafted"], note: "Word" }], level2: [] }
  ), () => {}, 2 as any);
  (vscode.window as any).visibleTextEditors = [];
  (vscode.workspace as any).applyEdit = async () => {
    // A foreign edit (another extension, or the user typing) lands before sharp-pen's own change is observed.
    source = "Something else entirely";
    document.version += 1;
    active.onDocumentChanged({ document, contentChanges: [{ range: {} as any, rangeOffset: 0, rangeLength: 5, text: "Something else entirely" }] } as any);
    return true;
  };
  try {
    await active.analyze();
    receive({ type: "acceptAll", level: 1 });
    await active.apply();
    assert.equal(posted.at(-1).model.state, "modified");
    assert.equal(posted.at(-1).model.error.message, "Document changed while sharp-pen applied staged changes. Review remains open; verify it and re-analyze before applying again.");
  } finally {
    (vscode.workspace as any).applyEdit = async () => false;
    active.dispose();
  }
});

test("a foreign edit landing right after sharp-pen's own apply edit still reconciles the review against both changes", async () => {
  let source = "Teh cat sat. A dog ran here.";
  const document: any = {
    uri: { toString: () => "file:///own-then-foreign.md" }, fileName: "/own-then-foreign.md", languageId: "markdown", version: 1,
    getText: () => source, positionAt: (offset: number) => offset,
  };
  const active = new ReviewController(document, "extension" as any, async () => (
    { title: "Draft", level1: [
      { from: "Teh", options: ["The quick"], note: "Spelling" },
      { from: "here", options: ["there"], note: "Word choice" },
    ], level2: [] }
  ), () => {}, 2 as any);
  (vscode.window as any).visibleTextEditors = [];
  (vscode.workspace as any).applyEdit = async (edit: any) => {
    for (const item of edit.entries) {
      const contentChanges = [{ range: {} as any, rangeOffset: item.range.start, rangeLength: item.range.end - item.range.start, text: item.text }];
      source = source.slice(0, item.range.start) + item.text + source.slice(item.range.end);
      document.version += 1;
      // sharp-pen's own expected change lands first...
      active.onDocumentChanged({ document, contentChanges } as any);
    }
    // ...then a foreign edit (another extension, or the user typing) lands before apply() re-checks state.
    const insertAt = source.length;
    source += "\n";
    document.version += 1;
    active.onDocumentChanged({ document, contentChanges: [{ range: {} as any, rangeOffset: insertAt, rangeLength: 0, text: "\n" }] } as any);
    return true;
  };
  try {
    await active.analyze();
    receive({ type: "choose", suggestionId: "l1-1", option: 0 });
    await active.apply();
    const model = posted.at(-1).model;
    assert.equal(model.state, "modified");
    assert.equal(model.error.message, "Document changed while sharp-pen applied staged changes. Review remains open; verify it and re-analyze before applying again.");
    const remaining = model.level1.find((s: any) => s.id === "l1-2");
    assert.equal(remaining.status, "active");
    assert.equal(model.currentSource.slice(remaining.start, remaining.end), "here");
  } finally {
    (vscode.workspace as any).applyEdit = async () => false;
    active.dispose();
  }
});

test("apply() reports an authored error instead of a silent no-op when the review considers itself stale", async () => {
  const active = controller("Draft", async () => (
    { title: "Draft", level1: [{ from: "Draft", options: ["Drafted"], note: "Word" }], level2: [] }
  ));
  try {
    await active.analyze();
    receive({ type: "acceptAll", level: 1 });
    (active as any).review.currentDocumentVersion += 1; // the review's own version no longer matches the live document
    await active.apply();
    assert.equal(posted.at(-1).model.state, "modified");
    assert.equal(posted.at(-1).model.error.message, "Document changed; re-analyze before applying.");
    assert.equal(posted.at(-1).model.error.action, "analyze");
  } finally {
    active.dispose();
  }
});

test("applying a multi-line option to a CRLF document is not misread as a foreign conflict", async () => {
  let source = "Teh cat sat.\r\nA dog ran.";
  const document: any = {
    uri: { toString: () => "file:///crlf.md" }, fileName: "/crlf.md", languageId: "markdown", version: 1,
    getText: () => source, positionAt: (offset: number) => offset, eol: (vscode as any).EndOfLine.CRLF,
  };
  const active = new ReviewController(document, "extension" as any, async () => (
    { title: "Draft", level1: [{ from: "Teh cat sat.", options: ["The cat sat.\nAnd stayed."], note: "Split" }], level2: [] }
  ), () => {}, 2 as any);
  (vscode.window as any).visibleTextEditors = [];
  (vscode.workspace as any).applyEdit = async (edit: any) => {
    for (const item of edit.entries) {
      const contentChanges = [{ range: {} as any, rangeOffset: item.range.start, rangeLength: item.range.end - item.range.start, text: item.text }];
      // VS Code's own text buffer normalizes inserted text to the document's EOL before firing the change event.
      source = source.slice(0, item.range.start) + item.text.replace(/\r\n|\r|\n/g, "\r\n") + source.slice(item.range.end);
      document.version += 1;
      active.onDocumentChanged({ document, contentChanges: [{ ...contentChanges[0], text: item.text.replace(/\r\n|\r|\n/g, "\r\n") }] } as any);
    }
    return true;
  };
  try {
    await active.analyze();
    receive({ type: "acceptAll", level: 1 });
    await active.apply();
    assert.equal(posted.at(-1).model.state, "applied");
    assert.equal(posted.at(-1).model.error, undefined);
    assert.equal(source, "The cat sat.\r\nAnd stayed.\r\nA dog ran.");
  } finally {
    (vscode.workspace as any).applyEdit = async () => false;
    active.dispose();
  }
});

test("a rejected WorkspaceEdit during Apply reports a retry error, not silence", async () => {
  const document: any = {
    uri: { toString: () => "file:///apply-reject.md" }, fileName: "/apply-reject.md", languageId: "markdown", version: 1,
    getText: () => "Draft", positionAt: (offset: number) => offset,
  };
  const active = new ReviewController(document, "extension" as any, async () => (
    { title: "Draft", level1: [{ from: "Draft", options: ["Drafted"], note: "Word" }], level2: [] }
  ), () => {}, 2 as any);
  (vscode.workspace as any).applyEdit = async () => false;
  try {
    await active.analyze();
    receive({ type: "acceptAll", level: 1 });
    await active.apply();
    assert.equal(posted.at(-1).model.state, "ready");
    assert.equal(posted.at(-1).model.error.message, "sharp-pen could not apply the staged changes. Try Apply again.");
    assert.equal(posted.at(-1).model.error.action, "apply");
  } finally {
    (vscode.workspace as any).applyEdit = async () => false;
    active.dispose();
  }
});

test("cancelling analysis after a mid-analysis edit restores modified, not the pre-analysis state", async () => {
  let started!: () => void;
  let finish!: () => void;
  const runnerStarted = new Promise<void>((resolve) => { started = resolve; });
  const active = controller("Draft", async () => {
    started();
    await new Promise<void>((resolve) => { finish = resolve; });
    return { title: "Draft", level1: [], level2: [] };
  });
  try {
    (active as any).review = { level1: [], level2: [], analysisDocumentVersion: 1, currentDocumentVersion: 2 };
    (active as any).state = "ready";
    const analysis = active.analyze();
    await runnerStarted;
    assert.equal(posted.at(-1).model.state, "analyzing");
    active.onDocumentChanged({
      document: { uri: { toString: () => "file:///draft.md" }, getText: () => "Draft!", version: 2 },
      contentChanges: [{ range: {} as any, rangeOffset: 5, rangeLength: 0, text: "!" }],
    } as any);
    active.cancelAnalysis();
    assert.equal(posted.at(-1).model.state, "modified");
    finish();
    await analysis;
  } finally {
    active.dispose();
  }
});

test("source and preview scrolling stay proportional without changing focus", () => {
  const document: any = {
    uri: { toString: () => "file:///scroll.md" }, fileName: "/scroll.md", languageId: "markdown", version: 1,
    lineCount: 100, getText: () => "Draft", lineAt: (line: number) => ({ range: { line } }),
  };
  let revealed: { line: number } | undefined;
  let revealType: number | undefined;
  const editor: any = {
    document,
    visibleRanges: [{ start: { line: 20 }, end: { line: 39 } }],
    revealRange: (range: { line: number }, type: number) => { revealed = range; revealType = type; },
  };
  (vscode.window as any).visibleTextEditors = [editor];
  const active = new ReviewController(document, "extension" as any, undefined, () => {}, 2 as any);
  try {
    active.onEditorVisibleRanges({ textEditor: editor, visibleRanges: editor.visibleRanges } as any);
    assert.deepEqual(posted.at(-1), { type: "sourceScroll", ratio: 0.25 });
    receive({ type: "scrollSource", ratio: 0.5 });
    assert.deepEqual(revealed, { line: 40 });
    assert.equal(revealType, vscode.TextEditorRevealType.AtTop);
    const messageCount = posted.length;
    editor.visibleRanges = [{ start: { line: 40 }, end: { line: 59 } }];
    active.onEditorVisibleRanges({ textEditor: editor, visibleRanges: editor.visibleRanges } as any);
    assert.equal(posted.length, messageCount);
    (active as any).ignoreEditorScrollUntil = 0;
    active.onEditorVisibleRanges({ textEditor: editor, visibleRanges: editor.visibleRanges } as any);
    assert.deepEqual(posted.at(-1), { type: "sourceScroll", ratio: 0.5 });
  } finally {
    (vscode.window as any).visibleTextEditors = [];
    active.dispose();
  }
});

test("task toggles edit only the current, exact source marker", async () => {
  let source = "- [ ] task";
  const document: any = {
    uri: { toString: () => "file:///task.md" }, fileName: "/task.md", languageId: "markdown", version: 7,
    getText: () => source, positionAt: (offset: number) => offset,
  };
  const active = new ReviewController(document, "extension" as any, undefined, () => {}, 2 as any);
  let edits = 0;
  let releaseEdit!: () => void;
  (vscode.workspace as any).applyEdit = async (edit: any) => {
    await new Promise<void>((resolve) => { releaseEdit = resolve; });
    const [item] = edit.entries;
    assert.equal(item.range.start, 2); assert.equal(item.range.end, 5); assert.equal(item.text, "[x]");
    source = source.slice(0, 2) + item.text + source.slice(5); document.version += 1; edits += 1;
    active.onDocumentChanged({ document, contentChanges: [{ range: {} as any, rangeOffset: 2, rangeLength: 3, text: "[x]" }] } as any);
    return true;
  };
  try {
    receive({ type: "toggleTask", offset: 2, checked: true, documentVersion: 7 });
    const beforeIgnoredToggle = posted.length;
    receive({ type: "toggleTask", offset: 2, checked: false, documentVersion: 7 });
    assert.equal(posted.length, beforeIgnoredToggle + 1); // ignored optimistic click is reset by current state
    releaseEdit();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(source, "- [x] task");
    receive({ type: "toggleTask", offset: 2, checked: false, documentVersion: 7 }); // stale version
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(edits, 1);
  } finally {
    (vscode.workspace as any).applyEdit = async () => false;
    active.dispose();
  }
});

test("fence language edits preserve metadata and reject unknown IDs", async () => {
  let source = "```ts linenos=1\nconst x = 1;\n```";
  const document: any = {
    uri: { toString: () => "file:///fence.md" }, fileName: "/fence.md", languageId: "markdown", version: 3,
    getText: () => source, positionAt: (offset: number) => offset,
  };
  const active = new ReviewController(document, "extension" as any, undefined, () => {}, 2 as any);
  let edits = 0;
  let failEdit = true;
  (vscode.workspace as any).applyEdit = async (edit: any) => {
    if (failEdit) return false;
    for (const item of edit.entries) {
      const contentChanges = [{ range: {} as any, rangeOffset: item.range.start, rangeLength: item.range.end - item.range.start, text: item.text }];
      source = source.slice(0, item.range.start) + item.text + source.slice(item.range.end);
      document.version += 1;
      active.onDocumentChanged({ document, contentChanges } as any);
    }
    edits += 1;
    return true;
  };
  try {
    await new Promise((resolve) => setImmediate(resolve));
    receive({ type: "setCodeFenceLanguage", fenceIndex: 0, languageId: "javascript", documentVersion: 3 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(posted.at(-1).model.error.message, "Could not update this code language. Try again.");
    failEdit = false;
    receive({ type: "setCodeFenceLanguage", fenceIndex: 0, languageId: "javascript", documentVersion: 3 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(source, "```javascript linenos=1\nconst x = 1;\n```");
    assert.equal(posted.at(-1).model.error, undefined);
    receive({ type: "setCodeFenceLanguage", fenceIndex: 0, languageId: "", documentVersion: 4 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(source, "```plaintext linenos=1\nconst x = 1;\n```");
    receive({ type: "setCodeFenceLanguage", fenceIndex: 0, languageId: "unknown", documentVersion: 5 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(edits, 2);
  } finally {
    (vscode.workspace as any).applyEdit = async () => false;
    active.dispose();
  }
});

test("task toggle failures reset the preview without exposing host errors", async () => {
  const active = controller("- [ ] task");
  try {
    receive({ type: "toggleTask", offset: 2, checked: true, documentVersion: 1 }); // no editor/showTextDocument mock
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(posted.at(-1).model.error.message, "Could not update this task. Try again.");
  } finally {
    active.dispose();
  }
});

test("a rejected workspace edit reports the same generic task error", async () => {
  const active = controller("- [ ] task");
  (vscode.workspace as any).applyEdit = async () => false;
  try {
    receive({ type: "toggleTask", offset: 2, checked: true, documentVersion: 1 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(posted.at(-1).model.error.message, "Could not update this task. Try again.");
  } finally {
    (vscode.workspace as any).applyEdit = async () => false;
    active.dispose();
  }
});

test("untrusted workspaces reject forged task toggles", async () => {
  const active = controller("- [ ] task");
  let edits = 0;
  (vscode.workspace as any).applyEdit = async () => { edits += 1; return true; };
  trusted = false;
  try {
    receive({ type: "toggleTask", offset: 2, checked: true, documentVersion: 1 });
    assert.equal(edits, 0);
    assert.equal(posted.at(-1).model.canToggleTasks, false);
    trusted = true;
    active.onWorkspaceTrustGranted();
    assert.equal(posted.at(-1).model.canToggleTasks, true);
  } finally {
    trusted = true;
    (vscode.workspace as any).applyEdit = async () => false;
    active.dispose();
  }
});

test("granting workspace trust clears the trust error instead of leaving it stuck", async () => {
  const active = controller("Draft");
  trusted = false;
  try {
    await active.analyze();
    assert.equal(posted.at(-1).model.error.message, "Trust this workspace before running sharp-pen analysis.");
    trusted = true;
    active.onWorkspaceTrustGranted();
    assert.equal(posted.at(-1).model.error, undefined);
    assert.equal(posted.at(-1).model.canAnalyze, true);
  } finally {
    trusted = true;
    active.dispose();
  }
});

test("granting workspace trust leaves an unrelated error message untouched", async () => {
  const active = controller("Draft", async () => { throw new Error("boom"); });
  try {
    await active.analyze();
    assert.equal(posted.at(-1).model.error.message, "Analysis failed. Try switching models or retrying.");
    active.onWorkspaceTrustGranted();
    assert.equal(posted.at(-1).model.error.message, "Analysis failed. Try switching models or retrying.");
  } finally {
    active.dispose();
  }
});

test("a successful task edit clears only a prior task error", async () => {
  let source = "- [ ] task";
  const document: any = {
    uri: { toString: () => "file:///task-error.md" }, fileName: "/task-error.md", languageId: "markdown", version: 1,
    getText: () => source, positionAt: (offset: number) => offset,
  };
  const active = new ReviewController(document, "extension" as any, undefined, () => {}, 2 as any);
  let fail = true;
  (vscode.workspace as any).applyEdit = async (edit: any) => {
    if (fail) throw new Error("host detail");
    for (const item of edit.entries) {
      const contentChanges = [{ range: {} as any, rangeOffset: item.range.start, rangeLength: item.range.end - item.range.start, text: item.text }];
      source = source.slice(0, item.range.start) + item.text + source.slice(item.range.end);
      document.version += 1;
      active.onDocumentChanged({ document, contentChanges } as any);
    }
    return true;
  };
  try {
    receive({ type: "toggleTask", offset: 2, checked: true, documentVersion: 1 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(posted.at(-1).model.error.message, "Could not update this task. Try again.");
    fail = false;
    receive({ type: "toggleTask", offset: 2, checked: true, documentVersion: 1 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(posted.at(-1).model.error, undefined);
    (active as any).error = { message: "Analysis failed. Try switching models or retrying.", action: "analyze" };
    receive({ type: "toggleTask", offset: 2, checked: false, documentVersion: 2 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(posted.at(-1).model.error.message, "Analysis failed. Try switching models or retrying.");
  } finally {
    (vscode.workspace as any).applyEdit = async () => false;
    active.dispose();
  }
});

test("cancelling analysis restores task-error provenance for a later retry", async () => {
  let source = "- [ ] task";
  let started!: () => void;
  let finish!: () => void;
  const runnerStarted = new Promise<void>((resolve) => { started = resolve; });
  const document: any = {
    uri: { toString: () => "file:///task-cancel.md" }, fileName: "/task-cancel.md", languageId: "markdown", version: 1,
    getText: () => source, positionAt: (offset: number) => offset,
  };
  const active = new ReviewController(document, "extension" as any, async () => {
    started();
    await new Promise<void>((resolve) => { finish = resolve; });
    return { title: "Draft", level1: [], level2: [] };
  }, () => {}, 2 as any);
  (active as any).error = { message: "Could not update this task. Try again." };
  (active as any).taskError = true;
  (vscode.workspace as any).applyEdit = async (edit: any) => {
    for (const item of edit.entries) {
      const contentChanges = [{ range: {} as any, rangeOffset: item.range.start, rangeLength: item.range.end - item.range.start, text: item.text }];
      source = source.slice(0, item.range.start) + item.text + source.slice(item.range.end);
      document.version += 1;
      active.onDocumentChanged({ document, contentChanges } as any);
    }
    return true;
  };
  try {
    const analysis = active.analyze();
    await runnerStarted;
    active.cancelAnalysis();
    assert.equal((active as any).taskError, true);
    receive({ type: "toggleTask", offset: 2, checked: true, documentVersion: 1 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(posted.at(-1).model.error, undefined);
    finish();
    await analysis;
  } finally {
    (vscode.workspace as any).applyEdit = async () => false;
    active.dispose();
  }
});

test("review shell includes an accessible split divider", () => {
  const html = reviewWebviewHtml({ asWebviewUri: () => "asset" } as any, "extension" as any);
  assert.match(html, /id="split-divider"[^>]*role="separator"[^>]*aria-orientation="vertical"[^>]*aria-valuemin="20"[^>]*aria-valuemax="80"[^>]*aria-valuenow="50"[^>]*tabindex="0"/);
});

test("review shell and client expose persistent accessible preview zoom", () => {
  const html = reviewWebviewHtml({ asWebviewUri: () => "asset", cspSource: "source" } as any, "extension" as any);
  const script = readFileSync("src/webview/reviewClient.js", "utf8");
  const css = readFileSync("media/review.css", "utf8");
  assert.match(html, /class="zoom-controls" role="group" aria-label="Preview zoom"/);
  assert.match(html, /id="zoom-value"[^>]*inputmode="numeric"[^>]*value="100%"/);
  assert.match(html, /id="zoom-out"[^>]*aria-label="Zoom out"/);
  assert.match(html, /id="zoom-in"[^>]*aria-label="Zoom in"/);
  assert.match(script, /normalizePreviewZoom\(saved\.zoom\)/);
  assert.match(script, /event\.ctrlKey.*event\.metaKey/);
  // Ctrl/Cmd +/-/0 are contributed VS Code keybindings (package.json), not a webview keydown listener,
  // so the workbench's own window-zoom and sidebar-focus commands are never also triggered (see R3-01).
  assert.doesNotMatch(script, /window\.addEventListener\("keydown"/);
  assert.match(script, /message\?\.type === "zoom"/);
  assert.match(script, /message\.command === "reset"/);
  assert.match(script, /Number\.parseFloat\(els\.zoomValue\.value\)/);
  assert.match(css, /\.zoom-controls \{[\s\S]*background: var\(--sp-bg\);[\s\S]*bottom: 10px;[\s\S]*position: fixed;[\s\S]*right: 10px;/);
  assert.match(css, /\.zoom-controls input \{ background: var\(--sp-bg\);[\s\S]*width: 3\.8em;/);
  assert.match(css, /\.zoom-controls input:focus-visible \{ box-shadow: inset 0 -1px 0 var\(--sp-focus\); outline: none; \}/);
  assert.match(css, /\.zoom-controls button \{ background: var\(--sp-bg\);[\s\S]*min-height: 22px;/);
  assert.match(css, /\.zoom-controls button:hover:not\(:disabled\) \{ background: var\(--sp-secondary-bg\); \}/);
});

test("review toolbar count starts as a polite actionable status", () => {
  const html = reviewWebviewHtml({ asWebviewUri: () => "asset" } as any, "extension" as any);
  assert.match(html, /id="count" aria-live="polite" aria-atomic="true" aria-label="Nothing to show; run analysis">Nothing to show — run analysis<\/output>/);
});

test("settings uses the compact VS Code gear icon", () => {
  const html = reviewWebviewHtml({ asWebviewUri: () => "asset", cspSource: "source" } as any, "extension" as any);
  const css = readFileSync("media/review.css", "utf8");
  assert.match(html, /<svg data-icon="gear-compact"[^>]*viewBox="0 0 12 12"/);
  assert.match(css, /#settings svg \{ height: 16px; width: 16px; \}/);
});

test("task checkboxes are located via the enclosing list item, not a <label> wrapper (see R4-01)", () => {
  const script = readFileSync("media/review.js", "utf8");
  assert.match(script, /closest\("li\.task-list-item"\)\?\.querySelector\("input\.task-list-item-checkbox"\)/);
  assert.doesNotMatch(script, /closest\("label"\)/);
});

test("a collapsed invalidated suggestion renders no pill (see R4-08)", () => {
  const script = readFileSync("media/review.js", "utf8");
  assert.match(script, /if \(s\.status === "invalidated" && s\.start === s\.end\) return document\.createTextNode\(""\);/);
});

test("review shell keeps inline review free of a banner", () => {
  const html = reviewWebviewHtml({ asWebviewUri: () => "asset" } as any, "extension" as any);
  assert.match(html, /id="inline-pane" aria-label="Inline review"><div id="inline"/);
  assert.doesNotMatch(html, /id="inline-pane"[^>]*><h2>/);
});

test("settings shell is a CSP-protected, labelled panel with safe dynamic rendering", () => {
  const html = settingsWebviewHtml({ asWebviewUri: () => "asset", cspSource: "csp" } as any, "extension" as any);
  const script = readFileSync("media/settings.js", "utf8");
  assert.match(html, /<title>sharp-pen Settings<\/title>/);
  assert.match(html, /default-src 'none'; style-src csp; script-src 'nonce-[^']+';/);
  assert.match(html, /<label for="client">Client<\/label>/);
  assert.match(html, /<label for="model">Model ID<\/label>/);
  assert.match(html, /<label for="theme">Theme<\/label>/);
  assert.match(html, /id="status" role="status" aria-live="polite"/);
  assert.match(html, /id="refresh-models" type="button">Refresh models/);
  assert.match(html, /id="manual-model" hidden/);
  assert.match(html, /id="models" disabled aria-describedby="model-provider model-choice-help"/);
  assert.match(html, /id="model"[^>]*aria-describedby="model-id-help"/);
  assert.match(script, /(?:const|var) otherModel = "__sharp_pen_other_model__"/);
  assert.match(script, /option\(otherModel, "Other \(specify model ID\)"\)/);
  assert.match(script, /els\.manualModel\.hidden = !showingManual;/);
  assert.match(script, /els\.model\.focus\(\);/);
  assert.match(script, /if \(modelSaved\) els\.models\.focus\(\);/);
  assert.match(script, /textContent = model\.status/);
  assert.doesNotMatch(script, /innerHTML/);
});

test("empty reviews force inline and hide both review toggles", () => {
  const html = reviewWebviewHtml({ asWebviewUri: () => "asset" } as any, "extension" as any);
  const script = readFileSync("media/review.js", "utf8");
  const css = readFileSync("media/review.css", "utf8");
  assert.match(html, /id="level-toggle" class="segmented" aria-label="Review level"/);
  assert.match(html, /id="view-toggle" class="segmented" aria-label="Review layout"/);
  assert.match(script, /const hasSuggestions = \(\) => all\(\)\.length > 0;/);
  assert.match(script, /const effectiveView = \(\) => !hasSuggestions\(\) \|\| narrowLayout\.matches \? "inline" : view;/);
  assert.match(script, /const showToggles = hasSuggestions\(\);/);
  assert.match(script, /els\.levelToggle\.hidden = !showToggles;/);
  assert.match(script, /els\.viewToggle\.hidden = !showToggles;/);
  assert.match(css, /#level-toggle\[hidden\], #view-toggle\[hidden\] \{ display: none; \}/);
});

test("review actions are hidden without a current review and survive re-analysis", () => {
  const script = readFileSync("media/review.js", "utf8");
  const css = readFileSync("media/review.css", "utf8");
  assert.match(script, /const hasReview = Boolean\(model\.hasReview\);/);
  assert.match(script, /\$\("next"\)\.hidden = !hasReview;/);
  assert.match(script, /\$\("accept-all"\)\.hidden = !hasReview;/);
  assert.match(script, /els\.apply\.hidden = !hasReview;/);
  assert.match(script, /\[data-action='next'\]"\)\.hidden = !hasReview;/);
  assert.match(script, /\[data-action='accept-all'\]"\)\.hidden = !hasReview;/);
  assert.match(css, /#overflow-menu \[data-action\]\[hidden\] \{ display: none; \}/);
});

test("task preview binds controls to source markers and fails closed on injected Markdown", () => {
  const script = readFileSync("media/review.js", "utf8");
  assert.match(script, /function taskToken\(offset\)/);
  assert.match(script, /function attachTaskControls\(container\)/);
  assert.match(script, /taskControlsMatch\(model\.tasks\.length, mapped\.size, inputs\.length, valid\)/);
});

test("preview scroll events synchronize with the source editor", () => {
  const script = readFileSync("src/webview/reviewClient.js", "utf8");
  assert.match(script, /send\(\{ type: "scrollSource", ratio \}\)/);
  assert.match(script, /message\?\.type === "sourceScroll"/);
  assert.match(script, /els\.inline\.addEventListener\("scroll"/);
  assert.match(script, /const synchronizedScrollTops = new WeakMap\(\)/);
  assert.match(script, /const pendingScrollTops = new Map\(\)/);
  assert.match(script, /sourceScrollTimer = setTimeout\([\s\S]*, 50\);/);
});

test("Next and suggestion focus restore target the pane the current view actually renders", () => {
  const script = readFileSync("src/webview/reviewClient.js", "utf8");
  assert.match(script, /function suggestionPane\(\) \{\s*return effectiveView\(\) === "inline" \? els\.inline : els\.draft;\s*\}/);
  assert.match(script, /const target = suggestionPane\(\)\.querySelector\(`\[data-suggestion-id="\$\{CSS\.escape\(suggestion\.id\)\}"\]`\);/);
  assert.match(script, /const pane = suggestionPane\(\);\s*requestAnimationFrame\(\(\) => \{\s*const target = pane\.querySelector\(`\[data-suggestion-id="\$\{CSS\.escape\(id\)\}"\]`\);/);
});

test("task marker cleanup precedes fail-closed validation", () => {
  const script = readFileSync("media/review.js", "utf8");
  assert.match(script, /let valid = true;/);
  assert.match(script, /if \(!task \|\| !input \|\| mapped\.has\(task\?\.offset\)\) valid = false;/);
  assert.match(script, /node\.data = cleanTaskMarkers\(node\.data, marker\);/);
  assert.match(script, /if \(!taskControlsMatch\(model\.tasks\.length, mapped\.size, inputs\.length, valid\)\) return;/);
});

test("the suggestion-marker fallback also strips task identities", () => {
  const script = readFileSync("media/review.js", "utf8");
  assert.match(script, /if \(!replaceMarkers\(container, side\)\) \{\s*container\.textContent = cleanFenceText\(cleanTaskMarkers\(source, taskPattern\(\)\)\);/);
  assert.match(script, /cleanFenceMarkers\(container\);\s*attachTaskControls\(container\);\s*attachFenceControls\(container\);/);
});

test("task preview gates controls by trust and restores focused task controls", () => {
  const script = readFileSync("media/review.js", "utf8");
  assert.match(script, /const canToggleTasks = \(\) => Boolean\(model\?\.canToggleTasks\) && !isReadOnly\(\);/);
  assert.match(script, /input\.dataset\.taskPane = container\.id;/);
  assert.match(script, /function focusedTask\(\)/);
  assert.match(script, /function restoreTaskFocus\(task\)/);
  assert.match(script, /else if \(taskFocus\) restoreTaskFocus\(taskFocus\);/);
});

test("successful analyses reset suggested reviews to inline, but cancellation does not", () => {
  const script = readFileSync("media/review.js", "utf8");
  assert.match(script, /const effectiveView = \(\) => !hasSuggestions\(\) \|\| narrowLayout\.matches \? "inline" : view;/);
  assert.match(script, /const activeView = effectiveView\(\);/);
  assert.match(script, /button\.setAttribute\("aria-pressed", String\(button\.dataset\.view === activeView\)\);/);
  assert.match(script, /const completedAnalysis = lastState === "analyzing" && model\.state === "ready" && hasSuggestions\(\) && !model\.error && !cancelRequested;/);
  assert.match(script, /if \(completedAnalysis\) \{\s*view = "inline";\s*splitPosition = 50;\s*persist\(\);\s*\}/);
  assert.match(script, /cancelRequested = model\.state === "analyzing";/);
  assert.match(script, /const splitStateVersion = 1;/);
  assert.match(script, /saved\.splitStateVersion === splitStateVersion && Number\.isFinite\(saved\.splitPosition\)/);
  assert.match(script, /vscode\.setState\(\{ level, view, splitPosition, splitStateVersion, zoom \}\);/);
});

test("split drag source only resizes while its active primary pointer is pressed", () => {
  const script = readFileSync("media/review.js", "utf8");
  assert.match(script, /const isActiveSplitDrag = \(dragId, pointerId, buttons\) => dragId === pointerId && Boolean\(buttons & 1\)/);
  assert.match(script, /if \(!isActiveSplitDrag\(dragPointerId, event\.pointerId, event\.buttons\)\) return finishDrag\(event\.pointerId\)/);
  assert.match(script, /setPointerCapture\(event\.pointerId\)/);
  assert.match(script, /addEventListener\("pointerup"/);
  assert.match(script, /addEventListener\("pointercancel"/);
  assert.match(script, /addEventListener\("lostpointercapture"/);
  assert.match(script, /window\.addEventListener\("blur", \(\) => finishDrag\(\)\)/);
});

test("split divider keeps a six-pixel hit target while rendering a centered rule and grip", () => {
  const css = readFileSync("media/review.css", "utf8");
  assert.match(css, /--split-hit: 6px/);
  assert.match(css, /grid-template-columns: minmax\(0, var\(--split-position\)\) var\(--split-hit\) minmax\(0, calc\(100% - var\(--split-position\) - var\(--split-hit\)\)\)/);
  assert.match(css, /#split-divider \{ background: transparent;/);
  assert.match(css, /#split-divider::before \{ background: var\(--sp-border\);[\s\S]*width: 1px;/);
  assert.match(css, /#split-divider::after \{[\s\S]*content: "⋮";[\s\S]*height: 28px;/);
});

test("Markdown headings retain document styling", () => {
  const css = readFileSync("media/review.css", "utf8");
  assert.match(css, /\.pane > h2 \{/);
  assert.doesNotMatch(css, /\.pane h2 \{/);
  assert.match(css, /\.document h1, \.document h2, \.document h3/);
  assert.match(css, /\.document h1 \{ font-size: 2\.25em; font-weight: 700; \}/);
  assert.match(css, /\.document h2 \{ font-size: 1\.75em; font-weight: 700; \}/);
  assert.match(css, /\.document h3 \{ font-size: 1\.5em; font-weight: 600; \}/);
  assert.match(css, /\.document h4 \{ font-size: 1\.25em; font-weight: 600; \}/);
  assert.match(css, /\.document h5 \{ font-size: 1\.1em; font-weight: 600; \}/);
  assert.match(css, /\.document h6 \{ color: var\(--sp-muted\); font-size: 1em; font-weight: 600; \}/);
});

test("bundled Markdown preview renders the fixture safely", () => {
  const script = readFileSync("media/review.js", "utf8");
  const css = readFileSync("media/review.css", "utf8");
  const html = createMarkdownRenderer().render(readFileSync("test/fixtures/markdown-preview.md", "utf8"));
  for (let level = 1; level <= 6; level++) assert.match(html, new RegExp(`<h${level}>`));
  assert.match(html, /Heading Level Two — Mixed Case/);
  assert.match(html, /<em>italic text<\/em>.*<strong>strong text<\/strong>.*<s>struck through<\/s>/);
  assert.match(html, /<ul>\n<li>Dash item\n<ul>\n<li>Nested dash item/);
  assert.match(html, /<ol start="3">/);
  assert.match(html, /<input class="task-list-item-checkbox" checked="" disabled="" type="checkbox">/);
  assert.match(html, /<blockquote>[\s\S]*<blockquote>/);
  assert.match(html, /<pre data-sharp-pen-fence-index="0" data-sharp-pen-fence-language="typescript"><code class="language-typescript hljs">/);
  assert.match(html, /<pre data-sharp-pen-fence-index="2" data-sharp-pen-fence-language="text"><code class="language-text">Tilde-fenced code block/);
  assert.match(html, /<pre><code>Indented code block/);
  assert.match(html, /<table>[\s\S]*<th class="markdown-align-left">Left<\/th>/);
  assert.doesNotMatch(html, /style="text-align:/);
  assert.match(html, /\*not italic\*/);
  assert.match(html, /\[not a link\]/);
  assert.match(html, /<span class="markdown-link" title="\.\/reference-target\.md">reference link<\/span>/);
  assert.match(html, /<span class="markdown-link" title="https:\/\/example\.invalid\/markdown-preview">https:\/\/example\.invalid\/markdown-preview<\/span>/);
  assert.doesNotMatch(html, /<a\b|\bhref=/i);
  assert.match(html, /&lt;mark&gt;Raw HTML shown safely/);
  assert.match(html, /&lt;mark&gt;Raw inline HTML shown safely as text&lt;\/mark&gt;/);
  assert.match(html, /&lt;div class=&quot;example&quot;&gt;Raw block HTML shown safely as text&lt;\/div&gt;/);
  assert.match(html, /&lt;script&gt;Harmless script-looking text&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<(?:mark|div|script)(?:\s|>)/);
  assert.match(html, /<img src="data:image\/gif;base64,/);
  assert.doesNotMatch(createMarkdownRenderer().render("[bad](command:run) ![remote](https://example.invalid/image.png)"), /(?:href="command:|src="https:)/);
  const dataLink = createMarkdownRenderer().render("[data link](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==)");
  assert.match(dataLink, /data link/);
  assert.doesNotMatch(dataLink, /<a[^>]*href="data:image/i);
  assert.ok(script.includes("markdown-it"));
  assert.doesNotMatch(script, /function renderBlocks\(parent, blockLines\)/);
  assert.match(css, /\.document blockquote \{ background: var\(--sp-quote-bg\); border-left: 7px solid var\(--sp-quote-rail\);/);
  assert.match(css, /\.document ul, \.document ol \{ margin: 0 0 1em; padding-left: 1\.6em; \}/);
  assert.match(css, /\.document table \{ border: 1px solid var\(--sp-border\); border-collapse: separate; border-radius: var\(--sp-radius\); border-spacing: 0; max-width: none; min-width: max-content; overflow: hidden; \}/);
  assert.match(css, /\.document th, \.document td \{ border: 0; padding: \.35em \.55em; text-align: left; \}/);
  assert.match(css, /\.document th \{ background: var\(--sp-surface\); border-bottom: 1px solid var\(--sp-border\); font-weight: 700; \}/);
  assert.match(css, /\.document th \+ th, \.document td \+ td \{ border-left: 1px solid var\(--sp-border\); \}/);
  assert.match(css, /\.document tbody tr \+ tr td \{ border-top: 1px solid var\(--sp-border\); \}/);
  assert.match(css, /\.document thead tr:first-child th:first-child \{ border-top-left-radius: calc\(var\(--sp-radius\) - 1px\); \}/);
  assert.match(css, /\.document tbody tr:last-child td:last-child \{ border-bottom-right-radius: calc\(var\(--sp-radius\) - 1px\); \}/);
  assert.match(css, /\.document \.task-list, \.document \.contains-task-list \{ list-style: none; \}/);
  assert.match(css, /\.document \.markdown-link \{ color: var\(--sp-link\); text-decoration: underline; \}/);
});

test("review and settings share the monochrome rounded visual system", () => {
  const reviewCss = readFileSync("media/review.css", "utf8");
  const settingsCss = readFileSync("media/settings.css", "utf8");
  assert.match(reviewCss, /--sp-button-bg: #171717; --sp-button-text: #ffffff;/);
  assert.match(reviewCss, /--sp-hl-comment: #686868;/);
  assert.match(reviewCss, /:root\[data-preview-theme="dark"\] \{[\s\S]*--sp-bg: #171717;[\s\S]*--sp-button-bg: #f5f5f5;/);
  assert.match(reviewCss, /--sp-radius: 9px; --sp-radius-sm: 6px;/);
  assert.match(reviewCss, /button:focus-visible, input:focus-visible, \.suggestion:focus-visible \{ outline: 2px solid var\(--sp-focus\);/);
  assert.match(reviewCss, /#error \{[\s\S]*border: 1px solid var\(--sp-error-border\);[\s\S]*border-radius: 0 0 var\(--sp-radius\)/);
  assert.match(reviewCss, /\.suggestion \{[\s\S]*text-decoration: line-through;/);
  assert.match(reviewCss, /\.suggestion\.suggested \{[\s\S]*text-decoration: underline dotted;/);
  assert.match(settingsCss, /--sp-radius: 9px; --sp-radius-sm: 6px;/);
  assert.match(settingsCss, /body\.vscode-dark \{ --sp-bg: #171717;/);
  assert.match(settingsCss, /input:focus-visible, select:focus-visible, button:focus-visible \{ outline: 2px solid var\(--sp-focus\);/);
  assert.match(settingsCss, /section \{[\s\S]*border-radius: var\(--sp-radius\);/);
});

test("highlight token CSS covers selector variants and high-contrast descendants", () => {
  const css = readFileSync("media/review.css", "utf8");
  assert.match(css, /\.hljs-selector-class, \.document pre\.fenced-code \.hljs-selector-id, \.document pre\.fenced-code \.hljs-selector-tag, \.document pre\.fenced-code \.hljs-selector-pseudo, \.document pre\.fenced-code \.hljs-selector-attr, \.document pre\.fenced-code \.hljs-section/);
  assert.match(css, /\.hljs-regexp, \.document pre\.fenced-code \.hljs-addition/);
  assert.match(css, /\.hljs-link \{ color: var\(--sp-hl-title\); text-decoration: underline; \}/);
  assert.match(css, /\.hljs-bullet \{ color: var\(--sp-hl-keyword\); font-weight: 600; \}/);
  assert.match(css, /\.hljs-deletion \{ color: var\(--sp-hl-number\); text-decoration: line-through; \}/);
  assert.match(css, /\.hljs-strong \{ font-weight: 700; \}/);
  assert.match(css, /\.hljs-emphasis \{ font-style: italic; \}/);
  assert.match(css, /\.hljs-symbol, \.document pre\.fenced-code \.hljs-template-tag/);
  assert.match(css, /body\.vscode-high-contrast \.document pre\.fenced-code \.hljs, body\.vscode-high-contrast-light \.document pre\.fenced-code \.hljs, body\.vscode-high-contrast \.document pre\.fenced-code \.hljs \*, body\.vscode-high-contrast-light \.document pre\.fenced-code \.hljs \* \{ color: inherit !important; \}/);
});

test("blockquote panels keep a light nested surface and explicit dark and contrast tokens", () => {
  const css = readFileSync("media/review.css", "utf8");
  assert.match(css, /--sp-quote-bg: #f3f3f3; --sp-quote-rail: #d6d6d6; --sp-quote-text: #5f5f5f;/);
  assert.match(css, /:root\[data-preview-theme="dark"\] \{[\s\S]*--sp-quote-bg: #242424; --sp-quote-rail: #5a5a5a; --sp-quote-text: #c7c7c7;/);
  assert.match(css, /\.document blockquote \{[\s\S]*border-left: 7px solid var\(--sp-quote-rail\);[\s\S]*padding: \.6em 1em \.65em 1\.05em;[\s\S]*width: 100%;/);
  assert.match(css, /\.document blockquote blockquote \{ background: transparent; border-left-width: 5px; border-radius: 0; margin: \.75em 0 \.15em; padding: \.1em 0 \.1em \.9em; \}/);
  assert.match(css, /\.document blockquote ul, \.document blockquote ol \{ margin: \.55em 0 \.2em; padding-left: 1\.5em; \}/);
  assert.match(css, /body\.vscode-high-contrast-light \{[\s\S]*--sp-quote-rail: var\(--vscode-contrastBorder, currentColor\);/);
});

test("fenced selector and themed scrollbar CSS leave indented code plain", () => {
  const css = readFileSync("media/review.css", "utf8");
  const script = readFileSync("media/review.js", "utf8");
  assert.match(css, /\.document pre\.fenced-code \{ min-height: 3em; padding-top: 2\.2em; position: relative; white-space: pre; \}/);
  assert.match(css, /\.fence-language \{ background: var\(--sp-surface\); border: 0; border-radius: var\(--sp-radius-sm\); color: var\(--sp-text\); font: inherit; font-size: \.72em; line-height: 1\.2; max-width: calc\(100% - 12px\); min-height: 20px; padding: 1px 4px; position: absolute; right: 5px; top: 4px; \}/);
  assert.match(css, /html, body, \.document, \.menu, \.toolbar \{ scrollbar-color: var\(--sp-scroll-thumb\) var\(--sp-scroll-track\); \}/);
  assert.match(css, /:root\[data-preview-theme="dark"\] \{[\s\S]*color-scheme: dark;/);
  assert.match(script, /function attachFenceControls\(container\)/);
  assert.match(script, /data-sharp-pen-fence-index/);
  assert.match(script, /function restoreFenceFocus\(/);
  assert.match(script, /Code block \$\{index \+ 1\} language/);
});
