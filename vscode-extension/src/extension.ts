import * as vscode from "vscode";
import { createAnalysisRunner } from "./ai/analysisService";
import { ModelDiscovery } from "./ai/modelDiscovery";
import { isModelId } from "./ai/modelId";
import { modelPickerOptions } from "./ai/modelScope";
import { selectAdapter } from "./ai/adapters";
import { SettingsStore, type AiClient } from "./config";
import type { CliId } from "./ai/types";
import { ReviewController } from "./reviewController";

const supportedLanguages = new Set(["markdown", "plaintext"]);

export function activate(context: vscode.ExtensionContext): void {
  const reviews = new Map<string, ReviewController>();
  const discovery = new ModelDiscovery();
  const settings = new SettingsStore(context.globalState);
  const runner = createAnalysisRunner({ settings, select: selectAdapter });
  const setTheme = (): void => reviews.forEach((controller) => controller.setPreviewTheme(settings.getConfig().previewTheme));
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
    vscode.commands.registerCommand("sharpPen.openReview", () => { const document = activeDocument(); if (document) open(document); }),
    vscode.commands.registerCommand("sharpPen.analyze", () => { const document = activeDocument(); if (document) void open(document).analyze(); }),
    vscode.commands.registerCommand("sharpPen.cancelAnalysis", () => {
      const document = activeDocumentOrUndefined();
      if (document) controllerFor(document)?.cancelAnalysis();
    }),
    vscode.commands.registerCommand("sharpPen.selectModel", () => { void selectModel(settings, discovery); }),
    vscode.commands.registerCommand("sharpPen.refreshModels", () => { void selectModel(settings, discovery, true); }),
    vscode.commands.registerCommand("sharpPen.openSettings", () => { void openSettings(settings, discovery, setTheme); }),
    vscode.workspace.onDidChangeTextDocument((event) => controllerFor(event.document)?.onDocumentChanged(event)),
    vscode.workspace.onDidCloseTextDocument((document) => controllerFor(document)?.dispose()),
    discovery,
    { dispose: () => reviews.forEach((controller) => controller.dispose()) },
  );
}

export function deactivate(): void {}

function activeDocument(): vscode.TextDocument | undefined {
  const document = vscode.window.activeTextEditor?.document;
  if (!document || !supportedLanguages.has(document.languageId)) {
    void vscode.window.showWarningMessage("Sharp Pen supports Markdown and plain-text editors.");
    return undefined;
  }
  return document;
}

function activeDocumentOrUndefined(): vscode.TextDocument | undefined {
  const document = vscode.window.activeTextEditor?.document;
  return document && supportedLanguages.has(document.languageId) ? document : undefined;
}

async function openSettings(settings: SettingsStore, discovery: ModelDiscovery, setTheme: () => void): Promise<void> {
  for (;;) {
    const config = settings.getConfig();
    const model = config.aiClient === "auto" ? "Resolve a client to choose" : settings.getModel(config.aiClient) || "Client default";
    const selected = await vscode.window.showQuickPick([
      { label: "AI Client", description: clientLabel(config.aiClient), value: "client" },
      { label: "Model", description: model, value: "model" },
      { label: "Preview Theme", description: themeLabel(config.previewTheme), value: "theme" },
    ], { placeHolder: "Sharp Pen settings" });
    if (!selected) return;
    if (selected.value === "client") await selectClient(settings, discovery);
    if (selected.value === "model") await selectModel(settings, discovery);
    if (selected.value === "theme") { await selectTheme(settings); setTheme(); }
  }
}

async function selectClient(settings: SettingsStore, discovery: ModelDiscovery): Promise<void> {
  const current = settings.getConfig().aiClient;
  const selected = await vscode.window.showQuickPick(aiClientOptions(current), { placeHolder: "Choose Sharp Pen AI client" });
  if (!selected || selected.client === current) return;
  await settings.setClient(selected.client);
  discovery.clear();
}

async function selectTheme(settings: SettingsStore): Promise<void> {
  const current = settings.getConfig().previewTheme;
  const selected = await vscode.window.showQuickPick([
    { label: "Light", description: "Sharp Pen light palette", theme: "light" as const },
    { label: "Dark", description: "Sharp Pen dark palette", theme: "dark" as const },
    { label: "Auto", description: "Follow the VS Code theme", theme: "auto" as const },
  ], { placeHolder: `Preview theme: ${themeLabel(current)}` });
  if (selected) await settings.setPreviewTheme(selected.theme);
}

async function selectModel(settings: SettingsStore, discovery: ModelDiscovery, refresh = false): Promise<void> {
  if (!workspaceTrusted()) return;
  const abort = new AbortController();
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Sharp Pen is finding available models", cancellable: true },
    async (_progress, token) => {
      token.onCancellationRequested(() => abort.abort());
      let client: Awaited<ReturnType<typeof selectAdapter>>;
      try {
        client = await selectAdapter(settings.getConfig().aiClient, abort.signal);
      } catch (error) {
        if (!abort.signal.aborted) void vscode.window.showWarningMessage(error instanceof Error ? error.message : "No AI client is available.");
        return;
      }
      let models: readonly string[] = [];
      try {
        models = await discovery.list(client.id, refresh, abort.signal);
      } catch (error) {
        if (!abort.signal.aborted) void vscode.window.showWarningMessage(error instanceof Error ? error.message : "Model discovery failed. You can still enter a model ID.");
      }
      if (!abort.signal.aborted) await showModelPicker(settings, discovery, client.id, models);
    },
  );
}

async function showModelPicker(settings: SettingsStore, discovery: ModelDiscovery, client: CliId, models: readonly string[]): Promise<void> {
  const currentModel = settings.getModel(client);
  const selected = await vscode.window.showQuickPick(
    modelPickerOptions(currentModel, models, manualGuidance(client)),
    { placeHolder: `${clientLabel(client)} model${currentModel ? `: ${currentModel}` : ": client default"}`, matchOnDescription: true },
  );
  if (!selected) return;
  if (selected.action === "refresh") return selectModel(settings, discovery, true);
  if (selected.action === "manual") {
    const value = await vscode.window.showInputBox({
      prompt: `Model ID for ${clientLabel(client)}`,
      value: currentModel,
      ignoreFocusOut: true,
      validateInput: (candidate) => !candidate.trim() || isModelId(candidate.trim()) ? undefined : "Use letters, digits, '.', '_', ':', '/', or '-'.",
    });
    if (value !== undefined) await settings.setModel(client, value);
    return;
  }
  await settings.setModel(client, selected.model ?? "");
}

function aiClientOptions(current: AiClient): { label: string; description: string; client: AiClient }[] {
  const options: { label: string; description: string; client: AiClient }[] = [
    { label: "Auto", description: "First available: Claude Code, Codex, then GitHub Copilot", client: "auto" },
    { label: "Claude Code", description: "Use Claude Code", client: "claude" },
    { label: "Codex", description: "Use Codex CLI", client: "codex" },
    { label: "GitHub Copilot", description: "Use GitHub Copilot CLI", client: "copilot" },
    { label: "OpenCode", description: "Unavailable: Sharp Pen will not launch OpenCode", client: "opencode" },
  ];
  return options.map((item) => ({ ...item, label: item.client === current ? `${item.label} (current)` : item.label }));
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
  return ({ auto: "Auto", claude: "Claude Code", codex: "Codex", copilot: "GitHub Copilot", opencode: "OpenCode (unavailable)" })[id];
}

function themeLabel(theme: "light" | "dark" | "auto"): string {
  return ({ light: "Light", dark: "Dark", auto: "Auto" })[theme];
}
