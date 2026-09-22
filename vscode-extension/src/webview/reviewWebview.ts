import * as vscode from "vscode";
import { randomUUID } from "crypto";
import type { PreviewTheme } from "../config";

export type ReviewIntent =
  | { type: "ready" }
  | { type: "analyze" }
  | { type: "cancel" }
  | { type: "choose"; suggestionId: string; option: number | null }
  | { type: "acceptAll"; level: 1 | 2 }
  | { type: "reset"; level: 1 | 2 }
  | { type: "apply" }
  | { type: "openSettings" };

export interface WebviewSuggestion {
  id: string;
  level: 1 | 2;
  start: number;
  end: number;
  from: string;
  options: string[];
  note: string;
  status: "active" | "invalidated";
  decision: number | null;
  decided: boolean;
}

export interface ReviewWebviewModel {
  title: string;
  format: "markdown" | "plaintext";
  currentSource: string;
  level1: WebviewSuggestion[];
  level2: WebviewSuggestion[];
  state: "empty" | "analyzing" | "ready" | "modified" | "applied" | "error";
  applying: boolean;
  canAnalyze: boolean;
  previewTheme: PreviewTheme;
  error?: { message: string; action?: "openSettings" | "analyze" | "apply" };
}

/** Static shell only: all document and review data arrives through postMessage. */
export function reviewWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const style = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "review.css"));
  const script = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "review.js"));
  const nonce = randomUUID().replace(/-/g, "");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
  <link rel="stylesheet" href="${style}">
  <title>Sharp Pen</title>
</head>
<body>
  <header class="toolbar" aria-label="Sharp Pen review controls">
    <button id="analyze" class="primary" type="button">Analyze</button>
    <div id="level-toggle" class="segmented" aria-label="Review level">
      <button type="button" data-level="1" aria-pressed="true">L1</button>
      <button type="button" data-level="2" aria-pressed="false">L2</button>
    </div>
    <div id="view-toggle" class="segmented" aria-label="Review layout">
      <button type="button" data-view="split" aria-label="Split view" aria-pressed="true" title="Split view">↔</button>
      <button type="button" data-view="inline" aria-label="Inline view" aria-pressed="false" title="Inline view">≋</button>
    </div>
    <output id="count" aria-label="Accepted suggestions">0/0</output>
    <button id="next" type="button">Next</button>
    <button id="accept-all" type="button">Accept all</button>
    <button id="apply" class="primary" type="button" disabled>Apply</button>
    <div class="overflow-wrap">
      <button id="overflow" type="button" aria-haspopup="menu" aria-expanded="false" aria-label="More actions">⋯</button>
      <div id="overflow-menu" class="menu" role="menu" hidden>
        <button type="button" role="menuitem" data-action="next">Next</button>
        <button type="button" role="menuitem" data-action="accept-all">Accept all</button>
        <button type="button" role="menuitem" data-action="settings">Settings</button>
        <button type="button" role="menuitem" data-reset="level">Reset current level</button>
        <button type="button" role="menuitem" data-reset="all">Reset all</button>
      </div>
    </div>
    <button id="settings" type="button" aria-label="Open Sharp Pen settings" title="Open Sharp Pen settings"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path fill="currentColor" d="M19.14 12.94c.04-.31.06-.62.06-.94s-.02-.63-.07-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.1 7.1 0 0 0-1.63-.94L14.5 2.78A.5.5 0 0 0 14 2.4h-4a.5.5 0 0 0-.5.38l-.36 2.54c-.58.24-1.13.56-1.63.94l-2.39-.96a.5.5 0 0 0-.61.22L2.59 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.08.63-.08.94s.03.63.08.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.31.61.22l2.39-.96c.5.38 1.05.7 1.63.94l.36 2.54c.04.24.24.42.5.42h4c.25 0 .46-.18.5-.42l.36-2.54c.58-.24 1.13-.56 1.63-.94l2.39.96c.22.09.48 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z"/></svg></button>
  </header>
  <div id="error" role="alert" hidden><span></span><button type="button" hidden></button></div>
  <main class="split">
    <section class="pane" id="draft-pane" aria-label="Current staged draft"><h2>Draft</h2><div id="draft" class="document" tabindex="0"></div></section>
    <div id="split-divider" role="separator" aria-orientation="vertical" aria-label="Resize draft and suggested panes" aria-valuemin="20" aria-valuemax="80" aria-valuenow="50" tabindex="0"></div>
    <section class="pane" id="suggested-pane" aria-label="Suggested result"><h2>Suggested</h2><div id="suggested" class="document" tabindex="0"></div></section>
    <section class="pane" id="inline-pane" aria-label="Inline review"><h2>Review</h2><div id="inline" class="document" tabindex="0"></div></section>
  </main>
  <div id="choices" class="menu choices" role="menu" hidden></div>
  <div id="announcements" class="sr-only" aria-live="polite"></div>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
}
