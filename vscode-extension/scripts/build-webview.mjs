import { build } from "esbuild";

await Promise.all([
  ["src/webview/reviewClient.js", "media/review.js"],
  ["src/webview/settingsClient.js", "media/settings.js"],
].map(([entryPoint, outfile]) => build({
  entryPoints: [entryPoint], bundle: true, format: "iife", target: "es2022",
  banner: { js: `/* Generated from ${entryPoint}; do not edit. */` }, outfile,
})));
