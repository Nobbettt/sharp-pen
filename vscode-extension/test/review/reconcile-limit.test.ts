import assert from "node:assert/strict";
import test from "node:test";

import { prepareApply } from "../../src/review/edits";
import { reconcileSourceChanges } from "../../src/review/reconcile";
import { createReview, REVIEW_LIMITS, validateAndResolve } from "../../src/review/validate";

const response = {
  title: "Draft",
  level1: [{ from: "teh", occurrence: 2, options: ["the"], note: "Typo" }],
  level2: [],
};

test("Markdown reconciliation invalidates an oversized source permanently", () => {
  const source = "teh teh";
  const review = createReview(source, { documentVersion: 1, format: "markdown" }, validateAndResolve(source, response, "markdown"));
  const oversized = "x".repeat(REVIEW_LIMITS.source + 1);
  const failed = reconcileSourceChanges(review, { "l1-1": { option: 0 } }, [
    { rangeOffset: 0, rangeLength: source.length, text: oversized },
  ], oversized, 2);
  assert.equal(failed.review.currentSource, oversized);
  assert.equal(failed.review.currentDocumentVersion, 2);
  assert.equal(failed.review.level1[0].status, "invalidated");
  assert.deepEqual(failed.decisions, {});

  const shrunk = reconcileSourceChanges(failed.review, failed.decisions, [
    { rangeOffset: 0, rangeLength: oversized.length, text: source },
  ], source, 3);
  const apply = prepareApply(shrunk.review, { "l1-1": { option: 0 } }, source, 3);
  assert.equal(shrunk.review.level1[0].status, "invalidated");
  assert.deepEqual(apply.edits, []);
});

test("Markdown reconciliation invalidates a structurally complex source", () => {
  const source = "teh";
  const review = createReview(source, { documentVersion: 1, format: "markdown" }, validateAndResolve(source, {
    title: "Draft", level1: [{ from: source, options: ["the"], note: "Typo" }], level2: [],
  }, "markdown"));
  const complex = "*".repeat(4_097);
  const result = reconcileSourceChanges(review, { "l1-1": { option: 0 } }, [
    { rangeOffset: 0, rangeLength: source.length, text: complex },
  ], complex, 2);
  assert.equal(result.review.level1[0].status, "invalidated");
  assert.deepEqual(result.decisions, {});
});

test("plaintext reconciliation invalidates an oversized source", () => {
  const source = "teh";
  const review = createReview(source, { documentVersion: 1 }, validateAndResolve(source, {
    title: "Draft", level1: [{ from: source, options: ["the"], note: "Typo" }], level2: [],
  }));
  const oversized = "x".repeat(REVIEW_LIMITS.source + 1);
  const result = reconcileSourceChanges(review, { "l1-1": { option: 0 } }, [
    { rangeOffset: 0, rangeLength: source.length, text: oversized },
  ], oversized, 2);
  assert.equal(result.review.level1[0].status, "invalidated");
  assert.deepEqual(result.decisions, {});
});
