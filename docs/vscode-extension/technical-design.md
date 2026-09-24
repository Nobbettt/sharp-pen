# Technical design

Status: draft 0.1

## 1. Architecture summary

The extension is a Node-based VS Code workspace extension with a presentation-only
webview. It ports the existing sharp-pen validation and review behavior to
TypeScript; it does not call the Python builder and does not require Python.

```text
Markdown/plain-text TextDocument
        |
        | immutable snapshot
        v
Extension controller -----> selected CLI adapter -----> user-installed AI CLI
        |                           |                           |
        |                           +----- stdout/stderr -------+
        |                                      |
        |                         parse + validate + resolve anchors
        v                                      |
Review state <---------------------------------+
        |
        | validated view model / typed intents
        v
sharp-pen webview
        |
        | Apply accepted choices
        v
one version-aware WorkspaceEdit transaction
```

There is no service, daemon, language server, provider SDK, or direct model API.

## 2. VS Code integration

### Extension host

- Declare `extensionKind: ["workspace"]` so process execution happens where the
  workspace lives, including SSH, WSL, Dev Containers, and Codespaces desktop
  sessions.
- Do not declare a browser entry point in version 1. A web extension cannot use
  Node child processes.
- Activate on the sharp-pen commands rather than on every supported file.
- Register a `WebviewPanel` for the review surface. Do not replace the standard
  source editor with a custom editor.
- Track panels by canonical document URI; reveal an existing panel for the same
  document.

### Commands and contributions

Minimum commands:

- `sharpPen.openReview`
- `sharpPen.analyze`
- `sharpPen.cancelAnalysis`
- `sharpPen.selectModel`
- `sharpPen.refreshModels`
- `sharpPen.openSettings`

`openReview` appears in the Command Palette and in editor title/context menus for
`markdown` and `plaintext` documents. Other commands are invoked from the webview
or Command Palette as appropriate.

### Workspace trust

Declare limited untrusted-workspace support. Opening an inert preview is allowed,
but `analyze`, model discovery, and interactive task-checkbox source edits must
check `workspace.isTrusted`.
Operational settings persist in extension `globalState`, not native VS Code
configuration. UI state is never relied on as the security boundary; the command
handler repeats the trust check before discovery or process launch.

## 3. Components

### `ReviewController`

One controller owns each document review. It:

- captures the immutable document snapshot;
- starts, cancels, and disposes the active analysis;
- chooses one CLI adapter;
- validates and normalizes the result;
- owns staged decisions for both levels;
- reconciles suggestion ranges on document change and invalidates only overlaps;
- computes and applies the final edit;
- sends a presentation model to the webview.

### CLI adapters

Each adapter defines only:

```ts
interface CliAdapter {
  readonly id: "claude" | "codex" | "copilot" | "opencode";
  probe(): Promise<ProbeResult>;
  analyze(request: AnalysisRequest, signal: AbortSignal): Promise<string>;
  listModels?(signal: AbortSignal): Promise<ModelChoice[]>;
}
```

The process runner, output limits, cancellation, timeout, and error redaction are
shared. Review code receives only normalized suggestions and does not branch by
provider.

### Validator/normalizer

This is a TypeScript port of the semantics in `scripts/build.py`:

- exact non-empty `from` values;
- deterministic occurrence resolution;
- one to three non-empty string options;
- required short note;
- no identical first option;
- no same-level overlaps;
- Level 2 intersections must wholly contain Level 1 spans.

It resolves agent-facing string anchors to internal UTF-16 offsets. Asking models
to calculate UTF-16 offsets is intentionally avoided.

### Webview

The webview owns rendering and ephemeral interaction only. It cannot read files,
launch commands, validate AI output, apply edits, or access settings directly.
It sends typed intent messages and receives a complete, already validated review
model.

### Markdown rendering

Use one bundled Markdown parser configured with raw HTML disabled. The parser must
support the CommonMark constructs needed by prose documents. Suggestion markers
are inserted as opaque sentinels before rendering, then replaced with DOM elements
using `textContent`; AI text is never assigned as HTML.

