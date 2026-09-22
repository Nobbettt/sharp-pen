# Product requirements

Status: draft 0.1
Product: Sharp Pen for VS Code
Initial document types: Markdown and plain text

## 1. Purpose

Sharp Pen for VS Code gives authors the existing Sharp Pen proofreading flow
without leaving VS Code. It analyzes the active Markdown or plain-text document
with a user-installed AI CLI, presents Level 1 and Level 2 suggestions in an
interactive review, and applies only the choices the author accepts.

The normal VS Code editor remains the source of truth. Sharp Pen is a review
surface, not a replacement text editor.

## 2. Product principles

- Preserve the author's meaning, voice, hedges, register, and source formatting.
- Suggest form, not substance.
- Never change the document merely because analysis completed.
- Make each suggestion independently reviewable.
- Keep provider choice explicit and local to the user's configured CLI.
- Use VS Code's native commands, settings, undo, themes, accessibility, and
  workspace-trust model wherever possible.
- Keep the toolbar compact. Explanations belong on the suggestion itself, not in
  persistent instructional text.

## 3. Users and primary workflow

The primary user is an author editing a Markdown or plain-text document in
desktop VS Code or a desktop VS Code remote workspace.

1. Open a Markdown or plain-text document.
2. Run **Sharp Pen: Open Review** from the editor title, Command Palette, or
   editor context menu.
3. Press **Analyze**.
4. Review Level 1 or Level 2 suggestions in split or inline view.
5. Accept individual suggestions, choose alternatives, or accept all suggestions
   in the active level.
6. Press **Apply** to commit accepted choices to the open document as one undoable
   edit.

## 4. Functional requirements

### Document and review lifecycle

- **FR-001** The extension shall operate on the active document when its language
  identifier is `markdown` or `plaintext`. File extensions such as `.md`,
  `.markdown`, and `.txt` are covered through those VS Code language modes.
- **FR-002** The extension shall open one review panel per source document and
  reveal an existing panel rather than creating a duplicate.
- **FR-003** The review shall use an immutable snapshot of the source document,
  its URI, document version, and SHA-256 hash.
- **FR-004** The extension shall not modify the source document during analysis
  or while the author is selecting suggestions.
- **FR-005** After an external source edit, the extension shall keep suggestions
  whose ranges remain untouched, shift their positions when text is inserted or
  removed before them, and invalidate only suggestions whose source ranges were
  edited. It shall re-enable Analyze so the author may refresh the full review.
- **FR-005a** If an edited range invalidates an accepted suggestion, the extension
  shall clear that decision. Unaffected accepted suggestions shall remain
  applicable.
- **FR-006** Re-running Analyze shall replace the current review only after the new
  result validates. A failed run shall leave the previous valid review visible.
- **FR-007** Closing a review panel shall cancel its active analysis process.

### Analysis

- **FR-010** Analyze shall invoke one supported, user-installed headless AI CLI:
  Claude Code, Codex CLI, or GitHub Copilot CLI. OpenCode shall remain fail-closed
  until it can disable tools, custom agents, configuration, and MCP reliably.
- **FR-011** `Auto` client selection shall use this priority order: Claude Code,
  Codex, GitHub Copilot CLI.
- **FR-012** An explicitly selected unavailable client shall produce an actionable
  error and shall not fall back to another provider.
- **FR-013** An automatically selected client that fails after launch shall
  produce an actionable error and shall not silently send the document to another
  provider.
- **FR-014** The selected CLI shall own authentication, credentials, billing, and
  network access. Sharp Pen shall not collect or store provider credentials.
- **FR-015** The user shall be able to cancel analysis.
- **FR-016** Only one analysis may run per review panel. Starting another shall
  cancel the previous run.
- **FR-017** The extension shall validate all AI output before displaying it.
  Invalid, ambiguous, overlapping, or out-of-range suggestions shall not enter
  review state.
- **FR-018** Analysis shall be disabled in an untrusted workspace and wherever a
  Node-based extension host cannot launch local processes.

### Suggestion semantics

- **FR-020** Level 1 shall contain only spelling, typographical, agreement,
  preposition, article, auxiliary, homophone, hyphenation, capitalization,
  spacing, and clear punctuation or grammar errors. It shall not rewrite.
- **FR-021** Level 2 shall contain sentence-construction suggestions such as
  fragments, broken parallelism, tangled clauses, misplaced modifiers, repeated
  nouns, near-miss idioms, and weak or unfinished sentence endings.
