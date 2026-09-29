# VS Code extension CI (`vscode-extension-ci.yml`)

**What it's for:** checking that the VS Code extension builds and works on every platform VS Code runs on, before changes are merged.

**When it runs:** on every push and every pull request that changes something in `vscode-extension/` or this workflow.

**What it does:** it runs the extension's tests on Linux, macOS and Windows, on both Intel/AMD (x64) and ARM computers. It also starts a real copy of VS Code and checks that the extension works inside it, in both the newest VS Code and the oldest version the extension supports (1.85). The AI tools are replaced by small fake programs here, so no account or login is needed.

## Steps

The workflow has two jobs.

### Job 1: oldest supported Node.js (`minimum-runtime`)

VS Code 1.85 ships with Node.js 18, so the extension must still work there.

1. Check out the code.
2. Install Node.js 18.15.
3. Install the exact dependency versions from the lockfile (`npm ci`).
4. Build the extension and run the unit tests (`npm test`).

### Job 2: every platform (`test`)

This job runs nine times at once: six computers on the newest VS Code (Linux x64, Linux ARM, macOS ARM, macOS Intel, Windows x64, Windows ARM), plus Linux, macOS and Windows x64 again on VS Code 1.85. One failing combination doesn't stop the others.

1. Check out the code.
2. Install Node.js 22.
3. Install the dependencies from the lockfile.
4. Build the extension and run the unit tests.
5. On the newest-VS-Code runs only: build the installable `.vsix` package, to prove it can be packaged on that platform.
6. Download the chosen VS Code version and run the smoke test inside it: the extension starts, the review panel opens, and an analysis completes through a fake AI tool. On Linux, which has no screen, VS Code runs inside a virtual display (`xvfb`), installed first if it's missing.
