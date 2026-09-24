import { spawn } from "node:child_process";
import { join } from "node:path";
import { context } from "esbuild";

const builds = await Promise.all([
  ["src/webview/reviewClient.js", "media/review.js"],
  ["src/webview/settingsClient.js", "media/settings.js"],
].map(([entryPoint, outfile]) => context({
  entryPoints: [entryPoint], bundle: true, format: "iife", target: "es2022",
  banner: { js: `/* Generated from ${entryPoint}; do not edit. */` }, outfile,
})));
const tsc = spawn(process.execPath, [join("node_modules", "typescript", "bin", "tsc"), "-p", ".", "--watch"], { stdio: "inherit" });
let stopping = false;

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  tsc.kill();
  await Promise.all(builds.map((build) => build.dispose()));
  process.exitCode = code;
}

tsc.on("exit", (code, signal) => { if (!stopping) void stop(signal ? 0 : code ?? 1); });
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
await Promise.all(builds.map((build) => build.watch()));
