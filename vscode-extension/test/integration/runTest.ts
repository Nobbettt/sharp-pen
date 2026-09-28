import { resolve } from "node:path";
import { runTests } from "@vscode/test-electron";

// Compiled to out/test/integration, three levels below the extension root.
const root = resolve(__dirname, "../../..");

/** Downloads VS Code (VSCODE_TEST_VERSION, default stable) and runs suite.ts inside its extension host. */
async function main(): Promise<void> {
  await runTests({
    version: process.env.VSCODE_TEST_VERSION || "stable",
    extensionDevelopmentPath: root,
    extensionTestsPath: resolve(__dirname, "suite"),
    launchArgs: [resolve(root, "test/fixtures"), "--disable-extensions", "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes"],
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
