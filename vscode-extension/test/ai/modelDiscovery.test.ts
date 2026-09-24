import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";

import {
  ModelDiscovery,
  codexInitializeParams,
  codexInitializedNotification,
  codexModelListParams,
  discoverModels,
  parseCodexModels,
  parseOpenCodeModels,
} from "../../src/ai/modelDiscovery";
import { cliFixture, writeCliFixtureExecutable } from "./cliFixture";

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

async function codexFixture(body: string): Promise<{ restore(): Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "sharp-pen-codex-"));
  await writeCliFixtureExecutable(dir, "codex", body);
  const previous = process.env.PATH;
  process.env.PATH = `${dir}${delimiter}${previous ?? ""}`;
  return {
    async restore() {
      process.env.PATH = previous;
      await rm(dir, { recursive: true, force: true });
    },
  };
}

const waitForLateFaults = () => new Promise<void>((resolve) => setTimeout(resolve, 50));

test("model discovery parsers keep only supported visible model IDs", () => {
  assert.deepEqual(parseCodexModels({ data: [
    { id: "gpt-5" }, { model: "gpt-5-mini" }, { id: "hidden", hidden: true }, { id: "bad model" }, { id: "gpt-5" },
  ] }), ["gpt-5", "gpt-5-mini"]);
});

test("OpenCode model discovery parses its bounded plain model list", { concurrency: false }, async () => {
  assert.deepEqual(parseOpenCodeModels("openai/gpt-5\ninvalid model\nopenai/gpt-5\nanthropic/claude\n"), ["openai/gpt-5", "anthropic/claude"]);
  const setup = await cliFixture({ opencodeModels: "openai/gpt-5\nanthropic/claude\n" });
  try {
    assert.deepEqual(await discoverModels("opencode"), ["openai/gpt-5", "anthropic/claude"]);
  } finally {
    await setup.restore();
  }
});

test("Codex app-server v0.155.1 model/list fixture uses its required handshake and page fields", () => {
  assert.deepEqual(codexInitializeParams("1.2.3"), {
    clientInfo: { name: "sharp-pen", title: null, version: "1.2.3" },
    capabilities: { experimentalApi: false, requestAttestation: false },
  });
  assert.deepEqual(codexInitializedNotification, { jsonrpc: "2.0", method: "initialized" });
  assert.deepEqual(codexModelListParams(), { limit: 50, includeHidden: false });
  assert.deepEqual(codexModelListParams("next-page"), { limit: 50, includeHidden: false, cursor: "next-page" });
  assert.deepEqual(parseCodexModels({
    data: [
      { id: "gpt-5.3-codex", model: "gpt-5.3-codex", hidden: false },
      { id: "gpt-5.3-codex-hidden", model: "gpt-5.3-codex-hidden", hidden: true },
    ],
    nextCursor: "next-page",
  }), ["gpt-5.3-codex"]);
});

test("model discovery caches successful results by effective client and refresh bypasses it", async () => {
  let calls = 0;
  const discovery = new ModelDiscovery(async (client) => { calls += 1; return [`${client}-model`]; });
  assert.deepEqual(await discovery.list("codex"), ["codex-model"]);
  assert.deepEqual(await discovery.list("codex"), ["codex-model"]);
  assert.deepEqual(await discovery.list("codex", true), ["codex-model"]);
  assert.equal(calls, 2);
  discovery.dispose();
});

test("model discovery does not invoke its source for a pre-aborted request", async () => {
  let calls = 0;
  const abort = new AbortController();
  abort.abort();
  const discovery = new ModelDiscovery(async () => { calls += 1; return ["gpt-test"]; });
  await assert.rejects(discovery.list("codex", false, abort.signal), /cancelled/);
  assert.equal(calls, 0);
});

test("Codex discovery handles an initial early exit without stdin faults", { concurrency: false, timeout: 3_000 }, async () => {
  const setup = await codexFixture("process.exit(0);");
  const faults = captureProcessFaults();
  try {
    await assert.rejects(discoverModels("codex"), /Codex model discovery (failed|ended before returning models)/);
    await waitForLateFaults();
  } finally {
    faults.release();
    await setup.restore();
  }
  assert.deepEqual(faults.faults, []);
});

test("Codex discovery resolves promptly on success instead of waiting the full kill-grace timer", { concurrency: false, timeout: 3_000 }, async () => {
  // The model ID encodes the fixture's own send time, so the assertion below measures from the
  // moment the fixture actually replied rather than from process spawn, which is what makes this
  // robust under `npm test`'s parallel test files: Node startup jitter no longer counts against it.
  const setup = await codexFixture(`
let input = "";
process.stdin.on("data", (chunk) => {
  input += chunk;
  for (let end; (end = input.indexOf("\\n")) >= 0;) {
    const request = JSON.parse(input.slice(0, end));
    input = input.slice(end + 1);
    if (request.method === "initialize") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {} }) + "\\n");
    } else if (request.method === "model/list") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { data: [{ id: "t" + Date.now() }] } }) + "\\n");
    }
  }
});`);
  try {
    const [modelId] = await discoverModels("codex");
    const sentAt = Number(modelId.slice(1));
    assert.ok(Date.now() - sentAt < 900, "should not wait for the 1s kill-grace timer once the process closes");
  } finally {
    await setup.restore();
  }
});

test("Codex discovery handles an EPIPE before a cursor follow-up without process faults", { concurrency: false, timeout: 3_000 }, async () => {
  const setup = await codexFixture(`
let input = "";
process.stdin.on("data", (chunk) => {
  input += chunk;
  for (let end; (end = input.indexOf("\\n")) >= 0;) {
    const request = JSON.parse(input.slice(0, end));
    input = input.slice(end + 1);
    if (request.method === "initialize") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {} }) + "\\n");
    } else if (request.method === "model/list") {
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0", id: request.id,
        result: { data: [{ id: "gpt-5" }], nextCursor: "x".repeat(100_000) },
      }) + "\\n", () => process.exit(0));
    }
  }
});`);
  const faults = captureProcessFaults();
  try {
    await assert.rejects(discoverModels("codex"), /Codex model discovery failed/);
    await waitForLateFaults();
  } finally {
    faults.release();
    await setup.restore();
  }
  assert.deepEqual(faults.faults, []);
});
