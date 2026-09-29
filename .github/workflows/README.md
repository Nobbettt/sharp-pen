# Workflows

The GitHub Actions workflows for this repository. Each workflow has a plain-language guide next to it with the same name.

| Workflow | Guide | In short |
|---|---|---|
| `release-skill-and-plugin.yml` | [release-skill-and-plugin.md](release-skill-and-plugin.md) | Publishes the sharp-pen skill and Claude Code plugin as a GitHub release every time a skill change is merged into `main`. |
| `vscode-extension-ci.yml` | [vscode-extension-ci.md](vscode-extension-ci.md) | Tests the VS Code extension on Linux, macOS and Windows (x64 and ARM) on every push and pull request, using fake AI tools. |
| `vscode-extension-release.yml` | [vscode-extension-release.md](vscode-extension-release.md) | Publishes the VS Code extension to the VS Code Marketplace and GitHub Releases when an `extension-v<version>` tag is pushed. |
| `vscode-extension-real-ai.yml` | [vscode-extension-real-ai.md](vscode-extension-real-ai.md) | Tests the extension with the real AI tools and the developer's own logins on every platform. Started only by `npm run test:ai`. |
