import assert from "node:assert/strict";
import test from "node:test";

import { maskMarkdownForPrompt, validateAndResolve } from "../../src/review/validate";

const response = (from: string) => ({ title: "Draft", level1: [{ from, options: ["replacement"], note: "Typo" }], level2: [] });

test("Markdown masks reference definitions in blockquotes and list containers", () => {
  const source = [
    "> [quote]: https://accounts.example/quote-secret",
    "> [multiline]:",
    "> <https://accounts.example/multiline-secret>",
    "> > [nested]: https://accounts.example/nested-secret",
    "- [list]:",
    "  https://accounts.example/list-secret",
    "- [list-tab]:",
    "\thttps://accounts.example/list-tab-secret",
    "> - [mixed]:",
    ">   https://accounts.example/mixed-secret",
    ">\t[tabbed]:",
    ">\thttps://accounts.example/tab-secret",
    "",
    "Later teh prose remains available.",
  ].join("\n");
  const masked = maskMarkdownForPrompt(source);

  assert.doesNotMatch(masked, /quote-secret|multiline-secret|nested-secret|list-secret|list-tab-secret|mixed-secret|tab-secret|\[quote\]:|\[list\]:/);
  assert.match(masked, /Later teh prose remains available/);
  for (const secret of ["quote-secret", "multiline-secret", "nested-secret", "list-secret", "list-tab-secret", "mixed-secret", "tab-secret"]) {
    const result = validateAndResolve(source, response(secret), "markdown");
    assert.deepEqual(result.level1, []);
    assert.equal(result.skipped, 1);
  }
  assert.doesNotThrow(() => validateAndResolve(source, response("teh prose"), "markdown"));
});
