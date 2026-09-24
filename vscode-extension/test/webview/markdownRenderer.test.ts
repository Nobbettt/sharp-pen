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

test("only a data-URI image renders as <img>; every other source falls back to alt text", () => {
  const html = createMarkdownRenderer().render("![safe](data:image/png;base64,QQ==) ![relative](./image.png) ![unsafe](javascript:alert(1))");
  assert.match(html, /<img src="data:image\/png;base64,QQ==" alt="safe">/);
  assert.match(html, / relative unsafe<\/p>/);
  assert.doesNotMatch(html, /javascript:|<img src="\.\/image\.png"/i);
});

test("bare domains and emails are not linkified, matching the review's literal-URL exclusion", () => {
  const html = createMarkdownRenderer().render("Visit example.com today. Mail me at a@b.co now.\n\n<https://example.test/auto>");
  assert.match(html, /<p>Visit example\.com today\. Mail me at a@b\.co now\.<\/p>/);
  assert.match(html, /class="markdown-link" title="https:\/\/example\.test\/auto"/);
});

test("protocol-relative image sources are rejected like other remote URLs", () => {
  const html = createMarkdownRenderer().render("![tracker](//evil.example/pixel.png)");
  assert.doesNotMatch(html, /<img/i);
  assert.match(html, /<p>tracker<\/p>/);
});

test("task items render without a <label> wrapper so clicking their text can't toggle the checkbox", () => {
  const html = createMarkdownRenderer().render("- [ ] buy milk and eggs");
  assert.doesNotMatch(html, /<label/);
  assert.match(html, /<li class="task-list-item"><input class="task-list-item-checkbox" disabled="" type="checkbox"> buy milk and eggs<\/li>/);
});

test("Markdown table alignment uses CSP-safe classes", () => {
  const html = createMarkdownRenderer().render("| Left | Center | Right |\n| :--- | :---: | ---: |\n| a | b | c |");
  assert.match(html, /class="markdown-align-left"/);
  assert.match(html, /class="markdown-align-center"/);
  assert.match(html, /class="markdown-align-right"/);
  assert.doesNotMatch(html, /style=/);
});

test("fenced and four-space-indented code both render as code blocks", () => {
  const html = createMarkdownRenderer().render("```typescript\nconst fenced = true;\n```\n\n    const indented = true;");
  assert.match(html, /<pre data-sharp-pen-fence-index="0" data-sharp-pen-fence-language="typescript"><code class="language-typescript hljs">[\s\S]*const[\s\S]*fenced/);
  assert.match(html, /<pre><code>const indented = true;\n<\/code><\/pre>/);
});

test("fenced blocks receive sequential safe source mapping while indented blocks do not", () => {
  const html = createMarkdownRenderer().render("```TS meta\nx\n```\n\n~~~~go\ny\n~~~~\n\n    indented");
  assert.match(html, /data-sharp-pen-fence-index="0" data-sharp-pen-fence-language="ts"/);
  assert.match(html, /data-sharp-pen-fence-index="1" data-sharp-pen-fence-language="go"/);
  assert.match(html, /<pre><code>indented\n<\/code><\/pre>/);
});

test("source-backed fence identities do not become languages or visible code text", () => {
  const namespace = "\uE004sharp-pen-fence-123e4567-e89b-12d3-a456-426614174000\uE005";
  const identity = `${namespace}0${namespace}`;
  const html = createMarkdownRenderer().render(`\`\`\`ts ${identity} linenos=1\nx\n\`\`\``);
  assert.match(html, new RegExp(`data-sharp-pen-fence-identity="${identity}"`));
  assert.match(html, /data-sharp-pen-fence-language="ts" data-sharp-pen-fence-identity="[^"]+"><code class="language-ts hljs">x/);
  assert.doesNotMatch(html.replace(/ data-sharp-pen-fence-[^=]+="[^"]+"/g, ""), /sharp-pen-fence/);
});

test("one render shares the aggregate highlighting budget across fenced blocks", () => {
  const block = "x".repeat(3_999); // fence content includes a trailing newline
  const html = createMarkdownRenderer().render(`\`\`\`typescript\n${block}\n\`\`\`\n\n\`\`\`typescript\n${block}\n\`\`\`\n\n\`\`\`typescript\n${block}\n\`\`\``);
  assert.equal((html.match(/class="language-typescript hljs"/g) ?? []).length, 2);
  assert.match(html, /data-sharp-pen-fence-index="2" data-sharp-pen-fence-language="typescript"><code class="language-typescript">/);
});

test("hostile HTML in a supported fence stays escaped and inert", () => {
  const html = createMarkdownRenderer().render("```html\n<script onload=alert(1)><img onerror=alert(2)>\n```");
  assert.match(html, /&lt;/);
  assert.match(html, /hljs-attr">onload/);
  assert.doesNotMatch(html, /<(?:script|img)\b/i);
  assert.doesNotMatch(html, /<(?:script|img)[^>]*on(?:load|error)=/i);
});
