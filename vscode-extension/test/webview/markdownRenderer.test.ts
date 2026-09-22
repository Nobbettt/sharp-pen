import assert from "node:assert/strict";
import test from "node:test";

import { createMarkdownRenderer } from "../../src/webview/markdownRenderer";

test("Markdown links are inert spans with safe destination tooltips", () => {
  const html = createMarkdownRenderer().render([
    "[https](https://example.test/a?x=1&y=2)",
    "[mail](mailto:writer@example.test)",
    "[relative](../draft.md)",
    "[data](data:text/html,hello)",
    "[javascript](javascript:alert(1))",
    "[command](command:open)",
    "<https://example.test/auto>",
    "[reference][ref]",
    "",
    "[ref]: https://example.test/reference",
  ].join("\n\n"));

  assert.doesNotMatch(html, /<a\b|\bhref=/i);
  assert.match(html, /<span class="markdown-link" title="https:\/\/example\.test\/a\?x=1&amp;y=2">https<\/span>/);
  assert.match(html, /title="mailto:writer@example\.test">mail<\/span>/);
  assert.match(html, /title="\.\.\/draft\.md">relative<\/span>/);
  assert.match(html, /title="https:\/\/example\.test\/auto">https:\/\/example\.test\/auto<\/span>/);
  assert.match(html, /title="https:\/\/example\.test\/reference">reference<\/span>/);
  for (const label of ["data", "javascript", "command"]) assert.match(html, new RegExp(`<span class="markdown-link">${label}</span>`));
  assert.doesNotMatch(html, /data:text|javascript:|command:open/i);
});

test("Markdown image safety remains independent from inert links", () => {
  const html = createMarkdownRenderer().render("![safe](./image.png) ![unsafe](javascript:alert(1))");
  assert.match(html, /<img src="\.\/image\.png" alt="safe">/);
  assert.match(html, / unsafe<\/p>/);
  assert.doesNotMatch(html, /javascript:/i);
});

test("Markdown table alignment uses CSP-safe classes", () => {
  const html = createMarkdownRenderer().render("| Left | Center | Right |\n| :--- | :---: | ---: |\n| a | b | c |");
  assert.match(html, /class="markdown-align-left"/);
  assert.match(html, /class="markdown-align-center"/);
  assert.match(html, /class="markdown-align-right"/);
  assert.doesNotMatch(html, /style=/);
});
