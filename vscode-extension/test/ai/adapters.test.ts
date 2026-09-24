import assert from "node:assert/strict";
import test from "node:test";

import { adapters, selectAdapter } from "../../src/ai/adapters";
import { ClaudeAdapter, extractClaudeStructuredOutput } from "../../src/ai/adapters/claude";
import { CodexAdapter } from "../../src/ai/adapters/codex";
import { CopilotAdapter } from "../../src/ai/adapters/copilot";
import { OpenCodeAdapter, extractOpenCodeFinalText } from "../../src/ai/adapters/opencode";
import { ProcessRunnerError } from "../../src/ai/processRunner";
import { extractCopilotFinalText, extractFinalText } from "../../src/ai/adapters/shared";
import { cliFixture } from "./cliFixture";
import { copilot185Output } from "./copilot-1.0.85.fixture";

const help = [
  "--print", "--output-format", "--restricted", "--safe-mode", "--strict-mcp-config", "--permission-mode", "--permission-prompts", "--no-session-persistence", "--disable-slash-commands", "--no-chrome", "--tools", "--json-schema",
  "--sandbox", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--strict-config", "--disable", "--config", "--json",
  "--prompt", "--silent", "--mode", "--available-tools", "--excluded-tools", "--disable-builtin-mcps", "--deny-url", "--no-custom-instructions", "--no-remote", "--no-remote-export", "--no-auto-update", "--no-experimental", "--no-bash-env", "--no-ask-user", "--model",
  "--pure", "--format", "--agent", "--file",
];
const codexFeatures = ["apps", "apps_mcp_path_override", "browser_use", "browser_use_external", "browser_use_full_cdp_access", "code_mode", "code_mode_buffered_exec", "code_mode_host", "code_mode_only", "code_mode_prewarm", "collaboration_modes", "computer_use", "enable_mcp_apps", "executed_tool_call_metadata", "executor_capability_discovery", "external_agent_memory_import", "hooks", "image_generation", "in_app_browser", "in_app_chat", "in_app_dictation", "in_app_local_automation", "in_app_updates", "mcp_2026_07_28", "mcp_oauth_refresh_coordination", "multi_agent", "multi_agent_mode", "multi_agent_v2", "non_prefixed_mcp_tool_names", "plugin_hooks", "plugin_sharing", "plugins", "remote_plugin", "request_permissions_tool", "search_tool", "shell_snapshot", "shell_snapshot_v2", "shell_tool", "shell_zsh_fork", "skill_env_var_dependency_prompt", "skill_mcp_dependency_install", "skill_search", "skip_host_skill_discovery", "sleep_tool", "standalone_web_search", "tool_call_mcp_elicitation", "tool_search", "tool_search_always_defer_mcp_tools", "tool_suggest", "unified_exec", "unified_exec_tty", "unified_exec_zsh_fork", "use_agent_identity", "view_image", "web_search_cached", "web_search_request"].join(" stable false\n");

async function fixtures() {
  return cliFixture({ help: help.join(" "), codexFeatures });
}

test("adapters probe fixed names in product priority order", { concurrency: false }, async () => {
  const setup = await fixtures();
  try {
    assert.deepEqual(adapters.map((adapter) => adapter.id), ["claude", "codex", "copilot", "opencode"]);
    assert.equal((await selectAdapter("auto")).id, "claude");
    const probe = await new ClaudeAdapter().probe();
    assert.equal(probe.available, true);
    assert.equal(probe.version, "fixture 1.0");
  } finally {
    await setup.restore();
  }
});

test("explicit OpenCode selection probes and resolves the adapter", { concurrency: false }, async () => {
  const setup = await fixtures();
  try {
    assert.equal((await selectAdapter("opencode")).id, "opencode");
  } finally {
    await setup.restore();
  }
});

test("OpenCode accepts only text events followed by a clean stop", () => {
  const output = [
    JSON.stringify({ type: "step_start", part: { type: "step-start" } }),
    JSON.stringify({ type: "text", part: { type: "text", text: "one" } }),
    JSON.stringify({ type: "text", part: { type: "text", text: "two" } }),
    JSON.stringify({ type: "step_finish", part: { type: "step-finish", reason: "stop" } }),
  ].join("\n");
  assert.equal(extractOpenCodeFinalText(output), "onetwo");
  assert.throws(() => extractOpenCodeFinalText(output.replace('"step_finish"', '"tool_use"')), /invalid structured response/);
  assert.throws(() => extractOpenCodeFinalText(output.replace('"stop"', '"tool-calls"')), /invalid structured response/);
});

