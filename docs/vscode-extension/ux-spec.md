# UX specification

Status: draft 0.1

## 1. Entry points

- Markdown and plain-text editor title action: pen icon, **Open Sharp Pen Review**
  tooltip.
- Markdown and plain-text editor context menu: **Sharp Pen: Open Review**.
- Command Palette: **Sharp Pen: Open Review**.

The review opens in a column beside the active source editor. Reinvoking the
command reveals the existing review for that document.

## 2. Review layout

```text
+--------------------------------------------------------------------------+
| Analyze   L1 | L2   [split][inline]   3/13   Next   Accept all   Apply  ⚙ |
+--------------------------------------------------------------------------+
|                                                                          |
|  Split view                         Inline view                           |
|  +---------------------------+      +---------------------------------+   |
|  | Current staged draft      |      | rendered Markdown with          |   |
|  |                           |      | deletion + insertion pairs      |   |
|  +---------------------------+      +---------------------------------+   |
|  | Suggested result          |                                            |
|  |                           |                                            |
|  +---------------------------+                                            |
+--------------------------------------------------------------------------+
```

Only one of the split and inline bodies is visible at a time.

The toolbar contains no persistent instructions, level descriptions, or prose
such as “13 still open.” A compact `accepted/total` count is allowed. Native
tooltips and accessible names explain controls on demand.

## 3. Toolbar

Left to right:

1. **Analyze**; while running it becomes **Cancel** and shows native notification
   progress.
2. Segmented **L1 / L2** selector.
3. Icon-only segmented **Split / Inline** selector.
4. Compact accepted count, for example `3/13`.
5. **Next**.
6. **Accept all** for the active level.
7. **Apply**, disabled until at least one currently valid choice is accepted.
8. Icon-only settings button that opens Sharp Pen's custom looping Quick Pick.

Reset is placed in a small overflow menu with **Reset current level** and
**Reset all**. This keeps the primary toolbar narrow.

On narrow panels, secondary actions move into the overflow menu before controls
wrap. Analyze, level, view, count, and Apply remain visible.

## 4. Suggestion appearance and behavior

### Split

- Top/left pane: rendered current staged draft. Pending original spans use the
  theme's removed-text treatment.
- Bottom/right pane: rendered suggested result. Pending default replacements use
  the theme's inserted-text treatment.
- The exact orientation follows available width: columns when wide, stacked panes
  when narrow.
- Scrolling is proportionally synchronized, with manual scrolling always allowed.

### Inline

- Pending suggestions show original text struck through followed by the default
  insertion.
- Accepted suggestions show only the chosen text with a neutral accepted marker.
- Kept suggestions show ordinary original text.

### Interaction

- Hovering or focusing either side highlights its pair.
- A one-option suggestion toggles between default option and Keep original.
- A multi-option suggestion opens an anchored menu containing:
  - the short note;
  - each alternative;
  - Keep original.
- Accept all selects option zero only for pending suggestions in the active level;
  it preserves explicit Keep original and chosen alternative decisions.
- Menus support arrow keys, Enter/Space, Escape, and focus restoration.
- Next moves to the next pending item and announces its note to assistive
  technology without adding persistent page text.

## 5. Document preview behavior

- Default display is rendered Markdown.
- The source editor beside the panel is the raw Markdown view; the webview does
  not duplicate a source/rendered toggle in version 1.
- Formatting outside replacement spans remains unchanged.
- Raw HTML is displayed safely, not executed.
- Fenced code, inline code, front matter, link destinations, and other excluded
  regions are rendered but never highlighted as suggestions.
- Links do not navigate the webview unexpectedly. External navigation requires an
  explicit user action and opens through VS Code.
- Plain text is escaped and displayed with line breaks and whitespace preserved;
  Markdown syntax has no special meaning in `plaintext` mode.

## 6. Theme behavior

Preview Theme defaults to Light, including when VS Code is dark.
Dark uses Sharp Pen's dark palette. Auto follows VS Code's colors and high-contrast
classes. Insertions and deletions remain distinguishable by both color and text decoration.

## 7. Settings experience

The preview cog opens Sharp Pen's custom looping Quick Pick. The lone native VS
Code Settings row is only a static command-link launcher and opens that same menu.

Visible settings:

| Setting | Control | Default | Notes |
|---|---|---|---|
| AI client | Quick Pick | Auto | Claude, Codex, Copilot; OpenCode is visible but unavailable |
| Model | Quick Pick + manual ID | Client default | Saved separately for each provider |
| Preview theme | Quick Pick | Light | Light, Dark, or Auto (follow VS Code) |

VS Code does not support runtime-populated dropdown values in its native Settings
editor. Operational settings therefore live in extension global state, and both the custom menu
and **Sharp Pen: Select Model…** use the same native Quick Pick:

1. Show the effective AI client.
2. Ask that client's CLI for models when it exposes a supported discovery command
   or protocol.
3. Show the returned models, **Use client default**, **Enter model ID…**, and
   **Refresh models**.
4. Save the choice under that provider's global-state key.

Codex supplies a structured live model list. Claude Code and Copilot currently
fall back to defaults, stable aliases/recent
values, and manual model ID because their account-aware lists are interactive-only.
If discovery fails, the picker keeps the current value and offers retry/manual
entry; it does not silently change models.

No prompt text, API key, executable path, arbitrary arguments, temperature, token
limit, or provider-specific tuning appears in version 1 settings.

## 8. States

### Empty

The panel shows the rendered Markdown or escaped plain text without highlights.
Analyze is the primary action. There is no instructional paragraph.

### Analyzing

The current valid review remains visible but read-only if one exists. Analyze
becomes Cancel. Native cancellable notification progress shows the selected client
and model.

### Ready

Suggestions and actions are interactive. Apply is disabled until at least one
suggestion is accepted. Analyze may be disabled when the review exactly matches the
current document to avoid a redundant run.

### Document edited

Unaffected suggestions remain interactive and keep their decisions. Suggestions
whose source ranges were edited are marked unavailable and lose any staged
decision. Apply remains available when at least one valid choice is accepted.
Analyze is enabled again and may be labelled **Re-analyze**; no persistent warning
paragraph is added.

### Error

A compact error strip names the failure and one next action, such as **Open
settings**, **Retry**, or **Select client**. Raw CLI output is never rendered.

### Applied

The panel shows a brief **Applied** status and no longer offers the old suggestions.
The author can use VS Code Undo or Analyze again.

## 9. Confirmation behavior

- Individual choices and Accept all require no confirmation because they are
  staged and reversible before Apply.
- Apply requires no modal confirmation because it is one VS Code undo step.
- Reset requires no confirmation because it affects staged state only.
- Closing a panel with staged but unapplied choices uses VS Code's standard
  modal warning: **Discard unapplied Sharp Pen choices?**
