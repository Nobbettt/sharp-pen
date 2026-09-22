import type { SettingsStore } from "../config";
import type { AnalysisRequest, AnalysisRunner } from "../reviewController";
import { parseAgentResponse } from "../review/validate";
import { buildAnalysisPrompt } from "./prompt";
import type { CliAdapter } from "./types";

export interface AnalysisServiceDependencies {
  settings: Pick<SettingsStore, "getConfig" | "getModel">;
  select(client: ReturnType<SettingsStore["getConfig"]>["aiClient"], signal?: AbortSignal): Promise<CliAdapter>;
}

/** The provider-neutral bridge: prompt construction and schema parsing stay local. */
export function createAnalysisRunner(dependencies: AnalysisServiceDependencies): AnalysisRunner {
  return async (request: AnalysisRequest, signal: AbortSignal): Promise<unknown> => {
    const config = dependencies.settings.getConfig();
    const prompt = buildAnalysisPrompt(request);
    const adapter = await dependencies.select(config.aiClient, signal);
    const model = dependencies.settings.getModel(adapter.id);
    const text = await adapter.analyze(prompt, model ? { model } : {}, signal);
    return parseAgentResponse(text);
  };
}
