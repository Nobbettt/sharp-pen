import assert from "node:assert/strict";
import test from "node:test";

import { VscodeLmAdapter, type Chat, type VscodeLmApi } from "../../src/ai/adapters/vscodeLm";
import { ProcessRunnerError } from "../../src/ai/processRunner";
import { REVIEW_LIMITS } from "../../src/review/validate";

type Request = { modelId: string; messages: readonly unknown[]; options: unknown; token: unknown };

function api(modelIds: readonly string[], chunks: readonly string[] = ["reply"]): VscodeLmApi & { requests: Request[] } {
  const requests: Request[] = [];
  const models: Chat[] = modelIds.map((id) => ({
    id,
    async sendRequest(messages, options, token) {
      requests.push({ modelId: id, messages, options, token });
      return { text: (async function* () { for (const chunk of chunks) yield chunk; })() };
    },
  }));
  return {
    requests,
    async selectChatModels() { return models; },
    userMessage(text) { return { role: "user", text }; },
    createToken(signal) { return { token: signal, dispose() {} }; },
    isLanguageModelError(error): error is { code: string; message: string } {
      return Boolean(error && typeof error === "object" && "lmCode" in error);
    },
  };
}

test("VS Code language model probe reports models and setup guidance", async () => {
  const available = await new VscodeLmAdapter(api(["first"])).probe();
  assert.equal(available.available, true);
  assert.deepEqual([...available.capabilities], ["--model"]);
  const unavailable = await new VscodeLmAdapter(api([])).probe();
  assert.equal(unavailable.available, false);
  assert.match(unavailable.message!, /Install GitHub Copilot Chat and sign in/);
});

test("VS Code language models choose an ID, fall back to the first, and send text only", async () => {
  const fake = api(["first", "chosen"]);
  await new VscodeLmAdapter(fake).analyze("proofread me", { model: "chosen" });
  assert.deepEqual(fake.requests[0].messages, [{ role: "user", text: "proofread me" }]);
  assert.deepEqual(fake.requests[0].options, { justification: "sharp-pen sends the document you asked it to proofread." });
  assert.equal("tools" in (fake.requests[0].options as object), false);

  const fallback = api(["first", "second"]);
  await new VscodeLmAdapter(fallback).analyze("text", { model: "missing" });
  assert.equal(fake.requests[0].modelId, "chosen");
  assert.equal(fallback.requests[0].modelId, "first");
});

test("VS Code language models join stream chunks and strip one JSON fence", async () => {
  assert.equal(await new VscodeLmAdapter(api(["model"], ["one", "two"])).analyze("text"), "onetwo");
  assert.equal(await new VscodeLmAdapter(api(["model"], ["```json\n{\"title\":", "\"Draft\"}\n```"])).analyze("text"), '{"title":"Draft"}');
  assert.equal(await new VscodeLmAdapter(api(["model"], ["before\n```json\n{}\n```"])).analyze("text"), "before\n```json\n{}\n```");
});

test("VS Code language models enforce the response limit", async () => {
  await assert.rejects(new VscodeLmAdapter(api(["model"], ["x".repeat(REVIEW_LIMITS.response + 1)])).analyze("text"),
    (error: unknown) => error instanceof ProcessRunnerError && error.kind === "output");
});

test("VS Code language models honor cancellation", async () => {
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(new VscodeLmAdapter(api(["model"])).analyze("text", {}, abort.signal),
    (error: unknown) => error instanceof ProcessRunnerError && error.kind === "aborted" && error.message === "Analysis was cancelled.");

  const during = new AbortController();
  const fake = api(["model"]);
  fake.selectChatModels = async () => [{
    id: "model",
    async sendRequest(_messages, _options, token) {
      return { text: (async function* () {
        await new Promise<void>((resolve) => (token as AbortSignal).addEventListener("abort", () => resolve(), { once: true }));
      })() };
    },
  }];
  const analysis = new VscodeLmAdapter(fake).analyze("text", {}, during.signal);
  during.abort();
  await assert.rejects(analysis, (error: unknown) => error instanceof ProcessRunnerError && error.kind === "aborted");
});

for (const [code, message] of [
  ["NoPermissions", "Allow sharp-pen to use VS Code language models when VS Code asks, then retry."],
  ["Blocked", "The VS Code language model blocked this request. Retry, or choose another client."],
  ["NotFound", "The selected VS Code language model is no longer available. Choose another model or client."],
] as const) {
  test(`VS Code language model maps ${code}`, async () => {
    const fake = api(["model"]);
    fake.selectChatModels = async () => [{ id: "model", async sendRequest() { throw { lmCode: true, code, message: "unsafe provider detail" }; } }];
    await assert.rejects(new VscodeLmAdapter(fake).analyze("text"),
      (error: unknown) => error instanceof ProcessRunnerError && error.kind === "launch" && error.message === message);
  });
}

test("VS Code language models map unknown failures to a safe error", async () => {
  const fake = api(["model"]);
  fake.selectChatModels = async () => [{ id: "model", async sendRequest() { throw new Error("secret"); } }];
  await assert.rejects(new VscodeLmAdapter(fake).analyze("text"),
    (error: unknown) => error instanceof ProcessRunnerError && error.kind === "exit" && !error.message.includes("secret"));
});
