import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { markdownExcludedRanges, ReviewValidationError, validateAndResolve } from "../../src/review/validate";
import { markdownTasks } from "../../src/review/tasks";
import { markdownFences } from "../../src/review/fences";

const response = (from: string) => ({ title: "Draft", level1: [{ from, options: ["replacement"], note: "Typo" }], level2: [] });

test("delimiter-heavy Markdown fails closed before the parser", () => {
  const source = "[".repeat(80_000);
  const started = performance.now();
  assert.deepEqual(markdownExcludedRanges(source), [{ start: 0, end: source.length }]);
  assert.deepEqual(markdownTasks(source), []);
  assert.deepEqual(markdownFences(source), []);
  assert.ok(performance.now() - started < 1_000); // Target <250ms; leave room for loaded CI workers.
  assert.throws(() => validateAndResolve(source, response("["), "markdown"), (error: unknown) =>
    error instanceof ReviewValidationError && error.message === "Markdown is too structurally complex to analyze");
});

test("ordinary headings, lists, and emphasis remain eligible", () => {
  const source = "## Heading\n\n- *teh* prose\n";
  assert.doesNotThrow(() => validateAndResolve(source, response("teh"), "markdown"));
});
