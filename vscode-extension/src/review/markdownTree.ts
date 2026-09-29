import fromMarkdown = require("mdast-util-from-markdown");
import { markdownTooComplex } from "./validate";

/** A parsed mdast tree, or undefined when the source is too complex to parse or fails to parse. */
export type MarkdownTree = unknown;

/**
 * Parses once for every source-offset scanner (tasks, fences) that runs on the same state; the tree's
 * offsets exclude a leading BOM, which each scanner adds back.
 */
export function parseMarkdownTree(source: string): MarkdownTree | undefined {
  if (markdownTooComplex(source)) return undefined;
  try { return fromMarkdown(source.slice(source.charCodeAt(0) === 0xfeff ? 1 : 0)); } catch { return undefined; }
}