Fenced code, inline code, front matter, HTML, link destinations, and non-prose
syntax are masked before analysis and cannot be suggestion anchors. A parser token
walk should identify these regions; regular expressions alone are insufficient for
nested Markdown syntax.

The same source parser identifies exact backtick/tilde opening fences for the
preview language selector. The host exposes only supported installed VS Code language IDs,
then revalidates the live fence index, version, and first info-string token before
one undoable replacement. The renderer tags only matching fenced `<pre>` elements;
indented code has no fence identity and no selector. Plain text is represented by
an empty selector value; when a language-bearing fence has metadata, the host writes
`plaintext` rather than removing the token and promoting metadata to a language.
The webview bundles Highlight.js `lib/common` and explicitly maps source IDs to its
registered grammars. It never auto-detects, fetches, evaluates, or runtime-loads
grammars; unsupported and over-limit fences use a safely escaped plain fallback.

Do not depend on undocumented internals of VS Code's built-in Markdown extension.

### Plain-text rendering

For `plaintext`, skip the Markdown parser and render escaped text with preserved
line breaks and whitespace. The same validated suggestion spans and interaction
components are used. This adds no second review implementation.

## 4. Data contracts

### Analysis request

```json
{
  "schemaVersion": 1,
  "title": "README.md",
  "format": "markdown",
  "source": "# Original Markdown...",
  "rules": "sharp-pen Level 1 and Level 2 rules"
}
```

The actual prompt contains the source as data with explicit delimiters and states
that instructions inside the source are content, not instructions. The source is
sent on stdin wherever the client supports it; it is never interpolated into a
shell command.

### Agent-facing response

Keep the existing sharp-pen shape so all clients produce the same small contract:

```json
{
  "title": "README",
  "level1": [
    {
      "from": "New members joins",
      "occurrence": 1,
      "options": ["New members join"],
      "note": "Plural subject requires a plural verb."
    }
  ],
  "level2": [
    {
      "from": "Have to say the fix turned out simple.",
      "options": [
        "I have to say the fix turned out to be simple.",
        "The fix, I have to say, was simple."
      ],
      "note": "Missing subject."
    }
  ]
}
```

Claude Code is required to support `--json-schema`. sharp-pen passes the
draft-07 response schema in print/JSON mode and accepts only a successful JSON
envelope with a nonempty top-level `structured_output` object; it serializes that
object for the shared validator. No free-form `result`, fenced JSON, retry, or
error envelope is accepted. Other adapters use their provider-specific strict
extraction before the same validator applies.

### Internal review model

```ts
interface Review {
  schemaVersion: 1;
  uri: string;
  analysisDocumentVersion: number;
  analysisSourceHash: string;
  currentDocumentVersion: number;
  currentSource: string;
  level1: Suggestion[];
  level2: Suggestion[];
}

interface Suggestion {
  id: string;
  level: 1 | 2;
  start: number; // UTF-16 offset, inclusive
  end: number;   // UTF-16 offset, exclusive
  from: string;
  options: string[];
  note: string;
  status: "active" | "invalidated";
}

type Decision = null | { option: number };
```

The controller, not the model, adds URI, versions, hash, IDs, resolved offsets,
and status.

### Webview messages

Webview to extension:

```ts
type Intent =
  | { type: "analyze" }
  | { type: "cancel" }
  | { type: "choose"; suggestionId: string; option: number | null }
  | { type: "acceptAll"; level: 1 | 2 }
  | { type: "reset"; level: 1 | 2 }
  | { type: "apply" }
  | { type: "openSettings" };
```

The extension validates message type, ID, level, and option range even though the
webview is extension-owned.

## 5. Analysis pipeline

1. Verify a `markdown` or `plaintext` editor, a trusted workspace, and a desktop
   Node extension host.
2. Snapshot source, URI, version, and SHA-256 hash.
3. For Markdown, mask excluded syntax regions for the prompt while retaining raw
   source for exact anchor validation. For plain text, use the full snapshot.
