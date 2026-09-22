import { BaseAdapter, extractCopilotFinalText } from "./shared";

const required = [
  "--prompt", "--silent", "--output-format", "--mode", "--available-tools", "--disable-builtin-mcps", "--deny-url",
  "--no-custom-instructions", "--no-remote", "--no-remote-export", "--no-auto-update", "--no-experimental", "--no-bash-env",
] as const;

export class CopilotAdapter extends BaseAdapter {
  readonly id = "copilot" as const;

  protected requiredCapabilities(): readonly string[] {
    return required;
  }

  protected args(capabilities: ReadonlySet<string>, model?: string): string[] {
    return [
      // `-` is Copilot's stdin prompt marker; an empty allowlist exposes no tools.
      "--prompt", "-", "--silent", "--output-format", "json", "--mode", "plan",
      "--available-tools", "--disable-builtin-mcps", "--deny-url", "*", "--no-custom-instructions",
      "--no-remote", "--no-remote-export", "--no-auto-update", "--no-experimental", "--no-bash-env",
      ...(model && capabilities.has("--model") ? ["--model", model] : []),
    ];
  }

  protected extract(stdout: string): string {
    return extractCopilotFinalText(stdout);
  }
}
