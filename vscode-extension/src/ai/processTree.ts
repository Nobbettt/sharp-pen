import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import type { CliId } from "./types";

/** A fixed CLI launched separately from the extension-host process group. */
export interface ProcessTree {
  readonly child: ChildProcessWithoutNullStreams;
  readonly inputConsumed: boolean;
  terminate(): void;
  forceKill(): void;
  dispose(): void;
}

export const promptFileArgument = "__SHARP_PEN_PROMPT_FILE__";

export interface CliLaunch {
  readonly command: string;
  readonly args: readonly string[];
  readonly windowsVerbatimArguments: boolean;
}

export interface CliLaunchOptions {
  platform?: NodeJS.Platform;
  resolve?: (executable: CliId) => string | undefined;
  comSpec?: string;
}

/** Builds a direct launch on POSIX and a quoted cmd.exe launch only for npm shims. */
export function buildCliLaunch(executable: CliId, args: readonly string[], options: CliLaunchOptions = {}): CliLaunch {
  if ((options.platform ?? process.platform) !== "win32") return { command: executable, args: [...args], windowsVerbatimArguments: false };
  const resolved = options.resolve?.(executable) ?? executable;
  if (!/\.(?:cmd|bat)$/i.test(resolved)) return { command: resolved, args: [...args], windowsVerbatimArguments: false };
  return {
    command: options.comSpec ?? process.env.ComSpec ?? process.env.COMSPEC ?? "cmd.exe",
    args: ["/d", "/s", "/v:off", "/c", `"${[quoteCmdExecutable(resolved), ...args.map(quoteCmdArgument)].join(" ")}"`],
    windowsVerbatimArguments: true,
  };
}

export function spawnProcessTree(executable: CliId, args: readonly string[], input?: string): ProcessTree {
  const cwd = mkdtempSync(join(tmpdir(), "sharp-pen-"));
  try {
    if (process.platform !== "win32") chmodSync(cwd, 0o700);
    const env = isolatedEnv(executable, process.env, cwd);
    const promptIndexes = args.flatMap((value, index) => value === promptFileArgument ? [index] : []);
    if (promptIndexes.length && (executable !== "opencode" || promptIndexes.length !== 1 || input === undefined)) {
      throw new Error("Invalid prompt-file launch.");
    }
    const launchArgs = [...args];
    if (promptIndexes.length) {
      const promptPath = join(cwd, "prompt.txt");
      writeFileSync(promptPath, input!, { encoding: "utf8", mode: 0o600 });
      launchArgs[promptIndexes[0]] = promptPath;
    }
    const launch = buildCliLaunch(executable, launchArgs, {
      resolve: process.platform === "win32" ? (name) => resolveWindowsExecutable(name, env, cwd) : undefined,
      comSpec: env.ComSpec ?? env.COMSPEC,
    });
    const child: ChildProcessWithoutNullStreams = spawn(launch.command, [...launch.args], {
      cwd,
      env,
      shell: false,
      windowsVerbatimArguments: launch.windowsVerbatimArguments,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      // A negative PID can then safely target this CLI and every descendant on POSIX.
      detached: process.platform !== "win32",
    });
    return processTree(child, cwd, promptIndexes.length === 1);
  } catch (error) {
    rmSync(cwd, { recursive: true, force: true });
    throw error;
  }
}

// Runnable directly (spawn resolves .com/.exe itself) or launchable through the cmd.exe wrapping in buildCliLaunch.
const runnableExtensions = [".exe", ".com", ".cmd", ".bat"];

/** Picks the first `where.exe` result PATHEXT actually makes executable, preferring a native binary over a shim. */
export function selectWindowsExecutablePath(candidates: readonly string[], pathext: string | undefined): string | undefined {
  const allowed = new Set((pathext ?? "").split(";").map((entry) => entry.trim().toLowerCase()).filter(Boolean));
  let best: { path: string; rank: number } | undefined;
  for (const candidate of candidates) {
    const extension = win32.extname(candidate).toLowerCase();
    const rank = runnableExtensions.indexOf(extension);
    if (rank === -1 || !allowed.has(extension)) continue;
    if (!best || rank < best.rank) best = { path: candidate, rank };
  }
  return best?.path;
}

