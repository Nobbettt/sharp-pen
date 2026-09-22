import type { Level } from "./types";

export type ReviewIntent =
  | { type: "ready" }
  | { type: "analyze" }
  | { type: "cancel" }
  | { type: "choose"; suggestionId: string; option: number | null }
  | { type: "acceptAll"; level: Level }
  | { type: "reset"; level: Level }
  | { type: "apply" }
  | { type: "openSettings" };

const fields: Record<ReviewIntent["type"], readonly string[]> = {
  ready: ["type"], analyze: ["type"], cancel: ["type"], apply: ["type"], openSettings: ["type"],
  choose: ["type", "suggestionId", "option"], acceptAll: ["type", "level"], reset: ["type", "level"],
};

/** Treat webview messages as untrusted data, including unknown fields. */
export function parseReviewIntent(value: unknown): ReviewIntent | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  if (typeof input.type !== "string" || !Object.prototype.hasOwnProperty.call(fields, input.type)) return undefined;
  if (Object.keys(input).some((key) => !fields[input.type as ReviewIntent["type"]].includes(key))) return undefined;
  switch (input.type) {
    case "ready": return { type: "ready" };
    case "analyze": return { type: "analyze" };
    case "cancel": return { type: "cancel" };
    case "apply": return { type: "apply" };
    case "openSettings": return { type: "openSettings" };
    case "choose":
      return typeof input.suggestionId === "string" && input.suggestionId.length > 0
        && (input.option === null || (Number.isSafeInteger(input.option) && (input.option as number) >= 0))
        ? { type: "choose", suggestionId: input.suggestionId, option: input.option as number | null }
        : undefined;
    case "acceptAll": case "reset":
      return input.level === 1 || input.level === 2 ? { type: input.type, level: input.level } : undefined;
    default:
      return undefined;
  }
}
