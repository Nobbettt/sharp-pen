import type { CliId } from "./types";
import { spawnProcessTree } from "./processTree";

const executableNames: ReadonlySet<string> = new Set(["claude", "codex", "copilot", "opencode"]);
const defaultTimeoutMs = 120_000;
const defaultStdoutLimit = 1_000_000;
const defaultStderrLimit = 64_000;
const killGraceMs = 1_000;

export type ProcessFailureKind = "aborted" | "launch" | "timeout" | "output" | "exit";

export class ProcessRunnerError extends Error {
  constructor(readonly kind: ProcessFailureKind, message: string) {
    super(message);
    this.name = "ProcessRunnerError";
  }
}

export interface ProcessRequest {
  executable: CliId;
  args: readonly string[];
  input?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  stdoutLimit?: number;
  stderrLimit?: number;
}

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Runs one of Sharp Pen's fixed executables. Prompts never become shell input or argv. */
export function runProcess(request: ProcessRequest): Promise<ProcessResult> {
  if (!executableNames.has(request.executable)) throw new ProcessRunnerError("launch", "Sharp Pen cannot launch that AI client.");
  if (request.signal?.aborted) return Promise.reject(new ProcessRunnerError("aborted", "Sharp Pen analysis was cancelled."));

  const timeoutMs = request.timeoutMs ?? defaultTimeoutMs;
  const stdoutLimit = request.stdoutLimit ?? defaultStdoutLimit;
  const stderrLimit = request.stderrLimit ?? defaultStderrLimit;
  if (timeoutMs <= 0 || stdoutLimit <= 0 || stderrLimit <= 0) {
    return Promise.reject(new ProcessRunnerError("launch", "Sharp Pen analysis has invalid process limits."));
  }

  return new Promise<ProcessResult>((resolve, reject) => {
    const label = clientLabel(request.executable);
    let processTree;
    try {
      // A neutral cwd prevents source documents outside a Git workspace from becoming CLI workspace input.
      processTree = spawnProcessTree(request.executable, request.args);
    } catch {
      reject(new ProcessRunnerError("launch", `${label} could not be started. Check that it is installed on this extension host.`));
      return;
    }

    const child = processTree.child;
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutSize = 0;
    let stderrSize = 0;
    let failure: ProcessRunnerError | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    let settled = false;

    const finish = (error?: ProcessRunnerError, result?: ProcessResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      request.signal?.removeEventListener("abort", abort);
      child.removeListener("error", launchError);
      child.removeListener("close", closed);
      child.stdout.removeListener("data", stdoutData);
      child.stderr.removeListener("data", stderrData);
      processTree.dispose();
      error ? reject(error) : resolve(result!);
    };
    const stop = (error: ProcessRunnerError) => {
      if (failure) return;
      failure = error;
      child.stdin?.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      processTree.terminate();
      // Descendants can retain the stdio handles, so close is not a settlement guarantee.
      killTimer = setTimeout(() => { processTree.forceKill(); finish(failure); }, killGraceMs);
    };
    const abort = () => stop(new ProcessRunnerError("aborted", "Sharp Pen analysis was cancelled."));
    const timeout = setTimeout(() => stop(new ProcessRunnerError("timeout", `${label} timed out. Check its sign-in and selected model, then try again.`)), timeoutMs);

    const launchError = () => finish(new ProcessRunnerError("launch", `${label} could not be started. Check that it is installed on this extension host.`));
    const stdinError = () => {
      if (settled || failure) return;
      stop(new ProcessRunnerError("exit", `${label} could not receive the analysis request.`));
    };
    const stdoutData = (chunk: Buffer) => {
      if (failure) return;
      stdoutSize += chunk.length;
      if (stdoutSize > stdoutLimit) return stop(new ProcessRunnerError("output", `${label} returned too much output. Try again with a shorter document.`));
      stdout.push(chunk);
    };
    const stderrData = (chunk: Buffer) => {
      if (failure) return;
      stderrSize += chunk.length;
      if (stderrSize > stderrLimit) return stop(new ProcessRunnerError("output", `${label} returned too much diagnostic output. Try again.`));
      stderr.push(chunk);
    };
    const closed = (exitCode: number | null) => {
      // A terminated leader can close before a TERM-ignoring descendant. The grace
      // timer owns settlement so it can still send KILL to the original process group.
      if (failure) return;
      if (exitCode !== 0) {
        return finish(new ProcessRunnerError("exit", `${label} failed. Check its sign-in and selected model, then try again.`));
      }
      finish(undefined, { stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8"), exitCode: exitCode ?? 0 });
    };
    child.once("error", launchError);
    // Keep this listener until stdin itself closes: an EPIPE can arrive after the
    // child close event or after cancellation has settled the public promise.
    child.stdin.on("error", stdinError);
    child.stdin.once("close", () => child.stdin.removeListener("error", stdinError));
    child.stdout.on("data", stdoutData);
    child.stderr.on("data", stderrData);
    child.once("close", closed);
    request.signal?.addEventListener("abort", abort, { once: true });
    if (request.signal?.aborted) return abort();
    try {
      child.stdin.end(request.input ?? "", "utf8");
    } catch {
      stop(new ProcessRunnerError("launch", `${label} could not receive the analysis request.`));
    }
  });
}

function clientLabel(id: CliId): string {
  return ({ claude: "Claude Code", codex: "Codex", copilot: "GitHub Copilot", opencode: "OpenCode" })[id];
}
