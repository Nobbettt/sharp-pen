# Research notes

Research date: 2026-09-21
Method: three independent GPT-5.6 Terra sub-agents, medium reasoning, using
official VS Code, provider, and Node documentation.

These notes record externally constrained decisions. Product requirements remain
authoritative.

## 1. VS Code platform findings

### Review surface

A `WebviewPanel` beside the normal Markdown or plain-text editor fits the product better than a
custom text editor. A custom editor replaces the normal editor and creates a
larger two-way synchronization contract. The webview is justified because the
review needs paired highlights, menus, alternatives, and staged state that the
standard Markdown preview cannot provide.

Sources:

- [Webview API](https://code.visualstudio.com/api/extension-guides/webview)
- [Custom editors](https://code.visualstudio.com/api/extension-guides/custom-editors)
- [Webview UX guidance](https://code.visualstudio.com/api/ux-guidelines/webviews)

### Applying edits

`TextEditor.edit` supplies native document integration and undo/redo for one editor
transaction. sharp-pen should track document change ranges, retain unaffected
suggestions, and recheck the editor version and each accepted range's exact text
immediately before submitting the edit.

Source: [VS Code API — `TextEditor.edit`](https://code.visualstudio.com/api/references/vscode-api#TextEditor)

### Settings

Contributed configuration appears in native VS Code Settings and can use machine,
resource, or language scopes. sharp-pen keeps process-routing settings out of that
configuration and in extension global state, so workspace settings cannot redirect
execution. sharp-pen does not contribute native operational settings.

Source: [Configuration contribution point](https://code.visualstudio.com/api/references/contribution-points#contributes.configuration)

### Remote and web hosts

A workspace extension runs on the remote extension host for SSH, WSL, containers,
and remote workspaces. The CLI must therefore be installed and authenticated on
that host. A VS Code web extension cannot use Node child processes, so browser-only
analysis is outside version 1.

Sources:

- [Extension hosts](https://code.visualstudio.com/api/advanced-topics/extension-host)
- [Remote extensions](https://code.visualstudio.com/api/advanced-topics/remote-extensions)
- [Web extensions](https://code.visualstudio.com/api/extension-guides/web-extensions)
- [Virtual workspaces](https://code.visualstudio.com/api/extension-guides/virtual-workspaces)

### Trust and cancellation

Launching an external CLI is a trust-sensitive capability. The extension can
declare limited untrusted-workspace support while hard-blocking Analyze until the
workspace is trusted. Cancellable notification progress is the native progress UI
that provides a cancel button.

Sources:

- [Workspace Trust](https://code.visualstudio.com/api/extension-guides/workspace-trust)
- [VS Code API — `window.withProgress`](https://code.visualstudio.com/api/references/vscode-api#window.withProgress)

### Webview security and themes

The webview should use a strict Content Security Policy, nonce-protected scripts,
restricted local resource roots, `asWebviewUri`, message passing, semantic DOM,
and VS Code theme variables/classes. It should not retain its context while hidden
unless measurement later justifies the memory cost.

Source: [Webview API and security guidance](https://code.visualstudio.com/api/extension-guides/webview)

## 2. CLI compatibility findings

The exact installed CLI version must be capability-probed because flags and model
catalogs change. The following matrix captures the current official interfaces.

| Priority | Client | Noninteractive command | Machine-readable result | Auth ownership | Model selection |
|---:|---|---|---|---|---|
| 1 | Claude Code | `claude -p` | `--output-format json`; `--json-schema` where supported | Existing Claude Code login/provider credentials | `--model` alias or ID |
| 2 | Codex CLI | `codex exec --sandbox read-only` | `--json`; `--output-schema` and output file where supported | Existing Codex login or CLI-supported environment credential | `--model` |
| 3 | GitHub Copilot CLI | piped stdin with `--silent --output-format json` and every 1.0.88 tool excluded | JSONL assistant events | Existing OAuth or Copilot-supported token | `--model` |
| 4 | OpenCode | `opencode run --pure --format json --agent sharp-pen --file ...` | JSONL text events followed by a clean stop | Existing OpenCode auth store/provider credentials | `--model` |

### Claude Code

- Use print mode and no permission prompts.
- Require `--json-schema` and pass sharp-pen's serialized draft-07 response
  schema in JSON print mode. Accept only the successful nonempty
  `structured_output` object from the JSON envelope; never fall back to its
  free-form `result` text.
- Bound turns and cost where available.
- Do not use `--dangerously-skip-permissions`.

Source: [Claude Code CLI reference](https://code.claude.com/docs/en/cli-usage)

### Codex CLI

- Use noninteractive `exec` mode and a read-only sandbox.
- Use the installed CLI's structured output/schema features where available.
- Reuse CLI authentication; do not inspect its credential files.
- Capability-check flags against `codex exec --help`.
- Web search is enabled by default independently of the disabled-feature list;
  pass `--config web_search=disabled` to turn it off.

Source: [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)

### GitHub Copilot CLI

- Use programmatic prompt mode and suppress non-answer display.
- Do not grant tools or enable autopilot for proofreading.
- Pin the reviewed 1.0.88 tool catalog, exclude every tool, and accept only its
  completed tool-free assistant message from JSONL output.
- Model availability depends on the user's account and policy.

Sources:

- [Copilot CLI programmatic reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference)
- [Run Copilot CLI programmatically](https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/run-cli-programmatically)

### OpenCode

OpenCode 1.18.32 is supported with a version pin. sharp-pen replaces user and
project configuration with a deny-all custom agent, disables plugins with
`--pure`, and supplies the prompt through a private temporary file.
- [OpenCode models](https://opencode.ai/v2/docs/models)
- [OpenCode providers](https://opencode.ai/docs/providers)

## 3. Process and output safety

Node's direct `child_process.spawn` with an executable and argument array avoids
shell parsing. sharp-pen should use `shell: false`, fixed adapter flags, bounded
output, a timeout, and abort-driven termination. On POSIX it should spawn into
its own process group (detached only so a cancel/timeout can signal the whole
tree, never unref'd or left running); source text should travel on stdin where
supported.

Source: [Node.js child process API](https://nodejs.org/api/child_process.html)

AI output is not trusted merely because it came from a configured client. The
extension must parse it as data, enforce the sharp-pen schema, resolve exact source
anchors, reject overlaps, and render text through DOM `textContent` rather than
injecting model-produced HTML.

Parser, schema, and CLI diagnostics remain internal: raw model output is never
logged, and UI failure messages are generic and actionable so internal details do
not become part of the user-facing contract.

## 4. Dynamic model discovery

Native VS Code configuration dropdowns come from static `enum` values contributed
in `package.json`; the public API cannot replace them at runtime. sharp-pen instead
uses a dedicated webview settings panel and extension global state for operational
settings. sharp-pen therefore uses its dedicated panel rather than a native
settings contribution.

Sources:

- [VS Code configuration contributions](https://code.visualstudio.com/api/references/contribution-points#contributes.configuration)
- [VS Code `WebviewPanel`](https://code.visualstudio.com/api/references/vscode-api#WebviewPanel)
- [VS Code `window.showQuickPick`](https://code.visualstudio.com/api/references/vscode-api#window.showQuickPick) (standalone Select Model command)

| Client | Supported discovery | Result quality | Design fallback |
|---|---|---|---|
| Claude Code | No documented noninteractive list; `/model` is interactive | Cannot query the user's available catalog safely | Default, stable aliases/recent values, manual ID |
| Codex | Short-lived `codex app-server`, then JSON-RPC `model/list` | Structured, paginated, account/provider-aware catalog | Preserve current value and offer manual ID on RPC/auth failure |
| GitHub Copilot CLI | No documented noninteractive list; model selection is interactive | Cannot query account/org policy safely | `auto`, recent values, manual ID |
| OpenCode | `opencode models --pure` | Plain bounded model IDs | Preserve current value and offer manual ID on failure |

Model discovery never launches an inference request and never passes credentials on
the command line. A listed model is still only a candidate: provider permissions
may reject it during Analyze.

Sources:

- [Claude Code CLI reference](https://docs.anthropic.com/en/docs/claude-code/cli-usage)
- [Codex app-server documentation](https://developers.openai.com/docs/app-server)
- [Codex app-server protocol](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)
- [Copilot CLI programmatic reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference)
- [Copilot CLI command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference)
- [OpenCode models command](https://opencode.ai/v2/docs/cli/commands/#models)
- [OpenCode model availability](https://opencode.ai/v2/docs/models)

## 5. Version-drift risks

- CLI flags may differ by installed version; adapters must probe capabilities.
- Provider model lists are dynamic and may depend on account policy.
- Copilot's JSONL shape and tool catalog may change between versions, so its
  adapter remains pinned to the reviewed 1.0.88 release.
- OpenCode documentation spans current and development URLs.
- No provider documents a complete cross-platform signal or exit-code contract;
  sharp-pen must own cancellation and classify nonzero exit, error events, timeout,
  and parse failure itself.

These are reasons for small independent adapters, not for a generalized command
configuration system.
