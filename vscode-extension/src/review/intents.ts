import type { Level } from "./types";

export type ReviewIntent =
  | { type: "ready" }
  | { type: "analyze" }
  | { type: "cancel" }
  | { type: "choose"; suggestionId: string; option: number | null }
  | { type: "acceptAll"; level: Level }
  | { type: "reset"; level: Level }
  | { type: "apply" }
  | { type: "scrollSource"; ratio: number }
  | { type: "toggleTask"; offset: number; checked: boolean; documentVersion: number }
  | { type: "setCodeFenceLanguage"; fenceIndex: number; languageId: string; documentVersion: number }
  | { type: "openSettings" };

const fields: Record<ReviewIntent["type"], readonly string[]> = {
  ready: ["type"], analyze: ["type"], cancel: ["type"], apply: ["type"], openSettings: ["type"],
  scrollSource: ["type", "ratio"],
  choose: ["type", "suggestionId", "option"], acceptAll: ["type", "level"], reset: ["type", "level"],
  toggleTask: ["type", "offset", "checked", "documentVersion"],
  setCodeFenceLanguage: ["type", "fenceIndex", "languageId", "documentVersion"],
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
    case "scrollSource":
      return typeof input.ratio === "number" && Number.isFinite(input.ratio) && input.ratio >= 0 && input.ratio <= 1
        ? { type: "scrollSource", ratio: input.ratio }
        : undefined;
    case "toggleTask":
      return Number.isSafeInteger(input.offset) && (input.offset as number) >= 0 && typeof input.checked === "boolean"
        && Number.isSafeInteger(input.documentVersion) && (input.documentVersion as number) >= 0
        ? { type: "toggleTask", offset: input.offset as number, checked: input.checked, documentVersion: input.documentVersion as number }
        : undefined;
    case "setCodeFenceLanguage":
      return Number.isSafeInteger(input.fenceIndex) && (input.fenceIndex as number) >= 0 && typeof input.languageId === "string"
        && input.languageId.length <= 128
        && Number.isSafeInteger(input.documentVersion) && (input.documentVersion as number) >= 0
        ? { type: "setCodeFenceLanguage", fenceIndex: input.fenceIndex as number, languageId: input.languageId, documentVersion: input.documentVersion as number }
        : undefined;
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
