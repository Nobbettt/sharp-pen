import assert from "node:assert/strict";
import test from "node:test";

import { createMermaidRenderer, mermaidDark, type MermaidApi } from "../../src/webview/mermaid";

function fakeMermaid(fail = false) {
  const calls: { theme: unknown; source: string; container?: unknown }[] = [];
  let theme: unknown;
  const api: MermaidApi = {
    initialize: (config) => { theme = config.theme; },
    render: async (_id, source, container) => {
      calls.push({ theme, source, container });
      if (fail) throw new Error("Parse error");
      return { svg: `<svg aria-roledescription="flowchart-v2" viewBox="0 0 120.4 40"><text>${source}</text></svg>` };
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
  assert.equal(first.alt, "Mermaid flowchart diagram");
  assert.match(first.src, /^data:image\/svg\+xml;charset=utf-8,%3Csvg/);
  assert.deepEqual(render("graph TD; A-->B", false), first);

  await Promise.all([render("graph TD; A-->B", true), render("graph TD; C-->D", false)]);
  assert.deepEqual(calls.map((call) => call.theme), ["default", "dark", "default"]);
  assert.equal(loads, 3);
});

test("mermaid alt text names the diagram type without a doubled \"diagram\"", async () => {
  const api: MermaidApi = { initialize: () => undefined, render: async () => ({ svg: '<svg aria-roledescription="classDiagram" viewBox="0 0 10 10"></svg>' }) };
  assert.equal((await createMermaidRenderer(async () => api)("classDiagram", false)).alt, "Mermaid class diagram");
});

test("mermaid lays diagrams out in the given host instead of <body>", async () => {
  const { api, calls } = fakeMermaid();
  const host = { id: "host" } as unknown as Element;
  await createMermaidRenderer(async () => api, () => host)("graph TD; A-->B", false);
  assert.equal(calls[0].container, host);
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

test("queued renders that no pane still shows are skipped, so typing in a fence builds no backlog", async () => {
  const { api, calls } = fakeMermaid();
  const render = createMermaidRenderer(async () => api);
  // Each keystroke's source replaces the last one on the page before its queued render starts.
  const stale = [render("graph TD; A", false, () => false), render("graph TD; A-", false, () => false)];
  const latest = render("graph TD; A-->B", false, () => true);
  await Promise.allSettled(stale);
  await latest;
  assert.deepEqual(calls.map((call) => call.source), ["graph TD; A-->B"]);
  await assert.rejects(Promise.resolve(stale[0]), /superseded/);
  // A skipped source renders normally once a pane shows it again.
  await render("graph TD; A", false, () => true);
  assert.equal(calls.length, 2);
});

test("a shared queued render still runs while any pane showing it wants it", async () => {
  const { api, calls } = fakeMermaid();
  const render = createMermaidRenderer(async () => api);
  const gone = render("graph TD; A-->B", false, () => false);
  const shown = render("graph TD; A-->B", false, () => true);
  assert.equal(gone, shown);
  await shown;
  assert.equal(calls.length, 1);
});