test("adapter probes finish --version before reading --help", async () => {
  let versionFinished = false;
  const adapter = new ClaudeAdapter(async ({ args }) => {
    if (args.includes("--version")) {
      await Promise.resolve();
      versionFinished = true;
      return { stdout: "fixture 1.0\n", stderr: "", exitCode: 0 };
    }
    assert.equal(versionFinished, true, "--help must not overlap --version");
    return { stdout: help.join(" "), stderr: "", exitCode: 0 };
  });

  assert.equal((await adapter.probe()).available, true);
});

test("the analysis right after a fresh probe skips the redundant --version check", async () => {
  let versionCalls = 0;
  const adapter = new ClaudeAdapter(async ({ args }) => {
    if (args.includes("--version")) {
      versionCalls++;
      return { stdout: "fixture 1.0\n", stderr: "", exitCode: 0 };
    }
    if (args.includes("--help")) return { stdout: help.join(" "), stderr: "", exitCode: 0 };
    return { stdout: JSON.stringify({ type: "result", subtype: "success", is_error: false, structured_output: { title: "Draft", level1: [], level2: [] } }), stderr: "", exitCode: 0 };
  });

  assert.equal((await adapter.probe()).available, true);
  assert.equal(versionCalls, 1);
  await adapter.analyze("prompt");
  assert.equal(versionCalls, 1, "the probe that just ran already checked --version");
  await adapter.analyze("prompt");
  assert.equal(versionCalls, 2, "a later analysis still revalidates the cached probe");
});

test("a stale probe no longer skips the version recheck", { concurrency: false }, async (t) => {
  const setup = await fixtures();
  try {
    const adapter = new CodexAdapter();
    await setup.set({ output: "__capture__" });
    t.mock.timers.enable({ apis: ["Date"] });
    assert.equal((await adapter.probe()).available, true);
    t.mock.timers.tick(2_001);
    await setup.set({ codexVersion: "codex-cli 0.160.0" });
    await assert.rejects(adapter.analyze("outside-git source"), (error: unknown) =>
      error instanceof ProcessRunnerError && error.kind === "launch" && /has not been safety-reviewed/.test(error.message));
  } finally {
    await setup.restore();
  }
});

test("Claude retries one truncated help response and merges its capabilities", async () => {
  const helpRequests: string[][] = [];
  const adapter = new ClaudeAdapter(async ({ args, timeoutMs, stdoutLimit, stderrLimit }) => {
    if (args.includes("--version")) return { stdout: "fixture 1.0\n", stderr: "", exitCode: 0 };
    assert.equal(timeoutMs, 5_000);
    assert.equal(stdoutLimit, 64_000);
    assert.equal(stderrLimit, 64_000);
    helpRequests.push([...args]);
    return { stdout: helpRequests.length === 1 ? help.slice(0, 10).join(" ") : help.join(" "), stderr: "", exitCode: 0 };
  });

  const probe = await adapter.probe();
  assert.equal(probe.available, true);
  assert.deepEqual(helpRequests, [["--help"], ["--help"]]);
  assert.equal(probe.capabilities.has("--print"), true);
  assert.equal(probe.capabilities.has("--tools"), true);
});

test("Claude remains unavailable after two incomplete help responses", async () => {
  let helpCalls = 0;
  const adapter = new ClaudeAdapter(async ({ args }) => {
    if (args.includes("--version")) return { stdout: "fixture 1.0\n", stderr: "", exitCode: 0 };
    helpCalls++;
    return { stdout: "--print", stderr: "", exitCode: 0 };
  });

  assert.equal((await adapter.probe()).available, false);
  assert.equal(helpCalls, 2);
});

test("Claude cancellation does not retry help", async () => {
  let helpCalls = 0;
  const adapter = new ClaudeAdapter(async ({ args }) => {
    if (args.includes("--version")) return { stdout: "fixture 1.0\n", stderr: "", exitCode: 0 };
    helpCalls++;
    throw new ProcessRunnerError("aborted", "sharp-pen analysis was cancelled.");
  });

  const probe = await adapter.probe();
  assert.equal(probe.available, false);
  assert.equal(helpCalls, 1);
});

test("Claude finds safety flags late in large stderr help", { concurrency: false }, async () => {
  const setup = await cliFixture({ helpStderr: `${"x".repeat(21_000)} ${help.join(" ")}` });
  try {
    assert.equal((await new ClaudeAdapter().probe()).available, true);
  } finally {
    await setup.restore();
  }
});

test("Claude sends the complete prompt on stdin and extracts its structured JSON", { concurrency: false }, async () => {
  const setup = await fixtures();
  try {
    await setup.set({ output: JSON.stringify({ type: "result", subtype: "success", is_error: false, structured_output: { title: "Draft", level1: [], level2: [] } }) });
    const adapter = new ClaudeAdapter();
    assert.equal(await adapter.analyze("complete prompt with source", { model: "test-model" }), JSON.stringify({ title: "Draft", level1: [], level2: [] }));
  } finally {
    await setup.restore();
  }
});

