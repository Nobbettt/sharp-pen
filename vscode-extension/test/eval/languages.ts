/**
 * `npm run eval:languages`: runs the real, signed-in AI CLIs on the mixed-language documents in
 * languageCases.ts through sharp-pen's own prompt, adapters and validation, several runs each, and
 * scores them. Makes real model calls on the developer's accounts; never part of `npm test` or CI.
 *
 *   npm run eval:languages -- [--cli claude,codex] [--case sv-no-da] [--runs 3]
 *   npm run eval:languages -- --rescore out/eval/languages-<time>.json    (no AI calls)
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { selectAdapter } from "../../src/ai/adapters";
import { createAnalysisRunner } from "../../src/ai/analysisService";
import { cliIds, type CliId } from "../../src/ai/types";
import { validateAndResolve } from "../../src/review/validate";
import { languageCases } from "./languageCases";
import { buildDocument, scoreRun, type RunScore } from "./score";

/** A tool passes a case when it finds at least this share of the planted issues, averaged over its runs. */
const MIN_RECALL = 0.9;
const DEFAULT_RUNS = 3;

interface Options { clis: CliId[]; cases: typeof languageCases; runs: number; rescore?: string }

function parseOptions(argv: string[]): Options {
  const value = (flag: string): string | undefined => { const index = argv.indexOf(flag); return index >= 0 ? argv[index + 1] : undefined; };
  const flags = ["--cli", "--case", "--runs", "--rescore"];
  const unknown = argv.find((arg, index) => arg.startsWith("--") ? !flags.includes(arg) : !flags.includes(argv[index - 1]));
  if (unknown) throw new Error(`unexpected argument ${unknown}`);
  const clis = (value("--cli")?.split(",") ?? [...cliIds]) as CliId[];
  const badCli = clis.find((cli) => !cliIds.includes(cli));
  if (badCli) throw new Error(`unknown CLI ${badCli}; use ${cliIds.join(", ")}`);
  const ids = value("--case")?.split(",");
  const cases = ids ? languageCases.filter((testCase) => ids.includes(testCase.id)) : languageCases;
  if (ids && cases.length !== ids.length) throw new Error(`unknown case; use ${languageCases.map((testCase) => testCase.id).join(", ")}`);
  const runs = Number(value("--runs") ?? DEFAULT_RUNS);
  if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs must be a positive integer");
  return { clis, cases, runs, rescore: value("--rescore") };
}

type Outcome = { score: RunScore; raw: unknown } | { error: string };

