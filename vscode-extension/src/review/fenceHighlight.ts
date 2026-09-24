const aliases: Readonly<Record<string, string>> = {
  typescript: "typescript", ts: "typescript", typescriptreact: "typescript", tsx: "typescript",
  javascript: "javascript", js: "javascript", javascriptreact: "javascript", jsx: "javascript",
  html: "xml", xml: "xml", css: "css", scss: "scss", less: "less", json: "json", jsonc: "json",
  shellscript: "bash", shell: "bash", bash: "bash", sh: "bash", zsh: "bash",
  csharp: "csharp", cs: "csharp", c: "c", cpp: "cpp", "c++": "cpp", python: "python", py: "python",
  java: "java", go: "go", rust: "rust", php: "php", ruby: "ruby", rb: "ruby", sql: "sql",
  yaml: "yaml", yml: "yaml", markdown: "markdown", md: "markdown", graphql: "graphql", kotlin: "kotlin",
  lua: "lua", perl: "perl", r: "r", makefile: "makefile", "objective-c": "objectivec", objectivec: "objectivec",
  vb: "vbnet", vbnet: "vbnet", wasm: "wasm", swift: "swift", diff: "diff", ini: "ini", properties: "ini",
};

/** Maps only source/VS Code language IDs that Highlight.js common can explicitly render. */
export function highlightLanguage(id: string): string | undefined {
  return aliases[id.toLowerCase()];
}

export function highlightableInstalledLanguageIds(installed: readonly string[]): string[] {
  return [...new Set(installed.filter((id) => highlightLanguage(id) !== undefined))].sort((a, b) => a.localeCompare(b));
}