function resolveWindowsExecutable(executable: CliId, env: NodeJS.ProcessEnv, cwd: string): string | undefined {
  try {
    const result = spawnSync("where.exe", [executable], { cwd, env, shell: false, windowsHide: true, encoding: "utf8" });
    if (result.status !== 0 || typeof result.stdout !== "string") return undefined;
    const candidates = result.stdout.split(/\r?\n/).map((path) => path.trim()).filter(Boolean);
    return selectWindowsExecutablePath(candidates, env.PATHEXT);
  } catch {
    return undefined;
  }
}

const cmdMeta = /([()%!^"`<>&|;, *?\[\]])/g;

// The command processor receives one command string; escape its command syntax before it parses it.
function quoteCmdExecutable(value: string): string {
  if (/[\0-\x1f\x7f]/.test(value)) throw new Error("sharp-pen cannot pass control characters to cmd.exe.");
  return value.replace(cmdMeta, "^$1");
}

/**
 * Caret-escapes one cmd.exe parse of this argument. When `resolved` is an npm .cmd shim, the
 * shim's own `%*` re-expands the arguments and cmd parses that line a second time, where `\"`
 * does not escape a quote (the class of issue behind CVE-2024-27980) — this function does not
 * defend against that second parse. It is safe only because every argv value sharp-pen passes is
 * either a fixed constant or a model ID constrained to `modelIdPattern` (src/ai/modelId.ts),
 * which contains no cmd.exe or shim metacharacters.
 */
function quoteCmdArgument(value: string): string {
  if (/[\0-\x1f\x7f]/.test(value)) throw new Error("sharp-pen cannot pass control characters to cmd.exe.");
  const escaped = value.replace(/(\\*)"/g, "$1$1\\\"").replace(/(\\*)$/, "$1$1");
  return `"${escaped}"`.replace(cmdMeta, "^$1");
}

export function taskkillArgs(pid: number): string[] {
  return ["/PID", String(pid), "/T", "/F"];
}

function processTree(child: ChildProcessWithoutNullStreams, cwd: string, inputConsumed: boolean): ProcessTree {
  const pid = child.pid;
  let closed = false;
  let terminating = false;
  const markClosed = () => { closed = true; };
  child.once("close", markClosed);

  const signalGroup = (signal: NodeJS.Signals) => {
    // Do not use `closed`: the group can still contain descendants which inherited stdio.
    if (!pid) return;
    try { process.kill(-pid, signal); } catch { /* The group already ended. */ }
  };
  const taskkill = () => {
    // Do not taskkill after the direct child has reported close: its PID may be reused.
    if (!pid || closed || child.exitCode !== null || child.signalCode !== null) return;
    try {
      const killer = spawn("taskkill", taskkillArgs(pid), { shell: false, windowsHide: true, stdio: "ignore" });
      killer.once("error", () => {});
      killer.unref();
    } catch { /* Best effort; the original failure is reported by the caller. */ }
  };

  return {
    child,
    inputConsumed,
    terminate() {
      if (terminating || closed) return;
      terminating = true;
      if (process.platform === "win32") taskkill(); else signalGroup("SIGTERM");
    },
    forceKill() {
      if (terminating && process.platform !== "win32") signalGroup("SIGKILL");
    },
    dispose() {
      child.removeListener("close", markClosed);
      try { rmSync(cwd, { recursive: true, force: true, maxRetries: 1 }); } catch { /* Windows can release cwd just after taskkill. */ }
    },
  };
}

const sharedEnv = new Set([
  "ALL_PROXY", "APPDATA", "COLORTERM", "COMSPEC", "HOME", "HOMEDRIVE", "HOMEPATH", "HTTP_PROXY", "HTTPS_PROXY",
  "LANG", "LOCALAPPDATA", "LOGNAME", "NO_COLOR", "NO_PROXY", "PATH", "PATHEXT", "SHELL",
  "SSL_CERT_DIR", "SSL_CERT_FILE", "SYSTEMROOT", "TEMP", "TERM", "TMP", "TMPDIR", "USER", "USERNAME", "USERPROFILE",
  "WINDIR", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_RUNTIME_DIR",
]);

// claude, copilot, and codex's npm launcher are all Node programs; Node reads these two for
// TLS-inspecting corporate proxies but ignores SSL_CERT_FILE/SSL_CERT_DIR without --use-openssl-ca.
const nodeCliEnv = new Set(["NODE_EXTRA_CA_CERTS", "NODE_USE_SYSTEM_CA"]);

const copilotEnv = new Set(["COPILOT_GH_HOST", "COPILOT_GITHUB_TOKEN", "COPILOT_HOME", "COPILOT_CACHE_HOME", "COPILOT_PROVIDERS_CONFIG", "GH_CONFIG_DIR", "GH_TOKEN", "GITHUB_TOKEN", "GH_HOST"]);
const unsafeCodexEnv = new Set(["CODEX_ALLOW_ALL", "CODEX_APPROVAL_POLICY", "CODEX_ASK_FOR_APPROVAL", "CODEX_PERMISSION_PROFILE", "CODEX_SANDBOX", "CODEX_SANDBOX_NETWORK_DISABLED"]);

/** Builds the smallest credential environment needed by one fixed CLI. */
export function isolatedEnv(executable: CliId, source: NodeJS.ProcessEnv = process.env, cwd?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && allowedFor(executable, key)) env[key] = value;
  }
  if (!env.PATH && source.Path) {
    env.PATH = source.Path;
    delete env.Path;
  }
  if (executable === "opencode" && cwd) {
    const dataHome = source.XDG_DATA_HOME ?? (process.platform === "win32" ? undefined : source.HOME && join(source.HOME, ".local", "share"));
    env.HOME = cwd;
    env.USERPROFILE = cwd;
    env.XDG_CONFIG_HOME = cwd;
    env.OPENCODE_CONFIG_DIR = cwd;
    env.OPENCODE_CONFIG_CONTENT = openCodeConfig;
    if (dataHome) env.XDG_DATA_HOME = dataHome;
  }
  return env;
}

