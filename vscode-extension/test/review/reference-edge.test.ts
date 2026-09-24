import assert from "node:assert/strict";
import test from "node:test";

import { maskMarkdownForPrompt, validateAndResolve } from "../../src/review/validate";

const response = (from: string) => ({ title: "Draft", level1: [{ from, options: ["replacement"], note: "Typo" }], level2: [] });

test("Markdown masks multiline reference destinations without swallowing later prose", () => {
  const source = [
    "[bare]:",
    " https://accounts.example/bare-secret",
    "[angle]:",
    "   <https://accounts.example/angle-secret>",
    "   \"Account title\"",
    "",
    "[bare] and [angle] leave teh prose.",
  ].join("\n");
  const masked = maskMarkdownForPrompt(source);

  assert.doesNotMatch(masked, /bare-secret|angle-secret|\[bare\]:|\[angle\]:/);
  assert.match(masked, /bare\s+and\s+angle\s+leave teh prose/);
  const bare = validateAndResolve(source, response("https://accounts.example/bare-secret"), "markdown");
  assert.deepEqual(bare.level1, []);
  assert.equal(bare.skipped, 1);
  const angle = validateAndResolve(source, response("https://accounts.example/angle-secret"), "markdown");
  assert.deepEqual(angle.level1, []);
  assert.equal(angle.skipped, 1);
  assert.doesNotThrow(() => validateAndResolve(source, response("teh prose"), "markdown"));
});
