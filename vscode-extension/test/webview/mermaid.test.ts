import assert from "node:assert/strict";
import test from "node:test";

import { createMermaidRenderer, mermaidDark, type MermaidApi } from "../../src/webview/mermaid";

function fakeMermaid(fail = false) {
  const calls: { theme: unknown; source: string }[] = [];
  let theme: unknown;
  const api: MermaidApi = {
    initialize: (config) => { theme = config.theme; },
    render: async (_id, source) => {
      calls.push({ theme, source });
      if (fail) throw new Error("Parse error");
      return { svg: `<svg viewBox="0 0 120.4 40"><text>${source}</text></svg>` };
    },
  };
  return { api, calls };
}

test("mermaid diagrams render once per source and theme, then come from the cache synchronously", async () => {
  const { api, calls } = fakeMermaid();
  let loads = 0;
  const render = createMermaidRenderer(async () => { loads++; return api; });

  const first = await render("graph TD; A-->B", false);
  assert.equal(first.width, 121);
  assert.match(first.src, /^data:image\/svg\+xml;charset=utf-8,%3Csvg/);
  assert.deepEqual(render("graph TD; A-->B", false), first);

  await Promise.all([render("graph TD; A-->B", true), render("graph TD; C-->D", false)]);
  assert.deepEqual(calls.map((call) => call.theme), ["default", "dark", "default"]);
  assert.equal(loads, 3);
});

test("a failed mermaid render rejects and is retried next time instead of being cached", async () => {
  const { api, calls } = fakeMermaid(true);
  const render = createMermaidRenderer(async () => api);
  await assert.rejects(Promise.resolve(render("not a diagram", false)), /Parse error/);
  await assert.rejects(Promise.resolve(render("not a diagram", false)), /Parse error/);
  assert.equal(calls.length, 2);
});

test("mermaid follows the preview theme, and the VS Code theme in auto mode", () => {
  const classes = (...names: string[]) => ({ contains: (name: string) => names.includes(name) });
  assert.equal(mermaidDark("dark", classes()), true);
  assert.equal(mermaidDark("light", classes("vscode-dark")), false);
  assert.equal(mermaidDark("auto", classes("vscode-dark")), true);
  assert.equal(mermaidDark("auto", classes("vscode-high-contrast")), true);
  assert.equal(mermaidDark("auto", classes("vscode-light")), false);
});
