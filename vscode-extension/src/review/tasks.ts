import fromMarkdown = require("mdast-util-from-markdown");
import { frontMatterRange, markdownTooComplex } from "./validate";

export interface MarkdownTask {
  /** Offset of the three-character Markdown marker, e.g. `[x]`. */
  offset: number;
  checked: boolean;
  label: string;
}

interface Node {
  type?: unknown;
  children?: unknown;
  position?: { start?: { offset?: unknown } };
}

/** Finds only Markdown-it-compatible task markers that belong to parsed list items. */
export function markdownTasks(source: string): MarkdownTask[] {
  if (markdownTooComplex(source)) return [];
  const tasks: MarkdownTask[] = [];
  const bom = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  const frontMatter = frontMatterRange(source)?.end ?? -1;
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    const node = value as Node;
    if (node.type === "listItem" && Array.isArray(node.children)) {
      const first = node.children[0] as Node | undefined;
      const parsedOffset = first?.position?.start?.offset;
      const offset = typeof parsedOffset === "number" ? parsedOffset + bom : undefined;
      if (first?.type === "paragraph" && typeof offset === "number" && (frontMatter < 0 || offset >= frontMatter)
        && /^\[([ xX])\] /.test(source.slice(offset, offset + 4))) {
        const lineEnd = source.indexOf("\n", offset);
        const limit = lineEnd === -1 ? source.length : lineEnd;
        tasks.push({ offset, checked: /[xX]/.test(source[offset + 1]), label: source.slice(offset + 4, limit).trim() });
      }
    }
    if (Array.isArray(node.children)) for (const child of node.children) visit(child);
  };
  try { visit(fromMarkdown(source.slice(bom))); } catch { return []; }
  return tasks.sort((a, b) => a.offset - b.offset);
}

export function matchesMarkdownTask(source: string, offset: number, checked: boolean): boolean {
  const marker = source.slice(offset, offset + 3);
  return Number.isSafeInteger(offset) && offset >= 0 && (checked ? marker === "[x]" || marker === "[X]" : marker === "[ ]")
    && markdownTasks(source).some((task) => task.offset === offset && task.checked === checked);
}
