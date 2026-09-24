import assert from "node:assert/strict";
import test from "node:test";

const { isPreviewTheme, previewTheme, SettingsStore } = require("../src/config") as typeof import("../src/config");

test("preview theme accepts its enum and defaults invalid values to light", () => {
  assert.equal(isPreviewTheme("light"), true);
  assert.equal(isPreviewTheme("dark"), true);
  assert.equal(isPreviewTheme("auto"), true);
  assert.equal(isPreviewTheme("system"), false);
  assert.equal(previewTheme("system"), "light");
});

test("settings store keeps models separate for every provider", async () => {
  const values = new Map<string, unknown>();
  const settings = new SettingsStore({ get: <T>(key: string) => values.get(key) as T | undefined, update: async (key, value) => { values.set(key, value); } });
  await settings.setClient("codex");
  await settings.setPreviewTheme("dark");
  await settings.setModel("claude", "sonnet");
  await settings.setModel("codex", "gpt-5");
  assert.deepEqual(settings.getConfig(), { aiClient: "codex", previewTheme: "dark" });
  assert.equal(settings.getModel("claude"), "sonnet");
  assert.equal(settings.getModel("codex"), "gpt-5");
  assert.equal(settings.getModel("copilot"), "");
});
