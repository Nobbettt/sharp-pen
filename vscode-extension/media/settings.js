/* Generated from src/webview/settingsClient.js; do not edit. */
"use strict";
(() => {
  // src/webview/settingsClient.js
  var vscode = acquireVsCodeApi();
  var el = (id) => document.getElementById(id);
  var els = {
    client: el("client"),
    theme: el("theme"),
    model: el("model"),
    models: el("models"),
    saveModel: el("save-model"),
    refreshModels: el("refresh-models"),
    modelProvider: el("model-provider"),
    manualModel: el("manual-model"),
    status: el("status")
  };
  var label = { claude: "Claude Code", codex: "Codex", copilot: "GitHub Copilot", opencode: "OpenCode" };
  var otherModel = "__sharp_pen_other_model__";
  var state;
  var showingManual = false;
  function option(value, text) {
    const item = document.createElement("option");
    item.value = value;
    item.textContent = text;
    return item;
  }
  function render(model) {
    state = model;
    els.client.value = model.aiClient;
    els.theme.value = model.previewTheme;
    const supported = Boolean(model.modelClient);
    els.modelProvider.textContent = supported ? `Model override for ${label[model.modelClient]}.` : "Choose a client, or refresh Auto to resolve one.";
    els.models.replaceChildren(option("", "Use client default"));
    for (const id of model.models) els.models.append(option(id, id));
    if (model.model && !model.models.includes(model.model)) els.models.append(option(model.model, `${model.model} (saved custom model)`));
    els.models.append(option(otherModel, "Other (specify model ID)"));
    els.models.value = showingManual ? otherModel : model.model;
    els.models.disabled = !supported || !model.trusted;
    els.manualModel.hidden = !showingManual;
    els.model.disabled = els.saveModel.disabled = !supported || !model.trusted;
    if (!showingManual) els.model.value = model.model;
    els.refreshModels.disabled = !model.trusted;
    els.status.textContent = model.status || (!model.trusted ? "Model controls require a trusted workspace." : "");
  }
  els.client.addEventListener("change", () => {
    showingManual = false;
    vscode.postMessage({ type: "setClient", client: els.client.value });
  });
  els.theme.addEventListener("change", () => vscode.postMessage({ type: "setTheme", theme: els.theme.value }));
  els.saveModel.addEventListener("click", () => vscode.postMessage({ type: "setModel", model: els.model.value }));
  els.refreshModels.addEventListener("click", () => vscode.postMessage({ type: "refreshModels" }));
  els.models.addEventListener("change", () => {
    if (els.models.value === otherModel) {
      showingManual = true;
      render(state);
      els.model.focus();
      return;
    }
    showingManual = false;
    els.manualModel.hidden = true;
    vscode.postMessage({ type: "setModel", model: els.models.value });
  });
  els.model.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      vscode.postMessage({ type: "setModel", model: els.model.value });
    }
  });
  window.addEventListener("message", (event) => {
    if (event.data?.type !== "state") return;
    const modelSaved = event.data.model.modelSaved;
    if (modelSaved) showingManual = false;
    render(event.data.model);
    if (modelSaved) els.models.focus();
  });
  vscode.postMessage({ type: "ready" });
})();
