#!/usr/bin/env node
// Tests sharp-pen against the real, signed-in AI CLIs on every platform with one command:
//   npm run test:ai [-- --local | --ci] [--cli claude,codex] [--platform macos-local,windows-11-arm] [--keep-secrets]
// It uses this Mac's own CLI logins (Keychain and login files), never API keys. Docker and CI get
// copies of them; a CLI that refreshes its copy there can sign this Mac out of that CLI.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const allClis = ["claude", "codex", "copilot", "opencode"];
const localTargets = ["macos-local", "linux-docker"];
const ciTargets = ["ubuntu-latest", "ubuntu-24.04-arm", "macos-latest", "macos-15-intel", "windows-latest", "windows-11-arm"];
const workflow = "vscode-extension-real-ai.yml";
const ciEnvironment = "real-ai";
const secretNames = { claude: "SHARP_PEN_CLAUDE_TOKEN", copilot: "SHARP_PEN_COPILOT_TOKEN", codex: "SHARP_PEN_CODEX_AUTH", opencode: "SHARP_PEN_OPENCODE_AUTH" };
const claudeExpiryWarningMs = 30 * 60_000;
const runLookupAttempts = 20;
const runLookupDelayMs = 3_000;
const shell = process.platform === "win32";

function parseArgs(argv) {
  const flags = new Set(["--local", "--ci", "--cli", "--platform", "--keep-secrets"]);
  argv.forEach((arg, index) => {
    if (arg.startsWith("--") && !flags.has(arg)) throw new Error(`unknown option ${arg}`);
    if (!arg.startsWith("--") && !["--cli", "--platform"].includes(argv[index - 1])) throw new Error(`unexpected argument ${arg}`);
  });
  const list = (flag) => { const index = argv.indexOf(flag); return index >= 0 ? (argv[index + 1] ?? "").split(",").filter(Boolean) : undefined; };
  const targets = list("--platform") ?? (argv.includes("--local") ? localTargets : argv.includes("--ci") ? ciTargets : [...localTargets, ...ciTargets]);
  const clis = list("--cli") ?? allClis;
  const badTarget = targets.find((target) => ![...localTargets, ...ciTargets].includes(target));
  if (badTarget) throw new Error(`unknown platform ${badTarget}; use ${[...localTargets, ...ciTargets].join(", ")}`);
  const badCli = clis.find((cli) => !allClis.includes(cli));
  if (badCli) throw new Error(`unknown CLI ${badCli}; use ${allClis.join(", ")}`);
  return { targets, clis, keepSecrets: argv.includes("--keep-secrets") };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", shell, maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  return result;
}

function must(command, args, options = {}) {
  const result = run(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) throw new Error(`${command} ${args[0]} failed (exit ${result.status})`);
  return result;
}

const tail = (text, lines = 15) => (text ?? "").trim().split(/\r?\n/).slice(-lines).join("\n");

function readResult(file, cli, fallbackDetail) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return { cli, outcome: "fail", detail: fallbackDetail, steps: [] }; }
}

function privateDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  chmodSync(dir, 0o700);
  return dir;
}

