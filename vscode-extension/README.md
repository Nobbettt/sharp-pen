# Sharp Pen for VS Code

Proofread a Markdown or plain-text document without leaving VS Code. Sharp Pen
opens an interactive review beside the editor; suggestions are staged and only
the choices you apply change the document.

## Requirements

- Desktop VS Code 1.85 or later and a trusted workspace. VS Code for the Web
  cannot run the required local CLI.
- A supported AI CLI installed and signed in on the extension host: Claude Code,
  Codex, or GitHub Copilot CLI. Sharp Pen uses that CLI's existing account.
- In SSH, WSL, Dev Container, or Codespaces desktop sessions, install and sign
  in to the CLI where the workspace extension host runs (normally the remote
  host), not only on the local machine.

Markdown and VS Code's `plaintext` language mode are supported. Markdown code,
front matter, raw HTML, and link destinations are excluded from analysis.

## Use

Open a supported document and run **Sharp Pen: Open Review** from the editor
toolbar, context menu, or Command Palette. Select **Analyze**, review Level 1
or Level 2 suggestions, then select **Apply** to make the accepted changes as
one undoable edit.

**Accept all** selects option zero only for pending suggestions in the active
level. Explicit **Keep original** and chosen alternative decisions are preserved.

## Preview theme

Run **Sharp Pen: Open Settings** (or use the review toolbar cog) to choose
**Light**, **Dark**, or **Auto**. Open review panels update immediately.

## Client and model

Choose **AI Client** in **Sharp Pen: Open Settings**. `Auto` uses the first
available supported client in this order: Claude Code, Codex, GitHub Copilot
CLI. A failed analysis never falls through to another provider.

Codex CLI is accepted only at the safety-reviewed version 0.155.1. Other
versions fail closed until their tool surface has been reviewed in Sharp Pen.

**Sharp Pen: Select Model...** resolves the effective client, offers its
default model, discovered choices when supported, and **Enter model ID...**.
**Refresh Models** bypasses the session cache. A saved model is scoped to its
provider, so switching clients never sends an ID to the wrong CLI. An empty
provider override always means that CLI's default.

OpenCode is intentionally fail-closed and unsupported. Its official controls
cannot establish precedence over workspace or user plugins and configuration,
so Sharp Pen will not launch it. A future OpenCode version is not assumed to
fix this; support requires controls that can prove that isolation.

## Install from a VSIX

This extension is not currently published to the VS Code Marketplace. With a
VSIX from this project or a release, run:

```sh
code --install-extension sharp-pen-0.1.0.vsix
```

Or use **Extensions: Install from VSIX...** in VS Code.

## Develop from this repository

```sh
cd vscode-extension
npm install
npm run compile
```

Open `vscode-extension` in desktop VS Code and press `F5` to launch an
Extension Development Host. To build a VSIX locally, run `npm run package`.

## Privacy

Sharp Pen has no service, API keys, accounts, analytics, or telemetry. It sends
the document snapshot to the selected local CLI on standard input; authentication,
storage, and any provider transmission are owned by that CLI and its provider.
Sharp Pen does not read or manage provider credentials. See the repository
[privacy policy](../PRIVACY.md) for details.

## License

[MIT](LICENSE)
