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
  const ambiguous = validateAndResolve(source, response([entry]));
  assert.deepEqual(ambiguous.level1, []);
  assert.equal(ambiguous.skipped, 1);
  const result = validateAndResolve(source, response([{ ...entry, occurrence: 2 }]));
  assert.equal(result.level1[0].start, source.lastIndexOf("planing"));
});

test("resolves a Level 2 anchor that spans a CRLF line break", () => {
  const source = "This sentence is wrapped\r\nacross two lines teh end.\r\n";
  const from = "This sentence is wrapped\nacross two lines teh end.";
  const result = validateAndResolve(source, response([], [{ from, options: ["This sentence is wrapped\nacross two lines the end."], note: "Typo" }]));
  assert.equal(result.level2.length, 1);
  assert.equal(result.level2[0].start, source.indexOf("This sentence"));
  assert.equal(result.level2[0].from, from.replace(/\n/g, "\r\n"));
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
  const codeAnchor = validateAndResolve("`teh`", response([{ from: "teh", options: ["the"], note: "Typo" }]), "markdown");
  assert.deepEqual(codeAnchor.level1, []);
  assert.equal(codeAnchor.skipped, 1);
  assert.doesNotThrow(() => validateAndResolve("`teh`", response([{ from: "teh", options: ["the"], note: "Typo" }])));
});

test("a leading thematic break is not mistaken for YAML front matter", () => {
  const source = "---\n\nIntro paragraph teh.\n\n---\n\nMore text.\n";
  const masked = maskMarkdownForPrompt(source);
  assert.match(masked, /Intro paragraph teh/);
  assert.doesNotThrow(() => validateAndResolve(source, response([{ from: "Intro paragraph teh.", options: ["Intro paragraph the."], note: "Typo" }]), "markdown"));
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
  const reference = validateAndResolve(source, response([{ from: "https://teh.example/guide", options: ["https://the.example/guide"], note: "Link" }]), "markdown");
  assert.deepEqual(reference.level1, []);
  assert.equal(reference.skipped, 1);
  const rawBlock = validateAndResolve(source, response([{ from: "inside an unclosed raw block", options: ["inside a raw block"], note: "Text" }]), "markdown");
  assert.deepEqual(rawBlock.level1, []);
  assert.equal(rawBlock.skipped, 1);
});

test("GFM task markers, table syntax, and literal autolinks are excluded while cell and strikethrough prose stays reviewable", () => {
  const task = "- [ ] Fix teh typo.\n";
  assert.doesNotMatch(maskMarkdownForPrompt(task), /\[ \]/);
  assert.doesNotThrow(() => validateAndResolve(task, response([{ from: "Fix teh typo.", options: ["Fix the typo."], note: "Typo" }]), "markdown"));
  const taskMarker = validateAndResolve(task, response([{ from: "[ ] Fix teh typo.", options: ["Fix the typo."], note: "Typo" }]), "markdown");
  assert.deepEqual(taskMarker.level1, []);
  assert.equal(taskMarker.skipped, 1);

  const table = "| Name | Bio |\n| --- | --- |\n| Bob | teh best |\n";
  const tableMasked = maskMarkdownForPrompt(table);
  assert.doesNotMatch(tableMasked, /---|\|/);
  assert.match(tableMasked, /teh best/);
  assert.doesNotThrow(() => validateAndResolve(table, response([{ from: "teh best", options: ["the best"], note: "Typo" }]), "markdown"));
  const tableSyntax = validateAndResolve(table, response([{ from: "| teh best |", options: ["| the best |"], note: "Typo" }]), "markdown");
  assert.deepEqual(tableSyntax.level1, []);
  assert.equal(tableSyntax.skipped, 1);

  const bareUrl = "See https://example.com/teh-guide for the details.\n";
  assert.doesNotMatch(maskMarkdownForPrompt(bareUrl), /teh-guide/);
  const literalUrl = validateAndResolve(bareUrl, response([{ from: "teh-guide", options: ["the-guide"], note: "Typo" }]), "markdown");
  assert.deepEqual(literalUrl.level1, []);
  assert.equal(literalUrl.skipped, 1);
  assert.doesNotThrow(() => validateAndResolve(bareUrl, response([{ from: "the details.", options: ["some details."], note: "Word" }]), "markdown"));

  const strike = "A ~~teh~~ deletion.\n";
  assert.doesNotMatch(maskMarkdownForPrompt(strike), /~~/);
  assert.doesNotThrow(() => validateAndResolve(strike, response([{ from: "teh", options: ["the"], note: "Typo" }]), "markdown"));
});

