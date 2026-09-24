export const cliIds = ["claude", "codex", "copilot", "opencode"] as const;

export type CliId = (typeof cliIds)[number];

export interface ProbeResult {
  available: boolean;
  version?: string;
  capabilities: ReadonlySet<string>;
  message?: string;
}

export interface AnalyzeOptions {
  model?: string;
}

/** Provider adapters receive a fully assembled, untrusted prompt through the process runner. */
export interface CliAdapter {
  readonly id: CliId;
  probe(signal?: AbortSignal): Promise<ProbeResult>;
  analyze(prompt: string, options?: AnalyzeOptions, signal?: AbortSignal): Promise<string>;
}
