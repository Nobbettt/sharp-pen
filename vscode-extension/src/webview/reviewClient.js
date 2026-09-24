import { createMarkdownRenderer } from "./markdownRenderer";
import { cleanTaskMarkers, taskControlsMatch } from "./taskControls";
import { reviewCountStatus } from "./reviewStatus";
import { fenceLanguageOptions } from "./fenceLanguages";
import { cleanFenceIdentityText } from "./fenceIdentity";
import { normalizePreviewZoom, previewZoom } from "./zoom";

const markdown = createMarkdownRenderer();

(() => {
  "use strict";
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const els = {
    analyze: $("analyze"), apply: $("apply"), count: $("count"), main: document.querySelector("main"),
    draft: $("draft"), suggested: $("suggested"), inline: $("inline"), divider: $("split-divider"), levelToggle: $("level-toggle"), viewToggle: $("view-toggle"), choices: $("choices"),
    overflow: $("overflow"), overflowMenu: $("overflow-menu"), error: $("error"), notice: $("notice"), announce: $("announcements"),
    zoomValue: $("zoom-value"), zoomOut: $("zoom-out"), zoomIn: $("zoom-in")
  };
  const saved = vscode.getState() || {};
  const splitStateVersion = 1;
  let level = saved.level === 2 ? 2 : 1;
  let view = saved.view === "inline" ? "inline" : "split";
  let splitPosition = saved.splitStateVersion === splitStateVersion && Number.isFinite(saved.splitPosition) && saved.splitPosition >= 20 && saved.splitPosition <= 80 ? saved.splitPosition : 50;
  let zoom = normalizePreviewZoom(saved.zoom);
  let model = null;
  let menuAnchor = null;
  let markerNamespace = "";
  let taskNamespace = "";
  let fenceNamespace = "";
  let markerIds = [];
  let nextId = null;
  let lastState = null;
  let cancelRequested = false;
  const synchronizedScrollTops = new WeakMap();
  const pendingScrollTops = new Map();
  let synchronizedScrollFrame = 0;
  let sourceScrollTimer = 0;
  let pendingSourceRatio = 0;
  let lastSourceRatio = -1;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const narrowLayout = matchMedia("(max-width: 620px)");
  const send = (message) => vscode.postMessage(message);
  const hasSuggestions = () => all().length > 0;
  const effectiveView = () => !hasSuggestions() || narrowLayout.matches ? "inline" : view;
  const isReadOnly = () => !model || model.state === "analyzing" || model.applying;
  const canToggleTasks = () => Boolean(model?.canToggleTasks) && !isReadOnly();
  const canSetFenceLanguage = () => Boolean(model?.canToggleTasks) && !isReadOnly();
  const validOption = (s) => Number.isInteger(s.decision) && s.decision >= 0 && s.decision < s.options.length;
  const isPending = (s) => !s.decided;
  const sourceText = (s) => model.currentSource.slice(Math.max(0, s.start), Math.max(0, s.end));
  const stagedL1Text = (s) => {
    let text = sourceText(s);
    model.level1.filter((item) => item.start >= s.start && item.end <= s.end && item.status === "active" && validOption(item))
      .sort((a, b) => b.start - a.start)
      .forEach((item) => { text = text.slice(0, item.start - s.start) + item.options[item.decision] + text.slice(item.end - s.start); });
    return text;
  };
  const all = () => model ? [...model.level1, ...model.level2] : [];
  const active = () => all().filter((s) => s.level === level);
  const byId = (id) => all().find((s) => s.id === id);
  const announce = (text) => { els.announce.textContent = ""; requestAnimationFrame(() => { els.announce.textContent = text; }); };

  function persist() { vscode.setState({ level, view, splitPosition, splitStateVersion, zoom }); }
  function setSplitPosition(value, announceChange = false) {
    splitPosition = Math.round(Math.max(20, Math.min(80, value)) * 10) / 10;
    els.main.style.setProperty("--split-position", `${splitPosition}%`);
    els.divider.setAttribute("aria-valuenow", String(splitPosition));
    els.divider.setAttribute("aria-valuetext", `${Math.round(splitPosition)}% draft pane width`);
    if (announceChange) announce(`Draft pane ${Math.round(splitPosition)}%.`);
  }
  function setZoom(value) {
    const next = normalizePreviewZoom(value);
    const panes = [els.draft, els.suggested, els.inline];
    const ratios = panes.map((pane) => {
      const range = pane.scrollHeight - pane.clientHeight;
      return range > 0 ? pane.scrollTop / range : 0;
    });
    zoom = next;
    document.documentElement.style.setProperty("--sp-preview-zoom", `${zoom}%`);
    els.zoomValue.value = `${zoom}%`;
    els.zoomOut.disabled = zoom === previewZoom.minimum;
    els.zoomIn.disabled = zoom === previewZoom.maximum;
    persist();
    requestAnimationFrame(() => panes.forEach((pane, index) => setSynchronizedScroll(pane, Math.max(0, pane.scrollHeight - pane.clientHeight) * ratios[index])));
  }
  const changeZoom = (steps) => setZoom(zoom + steps * previewZoom.step);
  const commitZoom = () => {
    const value = Number.parseFloat(els.zoomValue.value);
    setZoom(Number.isFinite(value) ? value : zoom);
  };
  function closeMenus(restoreFocus = false) {
    const focus = restoreFocus && (!els.choices.hidden || !els.overflowMenu.hidden) ? menuAnchor : null;
    els.choices.hidden = true;
    els.choices.textContent = "";
    els.overflowMenu.hidden = true;
    els.overflow.setAttribute("aria-expanded", "false");
    menuAnchor = null;
    if (focus && document.contains(focus)) focus.focus();
  }
  function position(menu, anchor) {
    const box = anchor.getBoundingClientRect();
    menu.hidden = false;
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(box.left, innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(box.bottom + 4, innerHeight - rect.height - 8))}px`;
  }
  function selectSuggestion(s, option) {
    if (isReadOnly() || s.status !== "active") return;
    nextId = s.id;
    send({ type: "choose", suggestionId: s.id, option });
    announce(option === null ? "Original kept." : "Suggestion accepted.");
    closeMenus(true);
  }
  function openChoices(s, anchor) {
    if (isReadOnly() || s.status !== "active") return;
    closeMenus();
    menuAnchor = anchor;
    const note = document.createElement("div");
    note.className = "choice-note";
    note.textContent = s.note;
    els.choices.append(note);
    [...s.options, null].forEach((option, index) => {
      const decision = index === s.options.length ? null : index;
      const button = document.createElement("button");
      button.type = "button";
      button.role = "menuitemradio";
      button.setAttribute("aria-checked", String(Boolean(s.decided && decision === s.decision)));
      button.textContent = option === null ? "Keep original" : option;
      button.addEventListener("click", () => selectSuggestion(s, decision));
      els.choices.append(button);
      if (index === 0) requestAnimationFrame(() => button.focus());
    });
    position(els.choices, anchor);
  }
  function interact(id, anchor) {
    const s = byId(id);
    if (isReadOnly() || !s || s.status !== "active") return;
    if (s.options.length === 1) selectSuggestion(s, validOption(s) ? null : 0);
    else openChoices(s, anchor);
  }
  function suggestionNode(id, side) {
    const s = byId(id);
    if (!s) return document.createTextNode("");
    if (s.status === "invalidated" && s.start === s.end) return document.createTextNode("");
    const current = s.status === "invalidated" ? sourceText(s) : s.level === 2 && !validOption(s) ? stagedL1Text(s) : sourceText(s);
    const selected = validOption(s);
    const pending = isPending(s);
    const make = (text, className) => {
      const span = document.createElement("span");
      span.className = `suggestion ${className}${s.status === "invalidated" ? " invalidated" : ""}`;
      span.dataset.suggestionId = s.id;
      const interactive = s.status === "active" && !isReadOnly();
      span.tabIndex = interactive ? 0 : -1;
      span.setAttribute("role", "button");
      span.setAttribute("aria-label", s.status === "invalidated" ? `${s.from}; unavailable after source edit` : isReadOnly() ? `${s.from}; review is analyzing` : `${s.note}. ${selected ? "Accepted." : s.decided ? "Original kept." : "Pending."} ${s.options.length > 1 ? "Choose an alternative" : "Toggle suggestion"}`);
      span.setAttribute("aria-disabled", String(!interactive));
      span.textContent = text;
      span.addEventListener("click", (event) => { event.preventDefault(); interact(s.id, span); });
      span.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); interact(s.id, span); }
      });
      span.addEventListener("mouseenter", () => highlight(s.id, true));
      span.addEventListener("mouseleave", () => highlight(s.id, false));
      span.addEventListener("focus", () => { nextId = s.id; highlight(s.id, true); });
      span.addEventListener("blur", () => highlight(s.id, false));
      return span;
    };
    if (side === "inline" && pending && s.status === "active") {
      const pair = document.createElement("span");
      pair.className = "inline-pair";
      pair.append(make(current, "removed"), make(s.options[0], "suggested"));
      return pair;
    }
    if (s.status === "invalidated") return make(current, "invalidated");
    if (selected) return make(s.options[s.decision], "accepted");
    if (s.decided) return make(current, "kept");
    if (side === "suggested") return make(s.options[0], "suggested");
    return make(current, "removed");
  }
  function highlight(id, on) {
    document.querySelectorAll(`[data-suggestion-id="${CSS.escape(id)}"]`).forEach((node) => node.classList.toggle("paired", on));
  }

  function markerPattern() {
    const namespace = markerNamespace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`${namespace}([^\\uE001]+)${namespace}`, "g");
  }
  function taskPattern() {
    const namespace = taskNamespace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`${namespace}(\\d+)${namespace}`, "g");
  }
  function fencePattern() {
    const namespace = fenceNamespace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`${namespace}(\\d+)${namespace}`, "g");
  }
  function token(id) { markerIds.push(id); return `${markerNamespace}${id}${markerNamespace}`; }
  function taskToken(offset) { return `${taskNamespace}${offset}${taskNamespace}`; }
  function fenceToken(index) { return `${fenceNamespace}${index}${fenceNamespace}`; }
  function setMarkerNamespace() {
    const text = [model.currentSource, ...all().flatMap((s) => s.options)].join("\u0000");
    do {
      markerNamespace = `\uE000sharp-pen-${crypto.randomUUID()}\uE001`;
      taskNamespace = `\uE002sharp-pen-task-${crypto.randomUUID()}\uE003`;
      fenceNamespace = `\uE004sharp-pen-fence-${crypto.randomUUID()}\uE005`;
    } while (text.includes(markerNamespace) || text.includes(taskNamespace) || text.includes(fenceNamespace));
  }
  function markerStreamMatches(text) {
    const marker = markerPattern();
    let index = 0, found;
    while ((found = marker.exec(text))) if (found[1] !== markerIds[index++]) return false;
    return index === markerIds.length;
  }
  function l1Parts(start, end, activeLevel) {
    const parts = [];
    let cursor = start;
    const inner = model.level1.filter((s) => s.start >= start && s.end <= end).sort((a, b) => a.start - b.start);
    for (const s of inner) {
      if (s.start < cursor || s.end <= cursor) continue;
      parts.push(sourcePart(cursor, s.start));
      if (activeLevel === 1) parts.push(token(s.id));
      else if (s.status === "active" && validOption(s)) parts.push(s.options[s.decision]);
      else parts.push(sourceText(s));
      cursor = s.end;
    }
    parts.push(sourcePart(cursor, end));
    return parts.join("");
  }
  function sourcePart(start, end) {
    let text = model.currentSource.slice(start, end);
    const inserts = [
      ...model.tasks.filter((item) => item.offset >= start && item.offset + 4 <= end).map((item) => ({ at: item.offset + 4 - start, text: taskToken(item.offset) })),
      ...model.fences.filter((item) => item.insertionOffset >= start && item.insertionOffset <= end).map((item) => ({ at: item.insertionOffset - start, text: ` ${fenceToken(item.index)}` })),
    ].sort((a, b) => b.at - a.at);
    for (const insert of inserts) text = text.slice(0, insert.at) + insert.text + text.slice(insert.at);
    return text;
  }
  function displaySource(activeLevel) {
    if (!model) return "";
    markerIds = [];
    // Front matter never carries a suggestion, task, or fence, so dropping it here (see R5-05) can't
    // strand a marker; VS Code's own preview hides it too.
    let out = "", cursor = model.frontMatterEnd || 0;
    const l2 = model.level2.slice().sort((a, b) => a.start - b.start);
    for (const s of l2) {
      if (s.start < cursor || s.end <= cursor) continue;
      out += l1Parts(cursor, s.start, activeLevel);
      if (activeLevel === 2) out += token(s.id);
      else if (s.status === "active" && validOption(s)) out += s.options[s.decision];
      else out += l1Parts(s.start, s.end, activeLevel);
      cursor = s.end;
    }
    return out + l1Parts(cursor, model.currentSource.length, activeLevel);
  }
  function replaceMarkers(container, side) {
    const marker = markerPattern();
    const knownMarkerIds = new Set(markerIds);
    const textNodes = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    let foundCount = 0;
    for (const node of textNodes) {
      let last = 0, found, changed = false;
      const fragment = document.createDocumentFragment();
      marker.lastIndex = 0;
      while ((found = marker.exec(node.data))) {
        changed = true;
        fragment.append(document.createTextNode(node.data.slice(last, found.index)));
        if (knownMarkerIds.has(found[1]) && found[1] === markerIds[foundCount] && byId(found[1])) {
          fragment.append(suggestionNode(found[1], side));
          foundCount++;
        } else return false;
        last = marker.lastIndex;
      }
      if (changed) { fragment.append(document.createTextNode(node.data.slice(last))); node.replaceWith(fragment); }
    }
    return foundCount === markerIds.length;
  }
  function renderMarkdown(container, source, side) {
    container.innerHTML = markdown.render(source);
    if (!replaceMarkers(container, side)) {
      container.textContent = cleanFenceText(cleanTaskMarkers(source, taskPattern()));
      replaceMarkers(container, side);
    }
    cleanFenceMarkers(container);
    attachTaskControls(container);
    attachFenceControls(container);
  }
  function attachFenceControls(container) {
    const fences = [...container.querySelectorAll("pre[data-sharp-pen-fence-index]")];
    if (fences.length !== model.fences.length) return;
    for (const pre of fences) {
      const index = Number(pre.dataset.sharpPenFenceIndex);
      const fence = model.fences.find((item) => item.index === index);
      if (!fence || pre.dataset.sharpPenFenceIdentity !== fenceToken(index)
        || String(pre.dataset.sharpPenFenceLanguage || "").toLowerCase() !== fence.language.toLowerCase()) return;
    }
    for (const pre of fences) {
      const index = Number(pre.dataset.sharpPenFenceIndex);
      const fence = model.fences.find((item) => item.index === index);
      if (!fence) return;
      const select = document.createElement("select");
      select.className = "fence-language";
      select.dataset.fenceIndex = String(index);
      select.dataset.fencePane = container.id;
      for (const item of fenceLanguageOptions(fence.language, model.codeFenceLanguages)) {
        const option = document.createElement("option");
        option.value = item.language;
        option.textContent = item.label;
        option.selected = item.selected;
        option.disabled = item.disabled;
        select.append(option);
      }
      select.disabled = !canSetFenceLanguage();
      select.setAttribute("aria-label", `Code block ${index + 1} language`);
      select.addEventListener("change", () => {
        if (!canSetFenceLanguage()) { select.value = fence.language; return; }
        send({ type: "setCodeFenceLanguage", fenceIndex: index, languageId: select.value, documentVersion: model.documentVersion });
      });
      pre.classList.add("fenced-code");
      pre.append(select);
    }
  }
  function cleanFenceText(text) { return cleanFenceIdentityText(text, fencePattern()); }
  function cleanFenceMarkers(container) {
    const nodes = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) node.data = cleanFenceText(node.data);
  }
  function attachTaskControls(container) {
    const inputs = [...container.querySelectorAll("input.task-list-item-checkbox")];
    const mapped = new Map();
    let valid = true;
    const nodes = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const marker = taskPattern();
      let found;
      while ((found = marker.exec(node.data))) {
        const task = model.tasks.find((item) => item.offset === Number(found[1]));
        const input = node.parentElement?.closest("li.task-list-item")?.querySelector("input.task-list-item-checkbox");
        if (!task || !input || mapped.has(task?.offset)) valid = false;
        else mapped.set(task.offset, { task, input });
      }
      node.data = cleanTaskMarkers(node.data, marker);
    }
    // Every rendered control must carry an unmodified source marker; injected tasks/fences fail closed.
    if (!taskControlsMatch(model.tasks.length, mapped.size, inputs.length, valid)) return;
    for (const { task, input } of mapped.values()) {
      if (input.checked !== task.checked) return;
      input.dataset.taskOffset = String(task.offset);
      input.dataset.taskPane = container.id;
      input.disabled = !canToggleTasks();
      input.tabIndex = canToggleTasks() ? 0 : -1;
      input.setAttribute("aria-label", `${input.checked ? "Mark incomplete" : "Mark complete"}: ${task.label || "task"}`);
      input.addEventListener("change", () => {
        if (!canToggleTasks()) { input.checked = task.checked; return; }
        send({ type: "toggleTask", offset: task.offset, checked: input.checked, documentVersion: model.documentVersion });
      });
    }
  }
  function renderDocument(container, source, side) {
    if (model.format === "plaintext") {
      container.classList.add("plain");
      container.replaceChildren();
      container.textContent = source;
      replaceMarkers(container, side);
    } else {
      container.classList.remove("plain");
      renderMarkdown(container, source, side);
    }
  }
  function updateViewControls() {
    const showToggles = hasSuggestions();
    els.levelToggle.hidden = !showToggles;
    els.viewToggle.hidden = !showToggles;
    if (els.viewToggle.hidden) return;
    const activeView = effectiveView();
    document.querySelectorAll("[data-view]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.view === activeView));
      if (button.dataset.view === "split") button.disabled = narrowLayout.matches;
    });
  }
  function updateControls() {
    const hasReview = Boolean(model.hasReview);
    const suggestions = active();
    const accepted = suggestions.filter((s) => s.status === "active" && validOption(s)).length;
    const total = suggestions.filter((s) => s.status === "active").length;
    const hasPending = suggestions.some((s) => s.status === "active" && isPending(s));
    const count = reviewCountStatus(model.state, level, all().length, accepted, total);
    els.count.value = count.text;
    els.count.textContent = count.text;
    els.count.setAttribute("aria-label", count.label);
    const analyzing = model.state === "analyzing";
    const busy = analyzing || model.applying;
    $("next").hidden = !hasReview;
    $("accept-all").hidden = !hasReview;
    els.apply.hidden = !hasReview;
    els.overflowMenu.querySelector("[data-action='next']").hidden = !hasReview;
    els.overflowMenu.querySelector("[data-action='accept-all']").hidden = !hasReview;
    els.analyze.textContent = model.applying ? "Applying…" : (analyzing ? "Cancel" : (model.state === "modified" ? "Re-analyze" : "Analyze"));
    els.analyze.disabled = model.applying || (analyzing ? false : !model.canAnalyze);
    const nextDisabled = busy || !hasPending;
    $("next").disabled = nextDisabled;
    $("accept-all").disabled = nextDisabled;
    els.overflowMenu.querySelector("[data-action='next']").disabled = nextDisabled;
    els.overflowMenu.querySelector("[data-action='accept-all']").disabled = nextDisabled;
    els.apply.disabled = busy || !all().some((s) => s.status === "active" && validOption(s));
    els.overflow.disabled = busy;
    els.overflowMenu.querySelectorAll("[data-reset]").forEach((button) => { button.hidden = !hasReview; button.disabled = !hasReview || busy; });
    document.querySelectorAll("[data-level]").forEach((button) => button.setAttribute("aria-pressed", String(Number(button.dataset.level) === level)));
    updateViewControls();
  }
  function renderError() {
    const error = model.error;
    els.error.hidden = !error;
    if (!error) return;
    els.error.querySelector("span").textContent = error.message;
    const action = els.error.querySelector("button");
    action.hidden = !error.action;
    action.textContent = error.action === "openSettings" ? "Settings" : "Retry";
    action.onclick = () => send({ type: error.action });
  }
  function renderNotice() {
    els.notice.hidden = !model.notice;
    if (model.notice) els.notice.querySelector("span").textContent = model.notice;
  }
  function render() {
    if (!model) return;
    document.documentElement.dataset.previewTheme = ["light", "dark", "auto"].includes(model.previewTheme) ? model.previewTheme : "light";
    document.title = `${model.title} — sharp-pen`;
    let source;
    do { setMarkerNamespace(); source = displaySource(level); } while (!markerStreamMatches(source));
    els.main.className = effectiveView();
    setSplitPosition(splitPosition);
    renderDocument(els.draft, source, "draft");
    renderDocument(els.suggested, source, "suggested");
    renderDocument(els.inline, source, "inline");
    renderError(); renderNotice(); updateControls(); persist();
  }
  function focusedSuggestionId() {
    const focused = document.activeElement;
    return focused && focused.dataset ? focused.dataset.suggestionId : menuAnchor && menuAnchor.dataset.suggestionId;
  }
  function focusedTask() {
    const focused = document.activeElement;
    return focused?.dataset?.taskPane && /^\d+$/.test(focused.dataset.taskOffset || "")
      ? { pane: focused.dataset.taskPane, offset: focused.dataset.taskOffset } : null;
  }
  function focusedFence() {
    const focused = document.activeElement;
    return focused?.dataset?.fencePane && /^\d+$/.test(focused.dataset.fenceIndex || "")
      ? { pane: focused.dataset.fencePane, index: focused.dataset.fenceIndex } : null;
  }
  function suggestionPane() {
    return effectiveView() === "inline" ? els.inline : els.draft;
  }
  function restoreSuggestionFocus(id) {
    const pane = suggestionPane();
    requestAnimationFrame(() => {
      const target = pane.querySelector(`[data-suggestion-id="${CSS.escape(id)}"]`);
      if (target) target.focus({ preventScroll: true });
    });
  }
  function restoreTaskFocus(task) {
    requestAnimationFrame(() => {
      const target = document.getElementById(task.pane)?.querySelector(`input[data-task-offset="${task.offset}"]`);
      if (target && !target.disabled) target.focus({ preventScroll: true });
    });
  }
  function restoreFenceFocus(fence) {
    requestAnimationFrame(() => {
      const target = document.getElementById(fence.pane)?.querySelector(`select[data-fence-index="${fence.index}"]`);
      if (target && !target.disabled) target.focus({ preventScroll: true });
    });
  }
  function next() {
    const ordered = active().filter((s) => s.status === "active").sort((a, b) => a.start - b.start);
    const focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.suggestionId : null;
    const current = focused || nextId;
    const currentIndex = ordered.findIndex((s) => s.id === current);
    let suggestion;
    for (let offset = 1; offset <= ordered.length; offset++) {
      const candidate = ordered[(Math.max(currentIndex, -1) + offset) % ordered.length];
      if (isPending(candidate)) { suggestion = candidate; break; }
    }
    if (!suggestion) return;
    const target = suggestionPane().querySelector(`[data-suggestion-id="${CSS.escape(suggestion.id)}"]`);
    nextId = suggestion.id;
    if (target) { target.scrollIntoView({ block: "center", behavior: reducedMotion.matches ? "auto" : "smooth" }); target.focus(); }
    announce(suggestion.note);
  }

  function syncScroll(from, to) {
    if (effectiveView() !== "split") return;
    const fromRange = from.scrollHeight - from.clientHeight;
    const toRange = to.scrollHeight - to.clientHeight;
    if (fromRange <= 0 || toRange <= 0) return;
    setSynchronizedScroll(to, toRange * from.scrollTop / fromRange);
  }
  function syncSourceScroll(from) {
    const range = from.scrollHeight - from.clientHeight;
    pendingSourceRatio = range > 0 ? from.scrollTop / range : 0;
    if (sourceScrollTimer) return;
    sourceScrollTimer = setTimeout(() => {
      sourceScrollTimer = 0;
      const ratio = Math.max(0, Math.min(1, pendingSourceRatio));
      if (Math.abs(ratio - lastSourceRatio) < .001) return;
      lastSourceRatio = ratio;
      send({ type: "scrollSource", ratio });
    }, 50);
  }
  function previewScrolled(from, other) {
    const expected = synchronizedScrollTops.get(from);
    synchronizedScrollTops.delete(from);
    if (expected !== undefined && Math.abs(from.scrollTop - expected) < 1) return;
    syncSourceScroll(from);
    if (other) syncScroll(from, other);
  }
  function setSynchronizedScroll(pane, top) {
    pendingScrollTops.set(pane, top);
    if (synchronizedScrollFrame) return;
    synchronizedScrollFrame = requestAnimationFrame(() => {
      synchronizedScrollFrame = 0;
      for (const [target, targetTop] of pendingScrollTops) {
        pendingScrollTops.delete(target);
        if (Math.abs(target.scrollTop - targetTop) < 1) continue;
        synchronizedScrollTops.set(target, targetTop);
        target.scrollTop = targetTop;
      }
    });
  }
  function scrollPreview(ratio) {
    for (const pane of [els.draft, els.suggested, els.inline]) {
      setSynchronizedScroll(pane, Math.max(0, pane.scrollHeight - pane.clientHeight) * ratio);
    }
  }
  els.draft.addEventListener("scroll", () => previewScrolled(els.draft, els.suggested));
  els.suggested.addEventListener("scroll", () => previewScrolled(els.suggested, els.draft));
  els.inline.addEventListener("scroll", () => previewScrolled(els.inline));

  els.zoomOut.addEventListener("click", () => changeZoom(-1));
  els.zoomIn.addEventListener("click", () => changeZoom(1));
  els.zoomValue.addEventListener("focus", () => els.zoomValue.select());
  els.zoomValue.addEventListener("blur", commitZoom);
  els.zoomValue.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); commitZoom(); els.zoomValue.blur(); }
    else if (event.key === "Escape") { event.preventDefault(); els.zoomValue.value = `${zoom}%`; els.zoomValue.blur(); }
  });
  let wheelZoom = 0;
  window.addEventListener("wheel", (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    wheelZoom += event.deltaY;
    if (Math.abs(wheelZoom) < 20) return;
    changeZoom(wheelZoom < 0 ? 1 : -1);
    wheelZoom = 0;
  }, { passive: false });
  // Ctrl/Cmd +/-/0 are handled by contributed VS Code keybindings (see package.json), not a webview
  // keydown listener: the webview host forwards every trusted keydown to the workbench regardless of
  // preventDefault, so a local handler here would also fire VS Code's own window-zoom/sidebar-focus commands.

  let dragPointerId = null;
  let finishingDrag = false;
  const isActiveSplitDrag = (dragId, pointerId, buttons) => dragId === pointerId && Boolean(buttons & 1);
  const setSplitPositionFromPointer = (clientX) => {
    const box = els.main.getBoundingClientRect();
    if (box.width) setSplitPosition((clientX - box.left) * 100 / box.width);
  };
  const finishDrag = (pointerId = dragPointerId) => {
    if (dragPointerId === null || pointerId !== dragPointerId || finishingDrag) return;
    finishingDrag = true;
    try {
      if (els.divider.hasPointerCapture(pointerId)) els.divider.releasePointerCapture(pointerId);
    } finally {
      dragPointerId = null;
      els.divider.classList.remove("dragging");
      finishingDrag = false;
      persist();
    }
  };
  els.divider.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    finishDrag();
    event.preventDefault();
    dragPointerId = event.pointerId;
    els.divider.setPointerCapture(event.pointerId);
    els.divider.classList.add("dragging");
    setSplitPositionFromPointer(event.clientX);
  });
  els.divider.addEventListener("pointermove", (event) => {
    if (event.pointerId !== dragPointerId) return;
    if (!isActiveSplitDrag(dragPointerId, event.pointerId, event.buttons)) return finishDrag(event.pointerId);
    setSplitPositionFromPointer(event.clientX);
  });
  els.divider.addEventListener("pointerup", (event) => {
    finishDrag(event.pointerId);
  });
  els.divider.addEventListener("pointercancel", (event) => finishDrag(event.pointerId));
  els.divider.addEventListener("lostpointercapture", (event) => finishDrag(event.pointerId));
  window.addEventListener("blur", () => finishDrag());
  els.divider.addEventListener("dblclick", () => { setSplitPosition(50, true); persist(); });
  els.divider.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 10 : 1;
    const target = event.key === "ArrowLeft" ? splitPosition - step : event.key === "ArrowRight" ? splitPosition + step : event.key === "Home" ? 20 : event.key === "End" ? 80 : null;
    if (target === null) return;
    event.preventDefault();
    setSplitPosition(target, true);
    persist();
  });

  els.analyze.addEventListener("click", () => {
    if (!model || model.applying) return;
    cancelRequested = model.state === "analyzing";
    send({ type: cancelRequested ? "cancel" : "analyze" });
  });
  els.apply.addEventListener("click", () => { if (!isReadOnly()) send({ type: "apply" }); });
  $("next").addEventListener("click", next);
  $("accept-all").addEventListener("click", () => { if (!isReadOnly()) send({ type: "acceptAll", level }); });
  $("settings").addEventListener("click", () => send({ type: "openSettings" }));
  document.querySelectorAll("[data-level]").forEach((button) => button.addEventListener("click", () => { level = Number(button.dataset.level); closeMenus(); render(); }));
  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => { if (button.dataset.view === "split" && narrowLayout.matches) return; view = button.dataset.view; closeMenus(); render(); }));
  narrowLayout.addEventListener("change", () => {
    if (model) render();
    else {
      els.main.className = effectiveView();
      updateViewControls();
    }
  });
  setSplitPosition(splitPosition);
  setZoom(zoom);
  updateViewControls();
  els.overflow.addEventListener("click", () => {
    const open = els.overflowMenu.hidden;
    closeMenus();
    if (open) {
      menuAnchor = els.overflow;
      position(els.overflowMenu, els.overflow);
      els.overflow.setAttribute("aria-expanded", "true");
      const first = [...els.overflowMenu.querySelectorAll("button")].find((button) => !button.disabled && button.getClientRects().length);
      if (first) first.focus();
    }
  });
  els.overflowMenu.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]");
    if (action) {
      closeMenus();
      if (action.dataset.action === "next") next();
      else if (action.dataset.action === "accept-all" && !isReadOnly()) send({ type: "acceptAll", level });
      else send({ type: "openSettings" });
      return;
    }
    const reset = event.target.closest("[data-reset]");
    if (!reset) return;
    if (isReadOnly()) return;
    if (reset.dataset.reset === "all") { send({ type: "reset", level: 1 }); send({ type: "reset", level: 2 }); }
    else send({ type: "reset", level });
    closeMenus(true);
  });
  document.addEventListener("click", (event) => { if (!event.target.closest(".menu, .overflow-wrap, .suggestion")) closeMenus(); });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && (!els.choices.hidden || !els.overflowMenu.hidden)) { closeMenus(true); return; }
    const menu = !els.choices.hidden ? els.choices : !els.overflowMenu.hidden ? els.overflowMenu : null;
    if (menu && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const choices = [...menu.querySelectorAll("button")].filter((button) => !button.disabled && button.getClientRects().length), at = choices.indexOf(document.activeElement);
      if (!choices.length) return;
      const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1 : (at + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length;
      choices[at < 0 ? 0 : nextIndex].focus();
    }
  });
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message?.type === "sourceScroll" && Number.isFinite(message.ratio) && message.ratio >= 0 && message.ratio <= 1) {
      scrollPreview(message.ratio);
      return;
    }
    if (message?.type === "zoom") {
      if (message.command === "reset") setZoom(previewZoom.default);
      else changeZoom(message.command === "out" ? -1 : 1);
      return;
    }
    if (!message || message.type !== "state" || !message.model) return;
    const focusId = focusedSuggestionId();
    const taskFocus = focusedTask();
    const fenceFocus = focusedFence();
    model = message.model;
    const completedAnalysis = lastState === "analyzing" && model.state === "ready" && hasSuggestions() && !model.error && !cancelRequested;
    if (completedAnalysis) { view = "inline"; splitPosition = 50; persist(); }
    if (model.state !== "analyzing") cancelRequested = false;
    closeMenus(); render();
    if (focusId) restoreSuggestionFocus(focusId);
    else if (taskFocus) restoreTaskFocus(taskFocus);
    else if (fenceFocus) restoreFenceFocus(fenceFocus);
    if (model.state === "applied" && lastState !== "applied") announce("Review applied.");
    lastState = model.state;
  });
  send({ type: "ready" });
})();
