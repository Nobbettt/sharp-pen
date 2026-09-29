import { spawn } from "node:child_process";
import { join } from "node:path";
import { context } from "esbuild";
import { copyMermaid, extensionBuild, webviewBuilds } from "./build.mjs";

// media/mermaid.min.js is gitignored, so a fresh clone has none until this copies it.
await copyMermaid();
const builds = await Promise.all([extensionBuild, ...webviewBuilds].map((options) => context(options)));
// esbuild writes the output; tsc only type-checks.
const tsc = spawn(process.execPath, [join("node_modules", "typescript", "bin", "tsc"), "-p", ".", "--watch", "--noEmit"], { stdio: "inherit" });
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
