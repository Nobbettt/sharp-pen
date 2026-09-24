import assert from "node:assert/strict";
import test from "node:test";

import { createMarkdownRenderer } from "../../src/webview/markdownRenderer";
import { cleanTaskMarkers, taskControlsMatch } from "../../src/webview/taskControls";

test("a task converted to code leaks no identity marker and remains disabled", () => {
  const namespace = "\uE002sharp-pen-task-uuid\uE003";
  const marker = new RegExp(`${namespace}\\d+${namespace}`, "g");
  const converted = `\`\`\`md\n- [ ] ${namespace}2${namespace} task\n\`\`\``;
  assert.doesNotMatch(cleanTaskMarkers(converted, marker), /sharp-pen-task-uuid/);
  assert.doesNotMatch(createMarkdownRenderer().render(converted), /task-list-item-checkbox/);
  assert.equal(taskControlsMatch(1, 0, 0, false), false);
});
