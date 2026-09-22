import { BaseAdapter } from "./shared";

const required = ["--sandbox", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--strict-config", "--disable", "--config", "--json"] as const;
// These are the current, non-removed switches which expose local, browser, or MCP tools.
const disabledFeatures = [
  "apps", "browser_use", "browser_use_external", "browser_use_full_cdp_access", "computer_use", "enable_mcp_apps",
  "image_generation", "in_app_browser", "in_app_chat", "in_app_dictation", "in_app_local_automation", "multi_agent",
  "plugin_sharing", "plugins", "remote_plugin", "shell_tool", "skill_search", "tool_call_mcp_elicitation", "tool_suggest",
  "unified_exec", "unified_exec_tty", "view_image",
] as const;

export class CodexAdapter extends BaseAdapter {
  readonly id = "codex" as const;

  protected versionIssue(version: string | undefined): string | undefined {
    return version === "codex-cli 0.155.1"
      ? undefined
      : `${version ?? "the installed version"} has not been safety-reviewed. Sharp Pen currently supports Codex CLI 0.155.1.`;
  }

  protected helpArgs(): string[] {
    return ["exec", "--help"];
  }

  protected requiredCapabilities(): readonly string[] {
    return required;
  }

  protected args(capabilities: ReadonlySet<string>, model?: string): string[] {
    return [
      "exec", "--strict-config", "--sandbox", "read-only", "--skip-git-repo-check", "--ephemeral",
      "--ignore-user-config", "--ignore-rules", ...disabledFeatures.flatMap((feature) => ["--disable", feature]),
      "--config", "shell_environment_policy.inherit=none", "--json",
      ...(model && capabilities.has("--model") ? ["--model", model] : []),
    ];
  }

  protected async safetyIssue(capabilities: ReadonlySet<string>, signal?: AbortSignal): Promise<string | undefined> {
    try {
      const features = await this.runner({ executable: this.id, args: ["features", "list"], signal, timeoutMs: 5_000, stdoutLimit: 64_000, stderrLimit: 8_192 });
      const available = new Set(features.stdout.split(/\r?\n/).flatMap((line) => {
        const match = /^(\S+)\s+(?!removed\b).*\s+(?:true|false)\s*$/.exec(line);
        return match ? [match[1]] : [];
      }));
      const missing = disabledFeatures.filter((feature) => !available.has(feature));
      if (missing.length) return `its installed version cannot disable ${missing.join(", ")}. Upgrade Codex and try again.`;
      await this.runner({ executable: this.id, args: [...this.args(capabilities), "--help"], signal, timeoutMs: 5_000, stdoutLimit: 64_000, stderrLimit: 8_192 });
      return undefined;
    } catch {
      return "its installed version rejects the required read-only safety configuration. Upgrade Codex and try again.";
    }
  }
}
