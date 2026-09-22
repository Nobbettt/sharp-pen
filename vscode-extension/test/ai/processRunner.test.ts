import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";

import { buildCliLaunch, isolatedEnv } from "../../src/ai/processTree";
import { ProcessRunnerError, runProcess } from "../../src/ai/processRunner";
import { writeCliFixtureExecutable } from "./cliFixture";

function captureProcessFaults(): { faults: unknown[]; release(): void } {
  const faults: unknown[] = [];
  const capture = (fault: unknown) => faults.push(fault);
  process.on("uncaughtException", capture);
  process.on("unhandledRejection", capture);
  return {
    faults,
    release() {
      process.removeListener("uncaughtException", capture);
      process.removeListener("unhandledRejection", capture);
    },
  };
}

async function fixture(body: string): Promise<{ dir: string; restore(): Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "sharp-pen-cli-"));
  await writeCliFixtureExecutable(dir, "claude", body);
  const previous = process.env.PATH;
  process.env.PATH = `${dir}${delimiter}${previous ?? ""}`;
  return {
    dir,
    async restore() {
      process.env.PATH = previous;
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("runner sends input through stdin and keeps it out of argv", { concurrency: false }, async () => {
  const setup = await fixture("let input = ''; process.stdin.on('data', c => input += c); process.stdin.on('end', () => process.stdout.write(JSON.stringify({ argv: process.argv.slice(2), input }))); ");
  try {
    const result = await runProcess({ executable: "claude", args: ["--print"], input: "source outside git" });
    assert.deepEqual(JSON.parse(result.stdout), { argv: ["--print"], input: "source outside git" });
  } finally {
    await setup.restore();
  }
});

test("Windows wraps a resolved command shim in one cmd.exe command", () => {
  const command = buildCliLaunch("codex", ["exec", "--model", "gpt-5.3-codex"], {
    platform: "win32",
    resolve: () => "C:\\Users\\Ada Lovelace\\AppData\\Roaming\\npm\\codex.cmd",
    comSpec: "C:\\Windows\\System32\\cmd.exe",
  });
  assert.equal(command.command, "C:\\Windows\\System32\\cmd.exe");
  assert.deepEqual(command.args.slice(0, 3), ["/d", "/s", "/c"]);
  assert.equal(command.args[3], '""C:\\Users\\Ada Lovelace\\AppData\\Roaming\\npm\\codex.cmd" "exec" "--model" "gpt-5.3-codex""');
  assert.equal(command.windowsVerbatimArguments, true);

  const native = buildCliLaunch("codex", ["exec"], { platform: "win32", resolve: () => "C:\\Tools\\codex.exe" });
  assert.deepEqual(native, { command: "C:\\Tools\\codex.exe", args: ["exec"], windowsVerbatimArguments: false });

  const posix = buildCliLaunch("codex", ["exec"], { platform: "linux" });
  assert.equal(posix.windowsVerbatimArguments, false);
});

test("Windows cmd.exe quoting preserves trailing slashes and quoted meta arguments", () => {
  const command = buildCliLaunch("claude", ["C:\\ends-with-slash\\", "safe&still", "^|<>()%!"], {
    platform: "win32",
    resolve: () => "C:\\fixture path\\claude.cmd",
  });
  assert.equal(command.args[3], '""C:\\fixture path\\claude.cmd" "C:\\ends-with-slash\\\\" "safe&still" "^|<>()%!""');
  assert.throws(() => buildCliLaunch("claude", ['embedded"quote'], { platform: "win32", resolve: () => "C:\\fixture\\claude.cmd" }));
});

test("runner isolates its cwd and environment", { concurrency: false }, async () => {
  const setup = await fixture("const { statSync } = require('node:fs'); process.stdout.write(JSON.stringify({ cwd: process.cwd(), mode: statSync(process.cwd()).mode & 0o777, env: Object.keys(process.env) }));");
  const previous = { allow: process.env.COPILOT_ALLOW_ALL, codex: process.env.CODEX_ALLOW_ALL, secret: process.env.UNRELATED_SECRET };
  process.env.COPILOT_ALLOW_ALL = "1";
  process.env.CODEX_ALLOW_ALL = "1";
  process.env.UNRELATED_SECRET = "nope";
  try {
    const result = await runProcess({ executable: "claude", args: [] });
    const value = JSON.parse(result.stdout) as { cwd: string; mode: number; env: string[] };
    assert.match(value.cwd, /sharp-pen-/);
    if (process.platform !== "win32") assert.equal(value.mode, 0o700);
    assert.ok(!value.env.includes("COPILOT_ALLOW_ALL"));
    assert.ok(!value.env.includes("CODEX_ALLOW_ALL"));
    assert.ok(!value.env.includes("UNRELATED_SECRET"));
    assert.ok(value.env.includes("PATH"));
    await assert.rejects(access(value.cwd));
  } finally {
    if (previous.allow === undefined) delete process.env.COPILOT_ALLOW_ALL; else process.env.COPILOT_ALLOW_ALL = previous.allow;
    if (previous.codex === undefined) delete process.env.CODEX_ALLOW_ALL; else process.env.CODEX_ALLOW_ALL = previous.codex;
    if (previous.secret === undefined) delete process.env.UNRELATED_SECRET; else process.env.UNRELATED_SECRET = previous.secret;
    await setup.restore();
  }
});

test("runner scopes auth and config environment to its CLI", () => {
  const source = {
    PATH: "fixture-path",
    CLAUDE_CODE_OAUTH_TOKEN: "credential",
    ANTHROPIC_API_KEY: "credential",
    AWS_ACCESS_KEY_ID: "credential",
    GOOGLE_APPLICATION_CREDENTIALS: "credential",
    AZURE_OPENAI_API_KEY: "credential",
    COPILOT_GITHUB_TOKEN: "credential",
    COPILOT_HOME: "config-path",
    COPILOT_CACHE_HOME: "cache-path",
    COPILOT_ALLOW_ALL: "1",
    COPILOT_APPROVAL_POLICY: "never",
    GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS: "true",
    CODEX_HOME: "config-path",
    CODEX_THREAD_ID: "session",
    CODEX_SANDBOX: "danger-full-access",
    CODEX_PERMISSION_PROFILE: "full",
    OPENAI_API_KEY: "credential",
    UNRELATED_SECRET: "credential",
  };
  const claude = isolatedEnv("claude", source);
  for (const key of ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "AWS_ACCESS_KEY_ID", "GOOGLE_APPLICATION_CREDENTIALS", "AZURE_OPENAI_API_KEY"]) assert.ok(key in claude);
  for (const key of ["COPILOT_GITHUB_TOKEN", "CODEX_HOME", "OPENAI_API_KEY", "UNRELATED_SECRET"]) assert.ok(!(key in claude));

  const copilot = isolatedEnv("copilot", source);
  for (const key of ["COPILOT_GITHUB_TOKEN", "COPILOT_HOME", "COPILOT_CACHE_HOME"]) assert.ok(key in copilot);
  for (const key of ["COPILOT_ALLOW_ALL", "COPILOT_APPROVAL_POLICY", "GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "UNRELATED_SECRET"]) assert.ok(!(key in copilot));

  const codex = isolatedEnv("codex", source);
  for (const key of ["CODEX_HOME", "CODEX_THREAD_ID", "OPENAI_API_KEY"]) assert.ok(key in codex);
  for (const key of ["CODEX_SANDBOX", "CODEX_PERMISSION_PROFILE", "COPILOT_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "UNRELATED_SECRET"]) assert.ok(!(key in codex));
});

test("runner bounds output and aborts a child", { concurrency: false }, async () => {
  const setup = await fixture("process.stdout.write('x'.repeat(2048)); setInterval(() => {}, 1000);");
  try {
    await assert.rejects(
      runProcess({ executable: "claude", args: [], stdoutLimit: 64, timeoutMs: 5_000 }),
      (error: unknown) => error instanceof ProcessRunnerError && error.kind === "output",
    );
  } finally {
    await setup.restore();
  }

  const aborted = await fixture("setInterval(() => {}, 1000);");
  try {
    const controller = new AbortController();
    const promise = runProcess({ executable: "claude", args: [], signal: controller.signal, timeoutMs: 5_000 });
    controller.abort();
    await assert.rejects(promise, (error: unknown) => error instanceof ProcessRunnerError && error.kind === "aborted");
  } finally {
    await aborted.restore();
  }
});

test("runner reports a bounded timeout without child diagnostics", { concurrency: false }, async () => {
  const setup = await fixture("process.stderr.write('credential=secret'); setInterval(() => {}, 1000);");
  try {
    await assert.rejects(
      runProcess({ executable: "claude", args: [], timeoutMs: 50 }),
      (error: unknown) => error instanceof ProcessRunnerError
        && error.kind === "timeout"
        && !error.message.includes("secret"),
    );
  } finally {
    await setup.restore();
  }
});

test("runner handles stdin EPIPE from an immediately exiting client", { concurrency: false, timeout: 3_000 }, async () => {
  const setup = await fixture("process.exit(0);");
  const faults = captureProcessFaults();
  try {
    await assert.rejects(
      runProcess({ executable: "claude", args: [], input: "x".repeat(100_000), timeoutMs: 5_000 }),
      (error: unknown) => error instanceof ProcessRunnerError
        && error.kind === "exit"
        && !error.message.includes("EPIPE"),
    );
  } finally {
    faults.release();
    await setup.restore();
    assert.deepEqual(faults.faults, []);
  }
});

test("runner ignores a stdin pipe error after cancellation", { concurrency: false, timeout: 3_000 }, async () => {
  const setup = await fixture("process.exit(0);");
  const controller = new AbortController();
  const faults = captureProcessFaults();
  try {
    const running = runProcess({ executable: "claude", args: [], input: "x".repeat(100_000), signal: controller.signal, timeoutMs: 5_000 });
    controller.abort();
    await assert.rejects(running, (error: unknown) => error instanceof ProcessRunnerError && error.kind === "aborted");
  } finally {
    faults.release();
    await setup.restore();
    assert.deepEqual(faults.faults, []);
  }
});
