import assert from "node:assert/strict";
import { resolve } from "node:path";
import * as vscode from "vscode";
import { cliFixture } from "../ai/cliFixture";
import { runRealCli } from "./realCli";

// Every flag the Claude adapter probes for, so the fake CLI passes as a safe, current install.
const claudeHelp = [
  "--print", "--output-format", "--restricted", "--safe-mode", "--strict-mcp-config", "--permission-mode", "--permission-prompts",
  "--no-session-persistence", "--disable-slash-commands", "--no-chrome", "--tools", "--json-schema", "--model",
].join(" ");
const emptyReview = { type: "result", subtype: "success", is_error: false, structured_output: { title: "demo", level1: [], level2: [] } };
const demo = resolve(__dirname, "../../../test/fixtures/demo.md");

/** Smoke test in a real VS Code: activation, the review webview, and one analysis through a spawned CLI. */
export async function run(): Promise<void> {
  // `npm run test:ai` sets this to test one real, signed-in CLI instead of the fake ones.
  if (process.env.SHARP_PEN_REAL_CLI) return runRealCli(process.env.SHARP_PEN_REAL_CLI);
  const fixture = await cliFixture({ help: claudeHelp, output: JSON.stringify(emptyReview) });
  try {
    const document = await vscode.workspace.openTextDocument(demo);
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand("sharpPen.openReview");
    assert.ok(await eventually(reviewPanelOpen), "the review panel did not open");
    const status = await vscode.commands.executeCommand<{ state: string; error?: string; suggestions: number }>("sharpPen.analyze", document.uri);
    // The open review panel now has focus, so pass the URI as the editor menu does.
    assert.deepEqual(status, { state: "ready", error: undefined, suggestions: 0 });
    const agent = await vscode.workspace.openTextDocument(resolve(__dirname, "../../../test/fixtures/orchestrator.agent.md"));
    assert.ok(["markdown", "chatagent"].includes(agent.languageId), `unexpected agent language: ${agent.languageId}`);
    await vscode.window.showTextDocument(agent);
    await vscode.commands.executeCommand("sharpPen.openReview", agent.uri);
    const agentStatus = await vscode.commands.executeCommand("sharpPen.analyze", agent.uri);
    assert.deepEqual(agentStatus, { state: "ready", error: undefined, suggestions: 0 });
    const reassociated = await vscode.languages.setTextDocumentLanguage(agent, "json");
    assert.equal(reassociated.languageId, "json");
    await vscode.window.showTextDocument(reassociated);
    const fallbackStatus = await vscode.commands.executeCommand("sharpPen.analyze", reassociated.uri);
    assert.deepEqual(fallbackStatus, { state: "ready", error: undefined, suggestions: 0 });
  } finally {
    await fixture.restore();
  }
}

function reviewPanelOpen(): boolean {
  return vscode.window.tabGroups.all.some((group) => group.tabs.some((tab) => tab.input instanceof vscode.TabInputWebview && tab.input.viewType.endsWith("sharpPen.review")));
}

async function eventually(check: () => boolean, timeoutMs = 5_000): Promise<boolean> {
  for (const started = Date.now(); Date.now() - started < timeoutMs; await new Promise((done) => setTimeout(done, 100))) {
    if (check()) return true;
  }
  return check();
}
