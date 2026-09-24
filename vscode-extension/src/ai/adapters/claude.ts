import { ProcessRunnerError } from "../processRunner";
import { agentResponseSchema } from "../schema";
import { BaseAdapter } from "./shared";

const required = [
  "--print", "--output-format", "--restricted", "--safe-mode", "--strict-mcp-config",
  "--permission-mode", "--permission-prompts", "--no-session-persistence",
  "--disable-slash-commands", "--no-chrome", "--tools", "--json-schema",
] as const;

const responseSchema = JSON.stringify(agentResponseSchema);

export class ClaudeAdapter extends BaseAdapter {
  readonly id = "claude" as const;

  protected requiredCapabilities(): readonly string[] {
    return required;
  }

  protected args(capabilities: ReadonlySet<string>, model?: string): string[] {
    return [
      "--print", "--output-format", "json", "--restricted", "--safe-mode", "--strict-mcp-config",
      "--permission-mode", "plan", "--permission-prompts", "none", "--no-session-persistence",
      "--disable-slash-commands", "--no-chrome", "--tools", "", "--json-schema", responseSchema,
      ...(model && capabilities.has("--model") ? ["--model", model] : []),
    ];
  }

  protected extract(stdout: string): string {
    return extractClaudeStructuredOutput(stdout);
  }
}

/** Claude's print-mode envelope is trusted only for its successful structured result. */
export function extractClaudeStructuredOutput(stdout: string): string {
  let envelope: unknown;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    throw new ProcessRunnerError("exit", "The AI client returned an invalid structured response.");
  }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new ProcessRunnerError("exit", "The AI client returned an invalid structured response.");
  }
  const result = envelope as Record<string, unknown>;
  const output = result.structured_output;
  if (result.type !== "result" || result.subtype !== "success" || result.is_error !== false
    || !output || typeof output !== "object" || Array.isArray(output) || !Object.keys(output).length) {
    throw new ProcessRunnerError("exit", "The AI client returned an invalid structured response.");
  }
  return JSON.stringify(output);
}
