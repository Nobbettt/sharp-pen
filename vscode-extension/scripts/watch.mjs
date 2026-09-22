import { spawn } from "node:child_process";
import { join } from "node:path";
import { context } from "esbuild";

const build = await context({
  entryPoints: ["src/webview/reviewClient.js"],
  bundle: true,
  format: "iife",
  target: "es2022",
  banner: { js: "/* Generated from src/webview/reviewClient.js; do not edit. */" },
  outfile: "media/review.js",
});
const tsc = spawn(process.execPath, [join("node_modules", "typescript", "bin", "tsc"), "-p", ".", "--watch"], { stdio: "inherit" });
let stopping = false;

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  tsc.kill();
  await build.dispose();
  process.exitCode = code;
}

tsc.on("exit", (code, signal) => { if (!stopping) void stop(signal ? 0 : code ?? 1); });
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
await build.watch();