test("Claude requires a draft-07 response schema in print/json mode", async () => {
  let analyzeArgs: readonly string[] | undefined;
  const adapter = new ClaudeAdapter(async ({ args }) => {
    if (args.includes("--version")) return { stdout: "fixture 1.0\n", stderr: "", exitCode: 0 };
    if (args.includes("--help")) return { stdout: help.join(" "), stderr: "", exitCode: 0 };
    analyzeArgs = args;
    return { stdout: JSON.stringify({ type: "result", subtype: "success", is_error: false, structured_output: { title: "Draft", level1: [], level2: [] } }), stderr: "", exitCode: 0 };
  });
  await adapter.analyze("prompt");
  assert.deepEqual(analyzeArgs?.slice(0, 4), ["--print", "--output-format", "json", "--restricted"]);
  const schema = JSON.parse(analyzeArgs![analyzeArgs!.indexOf("--json-schema") + 1]);
  assert.equal(schema.$schema, "http://json-schema.org/draft-07/schema#");
  assert.deepEqual(schema.required, ["title", "level1", "level2"]);
});

test("Claude accepts only a successful nonempty top-level structured_output object", () => {
  const response = { title: "Draft", level1: [], level2: [] };
  assert.equal(extractClaudeStructuredOutput(JSON.stringify({ type: "result", subtype: "success", is_error: false, structured_output: response })), JSON.stringify(response));
  const invalid = [
    {},
    { type: "result", subtype: "success", is_error: false },
    { type: "result", subtype: "success", is_error: false, structured_output: {} },
    { type: "result", subtype: "error_during_execution", is_error: true, structured_output: response },
    { type: "result", subtype: "retry", is_error: false, structured_output: response },
    { type: "result", subtype: "success", is_error: false, result: JSON.stringify(response) },
  ];
  for (const envelope of invalid) assert.throws(() => extractClaudeStructuredOutput(JSON.stringify(envelope)), (error: unknown) =>
    error instanceof ProcessRunnerError && error.kind === "exit" && /invalid structured response/.test(error.message));
  assert.throws(() => extractClaudeStructuredOutput(`\`\`\`json\n${JSON.stringify(response)}\n\`\`\``), /invalid structured response/);
  assert.throws(() => extractClaudeStructuredOutput(JSON.stringify(response)), /invalid structured response/);
});

test("extracts the final payload from the real provider JSON output shapes", () => {
  const response = JSON.stringify({ title: "Draft", level1: [], level2: [] });
  const outputs = [
    JSON.stringify({ type: "result", is_error: false, result: response }),
    `${JSON.stringify({ type: "thread.started", thread_id: "thread" })}\n${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: response } })}\n${JSON.stringify({ type: "turn.completed", usage: {} })}`,
    JSON.stringify({ type: "assistant.message", data: { content: response } }),
  ];
  for (const output of outputs) assert.equal(extractFinalText(output), response);
});

const copilotMessage = (text: string) => JSON.stringify({
  type: "assistant.message",
  data: { toolRequests: [], message: { content: [{ type: "text", text }] } },
});

test("Copilot 1.0.85 accepts its final text-block assistant message followed by result", () => {
  const response = JSON.stringify({ title: "Draft", level1: [], level2: [] });
  assert.equal(extractCopilotFinalText(copilot185Output), response);
  assert.throws(() => extractCopilotFinalText([
    JSON.stringify({ type: "assistant.message_delta", data: { deltaContent: response } }),
    JSON.stringify({ type: "tool.execution_complete", data: { result: { content: response } } }),
    JSON.stringify({ type: "assistant.message", data: { content: response, toolRequests: [{ name: "shell" }] } }),
  ].join("\n")), (error: unknown) => error instanceof ProcessRunnerError && /no final assistant response/.test(error.message));
});

test("Copilot 1.0.88 accepts string content followed by its terminal telemetry", () => {
  const response = JSON.stringify({ title: "Draft", level1: [], level2: [] });
  const output = [
    JSON.stringify({ type: "assistant.message", data: { content: response, toolRequests: [] } }),
    JSON.stringify({ type: "assistant.reasoning", data: { content: "internal" } }),
    JSON.stringify({ type: "assistant.turn_end", data: { turnId: "0" } }),
    JSON.stringify({ type: "session.usage_checkpoint", data: { promptCacheBreakState: [] } }),
    JSON.stringify({ type: "assistant.idle", data: {} }),
    JSON.stringify({ type: "result", exitCode: 0 }),
  ].join("\n");
  assert.equal(extractCopilotFinalText(output), response);
});

