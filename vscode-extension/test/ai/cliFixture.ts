import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

export interface CliFixtureConfig {
  help?: string;
  helpStderr?: string;
  output?: string;
  codexFeatures?: string;
  codexVersion?: string;
  copilotVersion?: string;
  opencodeVersion?: string;
  opencodeModels?: string;
}

const script = `
const { readFileSync } = require('node:fs');
const { basename, join } = require('node:path');
const fixture = JSON.parse(readFileSync(join(__dirname, 'fixture.json'), 'utf8'));
const args = process.argv.slice(2);
const executable = basename(process.argv[1]).replace(/\\.(?:cmd|js)$/, '');
if (args.includes('--version')) process.stdout.write(executable === 'codex' ? (fixture.codexVersion || 'codex-cli 0.155.1') + '\\n' : executable === 'copilot' ? (fixture.copilotVersion || 'GitHub Copilot CLI 1.0.88.') + '\\n' : executable === 'opencode' ? (fixture.opencodeVersion || '1.18.32') + '\\n' : 'fixture 1.0\\n');
else if (args[0] === 'features' && args[1] === 'list') process.stdout.write(fixture.codexFeatures || '');
else if (executable === 'opencode' && args[0] === 'models') process.stdout.write(fixture.opencodeModels || 'opencode/test-model\\n');
else if (args.includes('--help')) {
  process.stdout.write(fixture.help || '');
  process.stderr.write(fixture.helpStderr || '');
} else {
  let input = '';
  process.stdin.on('data', chunk => input += chunk);
  process.stdin.on('end', () => {
    const fileIndex = args.indexOf('--file');
    const fileInput = fileIndex >= 0 ? readFileSync(args[fileIndex + 1], 'utf8') : undefined;
    const captured = JSON.stringify({ args, input, fileInput });
    process.stdout.write(fixture.output === '__capture__' && process.argv[1].endsWith('claude')
      ? JSON.stringify({ type: 'result', subtype: 'success', is_error: false, structured_output: JSON.parse(captured) })
      : fixture.output === '__capture__' && process.argv[1].endsWith('copilot')
      ? JSON.stringify({ type: 'assistant.message', data: { toolRequests: [], message: { content: [{ type: 'text', text: captured }] } } })
      : fixture.output === '__capture__' && process.argv[1].endsWith('opencode')
      ? [JSON.stringify({ type: 'step_start', part: { type: 'step-start' } }), JSON.stringify({ type: 'text', part: { type: 'text', text: captured } }), JSON.stringify({ type: 'step_finish', part: { type: 'step-finish', reason: 'stop' } })].join('\\n')
      : fixture.output === '__capture__' ? captured : ('output' in fixture ? fixture.output : input));
  });
}
`;

export async function writeCliFixtureExecutable(dir: string, name: string, body: string): Promise<void> {
  if (process.platform === "win32") {
    await writeFile(join(dir, `${name}.js`), body);
    await writeFile(join(dir, `${name}.cmd`), `@echo off\r\n"${process.execPath}" "%~dp0${name}.js" %*\r\n`);
    return;
  }
  const executable = join(dir, name);
  await writeFile(executable, `#!/usr/bin/env node\n${body}`);
  await chmod(executable, 0o755);
}

export async function cliFixture(config: CliFixtureConfig): Promise<{ set(values: CliFixtureConfig): Promise<void>; restore(): Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "sharp-pen-cli-"));
  const configPath = join(dir, "fixture.json");
  const writeConfig = () => writeFile(configPath, JSON.stringify(config));
  await writeConfig();
  await Promise.all(["claude", "codex", "copilot", "opencode"].map((name) => writeCliFixtureExecutable(dir, name, script)));
  const path = process.env.PATH;
  process.env.PATH = `${dir}${delimiter}${path ?? ""}`;
  return {
    async set(values) {
      Object.assign(config, values);
      await writeConfig();
    },
    async restore() {
      process.env.PATH = path;
      await rm(dir, { recursive: true, force: true });
    },
  };
}
