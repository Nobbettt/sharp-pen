import assert from "node:assert/strict";
import test from "node:test";

import { normalizePreviewZoom } from "../../src/webview/zoom";

test("preview zoom defaults, accepts whole percentages, and stays bounded", () => {
  assert.equal(normalizePreviewZoom(undefined), 100);
  assert.equal(normalizePreviewZoom(124.4), 124);
  assert.equal(normalizePreviewZoom(5), 50);
  assert.equal(normalizePreviewZoom(500), 200);
});
