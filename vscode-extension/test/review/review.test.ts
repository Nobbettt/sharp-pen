import assert from "node:assert/strict";
import test from "node:test";

import { acceptAll, effectiveEdits, prepareApply } from "../../src/review/edits";
import { parseReviewIntent } from "../../src/review/intents";
import { reconcileSourceChanges } from "../../src/review/reconcile";
import { createReview, maskMarkdownForPrompt, REVIEW_LIMITS, ReviewValidationError, validateAndResolve } from "../../src/review/validate";
import type { Decisions } from "../../src/review/types";

const response = (level1: unknown[] = [], level2: unknown[] = []) => ({ title: "Draft", level1, level2 });

test("resolves anchors as UTF-16 offsets", () => {
  const source = "😀 bad planing";
  const result = validateAndResolve(source, response([{ from: "bad", options: ["good"], note: "Typo" }]));
  assert.equal(result.level1[0].start, 3);
  assert.equal(result.level1[0].end, 6);
});

test("requires an occurrence for repeated anchors", () => {
  const source = "planing then planing";
  const entry = { from: "planing", options: ["planning"], note: "Typo" };
  assert.throws(() => validateAndResolve(source, response([entry])), ReviewValidationError);
  const result = validateAndResolve(source, response([{ ...entry, occurrence: 2 }]));
  assert.equal(result.level1[0].start, source.lastIndexOf("planing"));
});

test("Markdown exclusions are masked for prompts and cannot resolve suggestions", () => {
  const source = [
    "---", "title: teh", "---", "", "Prose teh.", "", "```ts", "const teh = 1;", "```", "",
    "    indented teh", "Inline `teh`, <span>teh</span>, and [link](https://teh.example).",
  ].join("\n");
  const masked = maskMarkdownForPrompt(source);
  assert.equal(masked.length, source.length);
  assert.match(masked, /Prose teh/);
  assert.doesNotMatch(masked, /title: teh|const teh|indented teh|`teh`|<span>|https:\/\/teh/);
  assert.doesNotThrow(() => validateAndResolve(source, response([{ from: "Prose teh", options: ["Prose the"], note: "Typo" }]), "markdown"));
  assert.throws(() => validateAndResolve("`teh`", response([{ from: "teh", options: ["the"], note: "Typo" }]), "markdown"), ReviewValidationError);
  assert.doesNotThrow(() => validateAndResolve("`teh`", response([{ from: "teh", options: ["the"], note: "Typo" }])));
});

test("Markdown excludes reference destinations and unclosed raw HTML blocks", () => {
  const source = [
    "[guide]: https://teh.example/guide \"A teh title\"",
    "<div class=\"teh\">",
    "teh inside an unclosed raw block",
    "",
    "Prose teh.",
  ].join("\n");
  const masked = maskMarkdownForPrompt(source);
  assert.doesNotMatch(masked, /https:\/\/teh\.example|inside an unclosed raw block/);
  assert.match(masked, /A teh title|Prose teh/);
  assert.throws(() => validateAndResolve(source, response([{ from: "https://teh.example/guide", options: ["https://the.example/guide"], note: "Link" }]), "markdown"), ReviewValidationError);
  assert.throws(() => validateAndResolve(source, response([{ from: "inside an unclosed raw block", options: ["inside a raw block"], note: "Text" }]), "markdown"), ReviewValidationError);
});

test("Markdown resolves repeated anchors without rescanning exclusions", () => {
  const source = "teh ".repeat(25_000);
  const result = validateAndResolve(source, response([{ from: "teh", occurrence: 25_000, options: ["the"], note: "Typo" }]), "markdown");
  assert.equal(result.level1[0].start, source.length - 4);
});

test("response and source sizes are bounded", () => {
  assert.throws(() => validateAndResolve("x".repeat(REVIEW_LIMITS.source + 1), response()), ReviewValidationError);
  assert.throws(() => validateAndResolve("text", { title: "x".repeat(REVIEW_LIMITS.title + 1), level1: [], level2: [] }), ReviewValidationError);
  assert.throws(() => validateAndResolve("text", response(Array.from({ length: REVIEW_LIMITS.suggestionsPerLevel + 1 }, () => ({ from: "text", options: ["word"], note: "n" })))), ReviewValidationError);
  assert.throws(() => validateAndResolve("text", response([{ from: "x".repeat(REVIEW_LIMITS.from + 1), options: ["word"], note: "n" }])), ReviewValidationError);
  assert.throws(() => validateAndResolve("text", response([{ from: "text", options: ["x".repeat(REVIEW_LIMITS.option + 1)], note: "n" }])), ReviewValidationError);
  assert.throws(() => validateAndResolve("text", response([{ from: "text", options: ["word"], note: "x".repeat(REVIEW_LIMITS.note + 1) }])), ReviewValidationError);
});

test("rejects same-level overlap and partial level nesting", () => {
  assert.throws(() => validateAndResolve("abcde", response([
    { from: "abc", options: ["A"], note: "One" },
    { from: "cde", options: ["C"], note: "Two" },
  ])), ReviewValidationError);
  assert.throws(() => validateAndResolve("abcde", response(
    [{ from: "abc", options: ["A"], note: "One" }],
    [{ from: "cde", options: ["C"], note: "Sentence" }],
  )), ReviewValidationError);
  assert.doesNotThrow(() => validateAndResolve("abcde", response(
    [{ from: "abc", options: ["A"], note: "One" }],
    [{ from: "abcde", options: ["Sentence"], note: "Sentence" }],
  )));
});

