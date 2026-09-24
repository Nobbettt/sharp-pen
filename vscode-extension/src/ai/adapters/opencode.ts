import { ProcessRunnerError } from "../processRunner";
import { promptFileArgument } from "../processTree";
import { BaseAdapter } from "./shared";

const required = ["--pure", "--format", "--agent", "--file"] as const;
const promptInstruction = "Follow the complete instructions in the attached prompt file and return only the requested response.";

export class OpenCodeAdapter extends BaseAdapter {
  readonly id = "opencode" as const;

  protected helpArgs(): string[] {
    return ["run", "--help"];
  }

  protected versionIssue(version: string | undefined): string | undefined {
    if (version === "1.18.32") return undefined;
    const match = /^(\d+\.\d+\.\d+)$/.exec(version ?? "");
    return `${match ? `OpenCode ${match[1]}` : "The installed OpenCode version"} has not been safety-reviewed. sharp-pen currently supports OpenCode 1.18.32.`;
  }

  protected requiredCapabilities(): readonly string[] {
    return required;
  }

  protected args(capabilities: ReadonlySet<string>, model?: string): string[] {
    return [
      "run", promptInstruction, "--pure", "--format", "json", "--agent", "sharp-pen", "--file", promptFileArgument,
      ...(model && capabilities.has("--model") ? ["--model", model] : []),
    ];
  }

  protected extract(stdout: string): string {
    return extractOpenCodeFinalText(stdout);
  }
}

/** Accepts only OpenCode's reviewed JSON event stream and a clean terminal stop. */
export function extractOpenCodeFinalText(stdout: string): string {
  const parts: string[] = [];
  let stopped = false;
  for (const line of stdout.trim().split(/\r?\n/).filter(Boolean)) {
    let value: unknown;
    try { value = JSON.parse(line); } catch { throw invalidOutput(); }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidOutput();
    const event = value as Record<string, unknown>;
    const part = event.part;
    if (!part || typeof part !== "object" || Array.isArray(part)) throw invalidOutput();
    const item = part as Record<string, unknown>;
    if (event.type === "step_start" && item.type === "step-start" && !stopped) continue;
    if (event.type === "text" && item.type === "text" && typeof item.text === "string" && !stopped) {
      parts.push(item.text);
      continue;
    }
    if (event.type === "step_finish" && item.type === "step-finish" && item.reason === "stop" && !stopped) {
      stopped = true;
      continue;
    }
    throw invalidOutput();
  }
  if (!stopped || !parts.length) throw invalidOutput();
  return parts.join("");
}

function invalidOutput(): ProcessRunnerError {
  return new ProcessRunnerError("exit", "OpenCode returned an invalid structured response. Try again.");
}
