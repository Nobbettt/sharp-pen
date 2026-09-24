import type { SettingsStore } from "../config";
import type { AnalysisRequest, AnalysisRunner } from "../reviewController";
import { ReviewValidationError, parseAgentResponse, validateAgentResponse } from "../review/validate";
import { ProcessRunnerError } from "./processRunner";
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
    const analyze = async (input: string): Promise<unknown> => {
      const value = parseAgentResponse(await adapter.analyze(input, model ? { model } : {}, signal));
      if (adapter.id === "copilot") validateAgentResponse(value, request.title);
      return value;
    };
    try {
      return await analyze(prompt);
    } catch (error) {
      if (adapter.id !== "copilot" || !(error instanceof ReviewValidationError)) throw error;
    }
    try {
      return await analyze(`${prompt}\nFinal reminder: return only the required JSON object with title, level1, and level2.`);
    } catch (error) {
      if (!(error instanceof ReviewValidationError)) throw error;
      throw new ProcessRunnerError("exit", "GitHub Copilot returned a response that sharp-pen could not read. Retry, or choose another model.");
    }
  };
}
