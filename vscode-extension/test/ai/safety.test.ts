import assert from "node:assert/strict";
import test from "node:test";

import { ClaudeAdapter } from "../../src/ai/adapters/claude";
import { CodexAdapter } from "../../src/ai/adapters/codex";
import { CopilotAdapter } from "../../src/ai/adapters/copilot";
import { OpenCodeAdapter } from "../../src/ai/adapters/opencode";
import { ProcessRunnerError } from "../../src/ai/processRunner";
import { cliFixture } from "./cliFixture";

const safeHelp = [
  "--print", "--output-format", "--restricted", "--safe-mode", "--strict-mcp-config", "--permission-mode", "--permission-prompts", "--no-session-persistence", "--disable-slash-commands", "--no-chrome", "--tools", "--json-schema",
  "--sandbox", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--strict-config", "--disable", "--config", "--json",
  "--prompt", "--silent", "--mode", "--available-tools", "--excluded-tools", "--disable-builtin-mcps", "--deny-url", "--no-custom-instructions", "--no-remote", "--no-remote-export", "--no-auto-update", "--no-experimental", "--no-bash-env", "--no-ask-user", "--model",
  "--pure", "--format", "--agent", "--file",
].join(" ");
const codexDisabled = ["apps", "browser_use", "browser_use_external", "browser_use_full_cdp_access", "computer_use", "enable_mcp_apps", "hooks", "image_generation", "in_app_browser", "in_app_chat", "in_app_dictation", "in_app_local_automation", "multi_agent", "plugin_sharing", "plugins", "remote_plugin", "shell_tool", "skill_search", "tool_call_mcp_elicitation", "tool_suggest", "unified_exec", "unified_exec_tty", "view_image"];
const codexFeatures = `${codexDisabled.join(" stable false\n")} stable false`;

async function fixture() {
  return cliFixture({ help: safeHelp, codexFeatures, output: "__capture__" });
}

test("supported adapters pass their complete fixed safety invocation", { concurrency: false }, async () => {
  const setup = await fixture();
  try {
    const claude = JSON.parse(await new ClaudeAdapter().analyze("source", { model: "model" }));
    assert.deepEqual(claude.args.slice(0, 16), ["--print", "--output-format", "json", "--restricted", "--safe-mode", "--strict-mcp-config", "--permission-mode", "plan", "--permission-prompts", "none", "--no-session-persistence", "--disable-slash-commands", "--no-chrome", "--tools", "", "--json-schema"]);
    assert.equal(JSON.parse(claude.args[16]).$schema, "http://json-schema.org/draft-07/schema#");
    assert.deepEqual(claude.args.slice(17), ["--model", "model"]);

    const copilot = JSON.parse(await new CopilotAdapter().analyze("source", { model: "model" }));
    assert.deepEqual(copilot.args, ["--silent", "--output-format", "json", "--mode", "plan", "--excluded-tools", "bash", "read_bash", "stop_bash", "list_bash", "write_bash", "powershell", "read_powershell", "stop_powershell", "list_powershell", "write_powershell", "view", "create", "edit", "web_fetch", "fetch_copilot_cli_documentation", "skill", "sql", "session_store_sql", "read_agent", "list_agents", "write_agent", "grep", "glob", "task", "--disable-builtin-mcps", "--deny-url", "*", "--no-custom-instructions", "--no-remote", "--no-remote-export", "--no-auto-update", "--no-experimental", "--no-bash-env", "--no-ask-user", "--model", "model"]);

    const codex = JSON.parse(await new CodexAdapter().analyze("source", { model: "model" }));
    assert.deepEqual(codex.args, ["exec", "--strict-config", "--sandbox", "read-only", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--ignore-rules", ...codexDisabled.flatMap((feature) => ["--disable", feature]), "--config", "shell_environment_policy.inherit=none", "--config", "web_search=disabled", "--json", "--model", "model"]);

    const opencode = JSON.parse(await new OpenCodeAdapter().analyze("source", { model: "model" }));
    assert.equal(opencode.input, "");
    assert.equal(opencode.fileInput, "source");
    assert.deepEqual(opencode.args.slice(0, 8), ["run", "Follow the complete instructions in the attached prompt file and return only the requested response.", "--pure", "--format", "json", "--agent", "sharp-pen", "--file"]);
    assert.deepEqual(opencode.args.slice(9), ["--model", "model"]);
  } finally {
    await setup.restore();
  }
});

test("adapters reject unsafe model IDs before they can reach argv", async () => {
  await assert.rejects(
    new ClaudeAdapter().analyze("source", { model: "gpt-5 & whoami" }),
    (error: unknown) => error instanceof ProcessRunnerError && error.kind === "launch" && /model ID/.test(error.message),
  );
});

test("adapters reject a model override when the installed CLI cannot honor it", { concurrency: false }, async () => {
  const setup = await fixture();
  try {
    await setup.set({ help: safeHelp.replace("--model", "") });
    await assert.rejects(new ClaudeAdapter().analyze("source", { model: "model" }), /cannot use a model override/);
  } finally {
    await setup.restore();
  }
});

test("a missing safety capability makes a provider unavailable", { concurrency: false }, async () => {
  const setup = await fixture();
  try {
    await setup.set({ help: safeHelp.replace("--restricted", "") });
    const probe = await new ClaudeAdapter().probe();
    assert.equal(probe.available, false);
    assert.match(probe.message ?? "", /--restricted/);
  } finally {
    await setup.restore();
  }
});

test("Codex rejects versions whose tool surface has not been safety-reviewed", { concurrency: false }, async () => {
  const setup = await fixture();
  try {
    await setup.set({ codexVersion: "codex-cli 0.156.0" });
    const probe = await new CodexAdapter().probe();
    assert.equal(probe.available, false);
    assert.match(probe.message ?? "", /has not been safety-reviewed/);
  } finally {
    await setup.restore();
  }
});

test("Codex never echoes raw CLI output for an unrecognised version", { concurrency: false }, async () => {
  const setup = await fixture();
  try {
    await setup.set({ codexVersion: "npm warn config deprecated also-flag set true" });
    const probe = await new CodexAdapter().probe();
    assert.equal(probe.available, false);
    assert.match(probe.message ?? "", /an unrecognised version has not been safety-reviewed/);
    assert.doesNotMatch(probe.message ?? "", /npm warn/);
  } finally {
    await setup.restore();
  }
});

test("Codex rejects a CLI missing a required no-tool feature", { concurrency: false }, async () => {
  const setup = await fixture();
  try {
    await setup.set({ codexFeatures: codexFeatures.replace("view_image stable false", "") });
    const probe = await new CodexAdapter().probe();
    assert.equal(probe.available, false);
    assert.match(probe.message ?? "", /view_image/);
  } finally {
    await setup.restore();
  }
});

test("OpenCode pins the safety-reviewed CLI version", { concurrency: false }, async () => {
  const setup = await fixture();
  try {
    assert.equal((await new OpenCodeAdapter().probe()).available, true);
    await setup.set({ opencodeVersion: "1.18.33" });
    const probe = await new OpenCodeAdapter().probe();
    assert.equal(probe.available, false);
    assert.match(probe.message ?? "", /has not been safety-reviewed/);
  } finally {
    await setup.restore();
  }
});
