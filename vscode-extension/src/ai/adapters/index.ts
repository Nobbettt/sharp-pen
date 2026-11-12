import { ClaudeAdapter } from "./claude";
import { CodexAdapter } from "./codex";
import { CopilotAdapter } from "./copilot";
import { OpenCodeAdapter } from "./opencode";
import { VscodeLmAdapter } from "./vscodeLm";
import { ProcessRunnerError } from "../processRunner";
import type { CliAdapter, ClientId } from "../types";

export { ClaudeAdapter, CodexAdapter, CopilotAdapter, OpenCodeAdapter, VscodeLmAdapter };

/** Fixed product priority; a launch failure is never retried with another provider. */
const automaticAdapters: readonly CliAdapter[] = [new ClaudeAdapter(), new CodexAdapter(), new CopilotAdapter(), new OpenCodeAdapter(), new VscodeLmAdapter()];
export const adapters: readonly CliAdapter[] = automaticAdapters;

export async function selectAdapter(requested: ClientId | "auto", signal?: AbortSignal): Promise<CliAdapter> {
  if (requested !== "auto") {
    const adapter = adapters.find((candidate) => candidate.id === requested)!;
    const probe = await adapter.probe(signal);
    if (probe.available) return adapter;
    throw new ProcessRunnerError("launch", probe.message!);
  }
  for (const adapter of automaticAdapters) if ((await adapter.probe(signal)).available) return adapter;
  throw new ProcessRunnerError("launch", "No supported AI client is available. Install and sign in to Claude Code, Codex, GitHub Copilot, OpenCode CLI, or GitHub Copilot Chat.");
}