test("Markdown keeps hard-wrapped prose inside list items and blockquotes available", () => {
  const list = "- This list item has a speling error\n  and continues here.\n";
  const listMasked = maskMarkdownForPrompt(list);
  assert.match(listMasked, /speling error/);
  assert.match(listMasked, /continues here/);
  assert.doesNotThrow(() => validateAndResolve(list, response([{ from: "speling", options: ["spelling"], note: "Typo" }]), "markdown"));
  assert.doesNotThrow(() => validateAndResolve(list, response([{ from: "continues here.", options: ["continues here!"], note: "Word" }]), "markdown"));

  const quote = "> This is a quoted sentense that\n> wraps onto a second line.\n";
  const quoteMasked = maskMarkdownForPrompt(quote);
  assert.match(quoteMasked, /sentense/);
  assert.doesNotThrow(() => validateAndResolve(quote, response([{ from: "sentense", options: ["sentence"], note: "Typo" }]), "markdown"));
  assert.doesNotThrow(() => validateAndResolve(quote, response([{ from: "wraps onto a second line.", options: ["wraps onto a second line!"], note: "Word" }]), "markdown"));

  const nested = "> > nested wraps\n> > onto speling here.\n";
  assert.doesNotThrow(() => validateAndResolve(nested, response([{ from: "speling", options: ["spelling"], note: "Typo" }]), "markdown"));
});

test("Markdown keeps prose after a trailing space or tab before a soft line break available", () => {
  const trailingSpace = "First line has a trailing space \nsecond line teh end.\n";
  assert.doesNotThrow(() => validateAndResolve(trailingSpace, response([{ from: "teh", options: ["the"], note: "Typo" }]), "markdown"));

  const trailingTab = "First line has a trailing tab\t\nsecond line teh end.\n";
  assert.doesNotThrow(() => validateAndResolve(trailingTab, response([{ from: "teh", options: ["the"], note: "Typo" }]), "markdown"));

  const list = "- First item \n  second line teh end.\n";
  assert.doesNotThrow(() => validateAndResolve(list, response([{ from: "teh", options: ["the"], note: "Typo" }]), "markdown"));

  const quote = "> First \n> second line teh end.\n";
  assert.doesNotThrow(() => validateAndResolve(quote, response([{ from: "teh", options: ["the"], note: "Typo" }]), "markdown"));
});

test("Markdown keeps prose after a trailing space or tab before a CRLF soft line break available", () => {
  const trailingSpace = "First line has a trailing space \r\nsecond line teh end.\r\n";
  assert.doesNotThrow(() => validateAndResolve(trailingSpace, response([{ from: "teh", options: ["the"], note: "Typo" }]), "markdown"));

  const list = "- First item \r\n  second line teh end.\r\n";
  assert.doesNotThrow(() => validateAndResolve(list, response([{ from: "teh", options: ["the"], note: "Typo" }]), "markdown"));

  const quote = "> First \r\n> second line teh end.\r\n";
  assert.doesNotThrow(() => validateAndResolve(quote, response([{ from: "teh", options: ["the"], note: "Typo" }]), "markdown"));
});

test("Markdown keeps prose around a character escape or an HTML entity available", () => {
  const escaped = "Escaped \\*star\\* stays literal.\n";
  assert.doesNotThrow(() => validateAndResolve(escaped, response([
    { from: "Escaped", options: ["Escapes"], note: "Word" },
    { from: "stays literal.", options: ["stays literal!"], note: "Word" },
  ]), "markdown"));

  const entity = "Use AT&amp;T here, teh cat.\n";
  assert.doesNotThrow(() => validateAndResolve(entity, response([
    { from: "teh cat.", options: ["the cat."], note: "Typo" },
  ]), "markdown"));
});

