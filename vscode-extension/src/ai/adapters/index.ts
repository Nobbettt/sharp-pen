import { ClaudeAdapter } from "./claude";
import { CodexAdapter } from "./codex";
import { CopilotAdapter } from "./copilot";
import { OpenCodeAdapter } from "./opencode";
import type { CliAdapter, CliId } from "../types";

export { ClaudeAdapter, CodexAdapter, CopilotAdapter, OpenCodeAdapter };

/** Fixed product priority; a launch failure is never retried with another provider. */
const automaticAdapters: readonly CliAdapter[] = [new ClaudeAdapter(), new CodexAdapter(), new CopilotAdapter()];
export const adapters: readonly CliAdapter[] = [...automaticAdapters, new OpenCodeAdapter()];

export async function selectAdapter(requested: CliId | "auto", signal?: AbortSignal): Promise<CliAdapter> {
  if (requested !== "auto") {
    const adapter = adapters.find((candidate) => candidate.id === requested)!;
    const probe = await adapter.probe(signal);
    if (probe.available) return adapter;
    throw new Error(probe.message);
  }
  for (const adapter of automaticAdapters) if ((await adapter.probe(signal)).available) return adapter;
  throw new Error("No supported AI client is available. Install and sign in to Claude Code, Codex, or GitHub Copilot CLI.");
}
