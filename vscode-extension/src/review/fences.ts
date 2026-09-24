import fromMarkdown = require("mdast-util-from-markdown");
import { markdownTooComplex } from "./validate";

export interface CodeFence {
  index: number;
  language: string;
  languageStart: number;
  languageEnd: number;
  insertionOffset: number;
  hasMetadata: boolean;
}

interface Node {
  type?: unknown;
  children?: unknown;
  position?: { start?: { offset?: unknown } };
}

/** Collects only source-backed backtick/tilde fences; mdast's indented code has no opening fence here. */
export function markdownFences(source: string): CodeFence[] {
  if (markdownTooComplex(source)) return [];
  const bom = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  const found: Omit<CodeFence, "index">[] = [];
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    const node = value as Node;
    const parsedOffset = node.position?.start?.offset;
    const offset = typeof parsedOffset === "number" ? parsedOffset + bom : undefined;
    if (node.type === "code" && typeof offset === "number") {
      const lineEnd = source.indexOf("\n", offset);
      const line = source.slice(offset, lineEnd === -1 ? source.length : lineEnd).replace(/\r$/, "");
      const opening = /^(`{3,}|~{3,})(.*)$/.exec(line);
      if (opening) {
        const info = opening[2];
        const token = /\S+/.exec(info);
        const languageStart = offset + opening[1].length + (token ? token.index : 0);
        const languageEnd = token ? languageStart + token[0].length : languageStart;
        const metadata = token ? info.slice((token.index ?? 0) + token[0].length).trim() : "";
        found.push({ language: token?.[0] ?? "", languageStart, languageEnd, insertionOffset: languageEnd, hasMetadata: Boolean(metadata) });
      }
    }
    if (Array.isArray(node.children)) for (const child of node.children) visit(child);
  };
  try { visit(fromMarkdown(source.slice(bom))); } catch { return []; }
  return found.sort((a, b) => a.languageStart - b.languageStart).map((fence, index) => ({ index, ...fence }));
}
