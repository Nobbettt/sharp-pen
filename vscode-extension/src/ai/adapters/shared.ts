import { ProcessRunnerError, runProcess } from "../processRunner";
import { isModelId } from "../modelId";
import type { CliAdapter, CliId, ProbeResult } from "../types";

type Runner = typeof runProcess;

export abstract class BaseAdapter implements CliAdapter {
  private probeResult: ProbeResult | undefined;

  abstract readonly id: CliId;

  constructor(protected readonly runner: Runner = runProcess) {}

  async probe(signal?: AbortSignal): Promise<ProbeResult> {
    if (this.probeResult) return this.probeResult;
    try {
      const version = await this.runner({ executable: this.id, args: ["--version"], signal, timeoutMs: 5_000, stdoutLimit: 8_192, stderrLimit: 8_192 });
      const installedVersion = firstLine(version.stdout || version.stderr);
      const versionIssue = this.versionIssue(installedVersion);
      if (versionIssue) return this.unavailable(versionIssue, new Set());
      const args = this.helpArgs();
      const help = await this.runner({ executable: this.id, args, signal, timeoutMs: 5_000, stdoutLimit: 64_000, stderrLimit: 64_000 });
      let capabilities = flags(help.stdout + "\n" + help.stderr);
      let missing = this.requiredCapabilities().filter((flag) => !supports(capabilities, flag));
      if (missing.length) {
        const retry = await this.runner({ executable: this.id, args, signal, timeoutMs: 5_000, stdoutLimit: 64_000, stderrLimit: 64_000 });
        capabilities = new Set([...capabilities, ...flags(retry.stdout + "\n" + retry.stderr)]);
        missing = this.requiredCapabilities().filter((flag) => !supports(capabilities, flag));
      }
      if (missing.length) return this.unavailable(`requires ${missing.join(", ")} for its safe mode. Upgrade ${label(this.id)} and try again.`, capabilities);
      const safetyIssue = await this.safetyIssue(capabilities, signal);
      if (safetyIssue) return this.unavailable(safetyIssue, capabilities);
      this.probeResult = { available: true, version: installedVersion, capabilities };
      return this.probeResult;
    } catch (error) {
      const message = error instanceof ProcessRunnerError && error.kind === "aborted"
        ? error.message
        : `${label(this.id)} is not available. Install it and sign in on this extension host.`;
      return { available: false, capabilities: new Set(), message };
    }
  }

  async analyze(prompt: string, options: { model?: string } = {}, signal?: AbortSignal): Promise<string> {
    const model = options.model?.trim();
    if (model && !isModelId(model)) throw new ProcessRunnerError("launch", "Sharp Pen cannot use that model ID.");
    const probe = await this.probe(signal);
    if (!probe.available) throw new ProcessRunnerError("launch", probe.message!);
    if (model && !probe.capabilities.has("--model")) {
      throw new ProcessRunnerError("launch", `${label(this.id)} cannot use a model override. Upgrade it or clear the selected model.`);
    }
    const result = await this.runner({ executable: this.id, args: this.args(probe.capabilities, model), input: prompt, signal });
    return this.extract(result.stdout);
  }

  protected abstract args(capabilities: ReadonlySet<string>, model?: string): string[];

  protected requiredCapabilities(): readonly string[] {
    return [];
  }

  protected versionIssue(_version: string | undefined): string | undefined {
    return undefined;
  }

  /** Runs only local argument/config validation; providers can reject unsafe CLI versions here. */
  protected async safetyIssue(_capabilities: ReadonlySet<string>, _signal?: AbortSignal): Promise<string | undefined> {
    return undefined;
  }

  protected helpArgs(): string[] {
    return ["--help"];
  }

  protected extract(stdout: string): string {
    return extractFinalText(stdout);
  }

  private unavailable(message: string, capabilities: ReadonlySet<string>): ProbeResult {
    return { available: false, capabilities, message: `${label(this.id)} is unavailable: ${message}` };
  }
}

export function supports(capabilities: ReadonlySet<string>, flag: string): boolean {
  return capabilities.has(flag);
}

function flags(help: string): ReadonlySet<string> {
  return new Set(help.match(/--[a-z][a-z0-9-]*/gi)?.map((flag) => flag.toLowerCase()) ?? []);
}