async function analyze(cli: CliId, testCase: (typeof languageCases)[number]): Promise<Outcome> {
  const document = buildDocument(testCase);
  const runner = createAnalysisRunner({ settings: { getConfig: () => ({ aiClient: cli, previewTheme: "light" }), getModel: () => "" }, select: selectAdapter });
  try {
    const title = `${testCase.id}.md`;
    const raw = await runner({ title, format: "markdown", source: document.source, uri: `file:///${title}`, documentVersion: 1 }, new AbortController().signal);
    return { raw, score: scoreRun(document, validateAndResolve(document.source, raw, "markdown", title)) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function evaluate(cli: CliId, options: Options): Promise<{ cli: CliId; skipped?: string; results: Array<{ id: string; outcomes: Outcome[] }> }> {
  try { await selectAdapter(cli); } catch (error) { return { cli, skipped: error instanceof Error ? error.message : String(error), results: [] }; }
  const results: Array<{ id: string; outcomes: Outcome[] }> = [];
  for (const testCase of options.cases) {
    const outcomes: Outcome[] = [];
    for (let run = 0; run < options.runs; run += 1) {
      outcomes.push(await analyze(cli, testCase));
      process.stdout.write(".");
    }
    results.push({ id: testCase.id, outcomes });
  }
  return { cli, results };
}

/** Counts how often each message occurred across runs, e.g. `"x" (2/3)`. */
function tally(lists: string[][], runs: number): string[] {
  const counts = new Map<string, number>();
  for (const list of lists) for (const item of new Set(list)) counts.set(item, (counts.get(item) ?? 0) + 1);
  return [...counts].map(([item, count]) => `${item} (${count}/${runs})`);
}

function report(evaluations: Awaited<ReturnType<typeof evaluate>>[], runs: number): boolean {
  let passed = true;
  console.log(`\n\n${"tool".padEnd(9)} ${"case".padEnd(9)} recall  keep  L1-rewrite  language  unknown-note  unplaced  result`);
  const details: string[] = [];
  for (const evaluation of evaluations) {
    if (evaluation.skipped) { console.log(`${evaluation.cli.padEnd(9)} skipped: ${evaluation.skipped}`); continue; }
    for (const { id, outcomes } of evaluation.results) {
      const scores = outcomes.flatMap((outcome) => "score" in outcome ? [outcome.score] : []);
      const errors = outcomes.flatMap((outcome) => "error" in outcome ? [outcome.error] : []);
      const total = scores[0]?.total ?? 0;
      const recall = scores.reduce((sum, score) => sum + score.found / score.total, 0) / outcomes.length;
      const sum = (pick: (score: RunScore) => number) => scores.reduce((count, score) => count + pick(score), 0);
      const hard = { keep: sum((score) => score.keepViolations.length), rewrites: sum((score) => score.levelOneRewrites.length), language: sum((score) => score.languageMismatches.length) };
      const ok = !errors.length && recall >= MIN_RECALL && hard.keep === 0 && hard.rewrites === 0 && hard.language === 0;
      passed &&= ok;
      console.log(`${evaluation.cli.padEnd(9)} ${id.padEnd(9)} ${`${Math.round(recall * 100)}%`.padStart(6)}  ${String(hard.keep).padStart(4)}  ${String(hard.rewrites).padStart(10)}  ${String(hard.language).padStart(8)}  ${String(sum((score) => score.unknownNoteLanguage)).padStart(12)}  ${String(sum((score) => score.unplaced)).padStart(8)}  ${ok ? "PASS" : "FAIL"}`);
      const lines = [
        ...errors.map((error) => `error: ${error}`),
        ...tally(scores.map((score) => score.missed), runs).map((item) => `missed ${item}`),
        ...tally(scores.map((score) => score.keepViolations), runs).map((item) => `keep violated: ${item}`),
        ...tally(scores.map((score) => score.levelOneRewrites), runs).map((item) => `Level 1 rewrite: ${item}`),
        ...tally(scores.map((score) => score.languageMismatches), runs).map((item) => `language: ${item}`),
        ...tally(scores.map((score) => score.extras), runs).map((item) => `extra (not in the key): ${item}`),
      ];
      if (lines.length) details.push(`\n${evaluation.cli} / ${id} (${total} planted issues, ${runs} runs)\n  ${lines.join("\n  ")}`);
    }
  }
  console.log(details.join("\n"));
  console.log(`\nPass: recall ≥ ${MIN_RECALL * 100}% averaged over runs, and no keep, Level 1 rewrite or language violations. Unknown note languages and unplaced suggestions are reported only.`);
  return passed;
}

/** Scores a saved run again with the current answer key and scorer, without calling any AI. */
function rescore(file: string): Awaited<ReturnType<typeof evaluate>>[] {
  const saved = JSON.parse(readFileSync(file, "utf8")) as Awaited<ReturnType<typeof evaluate>>[];
  return saved.map((evaluation) => ({
    ...evaluation,
    results: evaluation.results.map(({ id, outcomes }) => {
      const testCase = languageCases.find((candidate) => candidate.id === id);
      if (!testCase) throw new Error(`the saved run has an unknown case ${id}`);
      const document = buildDocument(testCase);
      return { id, outcomes: outcomes.map((outcome) => "raw" in outcome
        ? { raw: outcome.raw, score: scoreRun(document, validateAndResolve(document.source, outcome.raw, "markdown", `${id}.md`)) }
        : outcome) };
    }),
  }));
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (options.rescore) {
    const evaluations = rescore(options.rescore);
    const runs = Math.max(...evaluations.flatMap((evaluation) => evaluation.results.map((result) => result.outcomes.length)));
    process.exitCode = report(evaluations, runs) ? 0 : 1;
    return;
  }
  console.log(`Evaluating ${options.clis.join(", ")} on ${options.cases.map((testCase) => testCase.id).join(", ")}, ${options.runs} run(s) each`);
  const evaluations = await Promise.all(options.clis.map((cli) => evaluate(cli, options)));
  const outDir = resolve(__dirname, "../../eval");
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `languages-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(evaluations, null, 2));
  const passed = report(evaluations, options.runs);
  console.log(`Full results: ${file}`);
  process.exitCode = passed ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error(`eval:languages: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
