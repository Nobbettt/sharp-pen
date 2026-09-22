import { BaseAdapter } from "./shared";

const required = [
  "--print", "--output-format", "--restricted", "--safe-mode", "--strict-mcp-config",
  "--permission-mode", "--permission-prompts", "--no-session-persistence",
  "--disable-slash-commands", "--no-chrome", "--tools",
] as const;

export class ClaudeAdapter extends BaseAdapter {
  readonly id = "claude" as const;

  protected requiredCapabilities(): readonly string[] {
    return required;
  }

  protected args(capabilities: ReadonlySet<string>, model?: string): string[] {
    return [
      "--print", "--output-format", "json", "--restricted", "--safe-mode", "--strict-mcp-config",
      "--permission-mode", "plan", "--permission-prompts", "none", "--no-session-persistence",
      "--disable-slash-commands", "--no-chrome", "--tools", "",
      ...(model && capabilities.has("--model") ? ["--model", model] : []),
    ];
  }
}
