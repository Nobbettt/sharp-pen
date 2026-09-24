import * as path from "path";
import * as vscode from "vscode";
import { createAnalysisRunner } from "./ai/analysisService";
import { ModelDiscovery } from "./ai/modelDiscovery";
import { isModelId } from "./ai/modelId";
import { modelPickerOptions } from "./ai/modelScope";
import { selectAdapter } from "./ai/adapters";
import { SettingsStore, type AiClient } from "./config";
import type { CliId } from "./ai/types";
import { ReviewController } from "./reviewController";
import { SettingsPanel } from "./settingsPanel";

const supportedLanguages = new Set(["markdown", "plaintext"]);

export function activate(context: vscode.ExtensionContext): void {
  const reviews = new Map<string, ReviewController>();
  const discovery = new ModelDiscovery(undefined, context.extension.packageJSON.version);
  const settings = new SettingsStore(context.globalState);
  const runner = createAnalysisRunner({ settings, select: selectAdapter });
  const setTheme = (): void => reviews.forEach((controller) => controller.setPreviewTheme(settings.getConfig().previewTheme));
  let settingsPanel: SettingsPanel | undefined;
  const runModelCommand = (refresh = false): void => {
    void selectModel(settings, discovery, refresh).then((client) => settingsPanel?.sync(client), () => {
      void vscode.window.showWarningMessage("Could not save model selection. Try again.");
      settingsPanel?.sync();
    });
  };
  const openSettings = (): void => {
    if (settingsPanel) return settingsPanel.reveal();
    settingsPanel = new SettingsPanel(context.extensionUri, settings, discovery, setTheme, () => { settingsPanel = undefined; });
  };
  const controllerFor = (document: vscode.TextDocument): ReviewController | undefined => reviews.get(document.uri.toString());
  const open = (document: vscode.TextDocument): ReviewController => {
    const existing = controllerFor(document);
    if (existing) {
      existing.reveal(vscode.ViewColumn.Beside);
      return existing;
    }
    const key = document.uri.toString();
    let controller: ReviewController;
    controller = new ReviewController(
      document, context.extensionUri, runner,
      () => { if (reviews.get(key) === controller) reviews.delete(key); },
      vscode.ViewColumn.Beside,
      settings.getConfig().previewTheme,
    );
    reviews.set(key, controller);
    return controller;
  };
  context.subscriptions.push(
    vscode.commands.registerCommand("sharpPen.openReview", (uri?: vscode.Uri) => { const document = activeDocument(uri); if (document) open(document); }),
    vscode.commands.registerCommand("sharpPen.analyze", (uri?: vscode.Uri) => { const document = activeDocument(uri); if (document) void open(document).analyze(); }),
    vscode.commands.registerCommand("sharpPen.cancelAnalysis", () => {
      const document = activeDocumentOrUndefined();
      const controller = (document && controllerFor(document)) ?? [...reviews.values()].find((candidate) => candidate.panel.active);
      if (controller) controller.cancelAnalysis();
      else void vscode.window.showWarningMessage("No sharp-pen review is active to cancel.");
    }),
    // Scoped to the active sharp-pen review panel by the "activeWebviewPanelId" when clause in package.json,
    // so these never compete with VS Code's own Ctrl/Cmd +/-/0 window-zoom and sidebar-focus keybindings.
    vscode.commands.registerCommand("sharpPen.zoomIn", () => [...reviews.values()].find((candidate) => candidate.panel.active)?.zoom("in")),
    vscode.commands.registerCommand("sharpPen.zoomOut", () => [...reviews.values()].find((candidate) => candidate.panel.active)?.zoom("out")),
    vscode.commands.registerCommand("sharpPen.zoomReset", () => [...reviews.values()].find((candidate) => candidate.panel.active)?.zoom("reset")),
    vscode.commands.registerCommand("sharpPen.selectModel", () => runModelCommand()),
    vscode.commands.registerCommand("sharpPen.refreshModels", () => runModelCommand(true)),
    vscode.commands.registerCommand("sharpPen.openSettings", openSettings),
    vscode.workspace.onDidChangeTextDocument((event) => controllerFor(event.document)?.onDocumentChanged(event)),
    vscode.workspace.onDidCloseTextDocument((document) => {
      const found = controllerFor(document);
      if (!found) return;
      const uri = document.uri.toString();
      // VS Code fires this event (immediately followed by onDidOpenTextDocument, with a new document
      // object) when a document's language id changes, not just when its source actually closes. Give
      // the reopen a tick before treating this as a real close, so switching e.g. plain text to Markdown
      // doesn't drop the review (see R5-04).
      setTimeout(() => {
        if (reviews.get(uri) !== found) return;
        const reopened = vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === uri);
        if (reopened && supportedLanguages.has(reopened.languageId)) return found.retarget(reopened);
        const staged = found.stagedChoiceCount();
        // The document model can close before its review panel does; there is no hook to keep the review open, so warn what was lost.
        if (staged > 0) {
          void vscode.window.showWarningMessage(
            `sharp-pen review for "${path.basename(document.fileName)}" closed with its source; ${staged} staged choice${staged === 1 ? "" : "s"} ${staged === 1 ? "was" : "were"} discarded.`,
          );
        }
        found.dispose();
      }, 0);
    }),
    vscode.window.onDidChangeTextEditorVisibleRanges((event) => controllerFor(event.textEditor.document)?.onEditorVisibleRanges(event)),
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      reviews.forEach((controller) => controller.onWorkspaceTrustGranted());
      settingsPanel?.onWorkspaceTrustGranted();
    }),
    discovery,
    { dispose: () => reviews.forEach((controller) => controller.dispose()) },
    { dispose: () => settingsPanel?.dispose() },
  );
}

