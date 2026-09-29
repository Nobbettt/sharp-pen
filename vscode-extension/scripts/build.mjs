import { copyFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

/** The extension host code bundled into one file, so activation loads it (and its npm dependencies) in one read. */
export const extensionBuild = {
  entryPoints: ["src/extension.ts"], bundle: true, platform: "node", format: "cjs", target: "node18",
  external: ["vscode"], sourcemap: true, outfile: "out/extension.js",
};

export const webviewBuilds = [
  ["src/webview/reviewClient.js", "media/review.js"],
  ["src/webview/settingsClient.js", "media/settings.js"],
].map(([entryPoint, outfile]) => ({
  entryPoints: [entryPoint], bundle: true, format: "iife", target: "es2022",
  banner: { js: `/* Generated from ${entryPoint}; do not edit. */` }, outfile,
}));

// pathToFileURL, not `file://${argv[1]}`: on Windows argv[1] is `D:\...`, which never matched and skipped the build.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Mermaid ships its own self-contained bundle; the webview loads it lazily for ```mermaid fences.
  await copyFile("node_modules/mermaid/dist/mermaid.min.js", "media/mermaid.min.js");
  await Promise.all([extensionBuild, ...webviewBuilds].map((options) => build(options)));
}
