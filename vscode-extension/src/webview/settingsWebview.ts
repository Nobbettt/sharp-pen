import { randomUUID } from "crypto";
import * as vscode from "vscode";

/** Static settings shell; values are posted after the webview reports ready. */
export function settingsWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const style = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "settings.css"));
  const script = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "settings.js"));
  const nonce = randomUUID().replace(/-/g, "");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${style}">
  <title>sharp-pen Settings</title>
</head>
<body>
  <main>
    <h1>sharp-pen Settings</h1>
    <p class="intro">Choose the local AI client and how sharp-pen previews reviews.</p>
    <section aria-labelledby="client-heading">
      <h2 id="client-heading">AI client</h2>
      <label for="client">Client</label>
      <select id="client" aria-describedby="client-help">
        <option value="auto">Auto — Claude Code, Codex, GitHub Copilot, then OpenCode</option>
        <option value="claude">Claude Code</option>
        <option value="codex">Codex</option>
        <option value="copilot">GitHub Copilot</option>
        <option value="opencode">OpenCode</option>
      </select>
      <p id="client-help" class="help">Auto chooses the first supported client available on this extension host.</p>
    </section>
    <section aria-labelledby="model-heading">
      <h2 id="model-heading">Model</h2>
      <p id="model-provider" class="help"></p>
      <label for="models">Model</label>
      <select id="models" disabled aria-describedby="model-provider model-choice-help"><option>Resolve a client to choose a model</option></select>
      <p id="model-choice-help" class="help">Choose the client default, a discovered model, or Other to enter a model ID.</p>
      <div id="manual-model" hidden>
      <label for="model">Model ID</label>
      <div class="row">
        <input id="model" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="model-id-help">
        <button id="save-model" type="button">Save model ID</button>
      </div>
      <p id="model-id-help" class="help">Model IDs use letters, digits, <code>.</code>, <code>_</code>, <code>:</code>, <code>/</code>, or <code>-</code>.</p>
      </div>
      <button id="refresh-models" type="button">Refresh models</button>
      <p class="help">Finding models runs the selected local CLI and requires a trusted workspace.</p>
    </section>
    <section aria-labelledby="theme-heading">
      <h2 id="theme-heading">Preview theme</h2>
      <label for="theme">Theme</label>
      <select id="theme">
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="auto">Auto — follow the VS Code theme</option>
      </select>
      <p class="help">Open reviews update immediately.</p>
    </section>
    <p id="status" role="status" aria-live="polite"></p>
  </main>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
}