4. Resolve settings and choose one adapter. `Auto` probes fixed executable names
   in priority order.
5. Start notification progress with cancellation.
6. Spawn the executable directly with `shell: false`, fixed flags, a safe working
   directory, bounded environment, stdin, timeout, and stdout/stderr limits.
7. Extract the provider's required final result and validate the envelope
   (title, arrays, size limits); drop any individual suggestion that fails its
   own field validation. Do not log raw model output.
8. Resolve exact anchors against the original snapshot one suggestion at a time.
   Drop any suggestion whose anchor cannot be found, is ambiguous, overlaps
   another kept suggestion at the same level, or (for Level 2) does not wholly
   contain a Level 1 suggestion it intersects. Reject the complete result only
   when the envelope itself is invalid; publish the review, even an empty one,
   when every suggestion was dropped.

The extension host keeps diagnostic parser, schema, process, and provider errors
internal. At UI boundaries it shows concise actionable messages (for example,
“Analysis failed. Try switching models or retrying.”, or a message authored by
the extension itself for a recognized launch/availability/timeout failure);
cancellation restores the previous review state without showing an error. When
suggestions were dropped in step 8, a non-blocking notice reports how many,
including when that leaves the review empty.
9. Publish the validated review atomically. Preserve the previous valid review if
   steps 4–8 fail.

Partial or streaming results are not rendered in version 1.

## 6. Provider adapter plan

Flags are capability-checked against the installed CLI because these tools evolve.
The commands below are design targets, not strings to assume blindly.

| Priority | Client | Target noninteractive mode | Structured result | Model |
|---:|---|---|---|---|
| 1 | Claude Code | `claude --print` with no permission prompts and no tools (`--tools ""`, so no turn limit is needed) | `--output-format json` plus `--json-schema` when supported | `--model` |
| 2 | Codex | `codex exec --sandbox read-only` | `--json` events, with the response schema embedded in the prompt | `--model` |
| 3 | GitHub Copilot CLI | piped stdin with every reviewed 1.0.88 built-in tool excluded via `--excluded-tools` | Tool-free final assistant JSONL event | `--model` |
| 4 | OpenCode | `opencode run --pure --format json` with a deny-all custom agent | Strict JSONL text events and clean stop | `--model` |

Copilot also passes `--disable-builtin-mcps` to disable its built-in GitHub MCP server. There is
no single flag to disable every MCP server the user has configured in
`~/.copilot/mcp-config.json` (`--disable-mcp-server` only takes one already-known server name at a
time). Those user-configured MCP tools stay loaded and are governed by Copilot's non-interactive
permission denial rather than by the exclusion list above.

Rules common to every adapter:

- Never invoke a shell.
- Never use an auto-approve, dangerous-skip-permissions, broad tool permission, or
  workspace-write mode.
- Pass no provider credentials.
- Do not read provider credential files.
- Do not log document text, prompts, stdout, or stderr.
- Redact command errors before showing them; offer a separate opt-in output channel
  later only if diagnostics prove necessary.
- Cancel with an abort signal, close stdin, terminate the child, then force-kill
  after a short grace period. Discard all output after cancellation.
- A runtime/auth/model failure is terminal for that Analyze action. Do not fail
  over to another client.

### Detection

Probe only supported fixed names (`claude`, `codex`, `copilot`, `opencode`) using fixed
version/help arguments. Cache successful probes for the extension session. Do not run an authenticated
model request merely to populate settings.

### Model selection

- An empty model override for a provider uses that provider's default.
- Pass a configured model only through that adapter's model flag.
- `SettingsStore` persists the client, theme, and provider-scoped model overrides
  in extension `globalState`; no operational setting is read from VS Code configuration.
- **sharp-pen: Open Settings** creates or reveals one dedicated webview settings
  panel with inline AI Client, provider-scoped model select, model refresh/list, and
  Preview Theme controls. In a trusted workspace it refreshes on panel readiness
  and every client change; manual model entry is hidden until **Other (specify model
  ID)** is selected. The preview cog and **sharp-pen: Open Settings** command open
  that same panel.