test("accepted level2 edits supersede contained level1 edits", () => {
  const source = "The teh sentence.";
  const review = createReview(source, { uri: "file:///draft", documentVersion: 1, sourceHash: "hash" }, validateAndResolve(source, response(
    [{ from: "teh", options: ["the"], note: "Typo" }],
    [{ from: source, options: ["A sentence."], note: "Construction" }],
  )));
  const decisions: Decisions = { "l1-1": { option: 0 }, "l2-1": { option: 0 } };
  assert.deepEqual(effectiveEdits(review, decisions), [{ suggestionId: "l2-1", start: 0, end: source.length, text: "A sentence." }]);
});

test("accept all fills pending decisions without replacing an explicit keep or alternative", () => {
  const review = createReview("teh bad", { uri: "file:///draft", documentVersion: 1, sourceHash: "hash" }, validateAndResolve("teh bad", response([
    { from: "teh", options: ["the", "te"], note: "Typo" },
    { from: "bad", options: ["good"], note: "Word" },
  ])));
  assert.deepEqual(acceptAll(review, { "l1-1": { option: 1 } }, 1), {
    "l1-1": { option: 1 }, "l1-2": { option: 0 },
  });
  assert.deepEqual(acceptAll(review, { "l1-1": null }, 1), {
    "l1-1": null, "l1-2": { option: 0 },
  });
});

test("source edits shift untouched suggestions and invalidate only overlaps", () => {
  const source = "one teh two bad three";
  const review = createReview(source, { uri: "file:///draft", documentVersion: 1, sourceHash: "hash" }, validateAndResolve(source, response([
    { from: "teh", options: ["the"], note: "Typo" },
    { from: "bad", options: ["good"], note: "Word" },
  ])));
  const result = reconcileSourceChanges(
    review,
    { "l1-1": { option: 0 }, "l1-2": { option: 0 } },
    [{ rangeOffset: 0, rangeLength: 0, text: "very " }, { rangeOffset: 12, rangeLength: 3, text: "good" }],
    "very one teh two good three",
    2,
  );
  assert.equal(result.review.level1[0].start, 9);
  assert.equal(result.review.level1[0].status, "active");
  assert.deepEqual(result.decisions["l1-1"], { option: 0 });
  assert.equal(result.review.level1[1].status, "invalidated");
  assert.equal(Object.hasOwn(result.decisions, "l1-2"), false);
});

test("invalidated suggestions continue shifting through earlier changes", () => {
  const source = "one teh two bad three";
  const review = createReview(source, { uri: "file:///draft", documentVersion: 1, sourceHash: "hash" }, validateAndResolve(source, response([
    { from: "bad", options: ["good"], note: "Word" },
  ])));
  const result = reconcileSourceChanges(
    review,
    { "l1-1": { option: 0 } },
    [{ rangeOffset: 0, rangeLength: 0, text: "very " }, { rangeOffset: 12, rangeLength: 3, text: "good" }],
    "very one teh two good three",
    2,
  );
  assert.equal(result.review.level1[0].status, "invalidated");
  assert.equal(result.review.level1[0].start, 17);
});

test("apply validation drops only accepted ranges that no longer match", () => {
  const source = "teh bad";
  const review = createReview(source, { uri: "file:///draft", documentVersion: 1, sourceHash: "hash" }, validateAndResolve(source, response([
    { from: "teh", options: ["the"], note: "Typo" },
    { from: "bad", options: ["good"], note: "Word" },
  ])));
  const result = prepareApply(review, { "l1-1": { option: 0 }, "l1-2": { option: 0 } }, "teh sad", 1);
  assert.deepEqual(result.edits, [{ suggestionId: "l1-1", start: 0, end: 3, text: "the" }]);
  assert.equal(result.review.level1[1].status, "invalidated");
  assert.equal(Object.hasOwn(result.decisions, "l1-2"), false);
});

test("apply invalidates a Markdown suggestion that enters an excluded region", () => {
  const source = "Prose teh";
  const review = createReview(source, { uri: "file:///draft", documentVersion: 1, sourceHash: "hash", format: "markdown" }, validateAndResolve(source, response([
    { from: "teh", options: ["the"], note: "Typo" },
  ]), "markdown"));
  const result = prepareApply(review, { "l1-1": { option: 0 } }, "`Prose teh`", 1);
  assert.equal(result.review.level1[0].status, "invalidated");
  assert.deepEqual(result.edits, []);
});

test("webview intents require an exact known shape", () => {
  assert.deepEqual(parseReviewIntent({ type: "choose", suggestionId: "l1-1", option: 0 }), { type: "choose", suggestionId: "l1-1", option: 0 });
  assert.equal(parseReviewIntent({ type: "choose", suggestionId: "l1-1", option: -1 }), undefined);
  assert.equal(parseReviewIntent({ type: "apply", extra: true }), undefined);
  assert.equal(parseReviewIntent({ type: "reset", level: 3 }), undefined);
  assert.equal(parseReviewIntent({ type: "constructor" }), undefined);
});
