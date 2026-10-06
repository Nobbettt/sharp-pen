import assert from "node:assert/strict";
import test from "node:test";

import { prepareApply } from "../../src/review/edits";
import { markdownFences } from "../../src/review/fences";
import { reconcileSourceChanges } from "../../src/review/reconcile";
import { markdownTasks, matchesMarkdownTask } from "../../src/review/tasks";
import { type Suggestion } from "../../src/review/types";
import { createReview } from "../../src/review/validate";

/** 300k characters of Markdown (three times the 100k per-request limit), with a typo and a code fence in every section. */
const sections = Array.from({ length: 2_400 }, (_, n) => `## Section ${n}\n\nParagraph ${n} has a teh typo in it and a few more words to fill space.\n\n- [ ] task ${n}\n\n\`\`\`js\nconst x${n} = 1;\n\`\`\`\n\n`);
const source = sections.join("");

function suggestionAt(index: number, id: string): Suggestion {
  const start = source.indexOf("teh", source.indexOf(`Paragraph ${index} `));
  return { id, level: 1, start, end: start + 3, from: "teh", options: ["the"], note: "Typo", status: "active" };
}

test("a suggestion far from an edit stays valid in a document above 100k, and the one it touches is invalidated", () => {
  assert.ok(source.length > 300_000 && source.length < 1_000_000);
  const first = suggestionAt(10, "a");
  const edited = suggestionAt(750, "b");
  const last = suggestionAt(1_490, "c");
  const review = createReview(source, { documentVersion: 1, format: "markdown" }, { title: "T", level1: [first, edited, last], level2: [], skipped: 0 });
  const next = `${source.slice(0, edited.start + 1)}X${source.slice(edited.start + 1)}`;
  const result = reconcileSourceChanges(review, { a: { option: 0 }, b: { option: 0 }, c: { option: 0 } }, [{ rangeOffset: edited.start + 1, rangeLength: 0, text: "X" }], next, 2);
  assert.deepEqual(result.review.level1.map((item) => item.status), ["active", "invalidated", "active"]);
  assert.deepEqual(Object.keys(result.decisions).sort(), ["a", "c"]);
  assert.equal(result.review.level1[2].start, last.start + 1);
});

test("an edit inside a code fence invalidates nothing outside it, and a suggestion inside the fence is rejected", () => {
  const typo = suggestionAt(300, "a");
  const review = createReview(source, { documentVersion: 1, format: "markdown" }, { title: "T", level1: [typo], level2: [], skipped: 0 });
  const fenceText = source.indexOf("const x900 = 1;");
  const next = `${source.slice(0, fenceText)}const y900 = 1;${source.slice(fenceText + "const x900 = 1;".length)}`;
  const result = reconcileSourceChanges(review, { a: { option: 0 } }, [{ rangeOffset: fenceText + 6, rangeLength: 1, text: "y" }], next, 2);
  assert.equal(result.review.level1[0].status, "active");
  const inFence = { ...typo, id: "f", start: fenceText, end: fenceText + 5, from: "const" };
  const bad = reconcileSourceChanges({ ...review, level1: [inFence] }, {}, [], source, 1);
  assert.equal(bad.review.level1[0].status, "invalidated");
});

test("Apply succeeds on a document above 100k and refuses a suggestion that now touches code", () => {
  const first = suggestionAt(10, "a");
  const last = suggestionAt(1_490, "c");
  const review = createReview(source, { documentVersion: 4, format: "markdown" }, { title: "T", level1: [first, last], level2: [], skipped: 0 });
  const prepared = prepareApply(review, { a: { option: 0 }, c: { option: 0 } }, source, 4);
  assert.equal(prepared.canApply, true);
  assert.deepEqual(prepared.edits.map((edit) => edit.suggestionId), ["a", "c"]);
  const codeStart = source.indexOf("const x5 = 1;");
  const inCode: Suggestion = { ...first, id: "k", start: codeStart, end: codeStart + 5, from: "const" };
  const refused = prepareApply({ ...review, level1: [inCode] }, { k: { option: 0 } }, source, 4);
  assert.deepEqual(refused.edits, []);
  assert.equal(refused.review.level1[0].status, "invalidated");
});

test("tasks and code fences are found, with global offsets and indexes, in a document above 100k", () => {
  const tasks = markdownTasks(source);
  assert.equal(tasks.length, 2_400);
  assert.equal(tasks[1_000].offset, source.indexOf("[ ] task 1000"));
  assert.equal(matchesMarkdownTask(source, tasks[1_000].offset, false), true);
  const fences = markdownFences(source);
  assert.equal(fences.length, 2_400);
  assert.deepEqual(fences.slice(0, 3).map((fence) => fence.index), [0, 1, 2]);
  assert.equal(fences[1_200].languageStart, source.indexOf("js\nconst x1200"));
});
