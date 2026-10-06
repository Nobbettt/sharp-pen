import { documentBlockSlices } from "./chunks";
import { frontMatterRange, REVIEW_LIMITS } from "./validate";
import { parseMarkdownTree, type MarkdownTree } from "./markdownTree";

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
export function markdownTasks(source: string, tree: MarkdownTree | undefined = parseMarkdownTree(source)): MarkdownTask[] {
  if (source.length > REVIEW_LIMITS.source) return largeDocumentTasks(source);
  return tasksIn(source, tree, true);
}

/** `documentStart` is false for a block taken from further down a document, where `---` is never front matter. */
function tasksIn(source: string, tree: MarkdownTree | undefined, documentStart: boolean): MarkdownTask[] {
  if (tree === undefined) return [];
  const tasks: MarkdownTask[] = [];
  const bom = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  const frontMatter = documentStart ? (frontMatterRange(source)?.end ?? -1) : -1;
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
  visit(tree);
  return tasks.sort((a, b) => a.offset - b.offset);
}

let blockTasks = new Map<string, MarkdownTask[]>();
/** Only a block holding a task marker is worth a parse. */
const taskMarker = /\[[ xX]\]/;

/**
 * Above the per-request limit: tasks block by block, so an edit only re-parses its own block. A block is at most
 * REVIEW_LIMITS.source, so this never recurses. Only blocks of the current text are kept between calls.
 */
function largeDocumentTasks(source: string): MarkdownTask[] {
  const blocks = documentBlockSlices(source);
  if (!blocks) return [];
  const used = new Map<string, MarkdownTask[]>();
  const tasks = blocks.flatMap(({ start, text }) => {
    if (text.length > REVIEW_LIMITS.source || !taskMarker.test(text)) return [];
    let found = used.get(text) ?? blockTasks.get(text);
    if (!found) found = tasksIn(text, parseMarkdownTree(text), start === 0);
    used.set(text, found);
    return found.map((task) => ({ ...task, offset: task.offset + start }));
  });
  blockTasks = used;
  return tasks;
}

export function matchesMarkdownTask(source: string, offset: number, checked: boolean): boolean {
  const marker = source.slice(offset, offset + 3);
  return Number.isSafeInteger(offset) && offset >= 0 && (checked ? marker === "[x]" || marker === "[X]" : marker === "[ ]")
    && markdownTasks(source).some((task) => task.offset === offset && task.checked === checked);
}
