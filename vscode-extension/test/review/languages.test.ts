import assert from "node:assert/strict";
import test from "node:test";

const Module = require("node:module") as { _load: (...args: any[]) => unknown };
const load = Module._load;
Module._load = (request: string, ...args: any[]) => request === "vscode"
  ? { languages: { getLanguages: () => Promise.resolve(["typescript", "", "x".repeat(129), "html", "typescript", "bad id", "bad\tlang", "bad`lang", "bad~lang", "c++", "foo.bar", "plaintext", "text", "unknown", "shellscript", "swift", "properties"]) } }
  : load(request, ...args);
const { installedLanguageIds } = require("../../src/review/languages") as typeof import("../../src/review/languages");
Module._load = load;

test("installed language catalog is sorted, deduplicated, and intent-bounded", async () => {
  assert.deepEqual(await installedLanguageIds(), ["c++", "html", "properties", "shellscript", "swift", "typescript"]);
});
