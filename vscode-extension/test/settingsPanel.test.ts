import assert from "node:assert/strict";
import test from "node:test";

const Module = require("node:module") as { _load: (...args: any[]) => unknown };
const load = Module._load;
let trusted = true;
const posted: any[] = [];
const selectedClients: string[] = [];
const discoveredClients: string[] = [];
let selectAdapterImpl: (client: string, signal?: AbortSignal) => Promise<{ id: string }> = async (client) => { selectedClients.push(client); return { id: client === "auto" ? "codex" : client }; };
const disposable = { dispose() {} };
let disposed: () => void = () => {};
const vscode = {
  ViewColumn: { Active: 1 },
  Uri: { joinPath: (...parts: string[]) => parts.join("/") },
  workspace: { get isTrusted() { return trusted; } },
  window: {
    createWebviewPanel: () => ({
      webview: {
        html: "", cspSource: "csp", asWebviewUri: () => "asset",
        onDidReceiveMessage: () => disposable,
        postMessage: (message: unknown) => { posted.push(message); return Promise.resolve(true); },
      },
      onDidDispose: (listener: () => void) => { disposed = listener; return disposable; },
      reveal() {}, dispose() { disposed(); },
    }),
  },
};
Module._load = (request: string, ...args: any[]) => {
  if (request === "vscode") return vscode;
  if (request === "./ai/adapters") return { selectAdapter: (client: string, signal?: AbortSignal) => selectAdapterImpl(client, signal) };
  return load(request, ...args);
};
const { SettingsPanel } = require("../src/settingsPanel") as typeof import("../src/settingsPanel");
const { SettingsStore } = require("../src/config") as typeof import("../src/config");
const { ModelDiscovery } = require("../src/ai/modelDiscovery") as typeof import("../src/ai/modelDiscovery");
Module._load = load;

function panel(client = "auto", rejectDiscovery = false) {
  posted.length = 0;
  selectedClients.length = 0;
  discoveredClients.length = 0;
  selectAdapterImpl = async (client: string) => { selectedClients.push(client); return { id: client === "auto" ? "codex" : client }; };
  trusted = true;
  const values = new Map<string, unknown>([["sharpPen.settings.aiClient", client]]);
  let themeUpdates = 0;
  const settings = new SettingsStore({ get: <T>(key: string) => values.get(key) as T | undefined, update: async (key, value) => { values.set(key, value); } });
  const active = new SettingsPanel("extension" as any, settings, new ModelDiscovery(async (id) => {
    discoveredClients.push(id);
    if (rejectDiscovery) throw new Error("Model listing failed.");
    return [`${id}-model`];
  }), () => { themeUpdates += 1; }, () => {});
  return { active, settings, themeUpdates: () => themeUpdates };
}

test("settings panel posts safe state and updates theme and provider-scoped manual model", async () => {
  const current = panel();
  try {
    await (current.active as any).receive({ type: "ready" });
    assert.equal(posted.at(-1).model.previewTheme, "light");
    assert.deepEqual(selectedClients, ["auto"]);
    assert.deepEqual(discoveredClients, ["codex"]);
    await (current.active as any).receive({ type: "setClient", client: "codex" });
    assert.deepEqual(selectedClients, ["auto", "codex"]);
    await (current.active as any).receive({ type: "setModel", model: "gpt-5" });
    await (current.active as any).receive({ type: "setTheme", theme: "dark" });
    assert.equal(current.settings.getModel("codex"), "gpt-5");
    assert.equal(current.settings.getModel("claude"), "");
    assert.equal(current.settings.getConfig().previewTheme, "dark");
    assert.equal(current.themeUpdates(), 1);
  } finally {
    current.active.dispose();
  }
});

test("settings panel keeps model changes behind workspace trust", async () => {
  const current = panel();
  try {
    trusted = false;
    await (current.active as any).receive({ type: "ready" });
    assert.deepEqual(selectedClients, []);
    assert.deepEqual(discoveredClients, []);
    await (current.active as any).receive({ type: "setClient", client: "codex" });
    await (current.active as any).receive({ type: "setModel", model: "gpt-5" });
    assert.equal(current.settings.getModel("codex"), "");
    assert.match(posted.at(-1).model.status, /Trust this workspace/);
  } finally {
    current.active.dispose();
  }
});

test("OpenCode probes and discovers models from the settings panel", async () => {
  const current = panel("opencode");
  try {
    await (current.active as any).receive({ type: "ready" });
    assert.deepEqual(selectedClients, ["opencode"]);
    assert.deepEqual(discoveredClients, ["opencode"]);
    assert.equal(posted.at(-1).model.model, "");
    assert.match(posted.at(-1).model.status, /Found 1 model/);
  } finally {
    current.active.dispose();
  }
});

test("Auto keeps its resolved provider when model listing fails", async () => {
  const current = panel("auto", true);
  try {
    await (current.active as any).receive({ type: "ready" });
    const model = posted.at(-1).model;
    assert.equal(model.modelClient, "codex");
    assert.deepEqual(model.models, []);
    assert.equal(model.status, "Model discovery failed. Try refreshing or choose a model ID.");
    await (current.active as any).receive({ type: "setModel", model: "saved-custom" });
    assert.equal(current.settings.getModel("codex"), "saved-custom");
  } finally {
    current.active.dispose();
  }
});

