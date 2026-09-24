import * as vscode from "vscode";
import { randomUUID } from "crypto";
import type { PreviewTheme } from "../config";

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
  documentVersion: number;
  level1: WebviewSuggestion[];
  level2: WebviewSuggestion[];
  state: "empty" | "analyzing" | "ready" | "modified" | "applied" | "error";
  applying: boolean;
  canAnalyze: boolean;
  hasReview: boolean;
  canToggleTasks: boolean;
  tasks: { offset: number; checked: boolean; label: string }[];
  fences: { index: number; language: string; languageStart: number; languageEnd: number; insertionOffset: number; hasMetadata: boolean }[];
  /** Offset past the source's YAML front matter, for Markdown; 0 when there is none. */
  frontMatterEnd: number;
  codeFenceLanguages: readonly string[];
  previewTheme: PreviewTheme;
  error?: { message: string; action?: "openSettings" | "analyze" | "apply" };
  notice?: string;
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
  <title>sharp-pen</title>
</head>
<body>
  <header class="toolbar" aria-label="sharp-pen review controls">
    <button id="analyze" class="primary" type="button">Analyze</button>
    <div id="level-toggle" class="segmented" aria-label="Review level">
      <button type="button" data-level="1" aria-pressed="true">L1</button>
      <button type="button" data-level="2" aria-pressed="false">L2</button>
    </div>
    <div id="view-toggle" class="segmented" aria-label="Review layout">
      <button type="button" data-view="split" aria-label="Split view" aria-pressed="true" title="Split view">↔</button>
      <button type="button" data-view="inline" aria-label="Inline view" aria-pressed="false" title="Inline view">≋</button>
    </div>
    <output id="count" aria-live="polite" aria-atomic="true" aria-label="Nothing to show; run analysis">Nothing to show — run analysis</output>
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
    <button id="settings" type="button" aria-label="Open sharp-pen settings" title="Open sharp-pen settings"><svg data-icon="gear-compact" aria-hidden="true" focusable="false" viewBox="0 0 12 12" fill="currentColor"><path d="M5.99994 3.99898C4.89694 3.99898 3.99994 4.89598 3.99994 5.99898C3.99994 7.10198 4.89694 7.99898 5.99994 7.99898C7.10294 7.99898 7.99994 7.10198 7.99994 5.99898C7.99994 4.89598 7.10294 3.99898 5.99994 3.99898ZM5.99994 6.99898C5.44794 6.99898 4.99994 6.54998 4.99994 5.99898C4.99994 5.44798 5.44794 4.99898 5.99994 4.99898C6.55194 4.99898 6.99994 5.44798 6.99994 5.99898C6.99994 6.54998 6.55194 6.99898 5.99994 6.99898ZM11.6249 7.46998L10.5229 6.53798C10.4939 6.51298 10.4659 6.48598 10.4419 6.45698C10.1879 6.15998 10.2249 5.71498 10.5229 5.46198L11.6249 4.52998C11.7349 4.43698 11.7769 4.28798 11.7329 4.15198C11.4719 3.34598 11.0399 2.60598 10.4709 1.97898C10.4019 1.90398 10.3059 1.86198 10.2079 1.86198C10.1679 1.86198 10.1269 1.86898 10.0889 1.88298L8.72894 2.36698C8.69294 2.37998 8.65494 2.38998 8.61794 2.39698C8.57494 2.40498 8.53194 2.40898 8.48994 2.40898C8.15394 2.40898 7.85594 2.17098 7.79294 1.82998L7.53294 0.413977C7.50694 0.272977 7.39794 0.161977 7.25794 0.131977C6.84694 0.0449766 6.42594 0.000976562 5.99894 0.000976562C5.57194 0.000976562 5.15094 0.0459766 4.73894 0.131977C4.59794 0.161977 4.48994 0.272977 4.46394 0.413977L4.20494 1.82998C4.19794 1.86798 4.18794 1.90498 4.17494 1.94098C4.07094 2.22998 3.79895 2.40998 3.50695 2.40998C3.42795 2.40998 3.34794 2.39598 3.26894 2.36898L1.90894 1.88498C1.86994 1.87098 1.82894 1.86398 1.78994 1.86398C1.69094 1.86398 1.59494 1.90498 1.52694 1.98098C0.957942 2.60798 0.526941 3.34798 0.264941 4.15398C0.219941 4.28998 0.262943 4.43898 0.372943 4.53198L1.47494 5.46398C1.50394 5.48898 1.53194 5.51598 1.55594 5.54498C1.80994 5.84198 1.77294 6.28698 1.47494 6.53998L0.372943 7.47198C0.262943 7.56498 0.220941 7.71398 0.264941 7.84998C0.525941 8.65598 0.957942 9.39598 1.52694 10.023C1.59594 10.098 1.69194 10.14 1.78994 10.14C1.82994 10.14 1.87094 10.133 1.90894 10.119L3.26894 9.63498C3.30494 9.62198 3.34294 9.61198 3.37994 9.60498C3.42294 9.59698 3.46594 9.59398 3.50794 9.59398C3.84394 9.59398 4.14194 9.83198 4.20494 10.173L4.46394 11.589C4.48994 11.73 4.59894 11.841 4.73894 11.871C5.14994 11.958 5.57194 12.002 5.99894 12.002C6.42594 12.002 6.84694 11.957 7.25794 11.871C7.39894 11.841 7.50694 11.73 7.53294 11.589L7.79294 10.173C7.79994 10.135 7.80994 10.098 7.82294 10.062C7.92694 9.77298 8.19894 9.59298 8.49094 9.59298C8.56994 9.59298 8.64994 9.60698 8.72894 9.63398L10.0879 10.118C10.1269 10.132 10.1679 10.139 10.2069 10.139C10.3059 10.139 10.4019 10.098 10.4699 10.022C11.0389 9.39498 11.4699 8.65498 11.7319 7.84898C11.7769 7.71298 11.7339 7.56398 11.6239 7.47098L11.6249 7.46998ZM10.0019 9.02398L9.05894 8.68798C8.87494 8.62398 8.68394 8.59098 8.49194 8.59098C7.77294 8.59098 7.12594 9.04498 6.88294 9.72298C6.85194 9.81098 6.82694 9.89998 6.81094 9.98998L6.63294 10.96C6.42294 10.986 6.21194 10.999 6.00094 10.999C5.78794 10.999 5.57694 10.986 5.36794 10.96L5.19094 9.98998C5.04194 9.17898 4.33594 8.59098 3.51094 8.59098C3.41094 8.59098 3.30794 8.59998 3.20494 8.61798C3.11394 8.63498 3.02294 8.65898 2.93694 8.68998L1.99994 9.02398C1.74294 8.68798 1.53094 8.32598 1.36794 7.93998L2.12394 7.30098C2.47294 7.00498 2.68494 6.59198 2.72194 6.13698C2.75894 5.68298 2.61594 5.24098 2.31994 4.89398C2.26094 4.82498 2.19594 4.75998 2.12294 4.69798L1.36794 4.05998C1.53194 3.67298 1.74294 3.30998 1.99894 2.97598L2.94294 3.31198C3.12694 3.37598 3.31794 3.40898 3.50994 3.40898C4.22894 3.40898 4.87594 2.95498 5.11894 2.27698C5.14994 2.18898 5.17494 2.09998 5.19094 2.00898L5.36794 1.03998C5.57794 1.01398 5.78994 1.00098 6.00094 1.00098C6.21294 1.00098 6.42494 1.01398 6.63294 1.03998L6.81094 2.00998C6.95994 2.82098 7.66594 3.40898 8.49094 3.40898C8.59094 3.40898 8.69394 3.39998 8.79694 3.38098C8.88794 3.36398 8.97894 3.33998 9.06494 3.30898L10.0019 2.97498C10.2589 3.31098 10.4699 3.67398 10.6329 4.05898L9.87694 4.69798C9.52794 4.99398 9.31594 5.40698 9.27894 5.86198C9.24194 6.31598 9.38494 6.75798 9.68094 7.10398C9.73994 7.17298 9.80494 7.23898 9.87794 7.30098L10.1549 7.53498L10.1529 7.53698L10.6319 7.94098C10.4689 8.32798 10.2579 8.68898 10.0019 9.02398Z"/></svg></button>
  </header>
  <div id="error" role="alert" hidden><span></span><button type="button" hidden></button></div>
  <div id="notice" role="status" hidden><span></span></div>
  <main class="split">
    <section class="pane" id="draft-pane" aria-label="Current staged draft"><h2>Draft</h2><div id="draft" class="document" tabindex="0"></div></section>
    <div id="split-divider" role="separator" aria-orientation="vertical" aria-label="Resize draft and suggested panes" aria-valuemin="20" aria-valuemax="80" aria-valuenow="50" tabindex="0"></div>
    <section class="pane" id="suggested-pane" aria-label="Suggested result"><h2>Suggested</h2><div id="suggested" class="document" tabindex="0"></div></section>
    <section class="pane" id="inline-pane" aria-label="Inline review"><div id="inline" class="document" tabindex="0"></div></section>
  </main>
  <div class="zoom-controls" role="group" aria-label="Preview zoom">
    <input id="zoom-value" type="text" inputmode="numeric" value="100%" aria-label="Preview zoom percentage" title="Enter a zoom percentage from 50 to 200">
    <button id="zoom-out" type="button" aria-label="Zoom out" title="Zoom out (Ctrl/Cmd -)">−</button>
    <button id="zoom-in" type="button" aria-label="Zoom in" title="Zoom in (Ctrl/Cmd +)">+</button>
  </div>
  <div id="choices" class="menu choices" role="menu" hidden></div>
  <div id="announcements" class="sr-only" aria-live="polite"></div>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
}