export function deactivate(): void {}

/** Menu commands pass the clicked resource's URI; the palette and keybindings pass none. */
function resolveDocument(uri?: vscode.Uri): vscode.TextDocument | undefined {
  if (!uri) return vscode.window.activeTextEditor?.document;
  return vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === uri.toString())
    ?? vscode.window.activeTextEditor?.document;
}

function activeDocument(uri?: vscode.Uri): vscode.TextDocument | undefined {
  const document = resolveDocument(uri);
  if (!document || !supportedLanguages.has(document.languageId)) {
    void vscode.window.showWarningMessage("sharp-pen supports Markdown and plain-text editors.");
    return undefined;
  }
  return document;
}

function activeDocumentOrUndefined(): vscode.TextDocument | undefined {
  const document = vscode.window.activeTextEditor?.document;
  return document && supportedLanguages.has(document.languageId) ? document : undefined;
}

async function selectModel(settings: SettingsStore, discovery: ModelDiscovery, refresh = false): Promise<CliId | undefined> {
  if (!workspaceTrusted()) return;
  const requested = settings.getConfig().aiClient;
  const abort = new AbortController();
  // Resolve the client and its models inside withProgress, but open the QuickPick only after the
  // notification closes: keeping it open while the user picks leaves a stale spinner on screen.
  const found = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "sharp-pen is finding available models", cancellable: true },
    async (_progress, token): Promise<{ client: CliId; models: readonly string[] } | undefined> => {
      token.onCancellationRequested(() => abort.abort());
      let client: Awaited<ReturnType<typeof selectAdapter>>;
      try {
        client = await selectAdapter(requested, abort.signal);
      } catch {
        if (!abort.signal.aborted) void vscode.window.showWarningMessage("No AI client is available. Check your client setup and retry.");
        return undefined;
      }
      let models: readonly string[] = [];
      try {
        models = await discovery.list(client.id, refresh, abort.signal);
      } catch {
        if (!abort.signal.aborted) void vscode.window.showWarningMessage("Model discovery failed. Try refreshing or choose a model ID.");
      }
      return abort.signal.aborted ? undefined : { client: client.id, models };
    },
  );
  return found ? showModelPicker(settings, discovery, found.client, found.models) : undefined;
}

async function showModelPicker(settings: SettingsStore, discovery: ModelDiscovery, client: CliId, models: readonly string[]): Promise<CliId | undefined> {
  const currentModel = settings.getModel(client);
  const selected = await vscode.window.showQuickPick(
    modelPickerOptions(currentModel, models, manualGuidance(client)),
    { placeHolder: `${clientLabel(client)} model${currentModel ? `: ${currentModel}` : ": client default"}`, matchOnDescription: true },
  );
  if (!selected) return client;
  if (selected.action === "refresh") return selectModel(settings, discovery, true);
  if (selected.action === "manual") {
    const value = await vscode.window.showInputBox({
      prompt: `Model ID for ${clientLabel(client)}`,
      value: currentModel,
      ignoreFocusOut: true,
      validateInput: (candidate) => !candidate.trim() || isModelId(candidate.trim()) ? undefined : "Use letters, digits, '.', '_', ':', '/', or '-'.",
    });
    if (value !== undefined) await settings.setModel(client, value);
    return client;
  }
  await settings.setModel(client, selected.model ?? "");
  return client;
}

function manualGuidance(client: CliId): string {
  if (client === "claude" || client === "copilot") return `Use ${client === "claude" ? "Claude Code" : "GitHub Copilot CLI"}'s /model picker to browse account models, then enter its ID.`;
  return "Use a model ID not listed here";
}

function workspaceTrusted(): boolean {
  if (vscode.workspace.isTrusted) return true;
  void vscode.window.showWarningMessage("Trust this workspace before selecting or refreshing AI models.");
  return false;
}

function clientLabel(id: AiClient | CliId): string {
  return ({ auto: "Auto", claude: "Claude Code", codex: "Codex", copilot: "GitHub Copilot", opencode: "OpenCode" })[id];
}
