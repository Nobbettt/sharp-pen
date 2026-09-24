import * as vscode from "vscode";
import { selectAdapter } from "./ai/adapters";
import { ModelDiscovery } from "./ai/modelDiscovery";
import { isModelId } from "./ai/modelId";
import type { CliId } from "./ai/types";
import { isAiClient, isPreviewTheme, SettingsStore, type AiClient } from "./config";
import { settingsWebviewHtml } from "./webview/settingsWebview";

type SettingsIntent =
  | { type: "ready" }
  | { type: "setClient"; client: AiClient }
  | { type: "setTheme"; theme: "light" | "dark" | "auto" }
  | { type: "setModel"; model: string }
  | { type: "refreshModels" };

/** One reusable settings panel. Each panel instance probes and discovers at most once; a
 * re-sent "ready" (the webview reloads on every re-show) reuses that cached result instead. */
export class SettingsPanel implements vscode.Disposable {
  readonly panel: vscode.WebviewPanel;
  private disposed = false;
  private probed = false;
  private modelClient: CliId | undefined;
  private models: readonly string[] = [];
  private status = "";
  private refreshAbort: AbortController | undefined;
  private operation = 0;
  private requestedClient: AiClient | undefined;
  private readonly disposables: vscode.Disposable[];

  constructor(
    extensionUri: vscode.Uri,
    private readonly settings: SettingsStore,
    private readonly discovery: ModelDiscovery,
    private readonly onThemeChanged: () => void,
    private readonly onDispose: () => void,
  ) {
    this.panel = vscode.window.createWebviewPanel("sharpPen.settings", "sharp-pen Settings", vscode.ViewColumn.Active, {
      enableScripts: true,
      enableCommandUris: false,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
    });
    this.panel.webview.html = settingsWebviewHtml(this.panel.webview, extensionUri);
    this.disposables = [
      this.panel.onDidDispose(() => this.dispose()),
      this.panel.webview.onDidReceiveMessage((message: unknown) => { void this.receive(message).catch(() => this.fail()); }),
    ];
  }

  reveal(): void {
    this.panel.reveal(vscode.ViewColumn.Active);
  }

  sync(modelClient?: CliId): void {
    const expected = directClient(this.settings.getConfig().aiClient) ?? this.modelClient;
    if (modelClient && expected && modelClient !== expected) return this.postState();
    if (modelClient && modelClient !== this.modelClient) {
      this.modelClient = modelClient;
      this.models = [];
    }
    this.postState();
  }

  onWorkspaceTrustGranted(): void {
    void this.refreshModels();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.refreshAbort?.abort();
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
    this.panel.dispose();
    this.onDispose();
  }

  private async receive(message: unknown): Promise<void> {
    try {
      const intent = settingsIntent(message);
      if (!intent) return;
      // The webview re-sends "ready" on every reload, including just becoming visible again
      // (no retainContextWhenHidden); only post the cached state then, not a fresh probe.
      if (intent.type === "ready") {
        if (this.probed) return this.postState();
        return this.refreshModels(this.operation, this.settings.getConfig().aiClient, false);
      }
      if (intent.type === "setClient") {
        const operation = ++this.operation;
        this.requestedClient = intent.client;
        this.refreshAbort?.abort();
        try { await this.settings.setClient(intent.client); } catch {
          if (this.operation === operation) {
            this.requestedClient = this.settings.getConfig().aiClient;
            this.models = [];
            this.modelClient = directClient(this.requestedClient);
          }
          this.fail();
          return;
        }
        if (!this.current(operation, intent.client)) return this.restoreLatestClient(operation);
        this.discovery.clear();
        this.models = [];
        this.modelClient = directClient(intent.client);
        this.status = "";
        return this.refreshModels(operation, intent.client);
      }
      if (intent.type === "setTheme") {
        await this.settings.setPreviewTheme(intent.theme);
        this.onThemeChanged();
        return this.postState();
      }
      if (intent.type === "setModel") return this.setModel(intent.model);
      return this.refreshModels();
    } catch {
      this.fail();
    }
  }

