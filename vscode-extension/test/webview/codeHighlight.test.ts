import assert from "node:assert/strict";
import test from "node:test";

import { HIGHLIGHT_CODE_LIMIT, highlightCode } from "../../src/webview/codeHighlight";

test("highlights explicit TypeScript, HTML, shell, and C# grammars", () => {
  for (const [language, source] of [["typescript", "const value: number = 1;"], ["html", "<div class=\"x\">ok</div>"], ["shellscript", "echo $HOME"], ["csharp", "public class Demo {}"]] as const) {
    const result = highlightCode(source, language);
    assert.equal(result.highlighted, true);
    assert.match(result.html, /hljs-/);
  }
});

test("large fenced code skips highlighting deterministically but remains escaped", () => {
  assert.equal(highlightCode("x".repeat(HIGHLIGHT_CODE_LIMIT), "typescript").highlighted, true);
  const oversized = highlightCode(`<img onerror=alert(1)>${"x".repeat(HIGHLIGHT_CODE_LIMIT)}`, "typescript");
  assert.equal(oversized.highlighted, false);
  assert.match(oversized.html, /&lt;img onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(oversized.html, /hljs-/);
});

test("unknown and plain languages remain escaped without Highlight.js spans", () => {
  for (const language of ["", "plaintext", "unknown"]) {
    const result = highlightCode("<img onerror=alert(1)>", language);
    assert.equal(result.highlighted, false);
    assert.equal(result.html, "&lt;img onerror=alert(1)&gt;");
  }
});