test("changing the client immediately aborts an active model refresh", async () => {
  const current = panel();
  try {
    const abort = new AbortController();
    (current.active as any).refreshAbort = abort;
    await (current.active as any).receive({ type: "setClient", client: "codex" });
    assert.equal(abort.signal.aborted, true);
  } finally {
    current.active.dispose();
  }
});

test("a stale refresh cannot overwrite OpenCode discovery", async () => {
  const current = panel();
  let resolveAdapter!: () => void;
  selectAdapterImpl = async (client: string) => {
    selectedClients.push(client);
    if (client === "auto") {
      await new Promise<void>((resolve) => { resolveAdapter = resolve; });
      return { id: "codex" };
    }
    return { id: client };
  };
  try {
    const refresh = (current.active as any).receive({ type: "ready" });
    await new Promise((resolve) => setImmediate(resolve));
    await (current.active as any).receive({ type: "setClient", client: "opencode" });
    resolveAdapter();
    await refresh;
    assert.deepEqual(discoveredClients, ["opencode"]);
    assert.equal(posted.at(-1).model.modelClient, "opencode");
  } finally {
    current.active.dispose();
  }
});

test("out-of-order client persistence restores and settles the latest client", async () => {
  posted.length = 0;
  const values = new Map<string, unknown>([["sharpPen.settings.aiClient", "auto"]]);
  const pending: { client: string; resolve: () => void }[] = [];
  const settings = new SettingsStore({
    get: <T>(key: string) => values.get(key) as T | undefined,
    update: async (key, value) => {
      if (key !== "sharpPen.settings.aiClient") { values.set(key, value); return; }
      await new Promise<void>((resolve) => pending.push({ client: String(value), resolve: () => { values.set(key, value); resolve(); } }));
    },
  });
  const active = new SettingsPanel("extension" as any, settings, new ModelDiscovery(async (id) => {
    discoveredClients.push(id); return [];
  }), () => {}, () => {});
  try {
    const first = (active as any).receive({ type: "setClient", client: "codex" });
    const second = (active as any).receive({ type: "setClient", client: "opencode" });
    assert.deepEqual(pending.map((item) => item.client), ["codex", "opencode"]);
    pending[1].resolve();
    await second;
    pending[0].resolve();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(pending.map((item) => item.client), ["codex", "opencode", "opencode"]);
    pending[2].resolve();
    await first;
    assert.equal(posted.at(-1).model.aiClient, "opencode");
    assert.match(posted.at(-1).model.status, /No models found/);
    assert.deepEqual(discoveredClients, ["opencode", "opencode", "opencode"]);
  } finally {
    active.dispose();
  }
});

test("sync ignores a late standalone model result for a different client", async () => {
  const current = panel("codex");
  try {
    await (current.active as any).receive({ type: "ready" });
    (current.active as any).sync("claude");
    assert.equal(posted.at(-1).model.modelClient, "codex");
  } finally {
    current.active.dispose();
  }
});

test("settings storage failures become generic panel state", async () => {
  const current = panel();
  try {
    (current.settings as any).setPreviewTheme = async () => { throw new Error("secret provider detail"); };
    await (current.active as any).receive({ type: "setTheme", theme: "dark" });
    assert.equal(posted.at(-1).model.status, "Settings update failed. Try again.");
  } finally {
    current.active.dispose();
  }
});

test("a rejected latest client save rolls back and permits later refresh", async () => {
  const current = panel();
  try {
    (current.settings as any).setClient = async () => { throw new Error("storage detail"); };
    await (current.active as any).receive({ type: "setClient", client: "codex" });
    assert.equal((current.active as any).requestedClient, "auto");
    assert.equal(posted.at(-1).model.status, "Settings update failed. Try again.");
    await (current.active as any).receive({ type: "refreshModels" });
    assert.deepEqual(selectedClients, ["auto"]);
  } finally {
    current.active.dispose();
  }
});

test("a re-sent ready (the webview reloading on every re-show) reuses the cache instead of re-probing", async () => {
  const current = panel();
  try {
    await (current.active as any).receive({ type: "ready" });
    assert.deepEqual(selectedClients, ["auto"]);
    assert.deepEqual(discoveredClients, ["codex"]);
    await (current.active as any).receive({ type: "ready" });
    // still one probe and one discovery: the second "ready" read the cache instead of re-probing
    assert.deepEqual(selectedClients, ["auto"]);
    assert.deepEqual(discoveredClients, ["codex"]);
    await (current.active as any).receive({ type: "refreshModels" });
    assert.deepEqual(selectedClients, ["auto", "auto"]); // an explicit refresh still bypasses the cache
    assert.deepEqual(discoveredClients, ["codex", "codex"]);
  } finally {
    current.active.dispose();
  }
});

test("granting workspace trust refreshes an open settings panel", async () => {
  const current = panel();
  trusted = false;
  try {
    await (current.active as any).receive({ type: "ready" });
    trusted = true;
    current.active.onWorkspaceTrustGranted();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(selectedClients, ["auto"]);
    assert.deepEqual(discoveredClients, ["codex"]);
  } finally {
    trusted = true;
    current.active.dispose();
  }
});
