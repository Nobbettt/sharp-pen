import { isModelId } from "./ai/modelId";
import type { CliId } from "./ai/types";

export const aiClients = ["auto", "claude", "codex", "copilot", "opencode"] as const;

export type AiClient = (typeof aiClients)[number];

export const previewThemes = ["light", "dark", "auto"] as const;

export type PreviewTheme = (typeof previewThemes)[number];

export interface SharpPenConfig {
  aiClient: AiClient;
  previewTheme: PreviewTheme;
}

export interface SettingsMemento {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

const keys = {
  aiClient: "sharpPen.settings.aiClient",
  previewTheme: "sharpPen.settings.previewTheme",
  models: "sharpPen.settings.models",
} as const;

/** Typed, user-global settings. Model overrides are always scoped to a provider. */
export class SettingsStore {
  constructor(private readonly state: SettingsMemento) {}

  getConfig(): SharpPenConfig {
    return {
      aiClient: value(this.state.get<string>(keys.aiClient), isAiClient, "auto"),
      previewTheme: previewTheme(this.state.get<string>(keys.previewTheme)),
    };
  }

  getModel(client: CliId): string {
    const models = this.state.get<Partial<Record<CliId, string>>>(keys.models);
    const model = models?.[client]?.trim() ?? "";
    return isModelId(model) ? model : "";
  }

  async setClient(aiClient: AiClient): Promise<void> {
    await this.state.update(keys.aiClient, aiClient);
  }

  async setPreviewTheme(theme: PreviewTheme): Promise<void> {
    await this.state.update(keys.previewTheme, theme);
  }

  async setModel(client: CliId, model: string): Promise<void> {
    const value = model.trim();
    if (value && !isModelId(value)) throw new Error("Model ID contains unsupported characters.");
    const models = { ...(this.state.get<Partial<Record<CliId, string>>>(keys.models) ?? {}) };
    if (value) models[client] = value; else delete models[client];
    await this.state.update(keys.models, models);
  }
}

export function isAiClient(value: string): value is AiClient {
  return (aiClients as readonly string[]).includes(value);
}

export function isPreviewTheme(value: string): value is PreviewTheme {
  return (previewThemes as readonly string[]).includes(value);
}

export function previewTheme(value: string | undefined): PreviewTheme {
  return value && isPreviewTheme(value) ? value : "light";
}

function value<T extends string>(candidate: string | undefined, check: (value: string) => value is T, fallback: T): T {
  return candidate && check(candidate) ? candidate : fallback;
}
