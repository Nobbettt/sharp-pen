import assert from "node:assert/strict";
import test from "node:test";

import { maskMarkdownForPrompt, validateAndResolve } from "../../src/review/validate";

const response = (from: string) => ({ title: "Draft", level1: [{ from, options: ["replacement"], note: "Typo" }], level2: [] });

test("Markdown excludes code and destinations, while exact text remains eligible", () => {
  for (const source of ["`SECRET`", "[x](SECRET)", "[x](https://private.example)"]) {
    const masked = maskMarkdownForPrompt(source);
    assert.doesNotMatch(masked, /SECRET|private\.example/);
    const result = validateAndResolve(source, response(source.includes("private") ? "https://private.example" : "SECRET"), "markdown");
    assert.deepEqual(result.level1, []);
    assert.equal(result.skipped, 1);
  }
  assert.doesNotThrow(() => validateAndResolve("`SECRET`*SECRET*", response("SECRET"), "markdown"));
});

test("Markdown keeps ordinary repeated prose eligible", () => {
  const source = "SECRET SECRET";
  assert.equal(maskMarkdownForPrompt(source), source);
  assert.doesNotThrow(() => validateAndResolve(source, { title: "Draft", level1: [{ from: "SECRET", occurrence: 2, options: ["replacement"], note: "Typo" }], level2: [] }, "markdown"));
});
