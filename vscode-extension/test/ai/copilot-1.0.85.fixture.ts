const response = '{"title":"Draft","level1":[],"level2":[]}';

/** Captured Copilot 1.0.85 JSONL shape, with all values replaced by harmless fixtures. */
export const copilot185Output = [
  { type: "assistant.reasoning_delta", data: { deltaContent: "not a response" } },
  { type: "assistant.message", data: { content: '{"title":"tool request"}', toolRequests: [{ name: "shell" }] } },
  { type: "tool.execution_complete", data: { result: { content: response } } },
  { type: "assistant.message_delta", data: { deltaContent: response } },
  { type: "assistant.message", data: { toolRequests: [], message: { content: [{ type: "text", text: `\`\`\`json\n${response}\n\`\`\`` }] } } },
  { type: "result", exitCode: 0 },
].map((event) => JSON.stringify(event)).join("\n");