export const openCodeConfig = JSON.stringify({
  share: "disabled",
  autoupdate: false,
  snapshot: false,
  formatter: false,
  lsp: false,
  instructions: [],
  plugin: [],
  permission: "deny",
  default_agent: "sharp-pen",
  agent: { "sharp-pen": { description: "Text-only proofreading", mode: "primary", steps: 1, permission: "deny" } },
});

function allowedFor(executable: CliId, key: string): boolean {
  const upper = key.toUpperCase();
  if (sharedEnv.has(upper) || upper.startsWith("LC_")) return true;
  switch (executable) {
    case "claude":
      return nodeCliEnv.has(key) || key === "CLAUDE_CONFIG_DIR" || key === "CLOUD_ML_REGION" || key.startsWith("CLAUDE_CODE_") || key.startsWith("ANTHROPIC_")
        || key.startsWith("AWS_") || key.startsWith("AZURE_") || key.startsWith("GOOGLE_") || key.startsWith("VERTEX_REGION_");
    case "copilot": return nodeCliEnv.has(key) || copilotEnv.has(key);
    case "codex": return nodeCliEnv.has(key) || (key.startsWith("CODEX_") && !unsafeCodexEnv.has(key)) || key.startsWith("OPENAI_");
    case "opencode":
      return nodeCliEnv.has(key) || key.startsWith("OPENAI_") || key.startsWith("ANTHROPIC_") || key.startsWith("AWS_")
        || key.startsWith("AZURE_") || key.startsWith("GOOGLE_") || key === "GITHUB_TOKEN";
  }
}
