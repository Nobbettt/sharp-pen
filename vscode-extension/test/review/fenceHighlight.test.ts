import assert from "node:assert/strict";
import test from "node:test";

import { highlightLanguage, highlightableInstalledLanguageIds } from "../../src/review/fenceHighlight";

test("fence language aliases resolve only to Highlight.js common grammars", () => {
  assert.equal(highlightLanguage("tsx"), "typescript");
  assert.equal(highlightLanguage("jsx"), "javascript");
  assert.equal(highlightLanguage("html"), "xml");
  assert.equal(highlightLanguage("shellscript"), "bash");
  assert.equal(highlightLanguage("cs"), "csharp");
  assert.equal(highlightLanguage("objective-c"), "objectivec");
  assert.equal(highlightLanguage("swift"), "swift");
  assert.equal(highlightLanguage("diff"), "diff");
  assert.equal(highlightLanguage("properties"), "ini");
  assert.equal(highlightLanguage("plaintext"), undefined);
  assert.equal(highlightLanguage("unknown"), undefined);
});

test("installed selector catalog contains only highlightable source IDs", () => {
  assert.deepEqual(highlightableInstalledLanguageIds(["typescript", "typescriptreact", "plaintext", "text", "html", "shellscript", "unknown"]), ["html", "shellscript", "typescript", "typescriptreact"]);
});