  private async setModel(model: string): Promise<void> {
    let saved = false;
    const client = this.modelClient ?? directClient(this.settings.getConfig().aiClient);
    if (!client) {
      this.status = "Choose a supported client, or refresh Auto to resolve one, before saving a model.";
    } else if (!vscode.workspace.isTrusted) {
      this.status = "Trust this workspace before selecting or saving an AI model.";
    } else if (model.trim() && !isModelId(model.trim())) {
      this.status = "Model ID contains unsupported characters.";
    } else {
      await this.settings.setModel(client, model);
      saved = true;
      this.status = model.trim() ? `Saved model for ${clientLabel(client)}.` : `Using ${clientLabel(client)}'s default model.`;
    }
    this.postState(saved);
  }

  private async refreshModels(operation = this.operation, requested = this.settings.getConfig().aiClient, force = true): Promise<void> {
    if (!this.current(operation, requested)) return;
    if (!vscode.workspace.isTrusted) {
      this.status = "Trust this workspace before selecting or refreshing AI models.";
      return this.postState();
    }
    this.status = "Finding available models…";
    this.postState();
    this.refreshAbort?.abort();
    const abort = new AbortController();
    this.refreshAbort = abort;
    let resolvedClient: CliId | undefined;
    try {
      const client = await selectAdapter(requested, abort.signal);
      if (!this.current(operation, requested) || abort.signal.aborted) return;
      resolvedClient = client.id;
      const models = await this.discovery.list(client.id, force, abort.signal);
      if (!this.current(operation, requested) || abort.signal.aborted) return;
      this.modelClient = client.id;
      this.models = models;
      this.status = models.length ? `Found ${models.length} model${models.length === 1 ? "" : "s"} for ${clientLabel(client.id)}.` : `No models found for ${clientLabel(client.id)}. You can still enter an ID.`;
    } catch {
      if (!this.current(operation, requested) || abort.signal.aborted) return;
      this.modelClient = resolvedClient ?? directClient(requested);
      this.models = [];
      this.status = "Model discovery failed. Try refreshing or choose a model ID.";
    } finally {
      if (this.refreshAbort === abort) this.refreshAbort = undefined;
    }
    if (this.current(operation, requested)) {
      this.probed = true;
      this.postState();
    }
  }

  private current(operation: number, client: AiClient): boolean {
    return !this.disposed && this.operation === operation && (!this.requestedClient || this.requestedClient === client)
      && this.settings.getConfig().aiClient === client;
  }

  private async restoreLatestClient(operation: number): Promise<void> {
    if (this.disposed || this.operation === operation || !this.requestedClient || this.settings.getConfig().aiClient === this.requestedClient) return;
    try {
      await this.settings.setClient(this.requestedClient);
      if (this.operation === operation || this.disposed || this.settings.getConfig().aiClient !== this.requestedClient) return;
      this.models = [];
      this.modelClient = directClient(this.requestedClient);
      this.status = "";
      await this.refreshModels(this.operation, this.requestedClient);
    } catch { this.fail(); }
  }

  private fail(): void {
    if (this.disposed) return;
    this.status = "Settings update failed. Try again.";
    this.postState();
  }

  private postState(modelSaved = false): void {
    if (this.disposed) return;
    const config = this.settings.getConfig();
    const modelClient = this.modelClient ?? directClient(config.aiClient);
    if (modelClient !== this.modelClient && !this.models.length) this.modelClient = modelClient;
    void Promise.resolve(this.panel.webview.postMessage({
      type: "state",
      model: {
        aiClient: config.aiClient,
        previewTheme: config.previewTheme,
        modelClient,
        model: modelClient ? this.settings.getModel(modelClient) : "",
        models: this.models,
        modelSaved,
        trusted: vscode.workspace.isTrusted,
        status: this.status,
      },
    })).catch(() => undefined);
  }
}

function settingsIntent(value: unknown): SettingsIntent | undefined {
  if (!value || typeof value !== "object") return undefined;
  const message = value as Record<string, unknown>;
  if (message.type === "ready" || message.type === "refreshModels") return { type: message.type };
  if (message.type === "setClient" && typeof message.client === "string" && isAiClient(message.client)) return { type: "setClient", client: message.client };
  if (message.type === "setTheme" && typeof message.theme === "string" && isPreviewTheme(message.theme)) return { type: "setTheme", theme: message.theme };
  if (message.type === "setModel" && typeof message.model === "string" && message.model.length <= 256) return { type: "setModel", model: message.model };
  return undefined;
}

function directClient(client: AiClient): CliId | undefined {
  return client === "auto" ? undefined : client;
}

function clientLabel(client: CliId): string {
  return ({ claude: "Claude Code", codex: "Codex", copilot: "GitHub Copilot", opencode: "OpenCode" })[client];
}
