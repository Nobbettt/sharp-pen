import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const Module = require("node:module") as { _load: (...args: any[]) => unknown };
const load = Module._load;
const disposable = { dispose() {} };
const posted: any[] = [];
let receive: (message: unknown) => void = () => {};
const vscode = {
  ProgressLocation: { Notification: 15 },
  Uri: { joinPath: (...parts: string[]) => parts.join("/") },
  workspace: { isTrusted: true },
  window: {
    visibleTextEditors: [],
    createWebviewPanel: () => ({
      webview: {
        html: "",
        asWebviewUri: () => "asset",
        onDidReceiveMessage: (listener: typeof receive) => { receive = listener; return disposable; },
        postMessage: (message: unknown) => { posted.push(message); return Promise.resolve(true); },
      },
      onDidDispose: () => disposable,
      reveal() {},
      dispose() {},
    }),
    withProgress: (_options: unknown, task: (progress: unknown, token: unknown) => Promise<unknown>) => task({}, { onCancellationRequested: () => disposable }),
  },
};
Module._load = (request: string, ...args: any[]) => request === "vscode" ? vscode : load(request, ...args);
const { ReviewController, canAnalyzeReview } = require("../src/reviewController") as typeof import("../src/reviewController");
const { REVIEW_LIMITS } = require("../src/review/validate") as typeof import("../src/review/validate");
const { reviewWebviewHtml } = require("../src/webview/reviewWebview") as typeof import("../src/webview/reviewWebview");
const { createMarkdownRenderer } = require("../src/webview/markdownRenderer") as typeof import("../src/webview/markdownRenderer");
Module._load = load;

const review = { analysisDocumentVersion: 4, currentDocumentVersion: 4 };

function controller(source: string, runner: import("../src/reviewController").AnalysisRunner = async () => ({ title: "Draft", level1: [], level2: [] })) {
  posted.length = 0;
  const document = {
    uri: { toString: () => "file:///draft.md" }, fileName: "/draft.md", languageId: "markdown", version: 1, getText: () => source,
  };
  return new ReviewController(document as any, "extension" as any, runner, () => {}, 2 as any);
}

test("analysis eligibility accepts only stale, empty, or retryable reviews", () => {
  assert.equal(canAnalyzeReview(review), false);
  assert.equal(canAnalyzeReview({ ...review, currentDocumentVersion: 5 }), true);
  assert.equal(canAnalyzeReview(review, true), true);
  assert.equal(canAnalyzeReview(review, false), false);
  assert.equal(canAnalyzeReview(undefined), true);
});

test("a second Analyze request cancels the active analysis", async () => {
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

test("oversized documents never enter the webview model", () => {
  const active = controller("x".repeat(REVIEW_LIMITS.source + 1));
  receive({ type: "ready" });
  const model = posted.at(-1).model;
  assert.equal(model.currentSource, "");
  assert.equal(model.canAnalyze, false);
  assert.deepEqual(model.level1, []);
  assert.match(model.error.message, /preview and analysis limit/);
  active.dispose();
});

test("review shell includes an accessible split divider", () => {
  const html = reviewWebviewHtml({ asWebviewUri: () => "asset" } as any, "extension" as any);
  assert.match(html, /id="split-divider"[^>]*role="separator"[^>]*aria-orientation="vertical"[^>]*aria-valuemin="20"[^>]*aria-valuemax="80"[^>]*aria-valuenow="50"[^>]*tabindex="0"/);
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
  assert.match(script, /vscode\.setState\(\{ level, view, splitPosition, splitStateVersion \}\);/);
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
  assert.match(html, /<pre><code class="language-typescript">/);
  assert.match(html, /<pre><code class="language-text">Tilde-fenced code block/);
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
  assert.match(css, /\.document blockquote \{ border-left: 3px solid var\(--sp-border\); color: var\(--sp-muted\);/);
  assert.match(css, /\.document ul, \.document ol \{ margin: 0 0 1em; padding-left: 1\.6em; \}/);
  assert.match(css, /\.document \.task-list, \.document \.contains-task-list \{ list-style: none; \}/);
  assert.match(css, /\.document \.markdown-link \{ color: var\(--sp-link\); text-decoration: underline; \}/);
});
