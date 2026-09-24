import { BaseAdapter, extractCopilotFinalText } from "./shared";

const required = [
  "--silent", "--output-format", "--mode", "--excluded-tools", "--disable-builtin-mcps", "--deny-url",
  "--no-custom-instructions", "--no-remote", "--no-remote-export", "--no-auto-update", "--no-experimental", "--no-bash-env", "--no-ask-user",
] as const;

const excludedTools = [
  "bash", "read_bash", "stop_bash", "list_bash", "write_bash", "powershell", "read_powershell", "stop_powershell",
  "list_powershell", "write_powershell", "view", "create", "edit", "web_fetch", "fetch_copilot_cli_documentation",
  "skill", "sql", "session_store_sql", "read_agent", "list_agents", "write_agent", "grep", "glob", "task",
] as const;

export class CopilotAdapter extends BaseAdapter {
  readonly id = "copilot" as const;

  protected versionIssue(version: string | undefined): string | undefined {
    if (version === "GitHub Copilot CLI 1.0.88.") return undefined;
    const match = /^GitHub Copilot CLI (\d+\.\d+\.\d+)\.?$/.exec(version ?? "");
    return `${match ? `GitHub Copilot CLI ${match[1]}` : "The installed GitHub Copilot CLI version"} has not been safety-reviewed. sharp-pen currently supports GitHub Copilot CLI 1.0.88.`;
  }

  protected requiredCapabilities(): readonly string[] {
    return required;
  }

  protected args(capabilities: ReadonlySet<string>, model?: string): string[] {
    return [
      "--silent", "--output-format", "json", "--mode", "plan", "--excluded-tools", ...excludedTools,
      "--disable-builtin-mcps", "--deny-url", "*", "--no-custom-instructions", "--no-remote", "--no-remote-export",
      "--no-auto-update", "--no-experimental", "--no-bash-env", "--no-ask-user",
      ...(model && capabilities.has("--model") ? ["--model", model] : []),
    ];
  }

  protected extract(stdout: string): string {
    return extractCopilotFinalText(stdout);
  }
}
