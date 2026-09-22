import { BaseAdapter } from "./shared";

export class OpenCodeAdapter extends BaseAdapter {
  readonly id = "opencode" as const;

  protected helpArgs(): string[] {
    return ["run", "--help"];
  }

  protected async safetyIssue(): Promise<string | undefined> {
    return "it cannot guarantee a fixed invocation with all tools, custom agents, configuration, and MCP disabled. OpenCode 0.5.12 is unsupported; upgrade to a version that provides those controls.";
  }

  protected args(_capabilities: ReadonlySet<string>, _model?: string): string[] {
    return ["run"];
  }
}
