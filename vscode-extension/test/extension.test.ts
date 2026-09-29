import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("standalone model commands resolve every configured adapter", () => {
  const source = readFileSync("src/extension.ts", "utf8");
  assert.match(source, /selectAdapter\(requested, abort\.signal\)/);
  assert.doesNotMatch(source, /requested === "opencode"/);
  assert.doesNotMatch(source, /selectAdapter\(settings\.getConfig\(\)\.aiClient, abort\.signal\)/);
});

test("workspace trust grants refresh reviews and the open settings panel", () => {
  const source = readFileSync("src/extension.ts", "utf8");
  assert.match(source, /workspace\.onDidGrantWorkspaceTrust\(\(\) => \{/);
  assert.match(source, /controller\.onWorkspaceTrustGranted\(\)/);
  assert.match(source, /settingsPanel\?\.onWorkspaceTrustGranted\(\)/);
});

test("editor visible-range changes are forwarded to the matching review", () => {
  const source = readFileSync("src/extension.ts", "utf8");
  assert.match(source, /onDidChangeTextEditorVisibleRanges\(\(event\) => controllerFor\(event\.textEditor\.document\)\?\.onEditorVisibleRanges\(event\)\)/);
});

test("standalone model command errors warn generically and sync an open panel", () => {
  const source = readFileSync("src/extension.ts", "utf8");
  assert.match(source, /const runModelCommand = \(refresh = false\): void => \{/);
  assert.match(source, /showWarningMessage\("Could not save model selection\. Try again\."\)/);
  assert.match(source, /settingsPanel\?\.sync\(\);/);
  assert.match(source, /registerCommand\("sharpPen\.selectModel", \(\) => runModelCommand\(\)\)/);
  assert.match(source, /registerCommand\("sharpPen\.refreshModels", \(\) => runModelCommand\(true\)\)/);
});

test("openReview and analyze resolve the menu's clicked resource instead of only the active editor", () => {
  const source = readFileSync("src/extension.ts", "utf8");
  assert.match(source, /registerCommand\("sharpPen\.openReview", \(uri\?: vscode\.Uri\) => \{ const document = activeDocument\(uri\); if \(document\) open\(document\); \}\)/);
  assert.match(source, /registerCommand\("sharpPen\.analyze", async \(uri\?: vscode\.Uri\) => \{\s+const document = activeDocument\(uri\);\s+if \(!document\) return undefined;\s+const controller = open\(document\);/);
  assert.match(source, /function resolveDocument\(uri\?: vscode\.Uri\): vscode\.TextDocument \| undefined \{/);
  assert.match(source, /vscode\.workspace\.textDocuments\.find\(\(candidate\) => candidate\.uri\.toString\(\) === uri\.toString\(\)\)/);
});

test("cancelling analysis falls back to the shown review and warns when nothing is active", () => {
  const source = readFileSync("src/extension.ts", "utf8");
  assert.match(source, /const controller = \(document && controllerFor\(document\)\) \?\? shown;/);
  assert.match(source, /showWarningMessage\("No sharp-pen review is active to cancel\."\)/);
});

test("the model picker opens only after the discovery progress notification closes", () => {
  const source = readFileSync("src/extension.ts", "utf8");
  assert.match(source, /const found = await vscode\.window\.withProgress\(/);
  assert.match(source, /return abort\.signal\.aborted \? undefined : \{ client: client\.id, models \};/);
  assert.match(source, /return found \? showModelPicker\(settings, discovery, found\.client, found\.models\) : undefined;/);
  assert.doesNotMatch(source, /return abort\.signal\.aborted \? undefined : showModelPicker\(/);
});

test("zoom shortcuts are contributed keybindings scoped to the active review panel, not a global command", () => {
  const source = readFileSync("src/extension.ts", "utf8");
  assert.match(source, /registerCommand\("sharpPen\.zoomIn", \(\) => shown\?\.zoom\("in"\)\)/);
  assert.match(source, /registerCommand\("sharpPen\.zoomOut", \(\) => shown\?\.zoom\("out"\)\)/);
  assert.match(source, /registerCommand\("sharpPen\.zoomReset", \(\) => shown\?\.zoom\("reset"\)\)/);

  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  const forCommand = (command: string) => manifest.contributes.keybindings.filter((item: { command: string }) => item.command === command);
  for (const command of ["sharpPen.zoomIn", "sharpPen.zoomOut", "sharpPen.zoomReset"]) {
    const bindings = forCommand(command);
    assert.ok(bindings.length > 0, `${command} has no keybinding`);
    for (const binding of bindings) assert.equal(binding.when, "activeWebviewPanelId == 'sharpPen.review'");
  }
});

// VS Code's workbench zoom binds every one of these chords (see the workbench.action.zoomIn/zoomOut
// keybindings); missing any lets it reach the whole window instead of the preview (see R5-07).
test("every VS Code default zoom chord is bound to the scoped sharp-pen zoom commands", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  const keys = (command: string) => manifest.contributes.keybindings
    .filter((item: { command: string }) => item.command === command)
    .flatMap((item: { key: string; mac: string }) => [item.key, item.mac]);
  assert.deepEqual(keys("sharpPen.zoomIn").sort(), ["cmd+=", "cmd+numpad_add", "cmd+shift+=", "ctrl+=", "ctrl+numpad_add", "ctrl+shift+="].sort());
  assert.deepEqual(keys("sharpPen.zoomOut").sort(), ["cmd+-", "cmd+numpad_subtract", "cmd+shift+-", "ctrl+-", "ctrl+numpad_subtract", "ctrl+shift+-"].sort());
});

test("the zoom commands are declared with titles, not left as raw IDs in Keyboard Shortcuts (see R5-13)", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  for (const command of ["sharpPen.zoomIn", "sharpPen.zoomOut", "sharpPen.zoomReset"]) {
    const declared = manifest.contributes.commands.find((item: { command: string }) => item.command === command);
    assert.ok(declared?.title, `${command} has no title in contributes.commands`);
    const paletteEntry = manifest.contributes.menus.commandPalette.find((item: { command: string }) => item.command === command);
    assert.equal(paletteEntry?.when, "activeWebviewPanelId == 'sharpPen.review'");
  }
});

test("closing the source document warns about discarded staged choices instead of disposing silently", () => {
  const source = readFileSync("src/extension.ts", "utf8");
  assert.match(source, /const staged = found\.stagedChoiceCount\(\);/);
  assert.match(source, /showWarningMessage\(\s*`sharp-pen review for "\$\{path\.basename\(document\.fileName\)\}" closed with its source; \$\{staged\} staged choice\$\{staged === 1 \? "" : "s"\} \$\{staged === 1 \? "was" : "were"\} discarded\.`,?\s*\);/);
});

function activateExtension() {
  const disposable = { dispose() {} };
  const panels: Array<{ posted: any[]; receive: (message: unknown) => void; disposed: boolean; onDisposeListener?: () => void; options?: any }> = [];
  let closeListener: (document: any) => void = () => {};
  let activeEditorListener: (editor: any) => void = () => {};
  const commandHandlers: Record<string, (...args: any[]) => unknown> = {};
  let documents: any[] = [];
  const warnings: string[] = [];
  const vscodeMock = {
    ProgressLocation: { Notification: 15 },
    EndOfLine: { LF: 1, CRLF: 2 },
    ViewColumn: { Beside: 2 },
    Uri: { joinPath: (...parts: string[]) => parts.join("/") },
    languages: { getLanguages: () => Promise.resolve([]) },
    workspace: {
      get isTrusted() { return true; },
      get textDocuments() { return documents; },
      applyEdit: async () => false,
      onDidChangeTextDocument: () => disposable,
      onDidCloseTextDocument: (listener: (document: any) => void) => { closeListener = listener; return disposable; },
      onDidGrantWorkspaceTrust: () => disposable,
    },
    window: {
      visibleTextEditors: [],
      activeTextEditor: undefined,
      showWarningMessage: (message: string) => { warnings.push(message); },
      onDidChangeTextEditorVisibleRanges: () => disposable,
      onDidChangeActiveTextEditor: (listener: (editor: any) => void) => { activeEditorListener = listener; return disposable; },
      createWebviewPanel: (_viewType: string, _title: string, _column: unknown, options: any) => {
        const panel = { posted: [] as any[], receive: ((_message: unknown) => {}) as (message: unknown) => void, disposed: false, onDisposeListener: undefined as (() => void) | undefined, options };
        panels.push(panel);
        const webviewObj = {
          html: "",
          asWebviewUri: () => "asset",
          onDidReceiveMessage: (listener: (message: unknown) => void) => { panel.receive = listener; return disposable; },
          postMessage: (message: unknown) => { panel.posted.push(message); return Promise.resolve(true); },
        };
        return {
          get webview() { return webviewObj; },
          onDidDispose: (listener: () => void) => { panel.onDisposeListener = listener; return disposable; },
          reveal() {},
          dispose() { if (panel.disposed) return; panel.disposed = true; panel.onDisposeListener?.(); },
        };
      },
    },
    commands: { registerCommand: (id: string, handler: (...args: any[]) => unknown) => { commandHandlers[id] = handler; return disposable; } },
  };
  const Module = require("node:module") as { _load: (...args: any[]) => unknown };
  const load = Module._load;
  Module._load = (request: string, ...args: any[]) => request === "vscode" ? vscodeMock : load(request, ...args);
  // Each activation gets fresh modules, so none keeps a previous test's vscode mock.
  for (const key of Object.keys(require.cache)) if (key.includes(`${require("node:path").sep}src${require("node:path").sep}`)) delete require.cache[key];
  const { activate } = require("../src/extension") as typeof import("../src/extension");
  Module._load = load;

  activate({
    subscriptions: [],
    globalState: { get: () => undefined, update: async () => {} },
    extension: { packageJSON: { version: "0.0.0" } },
    extensionUri: "ext",
  } as any);

  return {
    panels, commandHandlers, warnings,
    close: (document: any) => closeListener(document),
    focus: (document: any) => activeEditorListener(document && { document }),
    setDocuments: (next: any[]) => { documents = next; },
  };
}

test("switching a document's language id rebinds its review instead of closing it, but a real close still disposes it (see R5-04)", async () => {
  const { panels, commandHandlers, warnings, close, setDocuments } = activateExtension();
  const doc: any = { uri: { toString: () => "file:///notes.txt" }, fileName: "/notes.txt", languageId: "plaintext", version: 1, getText: () => "Hello" };
  setDocuments([doc]);
  commandHandlers["sharpPen.openReview"](doc.uri);
  assert.equal(panels.length, 1);

  // VS Code closes the plain-text document and reopens a new document object at the same URI as Markdown.
  const asMarkdown: any = { ...doc, languageId: "markdown" };
  setDocuments([asMarkdown]);
  close(doc);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(panels[0].disposed, false, "a language-id churn must not close the review");
  assert.equal(warnings.length, 0);

  // A real close: the document is gone from workspace.textDocuments and nothing reopens it.
  setDocuments([]);
  close(asMarkdown);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(panels[0].disposed, true, "a real close must still dispose the review");
});

function markdownDocument(name: string, scheme = "file"): any {
  return { uri: { scheme, toString: () => `${scheme}:///${name}` }, fileName: `/${name}`, languageId: "markdown", version: 1, getText: () => `# ${name}` };
}

const lastState = (panel: { posted: any[] }) => [...panel.posted].reverse().find((message) => message.type === "state")?.model;

test("one review panel follows the focused Markdown document and routes webview messages to it", async () => {
  const { panels, commandHandlers, focus, setDocuments } = activateExtension();
  const [a, b] = [markdownDocument("a.md"), markdownDocument("b.md")];
  setDocuments([a, b]);

  focus(a); // nothing happens before a review is open
  assert.equal(panels.length, 0);

  commandHandlers["sharpPen.openReview"](a.uri);
  assert.equal(panels.length, 1);
  focus(b);
  assert.equal(panels.length, 1, "focusing another document reuses the open panel");
  assert.equal(lastState(panels[0]).documentId, "file:///b.md");

  commandHandlers["sharpPen.openReview"](a.uri);
  assert.equal(panels.length, 1, "opening another review replaces the shown one");
  assert.equal(lastState(panels[0]).documentId, "file:///a.md");
  panels[0].receive({ type: "ready" });
  assert.equal(lastState(panels[0]).documentId, "file:///a.md", "webview messages reach the shown review");
});

test("the review panel stays alive while hidden instead of reloading on every tab switch", () => {
  const { panels, commandHandlers, setDocuments } = activateExtension();
  const a = markdownDocument("a.md");
  setDocuments([a]);
  commandHandlers["sharpPen.openReview"](a.uri);
  assert.equal(panels[0].options.retainContextWhenHidden, true);
  assert.equal(panels[0].options.enableCommandUris, false);
});

test("the review panel ignores output channels, diffs, and unsupported languages", () => {
  const { panels, commandHandlers, focus, setDocuments } = activateExtension();
  const a = markdownDocument("a.md");
  setDocuments([a]);
  commandHandlers["sharpPen.openReview"](a.uri);
  panels[0].receive({ type: "ready" });
  focus(markdownDocument("a.md", "git"));
  focus({ ...markdownDocument("log"), languageId: "log" });
  focus(undefined);
  assert.equal(lastState(panels[0]).documentId, "file:///a.md");
});

test("closing the review panel ends every document's review", async () => {
  const { panels, commandHandlers, focus, setDocuments } = activateExtension();
  const [a, b] = [markdownDocument("a.md"), markdownDocument("b.md")];
  setDocuments([a, b]);
  commandHandlers["sharpPen.openReview"](a.uri);
  focus(b);
  panels[0].disposed = true; // the user closes the panel
  panels[0].onDisposeListener?.();
  focus(a);
  assert.equal(panels.length, 1, "no review is open to follow the editor any more");
  commandHandlers["sharpPen.openReview"](a.uri);
  assert.equal(panels.length, 2, "a new review opens a new panel");
});

test("closing the shown document's source hands the panel to another open review instead of ending them all", async () => {
  const { panels, commandHandlers, focus, close, setDocuments } = activateExtension();
  const [a, b] = [markdownDocument("a.md"), markdownDocument("b.md")];
  setDocuments([a, b]);
  commandHandlers["sharpPen.openReview"](a.uri);
  focus(b);
  commandHandlers["sharpPen.openReview"](a.uri); // a is shown again; b's review is hidden

  // a closes while focus lands on an editor the panel doesn't follow.
  setDocuments([b]);
  close(a);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(panels[0].disposed, false, "the panel stays open for the remaining review");
  assert.equal(lastState(panels[0]).documentId, "file:///b.md");

  // With no review left, closing the last source closes the panel.
  setDocuments([]);
  close(b);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(panels[0].disposed, true);
});

test("closing the review panel warns about staged choices discarded in hidden reviews", () => {
  const source = readFileSync("src/extension.ts", "utf8");
  assert.match(source, /const staged = hidden\.reduce\(\(total, review\) => total \+ review\.stagedChoiceCount\(\), 0\);/);
  assert.match(source, /showWarningMessage\(`sharp-pen review closed; \$\{staged\} staged choice/);
});

test("manifest has no native settings contribution and retains Open Settings", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(manifest.contributes.configuration, undefined);
  assert.equal(manifest.contributes.commands.some((item: { command: string }) => item.command === "sharpPen.openSettings"), true);
  assert.doesNotMatch(JSON.stringify(manifest), /sharpPen\.configure/);
});
