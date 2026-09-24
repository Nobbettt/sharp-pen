import assert from "node:assert/strict";
import test from "node:test";

import { markdownTasks, matchesMarkdownTask } from "../../src/review/tasks";

test("finds nested Markdown task markers by source offset", () => {
  const source = "- [ ] outer\n  - [X] nested\n- [x] done";
  assert.deepEqual(markdownTasks(source), [
    { offset: 2, checked: false, label: "outer" },
    { offset: 16, checked: true, label: "nested" },
    { offset: 29, checked: true, label: "done" },
  ]);
  assert.equal(matchesMarkdownTask(source, 16, true), true);
});

test("rejects task-like text in front matter, raw HTML, and code", () => {
  const source = [
    "---", "items:", "  - [ ] front matter", "---", "", "```md", "- [ ] fenced", "```", "`- [x] inline`",
    "<div>", "- [ ] raw", "</div>", "", "- [ ] real",
  ].join("\n");
  const [task] = markdownTasks(source);
  assert.equal(task.label, "real");
  assert.equal(matchesMarkdownTask(source, task.offset, false), true);
  assert.equal(matchesMarkdownTask(source, task.offset, true), false);
  assert.equal(matchesMarkdownTask(source, task.offset + 1, false), false);
});

test("a leading thematic break followed by a blank line is not mistaken for YAML front matter", () => {
  const source = "---\n\n- [ ] first task\n- [ ] second task\n\n---\n\nMore text.\n";
  assert.deepEqual(markdownTasks(source), [
    { offset: 7, checked: false, label: "first task" },
    { offset: 24, checked: false, label: "second task" },
  ]);
});

test("keeps source offsets correct with a byte-order mark", () => {
  const source = "\ufeff- [ ] task";
  assert.deepEqual(markdownTasks(source), [{ offset: 3, checked: false, label: "task" }]);
});