test("Copilot rejects assistant candidates with nested or scalar tool metadata", () => {
  const response = JSON.stringify({ title: "Draft", level1: [], level2: [] });
  const candidates = [
    { type: "assistant.message", data: { message: { toolRequests: [{ name: "shell" }], content: [{ type: "text", text: response }] } } },
    { type: "assistant.message", data: { response: { toolCalls: [{ name: "shell" }], content: [{ type: "text", text: response }] } } },
    { type: "assistant.message", data: { tool_calls: "shell", message: { content: [{ type: "text", text: response }] } } },
  ];
  for (const candidate of candidates) assert.throws(() => extractCopilotFinalText(JSON.stringify(candidate)), /no final assistant response/);
});

test("Copilot invalidates a final candidate when a later event can carry more output", () => {
  const response = JSON.stringify({ title: "Draft", level1: [], level2: [] });
  const replacement = JSON.stringify({ title: "Replacement", level1: [], level2: [] });
  const tails = [
    { type: "tool.execution_complete", data: { status: "done" } },
    { type: "assistant.message_delta", data: { deltaContent: response } },
    { type: "unknown.event", data: { content: response } },
  ];
  for (const tail of tails) assert.throws(() => extractCopilotFinalText([copilotMessage(response), JSON.stringify(tail)].join("\n")), /no final assistant response/);
  assert.equal(extractCopilotFinalText([copilotMessage(response), JSON.stringify({ type: "result", exitCode: 0 })].join("\n")), response);
  assert.equal(extractCopilotFinalText([copilotMessage(response), JSON.stringify(tails[0]), copilotMessage(replacement)].join("\n")), replacement);
});

test("Copilot rejects non-JSON output and only unwraps one exact JSON fence", () => {
  const response = JSON.stringify({ title: "Draft", level1: [], level2: [] });
  assert.throws(() => extractCopilotFinalText(`${copilotMessage(response)}\nnot json`), /unexpected non-JSON output/);
  assert.throws(() => extractCopilotFinalText(JSON.stringify({ type: "assistant.message", data: { content: response } })), /no final assistant response/);
  assert.equal(extractCopilotFinalText(copilotMessage(`\`\`\`json\n${response}\n\`\`\``)), response);
  assert.equal(extractCopilotFinalText(copilotMessage(`\`\`\`\n${response}\n\`\`\``)), `\`\`\`\n${response}\n\`\`\``);
});

test("a client that exits successfully without a final payload is rejected", { concurrency: false }, async () => {
  const setup = await fixtures();
  try {
    await setup.set({ output: "" });
    await assert.rejects(new CopilotAdapter().analyze("prompt"), (error: unknown) =>
      error instanceof ProcessRunnerError && /no final response/.test(error.message));
  } finally {
    await setup.restore();
  }
});

test("Codex re-checks its CLI version before every analysis and revokes a cached probe after an unreviewed upgrade", { concurrency: false }, async () => {
  const setup = await fixtures();
  try {
    const adapter = new CodexAdapter();
    await setup.set({ output: "__capture__" });
    await adapter.analyze("outside-git source");
    await adapter.analyze("outside-git source");
    await setup.set({ codexVersion: "codex-cli 0.160.0" });
    await assert.rejects(adapter.analyze("outside-git source"), (error: unknown) =>
      error instanceof ProcessRunnerError && error.kind === "launch" && /has not been safety-reviewed/.test(error.message));
  } finally {
    await setup.restore();
  }
});

test("each supported adapter uses its fixed safe mode and optional model flag", { concurrency: false }, async () => {
  const setup = await fixtures();
  try {
    const cases = [
      [ClaudeAdapter, ["--restricted", "--safe-mode", "--strict-mcp-config", "--permission-mode", "plan", "--tools", ""]],
      [CodexAdapter, ["exec", "--sandbox", "read-only", "--ephemeral", "--ignore-user-config", "--strict-config"]],
      [CopilotAdapter, ["--mode", "plan", "--excluded-tools", "bash", "read_bash", "stop_bash", "list_bash", "write_bash", "powershell", "read_powershell", "stop_powershell", "list_powershell", "write_powershell", "view", "create", "edit", "web_fetch", "fetch_copilot_cli_documentation", "skill", "sql", "session_store_sql", "read_agent", "list_agents", "write_agent", "grep", "glob", "task", "--disable-builtin-mcps", "--deny-url", "*"]],
    ] as const;
    for (const [Adapter, required] of cases) {
      await setup.set({ output: "__capture__" });
      const captured = JSON.parse(await new Adapter().analyze("outside-git source", { model: "test-model" })) as { args: string[]; input: string };
      assert.equal(captured.input, "outside-git source");
      assert.ok(!captured.args.includes("outside-git source"));
      assert.ok(captured.args.includes("--model"));
      assert.ok(captured.args.includes("test-model"));
      for (const argument of required) assert.ok(captured.args.includes(argument));
      if (Adapter === CopilotAdapter) assert.equal(captured.args.includes("--prompt"), false);
    }
  } finally {
    await setup.restore();
  }
});