test("Markdown resolves repeated anchors without rescanning exclusions", () => {
  const source = "teh ".repeat(25_000);
  const result = validateAndResolve(source, response([{ from: "teh", occurrence: 25_000, options: ["the"], note: "Typo" }]), "markdown");
  assert.equal(result.level1[0].start, source.length - 4);
});

test("a blank or oversized title falls back to the requested title instead of rejecting the response", () => {
  const blank = validateAndResolve("text", { title: "  ", level1: [], level2: [] }, "plaintext", "Requested");
  assert.equal(blank.title, "Requested");
  const oversized = validateAndResolve("text", { title: "x".repeat(REVIEW_LIMITS.title + 1), level1: [], level2: [] }, "plaintext", "Requested");
  assert.equal(oversized.title, "Requested");
});

test("suggestions beyond the per-level limit are dropped and counted as skipped instead of rejecting the response", () => {
  const entries = Array.from({ length: REVIEW_LIMITS.suggestionsPerLevel + 5 }, (_, index) => ({ from: `word${String(index).padStart(3, "0")}`, options: ["term"], note: "Word" }));
  const result = validateAndResolve(entries.map((entry) => entry.from).join(" "), response(entries));
  assert.equal(result.level1.length, REVIEW_LIMITS.suggestionsPerLevel);
  assert.equal(result.skipped, 5);
});

test("response and source sizes are bounded", () => {
  assert.throws(() => validateAndResolve("x".repeat(REVIEW_LIMITS.source + 1), response()), ReviewValidationError);
  const oversizedFrom = validateAndResolve("text", response([{ from: "x".repeat(REVIEW_LIMITS.from + 1), options: ["word"], note: "n" }]));
  assert.deepEqual(oversizedFrom.level1, []);
  assert.equal(oversizedFrom.skipped, 1);
  const oversizedOption = validateAndResolve("text", response([{ from: "text", options: ["x".repeat(REVIEW_LIMITS.option + 1)], note: "n" }]));
  assert.deepEqual(oversizedOption.level1, []);
  assert.equal(oversizedOption.skipped, 1);
  const oversizedNote = validateAndResolve("text", response([{ from: "text", options: ["word"], note: "x".repeat(REVIEW_LIMITS.note + 1) }]));
  assert.deepEqual(oversizedNote.level1, []);
  assert.equal(oversizedNote.skipped, 1);
});

test("drops a later same-level overlap and a level2 suggestion that only partially nests a level1 one", () => {
  const overlap = validateAndResolve("abcde", response([
    { from: "abc", options: ["A"], note: "One" },
    { from: "cde", options: ["C"], note: "Two" },
  ]));
  assert.deepEqual(overlap.level1.map((s) => s.from), ["abc"]);
  assert.equal(overlap.skipped, 1);

  const nesting = validateAndResolve("abcde", response(
    [{ from: "abc", options: ["A"], note: "One" }],
    [{ from: "cde", options: ["C"], note: "Sentence" }],
  ));
  assert.deepEqual(nesting.level1.map((s) => s.from), ["abc"]);
  assert.deepEqual(nesting.level2, []);
  assert.equal(nesting.skipped, 1);

  const contained = validateAndResolve("abcde", response(
    [{ from: "abc", options: ["A"], note: "One" }],
    [{ from: "abcde", options: ["Sentence"], note: "Sentence" }],
  ));
  assert.equal(contained.skipped, 0);
});

test("drops individual unanchored suggestions instead of rejecting the whole response", () => {
  const source = "Teh first sentence is fine.\n\nThis is a bold sentence that are wrong.\n";
  const result = validateAndResolve(source, response([
    { from: "Teh", options: ["The"], note: "Typo" },
    { from: "This is not in the source", options: ["fixed"], note: "Ghost" },
  ]));
  assert.deepEqual(result.level1.map((s) => s.from), ["Teh"]);
  assert.equal(result.skipped, 1);
});

test("publishes an empty, skipped review instead of rejecting when every suggestion fails to resolve", () => {
  const result = validateAndResolve("abcde", response([
    { from: "not present", options: ["x"], note: "One" },
  ]));
  assert.deepEqual(result.level1, []);
  assert.equal(result.skipped, 1);
  assert.doesNotThrow(() => validateAndResolve("abcde", response()));
});