/** macOS itself: the CLIs use their own logins, exactly as the installed extension would. */
function runNative(clis, results) {
  if (process.platform !== "darwin") {
    clis.forEach((cli) => results.push({ target: "macos-local", cli, outcome: "skip", detail: "this machine is not a Mac", steps: [] }));
    return;
  }
  must("npm", ["run", "compile"], { stdio: ["ignore", "ignore", "inherit"] });
  must("npx", ["tsc", "-p", "tsconfig.test.json"]);
  const dir = privateDir("sharp-pen-ai-");
  try {
    for (const cli of clis) {
      console.log(`> macos-local  ${cli}`);
      const file = join(dir, `${cli}.json`);
      const output = run(process.execPath, ["out/test/integration/runTest.js"], { env: { ...process.env, SHARP_PEN_REAL_CLI: cli, SHARP_PEN_RESULT_FILE: file } });
      results.push({ target: "macos-local", ...readResult(file, cli, `no result written; last output:\n${tail(output.stdout + output.stderr)}`) });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function keychain(service) {
  if (process.platform !== "darwin") return undefined;
  try { return execFileSync("security", ["find-generic-password", "-s", service, "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return undefined; }
}

// One line, so GitHub masks the whole value if a secret ever reaches a log.
function jsonFile(path) {
  try { return JSON.stringify(JSON.parse(readFileSync(path, "utf8"))); } catch { return undefined; }
}

/** Reads this machine's CLI logins. Claude and Copilot become tokens the CLIs never refresh; Codex and OpenCode are login files. */
function readLogins() {
  const logins = {};
  try {
    const claude = JSON.parse(keychain("Claude Code-credentials") ?? jsonFile(join(homedir(), ".claude", ".credentials.json")) ?? "{}").claudeAiOauth;
    if (claude?.accessToken) logins.claude = { value: claude.accessToken, expiresAt: claude.expiresAt };
  } catch { /* No readable Claude login. */ }
  const copilot = keychain("github-copilot-app") ?? process.env.COPILOT_GITHUB_TOKEN;
  if (copilot) logins.copilot = { value: copilot };
  const codex = jsonFile(join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "auth.json"));
  if (codex) logins.codex = { value: codex };
  const opencode = jsonFile(join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "opencode", "auth.json"));
  if (opencode) logins.opencode = { value: opencode };
  const minutes = logins.claude?.expiresAt ? Math.round((logins.claude.expiresAt - Date.now()) / 60_000) : undefined;
  if (minutes !== undefined && minutes * 60_000 < claudeExpiryWarningMs) {
    console.warn(`! The Claude access token expires in ${minutes} min; Docker and CI Claude runs may fail. Use Claude Code on this Mac to refresh it, then rerun.`);
  }
  console.log(`Logins found: ${Object.keys(logins).join(", ") || "none"}`);
  return logins;
}

function skipWithoutLogin(targets, clis, logins, results) {
  const tested = clis.filter((cli) => logins[cli]);
  for (const target of targets) {
    for (const cli of clis.filter((candidate) => !logins[candidate])) results.push({ target, cli, outcome: "skip", detail: "no login found on this Mac", steps: [] });
  }
  return tested;
}

/** Starts the CI matrix with this Mac's logins as short-lived environment secrets. Returns what finishCi needs. */
function startCi(targets, clis, logins, results) {
  const tested = skipWithoutLogin(targets, clis, logins, results);
  if (!tested.length) return undefined;
  const git = (...args) => run("git", args).stdout.trim();
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  const upstream = run("git", ["rev-parse", "@{u}"]).stdout.trim();
  if (!upstream || upstream !== git("rev-parse", "HEAD") || git("status", "--porcelain")) {
    console.warn(`! CI tests ${branch} as pushed${upstream ? ` (${upstream.slice(0, 7)})` : ""}, not unpushed or uncommitted local changes.`);
  }
  // Always returns `ci`, so finishCi deletes whichever secrets were uploaded even if a later step failed.
  const ci = { targets, tested, secrets: [] };
  try {
    must("gh", ["api", "-X", "PUT", `repos/{owner}/{repo}/environments/${ciEnvironment}`, "--silent"]);
    for (const cli of tested) {
      ci.secrets.push(secretNames[cli]);
      must("gh", ["secret", "set", secretNames[cli], "--env", ciEnvironment], { input: logins[cli].value, stdio: ["pipe", "ignore", "inherit"] });
    }
    const tag = `${Date.now().toString(36)}-${process.pid}`;
    const dispatch = run("gh", ["workflow", "run", workflow, "--ref", branch, "-f", `tag=${tag}`, "-f", `clis=${JSON.stringify(tested)}`, "-f", `platforms=${JSON.stringify(targets)}`]);
    if (dispatch.status !== 0) throw new Error(`could not start ${workflow} (it must exist on the default branch to be started): ${tail(dispatch.stderr, 3)}`);
    ci.run = findRun(branch, tag);
    console.log(`CI started: ${ci.run?.url ?? "run not found yet"}`);
  } catch (error) {
    ci.error = error instanceof Error ? error.message : String(error);
  }
  return ci;
}

function findRun(branch, tag) {
  for (let attempt = 0; attempt < runLookupAttempts; attempt += 1) {
    const listed = run("gh", ["run", "list", "--workflow", workflow, "--branch", branch, "--event", "workflow_dispatch", "--json", "databaseId,displayTitle,url", "-L", "10"]);
    const found = JSON.parse(listed.stdout || "[]").find((candidate) => candidate.displayTitle.endsWith(tag));
    if (found) return found;
    spawnSync(process.execPath, ["-e", `setTimeout(() => {}, ${runLookupDelayMs})`]);
  }
  return undefined;
}

/** Waits for the CI run, collects each job's result, and always deletes the login secrets. */
function finishCi(ci, keepSecrets, results) {
  if (!ci) return;
  try {
    const failAll = (detail) => ci.targets.forEach((target) => ci.tested.forEach((cli) => results.push({ target, cli, outcome: "fail", detail, steps: [] })));
    if (ci.error) return failAll(ci.error);
    if (!ci.run) return failAll("the CI run did not appear; check the Actions tab");
    console.log("Waiting for CI...");
    run("gh", ["run", "watch", String(ci.run.databaseId), "--interval", "20"], { stdio: ["ignore", "ignore", "inherit"] });
    const dir = privateDir("sharp-pen-ai-ci-");
    try {
      run("gh", ["run", "download", String(ci.run.databaseId), "-D", dir], { stdio: ["ignore", "ignore", "inherit"] });
      for (const target of ci.targets) {
        for (const cli of ci.tested) {
          const name = `real-ai-${target}-${cli}`;
          results.push({ target, cli, ...readResult(join(dir, name, `${name}.json`), cli, `no result; see ${ci.run.url}`) });
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  } finally {
    if (!keepSecrets) ci.secrets.forEach((name) => run("gh", ["secret", "delete", name, "--env", ciEnvironment], { stdio: "ignore" }));
  }
}

/** Linux in Docker on this machine's own architecture. The container gets copies of the logins. */
function runDocker(clis, logins, results) {
  if (run("docker", ["info"], { stdio: "ignore" }).status !== 0) {
    clis.forEach((cli) => results.push({ target: "linux-docker", cli, outcome: "skip", detail: "Docker is not running", steps: [] }));
    return;
  }
  const tested = skipWithoutLogin(["linux-docker"], clis, logins, results);
  if (!tested.length) return;
  console.log(`> linux-docker ${tested.join(", ")} (building the image with the latest CLIs)`);
  must("docker", ["build", "-q", "-t", "sharp-pen-real-ai", "--build-arg", `CLI_REFRESH=${new Date().toISOString().slice(0, 10)}`, "test/real-ai"], { stdio: ["ignore", "ignore", "inherit"] });
  const loginDir = privateDir("sharp-pen-ai-logins-");
  const resultDir = privateDir("sharp-pen-ai-results-");
  try {
    for (const [cli, file] of [["codex", "codex/auth.json"], ["opencode", "opencode/auth.json"]]) {
      if (!logins[cli] || !tested.includes(cli)) continue;
      mkdirSync(dirname(join(loginDir, file)), { recursive: true });
      writeFileSync(join(loginDir, file), logins[cli].value, { mode: 0o600 });
    }
    // Tokens go in through the environment, never on the docker command line where `ps` would show them.
    const env = { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: tested.includes("claude") ? logins.claude.value : "", COPILOT_GITHUB_TOKEN: tested.includes("copilot") ? logins.copilot.value : "" };
    run("docker", [
      "run", "--rm", "-v", `${root}:/src:ro`, "-v", `${loginDir}:/logins:ro`, "-v", `${resultDir}:/results`,
      "-v", "sharp-pen-real-ai-vscode:/w/.vscode-test", "-e", "CLAUDE_CODE_OAUTH_TOKEN", "-e", "COPILOT_GITHUB_TOKEN",
      "-e", `SHARP_PEN_CLIS=${tested.join(" ")}`, "sharp-pen-real-ai",
    ], { env, stdio: "inherit" });
    for (const cli of tested) {
      let log = "";
      try { log = readFileSync(join(resultDir, `${cli}.log`), "utf8"); } catch { /* The container failed before this CLI ran. */ }
      results.push({ target: "linux-docker", ...readResult(join(resultDir, `${cli}.json`), cli, `no result written; last output:\n${tail(log) || "(none)"}`) });
    }
  } finally {
    rmSync(loginDir, { recursive: true, force: true });
    rmSync(resultDir, { recursive: true, force: true });
  }
}

function report(results) {
  const icon = { pass: "PASS", fail: "FAIL", skip: "skip" };
  console.log("\nResults");
  for (const result of results) {
    const detail = result.outcome === "pass" ? result.steps.join("; ") : result.detail;
    console.log(`${icon[result.outcome]}  ${result.target.padEnd(17)} ${result.cli.padEnd(9)} ${detail.split("\n").join("\n" + " ".repeat(33))}`);
  }
  const count = (outcome) => results.filter((result) => result.outcome === outcome).length;
  console.log(`\n${count("pass")} passed, ${count("fail")} failed, ${count("skip")} skipped`);
  return count("fail") === 0;
}

function main() {
  const { targets, clis, keepSecrets } = parseArgs(process.argv.slice(2));
  const results = [];
  // The Mac run goes first: it lets the CLIs refresh their own logins before copies go to Docker and CI.
  if (targets.includes("macos-local")) runNative(clis, results);
  const remote = targets.filter((target) => ciTargets.includes(target));
  if (!targets.includes("linux-docker") && !remote.length) return report(results);
  const logins = readLogins();
  const ci = remote.length ? startCi(remote, clis, logins, results) : undefined;
  try {
    if (targets.includes("linux-docker")) runDocker(clis, logins, results);
  } finally {
    finishCi(ci, keepSecrets, results);
  }
  return report(results);
}

try {
  process.exitCode = main() ? 0 : 1;
} catch (error) {
  console.error(`test:ai: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
