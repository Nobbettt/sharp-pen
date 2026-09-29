import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as vscode from "vscode";
import { adapters } from "../../src/ai/adapters";
import { ModelDiscovery } from "../../src/ai/modelDiscovery";
import type { CliId } from "../../src/ai/types";
import type { SharpPenApi } from "../../src/extension";

type Status = { state: string; error?: string; suggestions: number };
export interface RealCliResult { cli: string; outcome: "pass" | "fail" | "skip"; detail: string; steps: string[]; platform: string; vscode: string }

// Short on purpose: every run is a real, billed model call on the developer's own account.
const sample = resolve(__dirname, "../../../test/fixtures/real-ai.md");
const cancelAfterMs = 1_500;
const cancelSettleMs = 5_000;

/** Runs sharp-pen against a real, signed-in CLI and writes the outcome to SHARP_PEN_RESULT_FILE. */
export async function runRealCli(cli: string): Promise<void> {
  const result: RealCliResult = { cli, outcome: "pass", detail: "", steps: [], platform: `${process.platform}-${process.arch}`, vscode: vscode.version };
  try {
    const skipped = await checks(cli, result.steps);
    if (skipped) Object.assign(result, { outcome: "skip", detail: skipped });
  } catch (error) {
    Object.assign(result, { outcome: "fail", detail: error instanceof Error ? error.message : String(error) });
  }
  if (process.env.SHARP_PEN_RESULT_FILE) writeFileSync(process.env.SHARP_PEN_RESULT_FILE, JSON.stringify(result, null, 2));
  if (result.outcome === "fail") throw new Error(`${cli}: ${result.detail}`);
}

/** Returns a skip reason, throws on failure, and records each passed step. */
async function checks(cli: string, steps: string[]): Promise<string | undefined> {
  const adapter = adapters.find((candidate) => candidate.id === cli);
  if (!adapter) throw new Error(`unknown CLI "${cli}"`);
  const probe = await adapter.probe();
  if (!probe.available && /is not available\. Install it/.test(probe.message ?? "")) return "not installed";
  assert.ok(probe.available, `probe refused the CLI: ${probe.message}`);
  steps.push(`probe: ${probe.version}`);

  const models = await new ModelDiscovery().list(cli as CliId, true);
  steps.push(`model discovery: ${models.length} models`);

  const api = await vscode.extensions.getExtension<SharpPenApi>("nobbettt.sharp-pen")!.activate();
  await api.setClient(cli as CliId);
  const document = await vscode.workspace.openTextDocument(sample);
  await vscode.window.showTextDocument(document);
  await vscode.commands.executeCommand("sharpPen.openReview");
  const analyzed = await analyze(document.uri);
  if (analyzed.error) throw new Error(`analysis failed: ${analyzed.error}`);
  assert.equal(analyzed.state, "ready");
  assert.ok(analyzed.suggestions > 0, "the analysis placed no suggestions in a document with obvious mistakes");
  steps.push(`analysis: ${analyzed.suggestions} suggestions`);

  steps.push(await cancel(document.uri));
  return undefined;
}

async function analyze(uri: vscode.Uri): Promise<Status> {
  return (await vscode.commands.executeCommand<Status>("sharpPen.analyze", uri))!;
}

/** Starts a second analysis and cancels it; it must settle quickly and restore the previous review. */
async function cancel(uri: vscode.Uri): Promise<string> {
  let settled = false;
  const running = analyze(uri).finally(() => { settled = true; });
  await new Promise((done) => setTimeout(done, cancelAfterMs));
  if (settled) return `cancel: not exercised, the analysis finished within ${cancelAfterMs} ms`;
  const started = Date.now();
  await vscode.commands.executeCommand("sharpPen.cancelAnalysis");
  const status = await running;
  const elapsed = Date.now() - started;
  assert.ok(elapsed < cancelSettleMs, `cancel took ${elapsed} ms to settle`);
  assert.equal(status.state, "ready", "cancel did not restore the previous review");
  return `cancel: settled in ${elapsed} ms`;
}
