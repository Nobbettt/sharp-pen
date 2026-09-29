# VS Code extension real AI CLIs (`vscode-extension-real-ai.yml`)

**What it's for:** checking that the extension works with the real AI tools (Claude Code, Codex, GitHub Copilot CLI and OpenCode) on Windows, macOS and Linux, using real logins instead of fake tools.

**When it runs:** only when started by `npm run test:ai` from the developer's Mac (`vscode-extension/scripts/test-ai.mjs`). It never runs on pushes or pull requests. GitHub can only start it once this file is on the `main` branch.

**What it does:** for every combination of AI tool and computer type, it installs the newest release of that AI tool, gives it the developer's own login, starts a real VS Code, and runs one real proofreading analysis. The results are collected by `npm run test:ai`, which prints them as a table.

## Before it runs (done by `npm run test:ai`)

1. Reads the developer's AI logins on the Mac, from the Keychain and the tools' login files.
2. Stores them as secrets in a GitHub environment named `real-ai`.
3. Starts this workflow, with a unique tag so it can find this exact run again.
4. After the run, deletes the secrets again, even if something failed.

## Steps

Each combination of AI tool and computer (up to 4 tools × 6 computers) runs as its own job, at the same time. One failing job doesn't stop the others.

1. Check out the code and install Node.js 22.
2. Install the dependencies and build the extension and its tests.
3. **Install the AI tool** for this job, at its newest release.
4. **Hand over the login,** only for this job's own tool:
   - Codex and OpenCode: their login file is written to a temporary folder, and the tool is told to look there.
   - Claude Code and GitHub Copilot: their token is passed in the next step as an environment variable.
5. **Run the real test in VS Code.** It checks that the extension accepts the tool, lists the tool's models, runs one real analysis of a short test document with deliberate mistakes (at least one suggestion must be placed), and cancels a second analysis within 5 seconds. On Linux, VS Code runs inside a virtual display (`xvfb`).
6. **Record the result.** If the job failed before the test could write a result, a "failed" result is written, so the summary always has one entry per job.
7. **Upload the result file** so `npm run test:ai` can download it.

Every run makes real, billed AI calls on the developer's accounts. Codex and OpenCode may refresh their copied logins during the run, which can sign the developer's Mac out of that tool.
