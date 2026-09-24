import hljs from "highlight.js/lib/common";
import { highlightLanguage } from "../review/fenceHighlight";

export const HIGHLIGHT_CODE_LIMIT = 4_000;
export const HIGHLIGHT_RENDER_LIMIT = 8_000;

export interface HighlightBudget { attempted: number; }

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Explicit grammar only: no auto-detection, network, eval, or runtime loading. */
export function highlightCode(code: string, sourceLanguage: string, budget?: HighlightBudget): { html: string; highlighted: boolean } {
  const language = highlightLanguage(sourceLanguage);
  if (!language || code.length > HIGHLIGHT_CODE_LIMIT || (budget && budget.attempted + code.length > HIGHLIGHT_RENDER_LIMIT)) return { html: escape(code), highlighted: false };
  if (budget) budget.attempted += code.length;
  try { return { html: hljs.highlight(code, { language, ignoreIllegals: true }).value, highlighted: true }; }
  catch { return { html: escape(code), highlighted: false }; }
}