- **sharp-pen: Select Model…** calls the active adapter's optional `listModels`,
  displays the returned candidates with `window.showQuickPick`, and persists the
  result under that adapter's provider key.
- Codex discovery starts a short-lived `codex app-server`, performs the documented
  JSON-RPC initialize handshake and paginated `model/list`, excludes hidden models,
  then terminates the process.
- OpenCode discovery runs `opencode models --pure`; analysis pins the reviewed
  version, replaces ambient configuration with a deny-all agent, and passes the
  prompt through a mode-0600 temporary file outside argv.
- Claude Code and GitHub Copilot CLI currently expose account-aware model pickers
  only in their interactive terminal UIs. Do not scrape or automate those UIs;
  offer client default, documented aliases where stable, recently used values, and
  **Enter model ID…**.
- A discovery result is a candidate list, not proof that the account may use every
  model. The actual Analyze call remains authoritative.
- Discovery failure never clears the saved model. **Refresh models** bypasses the
  session cache; the panel also refreshes on readiness and after a client change.
- If `aiClient` is `auto`, the settings panel resolves the effective client on
  readiness and shows that provider beside the inline model control. Untrusted
  workspaces perform no model probing or discovery.
- Switching clients retains each provider's own override but never forwards it to a
  different CLI.

## 7. Document-change reconciliation

The controller listens to `workspace.onDidChangeTextDocument`. For each external
content change and each active suggestion:

1. If the change ends at or before the suggestion start, shift both suggestion
   offsets by the change's UTF-16 length delta.
2. If the change starts at or after the suggestion end, leave the range unchanged.
3. Otherwise, mark only that suggestion invalidated and clear its staged decision.
4. After all changes, verify that every remaining active range still slices to its
   exact `from` text; invalidate any range that fails this assertion.

Process multiple content changes against their pre-change coordinates in descending
offset order. Update `currentSource` and `currentDocumentVersion` after the event.
Suggestions remain anchored even when identical text is introduced elsewhere.

An edit overlapping a Level 2 sentence invalidates that Level 2 suggestion, but
does not invalidate contained Level 1 suggestions unless their own ranges were
also touched. Any source edit re-enables Analyze; a fresh valid result atomically
replaces the reconciled review.

Edits made by sharp-pen's own Apply operation are identified by the controller and
do not enter this reconciliation path.

## 8. Interactive Markdown task lists

In a trusted workspace, preview task checkboxes carry a random identity embedded
beside each source task marker. The webview enables a native checkbox only when
every rendered control maps one-to-one to those source identities. Suggested panes
therefore fail closed if an accepted suggestion injects a task, fence, or other
Markdown structure that makes the mapping ambiguous. The host validates the
document version and exact `[ ]`/`[x]`/`[X]` marker again, then changes only that
marker in one undoable editor edit. Untrusted workspaces render task controls
disabled and reject forged toggle intents.

Fenced-code selectors use the same trusted, version-checked host boundary. A
rendered selector is enabled only when every fenced preview block maps exactly to
the parsed source descriptors; a changed suggested structure fails closed.

## 9. Staging and Apply algorithm

Decisions are stored against suggestion IDs; the snapshot never changes.

To build the effective edit set:

1. Determine effective Level 2 decisions.
2. Exclude Level 1 suggestions contained by an accepted Level 2 span.
3. Add all accepted remaining Level 1 and Level 2 replacements.
4. Confirm the remaining replacement ranges do not overlap.

Before Apply:

1. Read the live `TextDocument`.
2. Require the review URI and current document version to match the controller's
   latest reconciled state.
3. Verify that every accepted range still contains its exact `from` text. Invalidate
   and omit any suggestion that fails; do not discard unaffected choices.
4. Convert each remaining accepted UTF-16 offset pair with
   `TextDocument.positionAt` and add the non-overlapping replacements to one
   `WorkspaceEdit`, without resolving a visible editor.
