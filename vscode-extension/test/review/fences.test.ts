import assert from "node:assert/strict";
import test from "node:test";

import { markdownFences } from "../../src/review/fences";
import { markdownTasks } from "../../src/review/tasks";
import { parseMarkdownTree } from "../../src/review/markdownTree";

test("finds fenced language tokens while preserving metadata offsets", () => {
  const source = "```ts linenos=1\nconst x = 1;\n```\n\n~~~~ python title\npass\n~~~~";
  assert.deepEqual(markdownFences(source), [
    { index: 0, language: "ts", languageStart: 3, languageEnd: 5, insertionOffset: 5, hasMetadata: true },
    { index: 1, language: "python", languageStart: 39, languageEnd: 45, insertionOffset: 45, hasMetadata: true },
  ]);
});

test("handles empty info, long tilde fences, BOM/CRLF, and container offsets", () => {
  const source = "\ufeff````\r\nx\r\n````\r\n> ```js meta\r\n> x\r\n> ```\r\n- item\r\n  ~~~go\r\n  x\r\n  ~~~";
  const fences = markdownFences(source);
  assert.deepEqual(fences.map(({ index, language }) => ({ index, language })), [{ index: 0, language: "" }, { index: 1, language: "js" }, { index: 2, language: "go" }]);
  assert.equal(source.slice(fences[1].languageStart, fences[1].languageEnd), "js");
  assert.equal(source.slice(fences[2].languageStart, fences[2].languageEnd), "go");
});

test("excludes indented code and accepts an unterminated fence when mdast parses it", () => {
  assert.deepEqual(markdownFences("    const indented = true;\n\n```ruby\nputs :ok"), [{ index: 0, language: "ruby", languageStart: 31, languageEnd: 35, insertionOffset: 35, hasMetadata: false }]);
});

test("tasks and fences give the same results from one shared parse", () => {
  const source = "﻿# Plan\n\n- [ ] write\n- [x] review\n\n```ts title=a\nconst a = 1;\n```\n\n~~~\nplain\n~~~\n";
  const tree = parseMarkdownTree(source);
  assert.deepEqual(markdownFences(source, tree), markdownFences(source));
  assert.deepEqual(markdownTasks(source, tree), markdownTasks(source));
  assert.equal(markdownTasks(source, tree).length, 2);
  assert.equal(markdownFences(source, tree).length, 2);
});