- **FR-022** Level 2 shall preserve meaning and voice and shall use one suggestion
  per sentence or tightly linked pair.
- **FR-023** Every suggestion shall include exact original text, one to three
  replacement options, and a short explanatory note.
- **FR-024** The first option shall be the default and the option used by Accept
  all.
- **FR-025** Repeated original text shall be disambiguated before display.
- **FR-026** Suggestions at the same level shall not overlap.
- **FR-027** A Level 2 span that intersects a Level 1 span shall contain that Level
  1 span completely.
- **FR-028** Accepting a Level 2 option shall supersede accepted Level 1 choices
  inside that sentence. Keeping or rejecting the Level 2 suggestion shall leave
  those Level 1 choices available.
- **FR-029** Analysis shall ignore fenced code blocks, inline code, front matter,
  raw HTML, link destinations, and other Markdown syntax that is not prose.
- **FR-029a** Plain-text documents shall be analyzed as prose without Markdown
  parsing or syntax exclusions.

### Review interactions

- **FR-030** The review shall provide Level 1 and Level 2 selectors with
  independent selection state and counts.
- **FR-031** The review shall provide split and inline views.
- **FR-032** Split view shall show the current staged draft and the default or
  selected suggestion result side by side.
- **FR-033** Inline view shall show deletions and insertions together in one
  rendered document.
- **FR-034** Clicking a one-option suggestion shall toggle its accepted state.
- **FR-035** Clicking a multi-option suggestion shall open a menu containing its
  note, alternatives, and a Keep original choice.
- **FR-036** Accept all shall select option zero only for every pending suggestion
  in the active level. It shall preserve explicit Keep original and chosen
  alternative decisions, and shall not apply changes to the source document.
- **FR-037** Reset shall clear staged choices in the active level.
- **FR-038** Next shall focus and reveal the next unaccepted suggestion in the
  active level.
- **FR-039** Apply shall use the current mapped ranges, verify that every accepted
  range still contains its exact original text, and submit the remaining accepted
  replacements in one version-aware `TextEditor.edit` transaction.
- **FR-040** A successful Apply shall participate in VS Code undo/redo and shall
  end the current review as applied.
- **FR-041** The review shall never insert or execute AI-produced HTML.

### Settings

- **FR-050** Sharp Pen shall expose AI client selection in its custom settings menu
  and persist it in extension global state.
- **FR-051** Model overrides shall be optional and provider-scoped in global state.
  Empty means that provider's default model.
- **FR-052** A **Sharp Pen: Select Model…** command shall fetch models from the
  selected client's CLI when it exposes a supported discovery interface and show
  the results in a searchable VS Code Quick Pick.
- **FR-052a** The model picker shall always include **Use client default** and
  **Enter model ID…**. When live discovery is unsupported or fails, those fallback
  choices shall remain available and the current saved value shall not be cleared.
- **FR-052b** A **Refresh models** action shall bypass any cached discovery result.
  Discovery shall also refresh when the selected AI client or extension-host
  location changes.
- **FR-053** A compact settings button in the review toolbar shall open Sharp Pen's
  custom settings menu. Native Settings exposes only a static command-link launcher.
- **FR-054** Version 1 shall not accept arbitrary executable paths, shell command
  templates, or extra CLI arguments.
- **FR-055** Client and model settings shall be extension-global and never read from
  workspace configuration; model discovery and process launch remain trust-gated.

### Theme, accessibility, and localization readiness

- **FR-060** Preview Theme shall offer Light (default), Dark, and Auto in the custom
  settings menu.
  Light and Dark use Sharp Pen palettes; Auto follows VS Code's active theme.
- **FR-061** Open reviews shall update when the preview theme setting changes,
  without re-running analysis.
- **FR-062** The review shall remain usable with VS Code high-contrast themes.
- **FR-063** Every toolbar control and suggestion action shall be keyboard
  reachable and have an accessible name.
- **FR-064** Color shall not be the only indication of deletion, insertion,
  selection, focus, invalidated state, or failure.
- **FR-065** The webview shall respect reduced-motion preferences.

## 5. Non-functional requirements

- **NFR-001 Security:** launch fixed executables with fixed argument arrays and
  `shell: false`; treat document content and CLI output as untrusted data.
- **NFR-002 Privacy:** make no Sharp Pen service calls and collect no telemetry.
  The configured AI client is the only component that transmits document text.
