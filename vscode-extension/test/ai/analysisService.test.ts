import assert from "node:assert/strict";
import test from "node:test";

import { createAnalysisRunner } from "../../src/ai/analysisService";
import { modelPickerOptions } from "../../src/ai/modelScope";
import { ProcessRunnerError } from "../../src/ai/processRunner";
import type { CliAdapter } from "../../src/ai/types";

test("analysis runner masks the prompt, keeps the selected adapter, and parses its final JSON", async () => {
  let prompt = "";
  let model: string | undefined;
  const adapter: CliAdapter = {
    id: "codex",
    async probe() { return { available: true, capabilities: new Set() }; },
    async analyze(input, options) {
      prompt = input; model = options?.model;
      return '{"title":"Draft","level1":[],"level2":[]}';
    },
  };
  const runner = createAnalysisRunner({
    settings: { getConfig: () => ({ aiClient: "codex", previewTheme: "light" }), getModel: () => "gpt-test" },
    async select(client) { assert.equal(client, "codex"); return adapter; },
  });
  const result = await runner({ title: "Draft", format: "markdown", source: "Text `hidden`", uri: "file:///draft", documentVersion: 1 }, new AbortController().signal);
  assert.deepEqual(result, { title: "Draft", level1: [], level2: [] });
  assert.equal(model, "gpt-test");
  assert.match(prompt, /Text/);
  assert.doesNotMatch(prompt, /hidden/);
});

test("analysis runner leaves strict schema validation to the controller", async () => {
  const adapter: CliAdapter = {
    id: "claude",
    async probe() { return { available: true, capabilities: new Set() }; },
    async analyze() { return '{"title":"Draft","level1":[],"level2":[],"extra":true}'; },
  };
  const runner = createAnalysisRunner({ settings: { getConfig: () => ({ aiClient: "claude", previewTheme: "light" }), getModel: () => "" }, async select() { return adapter; } });
  const result = await runner({ title: "Draft", format: "plaintext", source: "Draft", uri: "file:///draft", documentVersion: 1 }, new AbortController().signal);
  assert.deepEqual(result, { title: "Draft", level1: [], level2: [], extra: true });
});

test("Copilot retries one malformed response and validates the replacement", async () => {
  let calls = 0;
  const adapter: CliAdapter = {
    id: "copilot",
    async probe() { return { available: true, capabilities: new Set() }; },
    async analyze(prompt) {
      calls += 1;
      if (calls === 1) return "not JSON";
      assert.match(prompt, /Final reminder/);
      return '{"title":"Draft","level1":[],"level2":[]}';
    },
  };
  const runner = createAnalysisRunner({ settings: { getConfig: () => ({ aiClient: "copilot", previewTheme: "light" }), getModel: () => "" }, async select() { return adapter; } });
  assert.deepEqual(await runner({ title: "Draft", format: "plaintext", source: "Draft", uri: "file:///draft", documentVersion: 1 }, new AbortController().signal), { title: "Draft", level1: [], level2: [] });
  assert.equal(calls, 2);
});

test("Copilot reports a safe specific error after two malformed responses", async () => {
  const adapter: CliAdapter = {
    id: "copilot",
    async probe() { return { available: true, capabilities: new Set() }; },
    async analyze() { return '{"message":"wrong contract"}'; },
  };
  const runner = createAnalysisRunner({ settings: { getConfig: () => ({ aiClient: "copilot", previewTheme: "light" }), getModel: () => "" }, async select() { return adapter; } });
  await assert.rejects(
    runner({ title: "Draft", format: "plaintext", source: "Draft", uri: "file:///draft", documentVersion: 1 }, new AbortController().signal),
    (error: unknown) => error instanceof ProcessRunnerError && /could not read/.test(error.message),
  );
});

test("provider-scoped models never cross to a resolved auto client", async () => {
  const models: Array<string | undefined> = [];
  const adapter = (id: CliAdapter["id"]): CliAdapter => ({
    id,
    async probe() { return { available: true, capabilities: new Set() }; },
    async analyze(_input, options) { models.push(options?.model); return '{"title":"Draft","level1":[],"level2":[]}'; },
  });
  let selected = adapter("claude");
  const runner = createAnalysisRunner({
    settings: { getConfig: () => ({ aiClient: "auto", previewTheme: "light" }), getModel: (client) => client === "claude" ? "sonnet" : "" },
    async select() { return selected; },
  });
  const request = { title: "Draft", format: "plaintext" as const, source: "Draft", uri: "file:///draft", documentVersion: 1 };
  await runner(request, new AbortController().signal);
  selected = adapter("codex");
  await runner(request, new AbortController().signal);
  assert.deepEqual(models, ["sonnet", undefined]);
});

test("unavailable providers retain default and manual picker choices", () => {
  const options = modelPickerOptions("gpt-test", [], "Manual guidance");
  assert.deepEqual(options.map(({ label, model, action }) => ({ label, model, action })), [
    { label: "Use client default", model: "", action: undefined },
    { label: "gpt-test", model: "gpt-test", action: undefined },
    { label: "Enter model ID…", model: undefined, action: "manual" },
    { label: "Refresh models", model: undefined, action: "refresh" },
  ]);
});
