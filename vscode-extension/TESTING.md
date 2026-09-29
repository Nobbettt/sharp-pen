# Testing sharp-pen across platforms

## Automated (CI on every push)

| Check | Where |
|---|---|
| Unit tests (`npm test`), fake CLIs incl. Windows `.cmd` shims and process-tree cancellation | Linux, macOS, Windows, each on x64 and arm64 |
| Unit tests on Node 18.15 (the Node in VS Code 1.85) | Linux x64 |
| Smoke test in a real VS Code (`npm run test:integration`): activates, opens the review panel, runs one analysis through a spawned fake CLI | Same six runners on VS Code stable; Linux, macOS and Windows x64 on VS Code 1.85.0 |

Run the smoke test locally with `npm run test:integration`. Set `VSCODE_TEST_VERSION=1.85.0` for the minimum version. On Linux without a display, prefix the command with `xvfb-run -a`.

## Real AI CLIs: `npm run test:ai`

One command tests sharp-pen against the real, signed-in CLIs, using this Mac's own logins (never API keys):

| Target | Runs on | Login |
|---|---|---|
| `macos-local` | This Mac, directly | The CLIs' own Keychain and file logins |
| `linux-docker` | Docker on this Mac (`test/real-ai/Dockerfile`, latest CLIs) | Copies of the Codex and OpenCode login files; Claude and Copilot tokens from the Keychain |
| `ubuntu-latest`, `ubuntu-24.04-arm`, `macos-latest`, `macos-15-intel`, `windows-latest`, `windows-11-arm` | GitHub Actions (`vscode-extension-real-ai.yml`) | The same logins, stored as `real-ai` environment secrets for the run and deleted afterwards |

For each CLI it checks the probe, model discovery, one real analysis of `test/fixtures/real-ai.md` (at least one suggestion placed), and that cancelling a second analysis settles within 5 s. It prints a table of passed, failed and skipped results, and exits non-zero on any failure.

```
npm run test:ai                          # everything
npm run test:ai -- --local               # this Mac and Docker only
npm run test:ai -- --cli codex --platform windows-11-arm
```

- Every run makes real model calls on your subscriptions.
- Codex and OpenCode can refresh their copied logins in Docker or CI, which may sign this Mac out of that CLI.
- CI tests the pushed branch, not local changes. `vscode-extension-real-ai.yml` must exist on the default branch before it can be started.
- If the Claude access token expires within 30 minutes, the script warns. Use Claude Code once to refresh it.

## Languages: `npm run eval:languages`

Runs the real, signed-in CLIs on this machine against mixed-language documents (`test/eval/languageCases.ts`), several runs each, through sharp-pen's own prompt, adapters and validation. It makes real model calls and is never part of `npm test` or CI.

| Document | What it stresses |
|---|---|
| `hu-es`, `es-hu` | Two unrelated languages; the same content in both orders, so order effects show |
| `sv-en-hu` | Three languages, including UK English whose spellings must stay UK |
| `sv-no-da` | Three closely related languages with the same kinds of error in near-identical sentences |

Each document has an answer key of planted errors, plus text that must not change: quotations, names, UK spellings, correct control sentences. Per tool and document, over all runs:

- **Recall** (must reach 90% on average): the share of planted errors caught. A Level 1 error counts only when a Level 1 suggestion on it has an option whose result matches the expected fix. A Level 2 problem counts when a Level 2 suggestion covers the sentence.
- **Keep violations** (must be 0): a suggestion changes text that must survive.
- **Level 1 rewrites** (must be 0): a Level 1 option less than 50% similar to its original, i.e. a rewrite rather than a correction.
- **Language mismatches** (must be 0): a note, or a replacement, confidently detected as a different language than the passage it belongs to, e.g. Norwegian "fixed" into Swedish, or a Hungarian note on a Spanish error.
- **Reported only:** notes whose language the simple marker-based detector can't tell, suggestions sharp-pen couldn't place, and suggestions outside the answer key (which can be valid).

```
npm run eval:languages                              # all CLIs, all documents, 3 runs
npm run eval:languages -- --cli codex --case sv-no-da --runs 1
```

The full per-run results are written to `out/eval/`.

## Still manual

- [ ] Remote hosts: Remote-SSH and WSL (the extension runs on the remote side, so the CLI must be signed in there)
- [ ] Mermaid diagrams render in the preview, and applying a suggestion edits the document
