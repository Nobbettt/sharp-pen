import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CliId } from "./types";

/** A fixed CLI launched separately from the extension-host process group. */
export interface ProcessTree {
  readonly child: ChildProcessWithoutNullStreams;
  terminate(): void;
  forceKill(): void;
  dispose(): void;
}

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
    args: ["/d", "/s", "/c", `"${[resolved, ...args].map(quoteCmdArgument).join(" ")}"`],
    windowsVerbatimArguments: true,
  };
}

export function spawnProcessTree(executable: CliId, args: readonly string[]): ProcessTree {
  const cwd = mkdtempSync(join(tmpdir(), "sharp-pen-"));
  try {
    if (process.platform !== "win32") chmodSync(cwd, 0o700);
    const env = isolatedEnv(executable);
    const launch = buildCliLaunch(executable, args, {
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
    return processTree(child, cwd);
  } catch (error) {
    rmSync(cwd, { recursive: true, force: true });
    throw error;
  }
}

function resolveWindowsExecutable(executable: CliId, env: NodeJS.ProcessEnv, cwd: string): string | undefined {
  try {
    const result = spawnSync("where.exe", [executable], { cwd, env, shell: false, windowsHide: true, encoding: "utf8" });
    if (result.status !== 0 || typeof result.stdout !== "string") return undefined;
    return result.stdout.split(/\r?\n/).map((path) => path.trim()).find(Boolean);
  } catch {
    return undefined;
  }
}

// The command processor receives one command string; quote each token before it parses it.
function quoteCmdArgument(value: string): string {
  if (/[\0\r\n"]/.test(value)) throw new Error("Sharp Pen cannot pass control characters to cmd.exe.");
  return `"${value.replace(/(\\*)$/, "$1$1")}"`;
}

export function taskkillArgs(pid: number): string[] {
  return ["/PID", String(pid), "/T", "/F"];
}

function processTree(child: ChildProcessWithoutNullStreams, cwd: string): ProcessTree {
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
  "LANG", "LOCALAPPDATA", "LOGNAME", "NO_COLOR", "NO_PROXY", "PATH", "PATHEXT", "SHELL", "SSH_AUTH_SOCK",
  "SSL_CERT_DIR", "SSL_CERT_FILE", "SYSTEMROOT", "TEMP", "TERM", "TMP", "TMPDIR", "USER", "USERNAME", "USERPROFILE",
  "WINDIR", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_RUNTIME_DIR",
]);

const copilotEnv = new Set(["COPILOT_GH_HOST", "COPILOT_GITHUB_TOKEN", "COPILOT_HOME", "COPILOT_CACHE_HOME", "COPILOT_PROVIDERS_CONFIG", "GH_CONFIG_DIR"]);
const unsafeCodexEnv = new Set(["CODEX_ALLOW_ALL", "CODEX_APPROVAL_POLICY", "CODEX_ASK_FOR_APPROVAL", "CODEX_PERMISSION_PROFILE", "CODEX_SANDBOX", "CODEX_SANDBOX_NETWORK_DISABLED"]);

/** Builds the smallest credential environment needed by one fixed CLI. */
export function isolatedEnv(executable: CliId, source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && allowedFor(executable, key)) env[key] = value;
  }
  if (!env.PATH && source.Path) {
    env.PATH = source.Path;
    delete env.Path;
  }
  return env;
}

function allowedFor(executable: CliId, key: string): boolean {
  const upper = key.toUpperCase();
  if (sharedEnv.has(upper) || upper.startsWith("LC_")) return true;
  switch (executable) {
    case "claude":
      return key === "CLAUDE_CONFIG_DIR" || key.startsWith("CLAUDE_CODE_") || key.startsWith("ANTHROPIC_")
        || key.startsWith("AWS_") || key.startsWith("AZURE_") || key.startsWith("GOOGLE_");
    case "copilot": return copilotEnv.has(key);
    case "codex": return (key.startsWith("CODEX_") && !unsafeCodexEnv.has(key)) || key.startsWith("OPENAI_");
    case "opencode": return key === "OPENCODE_CONFIG";
  }
}