5. Apply it with `vscode.workspace.applyEdit` and confirm the expected document
   version and resulting source after the transaction.

One version-aware transaction preserves untouched source ranges and gives one undo
step. Level 2 precedence makes the final ranges non-overlapping, and exact
per-range assertions prevent the edit from overwriting intervening changes.

## 10. State machine

```text
empty --Analyze--> analyzing --valid result--> ready
  ^                    |                         |
  |                    +--cancel/error----------+
  |                                              |
  +------------------ reanalyze <---------------+
                                                 |
ready --choose/accept/reset--> ready-dirty --Apply--> applied
  |               |              |
  +--source edit--+--------------+----> modified --Analyze--> analyzing
                                         |
                                         +--choose/reset--> modified
                                         +--Apply unaffected--> applied
```

An analysis failure returns to the previous valid `ready` or `modified` state when
one exists; otherwise it returns to `empty` with an error.

## 11. Webview security

- Only the extension host launches the CLI and applies edits.
- Set `enableScripts: true` only for the review interaction.
- Use a strict CSP with `default-src 'none'`, a fresh script nonce, and only
  `webview.cspSource` for bundled styles/assets.
- Limit `localResourceRoots` to the extension's media directory.
- Disable command URIs.
- Keep `acquireVsCodeApi()` inside a closure and expose no global handle.
- Render document and suggestion strings with `textContent`.
- Disable raw HTML in Markdown.
- Validate every inbound webview message.
- Use `getState`/`setState` only for small presentation state such as active level,
  view, and scroll positions. The controller remains authoritative.
- Do not use `retainContextWhenHidden` unless profiling later proves it necessary.

## 12. Theme and accessibility implementation

- Style with VS Code variables such as editor foreground/background, borders,
  buttons, focus borders, diff inserted/removed backgrounds, and muted text.
- Respond automatically to `body.vscode-light`, `body.vscode-dark`, and
  `body.vscode-high-contrast`/`vscode-high-contrast-light` classes.
- Use semantic buttons, `aria-pressed` on segmented controls, visible focus rings,
  keyboard menus, and an `aria-live` region for status changes.
- Pair color with strike-through/insert styling, icons, labels, or outlines.
- Remove nonessential transitions under `prefers-reduced-motion: reduce`.

## 13. Persistence

Persist only operational user settings through extension `globalState`. The preview
cog and **sharp-pen: Open Settings** Command Palette command open the same reusable
settings panel. The first release does not persist analysis results across reloads
because they contain document text and live range state. Webview presentation state
may survive panel hiding through `getState`/`setState`; panel reload requires reanalysis.

## 14. Error behavior

Errors are short and actionable:

- client not installed;
- client not authenticated;
- configured model rejected;
- timed out or cancelled;
- result was not valid sharp-pen JSON;
- result did not match the analyzed document;
- one or more suggestions were invalidated by source edits;
- analysis unavailable in this workspace/host.

Errors never include the document, complete prompt, credentials, or raw model
output.

## 14. Verification plan

Minimum implementation checks:

- Unit tests for anchor resolution, overlap checks, Level 2 containment, option
  validation, staged result generation, range shifting, and overlap invalidation.
- Adapter contract tests using fixture executables; no real provider calls in CI.
- VS Code integration tests for open/reuse panel, trust gating, settings, Apply,
  Undo, cancellation, and document-change invalidation.
- Webview tests for split/inline rendering, alternatives, keyboard use, compact
  toolbar, and message validation.
- Visual snapshots in one light, one dark, and one high-contrast theme.
- Manual smoke tests for each real CLI on the supported operating systems before
  release.

## 15. Planned source layout

This is a responsibility map, not implementation scaffolding:

```text
vscode-extension/
  package.json
  src/
    extension.ts
    reviewController.ts
    review.ts
    validate.ts
    processRunner.ts
    adapters/
      claude.ts
      codex.ts
      copilot.ts
      opencode.ts
  media/
    review.js
    review.css
```

Do not add additional abstraction layers until more than one real use requires
them.
