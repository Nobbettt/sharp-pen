export interface ModelPickerOption {
  label: string;
  description: string;
  model?: string;
  action?: "manual" | "refresh";
}

/** Keep manual selection possible even when no provider can be probed. */
export function modelPickerOptions(currentModel: string, models: readonly string[], manualDescription: string): readonly ModelPickerOption[] {
  return [
    { label: "Use client default", description: "Clear the model override", model: "" },
    ...(currentModel ? [{ label: currentModel, description: "Current selection", model: currentModel }] : []),
    ...models.filter((model) => model !== currentModel).map((model) => ({ label: model, description: "Available model", model })),
    { label: "Enter model ID…", description: manualDescription, action: "manual" },
    { label: "Refresh models", description: "Query this client again", action: "refresh" },
  ];
}
