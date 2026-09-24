import assert from "node:assert/strict";
import test from "node:test";

import { fenceLanguageOptions } from "../../src/webview/fenceLanguages";

test("fence language options retain supported and unknown current languages safely", () => {
  const installed = ["html", "plaintext", "typescript"];
  assert.deepEqual(fenceLanguageOptions("typescript", installed), [
    { language: "", label: "Plain text", disabled: false, selected: false },
    { language: "html", label: "html", disabled: false, selected: false },
    { language: "typescript", label: "typescript", disabled: false, selected: true },
  ]);
  assert.deepEqual(fenceLanguageOptions("unknown", installed)[1], { language: "unknown", label: "unknown", disabled: true, selected: true });
});

test("empty and plaintext source fences share one Plain text option", () => {
  for (const language of ["", "plaintext"]) {
    const options = fenceLanguageOptions(language, ["plaintext", "typescript"]);
    assert.equal(options.filter((item) => item.label === "Plain text").length, 1);
    assert.equal(options[0].selected, true);
  }
});