test("drops individually malformed suggestions instead of rejecting the whole response", () => {
  const source = "Teh first bold sentence is fine.\n";
  const result = validateAndResolve(source, response([
    { from: "Teh", occurrence: null, options: ["The"], note: "Typo" },
    { from: "bold", options: ["bold"], note: "No-op" },
    { from: "sentence", options: ["Sentence"], note: "  " },
    { from: "fine", options: ["great"], note: "n", unknownField: true },
  ]));
  assert.deepEqual(result.level1.map((s) => s.from), ["Teh"]);
  assert.equal(result.skipped, 3);
});

test("publishes an empty, skipped review instead of rejecting when every suggestion is malformed", () => {
  const result = validateAndResolve("abcde", response([
    { from: "abc", occurrence: 0, options: ["A"], note: "One" },
  ]));
  assert.deepEqual(result.level1, []);
  assert.equal(result.skipped, 1);
});

test("accepted level2 edits supersede contained level1 edits", () => {
  const source = "The teh sentence.";
  const review = createReview(source, { documentVersion: 1 }, validateAndResolve(source, response(
    [{ from: "teh", options: ["the"], note: "Typo" }],
    [{ from: source, options: ["A sentence."], note: "Construction" }],
  )));
  const decisions: Decisions = { "l1-1": { option: 0 }, "l2-1": { option: 0 } };
  assert.deepEqual(effectiveEdits(review, decisions), [{ suggestionId: "l2-1", start: 0, end: source.length, text: "A sentence." }]);
});

test("accept all fills pending decisions without replacing an explicit keep or alternative", () => {
  const review = createReview("teh bad", { documentVersion: 1 }, validateAndResolve("teh bad", response([
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
  const review = createReview(source, { documentVersion: 1 }, validateAndResolve(source, response([
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
  const review = createReview(source, { documentVersion: 1 }, validateAndResolve(source, response([
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
  const review = createReview(source, { documentVersion: 1 }, validateAndResolve(source, response([
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
  const review = createReview(source, { documentVersion: 1, format: "markdown" }, validateAndResolve(source, response([
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
  assert.deepEqual(parseReviewIntent({ type: "scrollSource", ratio: 0.5 }), { type: "scrollSource", ratio: 0.5 });
  assert.equal(parseReviewIntent({ type: "scrollSource", ratio: 2 }), undefined);
  assert.equal(parseReviewIntent({ type: "scrollSource", ratio: Number.NaN }), undefined);
  assert.equal(parseReviewIntent({ type: "reset", level: 3 }), undefined);
  assert.equal(parseReviewIntent({ type: "constructor" }), undefined);
  assert.deepEqual(parseReviewIntent({ type: "toggleTask", offset: 12, checked: true, documentVersion: 4 }), { type: "toggleTask", offset: 12, checked: true, documentVersion: 4 });
  assert.equal(parseReviewIntent({ type: "toggleTask", offset: 12, checked: true, documentVersion: 4, extra: true }), undefined);
  assert.equal(parseReviewIntent({ type: "toggleTask", offset: -1, checked: true, documentVersion: 4 }), undefined);
  assert.equal(parseReviewIntent({ type: "toggleTask", offset: 12, checked: "true", documentVersion: 4 }), undefined);
  assert.deepEqual(parseReviewIntent({ type: "setCodeFenceLanguage", fenceIndex: 1, languageId: "typescript", documentVersion: 4 }), { type: "setCodeFenceLanguage", fenceIndex: 1, languageId: "typescript", documentVersion: 4 });
  assert.deepEqual(parseReviewIntent({ type: "setCodeFenceLanguage", fenceIndex: 1, languageId: "", documentVersion: 4 }), { type: "setCodeFenceLanguage", fenceIndex: 1, languageId: "", documentVersion: 4 });
  assert.deepEqual(parseReviewIntent({ type: "setCodeFenceLanguage", fenceIndex: 1, languageId: "bad id", documentVersion: 4 }), { type: "setCodeFenceLanguage", fenceIndex: 1, languageId: "bad id", documentVersion: 4 });
  assert.equal(parseReviewIntent({ type: "setCodeFenceLanguage", fenceIndex: 1, languageId: "ts", documentVersion: 4, extra: true }), undefined);
});
