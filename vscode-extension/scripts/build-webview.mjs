import { copyFile } from "node:fs/promises";
import { build } from "esbuild";

// Mermaid ships its own self-contained bundle; the webview loads it lazily for ```mermaid fences.
await copyFile("node_modules/mermaid/dist/mermaid.min.js", "media/mermaid.min.js");

await Promise.all([
  ["src/webview/reviewClient.js", "media/review.js"],
  ["src/webview/settingsClient.js", "media/settings.js"],
].map(([entryPoint, outfile]) => build({
  entryPoints: [entryPoint], bundle: true, format: "iife", target: "es2022",
  banner: { js: `/* Generated from ${entryPoint}; do not edit. */` }, outfile,
})));
