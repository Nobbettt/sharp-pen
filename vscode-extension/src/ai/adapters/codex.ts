import { BaseAdapter } from "./shared";

const required = ["--sandbox", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--strict-config", "--disable", "--config", "--json"] as const;
// These are the current, non-removed switches which expose local, browser, or MCP tools.
const disabledFeatures = [
  "apps", "browser_use", "browser_use_external", "browser_use_full_cdp_access", "computer_use", "enable_mcp_apps",
  "hooks", "image_generation", "in_app_browser", "in_app_chat", "in_app_dictation", "in_app_local_automation", "multi_agent",
  "plugin_sharing", "plugins", "remote_plugin", "shell_tool", "skill_search", "tool_call_mcp_elicitation", "tool_suggest",
  "unified_exec", "unified_exec_tty", "view_image",
] as const;

export class CodexAdapter extends BaseAdapter {
  readonly id = "codex" as const;

  protected versionIssue(version: string | undefined): string | undefined {
    if (version === "codex-cli 0.155.1") return undefined;
    // Never interpolate raw CLI output into a message shown in the UI; only a validated version token.
    const match = /^codex-cli (\d+\.\d+\.\d+)$/.exec(version ?? "");
    const label = match ? `codex-cli ${match[1]}` : "an unrecognised version";
    return `${label} has not been safety-reviewed. sharp-pen currently supports Codex CLI 0.155.1.`;
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
      "--config", "shell_environment_policy.inherit=none", "--config", "web_search=disabled", "--json",
      ...(model && capabilities.has("--model") ? ["--model", model] : []),
    ];
  }

  protected async safetyIssue(_capabilities: ReadonlySet<string>, signal?: AbortSignal): Promise<string | undefined> {
    const features = await this.runner({ executable: this.id, args: ["features", "list"], signal, timeoutMs: 5_000, stdoutLimit: 64_000, stderrLimit: 8_192 });
    const available = new Set(features.stdout.split(/\r?\n/).flatMap((line) => {
      const match = /^(\S+)\s+(?!removed\b).*\s+(?:true|false)\s*$/.exec(line);
      return match ? [match[1]] : [];
    }));
    const missing = disabledFeatures.filter((feature) => !available.has(feature));
    if (missing.length) return `its installed version cannot disable ${missing.join(", ")}. Upgrade Codex and try again.`;
    return undefined;
  }
}