function firstLine(text: string): string | undefined {
  return text.split(/\r?\n/).find(Boolean)?.trim();
}

function label(id: CliId): string {
  return ({ claude: "Claude Code", codex: "Codex", copilot: "GitHub Copilot", opencode: "OpenCode" })[id];
}

/** Extracts a final assistant payload without interpreting its Sharp Pen schema. */
export function extractFinalText(stdout: string): string {
  const text = stdout.trim();
  if (!text) throw new ProcessRunnerError("exit", "The AI client returned no final response. Try again.");
  const whole = parse(text);
  if (whole !== undefined) return finalValue(whole) ?? text;
  let final: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const value = parse(line);
    if (value !== undefined) final = finalValue(value) ?? final;
  }
  return final ?? text;
}

/** Extracts only Copilot's completed assistant-message event from JSONL output. */
export function extractCopilotFinalText(stdout: string): string {
  const text = stdout.trim();
  if (!text) throw new ProcessRunnerError("exit", "The AI client returned no final response. Try again.");
  let final: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const event = parse(line);
    if (event === undefined) throw new ProcessRunnerError("exit", "The AI client returned unexpected non-JSON output.");
    const content = copilotAssistantContent(event);
    if (content !== undefined) final = content;
    else if (final !== undefined && !isSafeCopilotTerminalEvent(event)) final = undefined;
  }
  if (final === undefined) throw new ProcessRunnerError("exit", "The AI client returned no final assistant response. Try again.");
  return unwrapJsonFence(final);
}

function parse(text: string): unknown | undefined {
  try { return JSON.parse(text); } catch { return undefined; }
}

function finalValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (let index = value.length - 1; index >= 0; index--) {
      const nested = finalValue(value[index]);
      if (nested) return nested;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const object = value as Record<string, unknown>;
  if ("level1" in object && "level2" in object) return JSON.stringify(object);
  for (const key of ["result", "text", "content", "message", "output", "response", "data", "payload", "properties", "part", "item"]) {
    const candidate = object[key];
    if (typeof candidate === "string") return candidate;
    if (candidate && typeof candidate === "object") {
      const nested = finalValue(candidate);
      if (nested) return nested;
    }
  }
  return undefined;
}

function copilotAssistantContent(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const event = value as Record<string, unknown>;
  if (event.type !== "assistant.message" || !event.data || typeof event.data !== "object") return undefined;
  const data = event.data as Record<string, unknown>;
  if (hasToolMetadata(data)) return undefined;
  return contentText(data.content) ?? nestedContent(data.message) ?? nestedContent(data.response);
}

function nestedContent(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  return contentText((value as Record<string, unknown>).content);
}

function contentText(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const parts = value.map((block) => {
    if (!block || typeof block !== "object") return undefined;
    const item = block as Record<string, unknown>;
    if (item.type !== "text" && item.type !== "output_text") return undefined;
    return typeof item.text === "string" ? item.text : undefined;
  });
  return parts.every((part): part is string => part !== undefined) ? parts.join("") : undefined;
}

function isSafeCopilotTerminalEvent(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return event.type === "result" && !hasToolMetadata(event) && !hasContentMetadata(event);
}

function hasToolMetadata(value: unknown): boolean {
  return hasNestedMetadata(value, (key) => {
    const name = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    return name.startsWith("tool") || name.includes("toolcall") || name.includes("toolrequest") || name.includes("tooluse") || name.includes("execution");
  });
}

function hasContentMetadata(value: unknown): boolean {
  return hasNestedMetadata(value, (key) => ["content", "text", "message", "response", "output", "result", "delta", "fragment"].includes(key.replace(/[^a-z0-9]/gi, "").toLowerCase()));
}

function hasNestedMetadata(value: unknown, matches: (key: string) => boolean): boolean {
  if (!value || typeof value !== "object") return false;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (matches(key) && isNonEmpty(nested)) return true;
    if (hasNestedMetadata(nested, matches)) return true;
  }
  return false;
}

function isNonEmpty(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return value !== undefined && value !== null && value !== "";
}

function unwrapJsonFence(text: string): string {
  const match = text.match(/^[ \t]*```json[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/i);
  return match && !match[1].includes("```") ? match[1] : text;
}
