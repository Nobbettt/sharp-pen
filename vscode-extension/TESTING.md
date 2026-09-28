# Testing sharp-pen across platforms

## Automated (CI on every push)

| Check | Where |
|---|---|
| Unit tests (`npm test`), fake CLIs incl. Windows `.cmd` shims and process-tree cancellation | Linux, macOS, Windows, each on x64 and arm64 |
| Unit tests on Node 18.15 (the Node in VS Code 1.85) | Linux x64 |
| Smoke test in a real VS Code (`npm run test:integration`): activates, opens the review panel, runs one analysis through a spawned fake CLI | Same six runners on VS Code stable; Linux, macOS and Windows x64 on VS Code 1.85.0 |

Run the smoke test locally with `npm run test:integration`. Set `VSCODE_TEST_VERSION=1.85.0` for the minimum version. On Linux without a display, prefix the command with `xvfb-run -a`.

## Manual, before each release

CI cannot sign in to real AI CLIs, and it does not run on remote hosts. Run this list with the release `.vsix` (`code --install-extension sharp-pen-X.Y.Z.vsix`).

Environments:

- [ ] macOS (Apple Silicon)
- [ ] Windows 11, e.g. a Windows 11 ARM VM in UTM or Parallels. Install the CLIs through npm so they are `.cmd` shims.
- [ ] Linux, through a Dev Container, WSL or Remote-SSH. This also covers the remote case: the extension runs on the remote host, so the CLI must be installed and signed in *there*.
- [ ] VSCodium or Cursor, installed from Open VSX

In each environment, for every CLI you have (Claude Code, Codex, GitHub Copilot, OpenCode):

- [ ] Open `test/fixtures/demo.md`, run **sharp-pen: Open Review**, then **Analyze**. Suggestions appear.
- [ ] Mermaid diagrams render in the preview.
- [ ] Start an analysis, then run **sharp-pen: Cancel Analysis**. The progress notification closes, and no CLI process is left running (check Activity Monitor, Task Manager or `ps`).
- [ ] **Select Model...** lists models, and the chosen model is used for the next analysis.
- [ ] Apply a suggestion. The source document changes.
- [ ] Uninstall the CLI, or remove it from PATH, and analyze. The error names the missing client and offers settings.
