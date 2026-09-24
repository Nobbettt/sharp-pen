import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { maskMarkdownForPrompt, ReviewValidationError, validateAndResolve } from "../../src/review/validate";

const response = (from: string) => ({ title: "Draft", level1: [{ from, options: ["replacement"], note: "Typo" }], level2: [] });

test("the MDAST whitelist keeps only exact text offsets", () => {
  const source = [
    "# Heading prose", "- list prose", "plain prose and 2 < 3", "[label prose](https://private.example/explicit)",
    "[ref prose][r]", "", "[r]: https://private.example/reference", "  \"private title\"",
    "<span data=\">\">hidden HTML</span> visible prose", "<?pi hidden?>", "<!DOCTYPE hidden>", "<![CDATA[hidden]]>",
  ].join("\n");
  const masked = maskMarkdownForPrompt(source);

  for (const prose of ["Heading prose", "list prose", "plain prose", "2 < 3", "label prose", "ref prose", "visible prose"]) {
    assert.match(masked, new RegExp(prose.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotThrow(() => validateAndResolve(source, response(prose), "markdown"));
  }
  for (const privateText of ["https://private.example/explicit", "https://private.example/reference", "private title", "<?pi", "DOCTYPE", "CDATA"]) {
    assert.doesNotMatch(masked, new RegExp(privateText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(masked, /hidden HTML/);
});

test("unclosed front matter and malformed HTML-like prose stay eligible", () => {
  const source = "---\nmetadata-looking prose\n\n<a malformed prose";
  const masked = maskMarkdownForPrompt(source);
  assert.match(masked, /metadata-looking prose|malformed prose/);
  assert.doesNotThrow(() => validateAndResolve(source, response("malformed prose"), "markdown"));
});

test("an entity keeps its surrounding prose available while staying masked itself, and malformed angles stay near-linear", () => {
  const entityMasked = maskMarkdownForPrompt("before &amp; after");
  assert.match(entityMasked, /before/);
  assert.match(entityMasked, /after/);
  assert.doesNotMatch(entityMasked, /&amp;/);

  const source = "x <a ".repeat(20_000);
  const started = performance.now();
  assert.match(maskMarkdownForPrompt(source), /x <a/);
  assert.ok(performance.now() - started < 2_500);
  assert.throws(() => maskMarkdownForPrompt("x".repeat(100_001)), ReviewValidationError);
});
