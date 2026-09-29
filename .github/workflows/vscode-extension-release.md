# Release VS Code extension (`vscode-extension-release.yml`)

**What it's for:** publishing a new version of the VS Code extension to the VS Code Marketplace, Open VSX and GitHub Releases.

**When it runs:** when a tag named `extension-v<version>` is pushed, for example `extension-v0.2.0`. The tag must match the `version` in `vscode-extension/package.json`.

**What it does:** it builds and tests the extension once, packages it as a `.vsix` file, then uploads that same file to the VS Code Marketplace (for VS Code), Open VSX (for VSCodium, Cursor, Windsurf and similar editors), and a GitHub release.

## Steps

The workflow has two jobs. The first builds, the second publishes, so the login tokens for publishing are never present while the code is being built.

### Job 1: build

1. Check out the code.
2. Install Node.js 22.
3. **Check the version.** The tag must equal `extension-v` plus the version in `package.json`; otherwise the release stops.
4. Install the dependencies from the lockfile.
5. Run the unit tests.
6. Build the `.vsix` package, named `sharp-pen-<version>.vsix`.
7. Save the `.vsix` so the next job can use it.

### Job 2: publish

This job only starts if the build job succeeded.

1. Check out the code and install Node.js 22.
2. Download the `.vsix` from the build job.
3. Check the version again.
4. Install only the publishing tools, at the exact versions in the lockfile, without running any install scripts. This way no unpinned package is fetched while the publishing tokens are loaded.
5. **Publish to the VS Code Marketplace** with the `VSCE_PAT` token. If that version is already there, it's skipped instead of failing.
6. **Publish to Open VSX** with the `OVSX_PAT` token, again skipping a version that already exists.
7. **Create the GitHub release** for the tag, with the `.vsix` attached.

Only one extension release runs at a time.