- **NFR-003 Integrity:** never apply a suggestion unless its mapped live range
  still contains the exact source text analyzed for that suggestion.
- **NFR-004 Resource bounds:** enforce configurable-in-code limits for analysis
  duration, stdout/stderr size, suggestion count, anchor size, note size, and
  option size. These are safety constants, not user-facing settings in version 1.
- **NFR-005 Portability:** support local desktop extension hosts and remote
  extension hosts. The CLI must exist and be authenticated where the workspace
  extension host runs.
- **NFR-006 Performance:** interactions after validated analysis shall be local and
  immediate. Rendering shall not launch a process or make a network request.
- **NFR-007 Compatibility:** the extension shall declare a tested minimum VS Code
  version and test on macOS, Linux, and Windows.
- **NFR-008 Maintainability:** provider-specific command details shall remain in
  small adapters behind one result contract; review behavior shall not know
  which provider ran.

## 6. Out of scope for version 1

- Document language modes other than `markdown` and `plaintext`.
- VS Code for the Web analysis.
- Inline editor diagnostics, squiggles, Code Actions, or automatic analysis while
  typing.
- Direct provider APIs or Sharp Pen-managed API keys.
- Chat participant integration.
- Automatic provider failover after a client launches.
- Streaming partial suggestions into the review.
- Semantic regeneration of edited suggestions without a new analysis. Version 1
  performs only deterministic range shifting and per-suggestion invalidation.
- Full structural or factual editing, rewriting, translation, summarization, or
  argument review.
- A background daemon, language server, account system, telemetry, or cloud sync.
- A custom executable-path or arbitrary-arguments setting.

## 7. Acceptance scenarios

- **AC-001 Happy path:** Given a trusted Markdown or plain-text document and an
  authenticated supported CLI, Analyze returns a validated two-level review;
  accepting choices and pressing Apply modifies the document once and one Undo
  restores it.
- **AC-002 Alternatives:** Given a suggestion with three options, all options and
  Keep original are reachable by keyboard, and Apply uses the chosen option.
- **AC-003 Level nesting:** Given a Level 2 suggestion containing accepted Level 1
  edits, choosing the Level 2 replacement supersedes those inner edits without
  duplicating text.
- **AC-004 Source edit:** Given a completed analysis, editing outside a suggestion
  preserves and repositions that suggestion; editing inside one invalidates only
  that suggestion. Analyze becomes available again, and unaffected accepted
  suggestions can still be applied.
- **AC-005 Invalid output:** Given malformed JSON, a missing anchor, overlapping
  spans, or a non-string option, no suggestion is displayed and the document is
  unchanged.
- **AC-006 Provider routing:** With Claude absent and Codex present, Auto uses
  Codex. If Codex then fails, Sharp Pen reports that failure and does not invoke
  Copilot.
- **AC-007 Explicit provider:** With `claude` selected and Claude absent, Sharp Pen
  reports how to install/select another client and launches nothing else.
- **AC-008 Cancellation:** Cancelling analysis terminates the child process,
  discards late output, and leaves the document and previous valid review intact.
- **AC-009 Trust:** In an untrusted workspace, Analyze is disabled in the UI and
  guarded in the command handler.
- **AC-010 Remote:** In a remote workspace, detection and execution occur on the
  remote extension host and the webview remains interactive locally.
- **AC-011 Theme:** Changing between light, dark, and high-contrast themes updates
  the open review without reopening it; all states remain distinguishable.
- **AC-012 No prose chrome:** The toolbar contains only controls, short labels,
  icons, and compact counts. It contains no persistent instructional sentences or
  level descriptions.

## 8. Confirmed implementation decisions

Confirmed by the product owner on 2026-09-21:

1. Accept all applies option zero only to pending suggestions in the active level;
   explicit Keep original and chosen alternatives are preserved.
2. Acceptance is staged and followed by one explicit Apply action.
3. Markdown code, front matter, raw HTML, and link destinations are excluded from
   analysis.
4. The first release supports desktop/workspace extension hosts only.

## 9. Candidate formats after version 1

Add a format only when its prose regions and safe preview rules are specified.
Likely candidates, in order of expected value, are AsciiDoc and reStructuredText.
MDX, LaTeX, source-code comments, notebooks, logs, CSV, and configuration files
are not treated as plain text because their executable or structural syntax needs
format-aware exclusion rules.
