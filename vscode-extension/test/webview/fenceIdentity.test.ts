import assert from "node:assert/strict";
import test from "node:test";

import { cleanFenceIdentityText } from "../../src/webview/fenceIdentity";

test("an absorbed fence identity is removed from rendered code text before controls validate", () => {
  const namespace = "\uE004sharp-pen-fence-123e4567-e89b-12d3-a456-426614174000\uE005";
  const identity = `${namespace}0${namespace}`;
  const marker = new RegExp(`${namespace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\d+${namespace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g");
  assert.equal(cleanFenceIdentityText(`absorbed ${identity} fence`, marker), "absorbed  fence");
});
