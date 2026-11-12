import { REVIEW_LIMITS } from "../../review/validate";
import { ProcessRunnerError } from "../processRunner";
import type { AnalyzeOptions, CliAdapter, ProbeResult } from "../types";

export interface Chat {
  id: string;
  sendRequest(messages: readonly unknown[], options: { justification: string }, token: unknown): Thenable<{ text: AsyncIterable<string> }>;
}

export interface VscodeLmApi {
  selectChatModels(): Thenable<readonly Chat[]>;
  userMessage(text: string): unknown;
  createToken(signal?: AbortSignal): { token: unknown; dispose(): void };
  isLanguageModelError(error: unknown): error is { code: string; message: string };
}

/** Loads the extension-host API only when a language-model operation actually runs. */
export function createVscodeLmApi(): VscodeLmApi {
  const vscode = require("vscode") as typeof import("vscode");
  return {
    selectChatModels: () => vscode.lm.selectChatModels(),
    userMessage: (text) => vscode.LanguageModelChatMessage.User(text),
    createToken: (signal) => {
      const source = new vscode.CancellationTokenSource();
      const cancel = () => source.cancel();
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) source.cancel();
      return {
        token: source.token,
        dispose() { signal?.removeEventListener("abort", cancel); source.dispose(); },
      };
    },
    isLanguageModelError: (error): error is { code: string; message: string } => error instanceof vscode.LanguageModelError,
  };
}

export class VscodeLmAdapter implements CliAdapter {
  readonly id = "vscode-lm" as const;
  private api: VscodeLmApi | undefined;

  constructor(api?: VscodeLmApi) { this.api = api; }

  async probe(): Promise<ProbeResult> {
    try {
      const models = await this.getApi().selectChatModels();
      return models.length
        ? { available: true, capabilities: new Set(["--model"]) }
        : { available: false, capabilities: new Set(), message: "No VS Code language model is available. Install GitHub Copilot Chat and sign in, or choose another client." };
    } catch {
      return { available: false, capabilities: new Set(), message: "No VS Code language model is available. Install GitHub Copilot Chat and sign in, or choose another client." };
    }
  }

  async analyze(prompt: string, options: AnalyzeOptions = {}, signal?: AbortSignal): Promise<string> {
    if (signal?.aborted) throw cancelled();
    const api = this.getApi();
    const cancellation = api.createToken(signal);
    try {
      const models = await api.selectChatModels();
      if (signal?.aborted) throw cancelled();
      const model = models.find((candidate) => candidate.id === options.model) ?? models[0];
      if (!model) throw new ProcessRunnerError("launch", "No VS Code language model is available. Install GitHub Copilot Chat and sign in, or choose another client.");
      const response = await model.sendRequest(
        [api.userMessage(prompt)],
        { justification: "sharp-pen sends the document you asked it to proofread." },
        cancellation.token,
      );
      let output = "";
      for await (const chunk of response.text) {
        if (signal?.aborted) throw cancelled();
        output += chunk;
        if (output.length > REVIEW_LIMITS.response) {
          throw new ProcessRunnerError("output", "The VS Code language model returned too much output. Try again with a shorter document.");
        }
      }
      if (signal?.aborted) throw cancelled();
      return stripJsonFence(output);
    } catch (error) {
      if (error instanceof ProcessRunnerError) throw error;
      if (signal?.aborted) throw cancelled();
      if (api.isLanguageModelError(error)) throw languageModelError(error);
      throw new ProcessRunnerError("exit", "The VS Code language model request failed. Retry, or choose another client.");
    } finally {
      cancellation.dispose();
    }
  }

  private getApi(): VscodeLmApi { return this.api ??= createVscodeLmApi(); }
}

function cancelled(): ProcessRunnerError {
  return new ProcessRunnerError("aborted", "Analysis was cancelled.");
}

function languageModelError(error: { code: string; message: string }): ProcessRunnerError {
  const messages: Record<string, string> = {
    NoPermissions: "Allow sharp-pen to use VS Code language models when VS Code asks, then retry.",
    Blocked: "The VS Code language model blocked this request. Retry, or choose another client.",
    NotFound: "The selected VS Code language model is no longer available. Choose another model or client.",
  };
  return new ProcessRunnerError("launch", messages[error.code] ?? error.message);
}

function stripJsonFence(text: string): string {
  const match = /^\s*```json\s*\r?\n([\s\S]*?)\r?\n```\s*$/i.exec(text);
  return match ? match[1] : text;
}
