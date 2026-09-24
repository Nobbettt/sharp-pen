import assert from "node:assert/strict";
import test from "node:test";

import { applyEdits } from "../../src/review/edits";
import { reconcileSourceChanges } from "../../src/review/reconcile";
import { createReview, validateAndResolve } from "../../src/review/validate";

const response = (from: string, replacement: string) => ({
  title: "Draft", level1: [{ from, options: [replacement], note: "Fix" }], level2: [],
});

test("reconciliation maps invalidated spans to replacement text and shifts them", () => {
  const source = "one teh two bad three";
  const review = createReview(source, { documentVersion: 1 }, validateAndResolve(source, response("bad", "good")));
  const result = reconcileSourceChanges(review, { "l1-1": { option: 0 } }, [
    { rangeOffset: 0, rangeLength: 0, text: "very " },
    { rangeOffset: 12, rangeLength: 3, text: "good" },
  ], "very one teh two good three", 2);
  assert.deepEqual(result.review.level1[0], { ...review.level1[0], start: 17, end: 17, status: "invalidated" });
  assert.equal(Object.hasOwn(result.decisions, "l1-1"), false);
});

test("an edit overlapping a suggestion collapses it to an empty range instead of wrapping the new text", () => {
  const source = "one teh two bad three";
  const review = createReview(source, { documentVersion: 1 }, validateAndResolve(source, response("bad", "good")));
  const result = reconcileSourceChanges(review, { "l1-1": { option: 0 } }, [
    { rangeOffset: 12, rangeLength: 3, text: "## New section\n\n- item one\n- item two\n\nA fresh paragraph" },
  ], "one teh two ## New section\n\n- item one\n- item two\n\nA fresh paragraph three", 2);
  assert.equal(result.review.level1[0].status, "invalidated");
  assert.equal(result.review.level1[0].start, 12);
  assert.equal(result.review.level1[0].end, 12);
});

test("reconciliation invalidates a suggestion newly enclosed by Markdown syntax", () => {
  const source = "teh";
  const review = createReview(source, { documentVersion: 1, format: "markdown" }, validateAndResolve(source, response("teh", "the"), "markdown"));
  const result = reconcileSourceChanges(review, { "l1-1": { option: 0 } }, [
    { rangeOffset: 0, rangeLength: 0, text: "`" },
    { rangeOffset: 3, rangeLength: 0, text: "`" },
  ], "`teh`", 2);
  assert.equal(result.review.level1[0].status, "invalidated");
  assert.equal(Object.hasOwn(result.decisions, "l1-1"), false);
});

test("expected apply text uses simultaneous edit coordinates", () => {
  assert.equal(applyEdits("teh bad", [
    { suggestionId: "l1-1", start: 0, end: 3, text: "the" },
    { suggestionId: "l1-2", start: 4, end: 7, text: "good" },
  ]), "the good");
});
