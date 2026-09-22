import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { createReview, markdownExcludedRanges, ReviewValidationError, validateAndResolve } from "../../src/review/validate";
import { reconcileSourceChanges } from "../../src/review/reconcile";

const response = (from: string) => ({ title: "Draft", level1: [{ from, options: ["replacement"], note: "Typo" }], level2: [] });

test("many flat list, quote, or prose lines fail closed before parsing", () => {
  for (const source of ["- item\n".repeat(10_000), "> item\n".repeat(10_000), "x\n".repeat(20_001)]) {
    const started = performance.now();
    assert.deepEqual(markdownExcludedRanges(source), [{ start: 0, end: source.length }]);
    assert.ok(performance.now() - started < 1_000); // Target <250ms; leave room for loaded CI workers.
    assert.throws(() => validateAndResolve(source, response("item"), "markdown"), (error: unknown) =>
      error instanceof ReviewValidationError && error.message === "Markdown is too structurally complex to analyze");
  }
});

test("maximum prose and a reasonable number of containers remain supported", () => {
  const prose = "word ".repeat(20_000);
  const proseStarted = performance.now();
  assert.doesNotThrow(() => validateAndResolve(prose, { title: "Draft", level1: [{ from: "word", occurrence: 20_000, options: ["term"], note: "Word" }], level2: [] }, "markdown"));
  assert.ok(performance.now() - proseStarted < 1_000); // Target <250ms; leave room for loaded CI workers.

  const containers = [
    ...Array.from({ length: 1_024 }, (_, index) => `- list item ${index}`), "",
    ...Array.from({ length: 1_024 }, (_, index) => `> quote item ${index}`),
  ].join("\n");
  assert.doesNotThrow(() => validateAndResolve(containers, response("list item 1023"), "markdown"));
});

test("structural rejection keeps existing reviews all-invalid", () => {
  const source = "teh";
  const review = createReview(source, { uri: "file:///draft", documentVersion: 1, sourceHash: "hash", format: "markdown" }, validateAndResolve(source, response(source), "markdown"));
  const complex = "- item\n".repeat(10_000);
  const result = reconcileSourceChanges(review, { "l1-1": { option: 0 } }, [{ rangeOffset: 0, rangeLength: source.length, text: complex }], complex, 2);
  assert.equal(result.review.level1[0].status, "invalidated");
  assert.deepEqual(result.decisions, {});
});
