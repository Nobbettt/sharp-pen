import assert from "node:assert/strict";
import test from "node:test";

import { reviewCountStatus } from "../../src/webview/reviewStatus";

test("review toolbar status distinguishes empty, analysis, zero-result, level-empty, and numeric states", () => {
  assert.deepEqual(reviewCountStatus("empty", 1, 0, 0, 0), { text: "Nothing to show — run analysis", label: "Nothing to show; run analysis" });
  assert.deepEqual(reviewCountStatus("analyzing", 1, 0, 0, 0), { text: "Analyzing…", label: "Analysis in progress" });
  assert.deepEqual(reviewCountStatus("ready", 1, 0, 0, 0), { text: "No suggestions — all clear", label: "No suggestions found; all clear" });
  assert.deepEqual(reviewCountStatus("ready", 2, 3, 0, 0), { text: "No L2 suggestions", label: "No level 2 suggestions" });
  assert.deepEqual(reviewCountStatus("ready", 1, 3, 2, 3), { text: "2/3", label: "2 of 3 suggestions accepted" });
});

test("non-current empty states stay actionable rather than all clear", () => {
  for (const state of ["error", "modified"] as const) {
    assert.equal(reviewCountStatus(state, 1, 0, 0, 0).text, "Nothing to show — run analysis");
  }
});

test("applied gets a brief visible status instead of the run-analysis fallback (see R5-10)", () => {
  assert.deepEqual(reviewCountStatus("applied", 1, 0, 0, 0), { text: "Applied", label: "Staged changes applied" });
});

test("while a document is analysed in sections the status shows how many are done, even with suggestions already listed", () => {
  const expected = { text: "Analyzed 3 of 7 sections", label: "Analyzed 3 of 7 sections" };
  assert.deepEqual(reviewCountStatus("analyzing", 1, 0, 0, 0, { done: 3, total: 7 }), expected);
  assert.deepEqual(reviewCountStatus("analyzing", 1, 4, 0, 4, { done: 3, total: 7 }), expected);
  assert.deepEqual(reviewCountStatus("analyzing", 1, 0, 0, 0, { done: 0, total: 1 }), { text: "Analyzing…", label: "Analysis in progress" });
  assert.deepEqual(reviewCountStatus("ready", 1, 4, 1, 4, { done: 7, total: 7 }), { text: "1/4", label: "1 of 4 suggestions accepted" });
});
