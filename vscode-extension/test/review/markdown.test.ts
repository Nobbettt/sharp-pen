import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { maskMarkdownForPrompt, parseAgentResponse, REVIEW_LIMITS, ReviewValidationError, validateAndResolve } from "../../src/review/validate";

const response = (from: string, options = ["the"]) => ({
  title: "Draft", level1: [{ from, options, note: "Typo" }], level2: [],
});

test("Markdown parser ranges protect BOM front matter, code, and markers while retaining prose", () => {
  const source = [
    "\ufeff---", "title: teh", "---", "", "# Heading teh", "", "- list teh", "", "> ~~~ts", "> const teh = 1;", "> ~~~", "", "Prose teh.",
  ].join("\n");
  const masked = maskMarkdownForPrompt(source);
  assert.doesNotMatch(masked, /title: teh|const teh|# |^- /m);
  assert.match(masked, /Heading teh|list teh|Prose teh/);
  const heading = validateAndResolve(source, response("# Heading"), "markdown");
  assert.deepEqual(heading.level1, []);
  assert.equal(heading.skipped, 1);
  const code = validateAndResolve(source, response("const teh"), "markdown");
  assert.deepEqual(code.level1, []);
  assert.equal(code.skipped, 1);
});

test("MDAST admits only exact text offsets", () => {
  const source = [
    "Prose *teh* and [guide](https://teh.example/a\\)b).",
    "[ref]: <https://teh.example/reference>",
    "  \"teh title\"",
    "<span>teh in HTML</span>",
    "<custom>teh in unclosed HTML",
  ].join("\n");
  const masked = maskMarkdownForPrompt(source);
  assert.doesNotMatch(masked, /\*|https:\/\/teh\.example/);
  assert.match(masked, /Prose\s+teh\s+and\s+guide/);
  assert.match(masked, /teh in HTML|teh in unclosed HTML/);
  const emphasis = validateAndResolve(source, response("*teh*"), "markdown");
  assert.deepEqual(emphasis.level1, []);
  assert.equal(emphasis.skipped, 1);
  const linkDestination = validateAndResolve(source, response("https://teh.example/a\\)b"), "markdown");
  assert.deepEqual(linkDestination.level1, []);
  assert.equal(linkDestination.skipped, 1);
  assert.doesNotThrow(() => validateAndResolve(source, response("teh in unclosed HTML"), "markdown"));
});

test("MDAST keeps ordinary link labels but excludes autolinks", () => {
  const source = "[label teh](https://private.example) <https://private.example/autolink>";
  const masked = maskMarkdownForPrompt(source);
  assert.match(masked, /label teh/);
  assert.doesNotMatch(masked, /private\.example/);
  assert.doesNotThrow(() => validateAndResolve(source, response("label teh"), "markdown"));
  const autolink = validateAndResolve(source, response("https://private.example/autolink"), "markdown");
  assert.deepEqual(autolink.level1, []);
  assert.equal(autolink.skipped, 1);
});

test("Markdown anchor resolution remains linear enough for repeated prose anchors", () => {
  const source = "teh ".repeat(25_000);
  const started = performance.now();
  const result = validateAndResolve(source, {
    title: "Draft", level1: [{ from: "teh", occurrence: 25_000, options: ["the"], note: "Typo" }], level2: [],
  }, "markdown");
  assert.equal(result.level1[0].start, source.length - 4);
  assert.ok(performance.now() - started < 2_500);
});

test("aggregate agent response limits reject oversized JSON and expanded objects", () => {
  assert.throws(() => parseAgentResponse(" ".repeat(REVIEW_LIMITS.response + 1)), ReviewValidationError);
  assert.throws(() => validateAndResolve("text", JSON.parse(JSON.stringify({
    title: "Draft",
    level1: Array.from({ length: 100 }, () => ({ from: "text", options: ["word".repeat(2_500)], note: "n" })),
    level2: Array.from({ length: 100 }, () => ({ from: "text", options: ["word".repeat(2_500)], note: "n" })),
  }))), ReviewValidationError);
});
