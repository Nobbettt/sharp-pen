import type { CliId } from "./types";
import { spawnProcessTree } from "./processTree";
import { isModelId } from "./modelId";

const timeoutMs = 8_000;
const outputLimit = 128_000;
const pageLimit = 10;
const pageSize = 50;
const modelLimit = 200;

// Codex app-server 0.155.1 requires these fields during initialize.
export const codexInitializeParams = {
  clientInfo: { name: "sharp-pen", title: null, version: "0.1.0" },
  capabilities: { experimentalApi: false, requestAttestation: false },
};

export const codexInitializedNotification = { jsonrpc: "2.0", method: "initialized" };

export function codexModelListParams(cursor?: string): Record<string, unknown> {
  return { limit: pageSize, includeHidden: false, ...(cursor ? { cursor } : {}) };
}

export interface ModelDiscoverySource {
  (client: CliId, signal?: AbortSignal): Promise<readonly string[]>;
}

/** Caches only successful lists for this extension-host session. */
export class ModelDiscovery {
  private readonly cache = new Map<CliId, readonly string[]>();
  private readonly aborts = new Set<AbortController>();

  constructor(private readonly source: ModelDiscoverySource = discoverModels) {}

  async list(client: CliId, refresh = false, signal?: AbortSignal): Promise<readonly string[]> {
    if (signal?.aborted) throw new Error("Model discovery was cancelled.");
    if (!refresh && this.cache.has(client)) return this.cache.get(client)!;
    const abort = new AbortController();
    this.aborts.add(abort);
    const cancel = () => abort.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const models = unique(await this.source(client, abort.signal));
      this.cache.set(client, models);
      return models;
    } finally {
      signal?.removeEventListener("abort", cancel);
      this.aborts.delete(abort);
    }
  }

  clear(client?: CliId): void {
    if (client) this.cache.delete(client); else this.cache.clear();
  }

  dispose(): void {
    for (const abort of this.aborts) abort.abort();
    this.aborts.clear();
    this.cache.clear();
  }
}

export async function discoverModels(client: CliId, signal?: AbortSignal): Promise<readonly string[]> {
  switch (client) {
    case "codex": return discoverCodexModels(signal);
    case "opencode": throw new Error("OpenCode model discovery is unavailable because OpenCode is unsupported.");
    // These clients expose account-aware pickers only in their TUI. Never scrape it.
    case "claude": return ["sonnet", "opus", "haiku"];
    case "copilot": return ["auto"];
  }
}

/** Parses only visible, bounded IDs from a Codex model/list result. */
export function parseCodexModels(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const result = value as Record<string, unknown>;
  const entries = Array.isArray(result.data) ? result.data : Array.isArray(result.models) ? result.models : [];
  return unique(entries.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const model = entry as Record<string, unknown>;
    if (model.hidden === true || model.isHidden === true) return [];
    const id = typeof model.id === "string" ? model.id : typeof model.model === "string" ? model.model : "";
    return isModelId(id) ? [id] : [];
  }));
}

function unique(models: readonly string[]): string[] {
  return [...new Set(models.filter(isModelId))].slice(0, modelLimit);
}

function discoverCodexModels(signal?: AbortSignal): Promise<readonly string[]> {
  if (signal?.aborted) return Promise.reject(new Error("Model discovery was cancelled."));
  return new Promise((resolve, reject) => {
    let processTree;
    try {
      processTree = spawnProcessTree("codex", ["app-server"]);
    } catch {
      reject(new Error("Codex model discovery could not be started."));
      return;
    }
    const child = processTree.child;
    let settled = false;
    let stopping = false;
    let bytes = 0;
    let buffer = "";
    let nextId = 1;
    let pages = 0;
    const models: string[] = [];
    let killTimer: NodeJS.Timeout | undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      signal?.removeEventListener("abort", cancel);
      child.removeListener("error", launchError);
      child.removeListener("close", closed);
      child.stdout.removeListener("data", stdoutData);
      child.stderr.removeListener("data", stderrData);
      processTree.dispose();
      error ? reject(error) : resolve(unique(models));
    };
    const stop = (error?: Error) => {
      if (settled || stopping) return;
      stopping = true;
      child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
      processTree.terminate();
      killTimer = setTimeout(() => { processTree.forceKill(); finish(error); }, 1_000);
    };
    const cancel = () => stop(new Error("Model discovery was cancelled."));
    const timeout = setTimeout(() => stop(new Error("Codex model discovery timed out.")), timeoutMs);
    const write = (message: Record<string, unknown>) => {
      if (settled || stopping) return;
      if (!child.stdin.writable || child.stdin.destroyed) return stop(new Error("Codex model discovery failed."));
      try { child.stdin.write(`${JSON.stringify(message)}\n`); }
      catch { stop(new Error("Codex model discovery failed.")); }
    };
    const request = (method: string, params: Record<string, unknown>) => {
      write({ jsonrpc: "2.0", id: nextId++, method, params });
    };
    const page = (cursor?: string) => request("model/list", codexModelListParams(cursor));
    const receive = (line: string) => {
      let message: Record<string, unknown>;
      try {
        const value: unknown = JSON.parse(line);
        if (!value || typeof value !== "object") return;
        message = value as Record<string, unknown>;
      } catch { return; }
      if (message.error) return stop(new Error("Codex model discovery failed."));
      if (message.id === 1) {
        write(codexInitializedNotification);
        return page();
      }
      if (typeof message.id !== "number" || message.id < 2 || !message.result || typeof message.result !== "object") return;
      const result = message.result as Record<string, unknown>;
      models.push(...parseCodexModels(result));
      const cursor = typeof result.nextCursor === "string" ? result.nextCursor : undefined;
      if (cursor && ++pages < pageLimit && models.length < modelLimit) return page(cursor);
      models.length ? stop() : stop(new Error("Codex did not return any supported models."));
    };
    const launchError = () => finish(new Error("Codex model discovery could not be started."));
    const stdinError = () => {
      if (!settled && !stopping) stop(new Error("Codex model discovery failed."));
    };
    const closed = () => { if (!settled && !stopping) finish(new Error("Codex model discovery ended before returning models.")); };
    const stdoutData = (chunk: Buffer) => {
      if (settled) return;
      if ((bytes += chunk.length) > outputLimit) return stop(new Error("Codex model discovery returned too much output."));
      buffer += chunk.toString("utf8");
      for (let end; (end = buffer.indexOf("\n")) >= 0;) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); receive(line);
      }
    };
    const stderrData = (chunk: Buffer) => { if ((bytes += chunk.length) > outputLimit) stop(new Error("Codex model discovery returned too much output.")); };
    child.once("error", launchError);
    // Keep this listener until stdin itself closes: a write error can follow child
    // close or cancellation, and removing it sooner would make it uncaught.
    child.stdin.on("error", stdinError);
    child.stdin.once("close", () => child.stdin.removeListener("error", stdinError));
    child.once("close", closed);
    child.stdout.on("data", stdoutData);
    child.stderr.on("data", stderrData);
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) return cancel();
    request("initialize", codexInitializeParams);
  });
}
