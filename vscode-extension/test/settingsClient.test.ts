import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

class Element {
  value = "";
  disabled = false;
  hidden = false;
  textContent = "";
  focused = false;
  children: Element[] = [];
  private readonly listeners = new Map<string, (event: any) => void>();

  replaceChildren(...children: Element[]): void { this.children = children; }
  append(child: Element): void { this.children.push(child); }
  addEventListener(type: string, listener: (event: any) => void): void { this.listeners.set(type, listener); }
  dispatch(type: string, event: any = {}): void { this.listeners.get(type)?.(event); }
  focus(): void { this.focused = true; }
}

test("settings model select keeps Other hidden until selected and saves listed choices immediately", () => {
  const ids = ["client", "theme", "model", "models", "save-model", "refresh-models", "model-provider", "manual-model", "status"];
  const elements = new Map(ids.map((id) => [id, new Element()]));
  const messages: any[] = [];
  let message: (event: any) => void = () => {};
  runInNewContext(readFileSync("src/webview/settingsClient.js", "utf8"), {
    acquireVsCodeApi: () => ({ postMessage: (value: unknown) => messages.push(value) }),
    document: { getElementById: (id: string) => elements.get(id), createElement: () => new Element() },
    window: { addEventListener: (type: string, listener: (event: any) => void) => { if (type === "message") message = listener; } },
  });
  message({ data: { type: "state", model: {
    aiClient: "codex", previewTheme: "light", modelClient: "codex", model: "saved-custom", models: ["gpt-5"], trusted: true, status: "",
  } } });
  const models = elements.get("models")!;
  const manual = elements.get("manual-model")!;
  assert.equal(manual.hidden, true);
  assert.deepEqual(models.children.map((item) => item.textContent), ["Use client default", "gpt-5", "saved-custom (saved custom model)", "Other (specify model ID)"]);
  assert.equal(models.value, "saved-custom");
  models.value = "__sharp_pen_other_model__";
  models.dispatch("change");
  assert.equal(manual.hidden, false);
  assert.equal(elements.get("model")!.focused, true);
  message({ data: { type: "state", model: {
    aiClient: "codex", previewTheme: "light", modelClient: "codex", model: "manual-id", models: ["gpt-5"], modelSaved: true, trusted: true, status: "",
  } } });
  assert.equal(manual.hidden, true);
  assert.equal(models.focused, true);
  models.value = "gpt-5";
  models.dispatch("change");
  assert.equal(manual.hidden, true);
  assert.equal(messages.at(-1).type, "setModel");
  assert.equal(messages.at(-1).model, "gpt-5");
});
