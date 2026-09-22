import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";

import { taskkillArgs } from "../../src/ai/processTree";
import { ProcessRunnerError, runProcess } from "../../src/ai/processRunner";
import { writeCliFixtureExecutable } from "./cliFixture";

async function fixture(body: string): Promise<{ restore(): Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "sharp-pen-tree-"));
  await writeCliFixtureExecutable(dir, "claude", body);
  const previous = process.env.PATH;
  process.env.PATH = `${dir}${delimiter}${previous ?? ""}`;
  return { async restore() { process.env.PATH = previous; await rm(dir, { recursive: true, force: true }); } };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test("Windows taskkill targets the CLI process tree", () => {
  assert.deepEqual(taskkillArgs(1234), ["/PID", "1234", "/T", "/F"]);
});

test("cancellation settles and kills a CLI process tree that retains stdio", { concurrency: false, skip: process.platform === "win32" }, async () => {
  const pidFile = join(tmpdir(), `sharp-pen-tree-${process.pid}-${Date.now()}`);
  const grandchild = `const { appendFileSync } = require('node:fs'); appendFileSync(${JSON.stringify(pidFile)}, process.pid + '\\n'); setInterval(() => {}, 1_000);`;
  const child = `const { spawn } = require('node:child_process'); const { appendFileSync } = require('node:fs'); appendFileSync(${JSON.stringify(pidFile)}, process.pid + '\\n'); spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'inherit' }); setInterval(() => {}, 1_000);`;
  const setup = await fixture(`const { spawn } = require('node:child_process'); spawn(process.execPath, ['-e', ${JSON.stringify(child)}], { stdio: 'inherit' }); setInterval(() => {}, 1_000);`);
  try {
    const controller = new AbortController();
    const process = runProcess({ executable: "claude", args: [], signal: controller.signal, timeoutMs: 5_000 });
    let pids: number[] = [];
    for (let attempt = 0; attempt < 60 && pids.length < 2; attempt += 1) {
      try { pids = (await readFile(pidFile, "utf8")).trim().split("\n").filter(Boolean).map(Number); } catch { /* The nested process is still starting. */ }
      if (pids.length < 2) await sleep(50);
    }
    assert.equal(pids.length, 2, "fixture did not start its child and grandchild");
    const started = Date.now();
    controller.abort();
    await assert.rejects(process, (error: unknown) => error instanceof ProcessRunnerError && error.kind === "aborted");
    assert.ok(Date.now() - started < 1_800, "cancellation must not wait for inherited stdio to close");
    for (let attempt = 0; attempt < 20 && pids.some(alive); attempt += 1) await sleep(50);
    assert.ok(pids.every((pid) => !alive(pid)), "the child and grandchild must be gone");
  } finally {
    await setup.restore();
    await rm(pidFile, { force: true });
  }
});

test("cancellation kills a TERM-ignoring descendant after its leader closes", { concurrency: false, skip: process.platform === "win32" }, async () => {
  const pidFile = join(tmpdir(), `sharp-pen-tree-term-${process.pid}-${Date.now()}`);
  const descendant = `const { writeFileSync } = require('node:fs'); writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); process.on('SIGTERM', () => {}); setInterval(() => {}, 1_000);`;
  const setup = await fixture(`const { spawn } = require('node:child_process'); spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: 'ignore' }); process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1_000);`);
  try {
    const controller = new AbortController();
    const running = runProcess({ executable: "claude", args: [], signal: controller.signal, timeoutMs: 5_000 });
    let pid = 0;
    for (let attempt = 0; attempt < 60 && !pid; attempt += 1) {
      try { pid = Number(await readFile(pidFile, "utf8")); } catch { await sleep(50); }
    }
    assert.ok(pid, "fixture did not start its TERM-ignoring descendant");
    const started = Date.now();
    controller.abort();
    await assert.rejects(running, (error: unknown) => error instanceof ProcessRunnerError && error.kind === "aborted");
    assert.ok(Date.now() - started < 1_800, "cancellation must settle after the bounded kill grace");
    for (let attempt = 0; attempt < 20 && alive(pid); attempt += 1) await sleep(50);
    assert.ok(!alive(pid), "the TERM-ignoring descendant must receive SIGKILL after its leader closes");
  } finally {
    await setup.restore();
    await rm(pidFile, { force: true });
  }
});
