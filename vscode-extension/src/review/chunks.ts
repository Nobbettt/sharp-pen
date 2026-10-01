import {
  excludedRangesFromTree, frontMatterRange, markdownComplexityMessage, markdownExcludedRanges, markdownTooComplex, parseGfmMarkdown,
  ReviewValidationError, REVIEW_LIMITS, type OffsetRange,
} from "./validate";

/** A document longer than this is analysed in sections; one that fits stays a single request. */
export const CHUNK_TARGET = 20_000;
/** How many section requests run at once. */
export const CHUNK_CONCURRENCY = 3;
export const sectionTooLargeMessage = "Document has a section too large to analyze.";

export interface Chunk {
  start: number;
  end: number;
  /** Markdown only: the headings above the chunk's first line, e.g. "Install › macOS". */
  section?: string;
}

/** A top-level block, as far as it matters here: where it starts and how good a place that is to split. */
interface Block {
  start: number;
  /** A heading beats a rule beats a paragraph break; 0 for the first block. */
  score: number;
  heading?: { level: number; text: string };
}

/** Everything the document-level helpers need, computed in one pass and reused after small edits. */
interface DocState {
  source: string;
  blocks: Block[];
  /** Excluded ranges (see markdownExcludedRanges) for the whole document, ascending and non-overlapping. */
  ranges: OffsetRange[];
  /** Where the YAML front matter ends; an edit that moves it can change how the blocks around it parse. */
  frontMatterEnd: number;
}

/** Split strength of a heading: H1 is the strongest, then down to H6; a rule and a paragraph break come after. */
const headingScore = (level: number) => 9 - level;
const RULE_SCORE = 2;
const BREAK_SCORE = 1;
const MAX_SCORE = headingScore(1);

/** How much text one parse covers when the whole document is read, and when only the area of an edit is re-read. */
const WINDOW_FULL = 30_000;
const WINDOW_EDIT = 4_000;

interface MdNode { type?: string; depth?: number; value?: string; children?: MdNode[]; position?: { start: { offset: number } } }

function plainText(node: MdNode): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(plainText).join("");
}

interface Window {
  blocks: Block[];
  /** Excluded ranges of the confirmed blocks, in document offsets. */
  ranges: OffsetRange[];
  /** Where the next window starts: the first block that was not confirmed, or the end of the source. */
  next: number;
}

function mergeRanges(ranges: OffsetRange[]): OffsetRange[] {
  const merged: OffsetRange[] = [];
  for (const range of ranges) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ start: range.start, end: range.end });
  }
  return merged;
}

/**
 * Parses about `size` characters from `pos`, which is a known top-level block start, with the same parser
 * and GFM setup as the exclusions. The last block of a window may be cut off by the window's end, so it is
 * not confirmed: the next window starts there. A block that fills the whole window makes the window grow,
 * up to the request limit, above which the block is too big to analyse.
 */
function scanWindow(source: string, pos: number, size: number): Window {
  const bom = pos === 0 && source.charCodeAt(0) === 0xfeff ? 1 : 0;
  const frontMatterEnd = pos === 0 ? (frontMatterRange(source)?.end ?? 0) : 0;
  let end = Math.min(source.length, pos + size);
  for (;;) {
    const text = source.slice(pos + bom, end);
    if (markdownTooComplex(text)) throw new ReviewValidationError(markdownComplexityMessage);
    let tree: MdNode;
    try { tree = parseGfmMarkdown(text) as MdNode; } catch { throw new ReviewValidationError(markdownComplexityMessage); }
    const atEnd = end >= source.length;
    const found: Array<{ start: number; node: MdNode }> = [];
    for (const node of tree.children ?? []) {
      const offset = node.position?.start.offset;
      if (offset === undefined) continue;
      const absolute = pos + bom + offset;
      // Leading spaces belong to the block's line; a chunk must start at the line, not after its indentation.
      const start = found.length === 0 ? pos : Math.max(pos, source.lastIndexOf("\n", absolute - 1) + 1);
      // Only the true document start can have front matter; blocks parsed inside it are not real blocks.
      if (found.length > 0 && start < frontMatterEnd) continue;
      found.push({ start, node });
    }
    if (!found.length) found.push({ start: pos, node: { type: "paragraph" } });
    const confirmed = atEnd ? found : found.slice(0, -1);
    if (!confirmed.length) {
      if (end - pos > REVIEW_LIMITS.source) throw new ReviewValidationError(sectionTooLargeMessage);
      end = Math.min(source.length, pos + Math.min(2 * (end - pos), REVIEW_LIMITS.source + 1));
      continue;
    }
    const next = atEnd ? source.length : found[found.length - 1].start;
    const blocks: Block[] = confirmed.map(({ start, node }) => ({
      start,
      score: start === 0 ? 0 : node.type === "heading" && node.depth ? headingScore(node.depth) : node.type === "thematicBreak" ? RULE_SCORE : BREAK_SCORE,
      ...(node.type === "heading" && node.depth ? { heading: { level: node.depth, text: plainText(node).trim() } } : {}),
    }));

    const shift = pos + bom;
    const ranges: OffsetRange[] = [];
    if (bom) ranges.push({ start: pos, end: pos + bom });
    for (const range of excludedRangesFromTree(text, tree, 0, false)) {
      if (range.start + shift < next) ranges.push({ start: range.start + shift, end: Math.min(range.end + shift, next) });
    }
    if (frontMatterEnd) ranges.push({ start: 0, end: frontMatterEnd });
    ranges.sort((a, b) => a.start - b.start || a.end - b.end);
    return { blocks, ranges: mergeRanges(ranges), next };
  }
}

/** Index of the last element whose `start` is at most `offset`, or -1. */
function lastStartAtMost(items: ReadonlyArray<{ start: number }>, offset: number): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (items[middle].start <= offset) low = middle + 1; else high = middle;
  }
  return low - 1;
}

/**
 * Builds the block list and excluded ranges window by window, yielding between windows so a caller can
 * hand control back. Given the state of a slightly different earlier text, it re-reads only from the block
 * before the edit until a block start appears that the earlier text also had at the same distance from the
 * end: from there the rest is identical, so it is taken over (shifted) instead of parsed again.
 */
function* buildState(source: string, previous?: DocState): Generator<void, DocState> {
  if (previous?.source === source) return previous;
  const frontMatterEnd = frontMatterRange(source)?.end ?? 0;
  if (previous && previous.frontMatterEnd !== frontMatterEnd) previous = undefined;
  let blocks: Block[] = [];
  let ranges: OffsetRange[] = [];
  let pos = 0;
  let size = WINDOW_FULL;
  let editEnd = 0;
  let delta = 0;
  if (previous) {
    const old = previous.source;
    const shortest = Math.min(old.length, source.length);
    let prefix = 0;
    while (prefix < shortest && old.charCodeAt(prefix) === source.charCodeAt(prefix)) prefix += 1;
    let suffix = 0;
    while (suffix < shortest - prefix && old.charCodeAt(old.length - 1 - suffix) === source.charCodeAt(source.length - 1 - suffix)) suffix += 1;
    editEnd = source.length - suffix;
    delta = source.length - old.length;
    // One block back: the edit may have joined the block before it (a setext underline, a lazy continuation).
    const restart = Math.max(0, lastStartAtMost(previous.blocks, prefix) - 1);
    pos = previous.blocks[restart].start;
    blocks = previous.blocks.slice(0, restart);
    ranges = previous.ranges.filter((range) => range.start < pos).map((range) => ({ start: range.start, end: Math.min(range.end, pos) }));
    size = WINDOW_EDIT;
  }
  for (;;) {
    const window = scanWindow(source, pos, size);
    const lineUp = previous && window.blocks.find((block) => {
      const oldStart = block.start - delta;
      return block.start >= editEnd && oldStart > 0 && previous!.blocks[lastStartAtMost(previous!.blocks, oldStart)].start === oldStart;
    });
    if (previous && lineUp) {
      const oldStart = lineUp.start - delta;
      blocks.push(...window.blocks.filter((block) => block.start < lineUp.start));
      ranges.push(...window.ranges.filter((range) => range.start < lineUp.start).map((range) => ({ start: range.start, end: Math.min(range.end, lineUp.start) })));
      for (let index = lastStartAtMost(previous.blocks, oldStart); index < previous.blocks.length; index += 1) {
        blocks.push({ ...previous.blocks[index], start: previous.blocks[index].start + delta });
      }
      for (const range of previous.ranges) {
        if (range.end > oldStart) ranges.push({ start: Math.max(range.start, oldStart) + delta, end: range.end + delta });
      }
      break;
    }
    blocks.push(...window.blocks);
    ranges.push(...window.ranges);
    if (window.next >= source.length) break;
    pos = window.next;
    yield;
  }
  return { source, blocks, ranges: mergeRanges(ranges), frontMatterEnd };
}

// Only the latest text is kept: the state of every earlier version of an edited document would add up to
// hundreds of megabytes, and the next call needs just the previous one to find what an edit touched.
let cached: DocState | undefined;

/** For tests: forget the previous text, so the next call reads the whole document. */
export function resetDocumentCache(): void {
  cached = undefined;
}

function documentState(source: string): DocState {
  const generator = buildState(source, cached);
  for (;;) {
    const step = generator.next();
    if (step.done) { cached = step.value; return step.value; }
  }
}

/** Where each blank-line-separated paragraph of a plain text starts; a longer run of blank lines is a stronger split. */
function plainBlocks(source: string): Block[] {
  const blocks: Block[] = [{ start: 0, score: 0 }];
  let previousBlank = true;
  let blankRun = 0;
  for (let lineStart = 0; lineStart < source.length;) {
    const newline = source.indexOf("\n", lineStart);
    const next = newline === -1 ? source.length : newline + 1;
    const blank = /^[ \t\r]*$/.test(source.slice(lineStart, newline === -1 ? source.length : newline));
    if (blank) {
      blankRun += 1;
      previousBlank = true;
    } else {
      if (previousBlank && lineStart > 0) blocks.push({ start: lineStart, score: Math.min(blankRun, MAX_SCORE) });
      previousBlank = false;
      blankRun = 0;
    }
    lineStart = next;
  }
  return blocks;
}

/** "Install › macOS": the last three headings that are open where a chunk starts. */
function sectionLabel(stack: ReadonlyArray<{ level: number; text: string }>): string | undefined {
  const parts = stack.slice(-3).map((heading) => (heading.text.length > 60 ? `${heading.text.slice(0, 59)}…` : heading.text)).filter(Boolean);
  return parts.length ? parts.join(" › ") : undefined;
}

/** Lexicographic cost of a packing beyond its number of requests: tiny chunks, weak split points, uneven sizes. */
type Cost = [number, number, number];
const costLess = (a: Cost, b: Cost) => { for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] < b[index]; return false; };

/**
 * Chooses the split offsets. A chunk is feasible when it fits `target` or is a single block (which may be
 * bigger). The fewest chunks come first: greedy fills from both ends give that count and the range each cut
 * may fall in. Within those ranges, dynamic programming picks the packing with the fewest tiny chunks (below
 * a quarter of the average), then the strongest split points, then the most even sizes.
 */
function pack(blocks: readonly Block[], length: number, target: number): number[] {
  const positions = [...blocks.map((block) => block.start), length];
  const last = positions.length - 1;
  const fits = (from: number, to: number) => to === from + 1 || positions[to] - positions[from] <= target;
  const forward = [0];
  while (forward[forward.length - 1] < last) {
    const from = forward[forward.length - 1];
    let to = from + 1;
    while (to < last && fits(from, to + 1)) to += 1;
    forward.push(to);
  }
  const count = forward.length - 1;
  const backward = [last];
  for (let step = 1; step <= count; step += 1) {
    const to = backward[step - 1];
    let from = Math.max(0, to - 1);
    while (from > 0 && fits(from - 1, to)) from -= 1;
    backward.push(step === count ? 0 : from);
  }
  const tiny = length / count / 4;
  const reach = (layer: number) => ({ low: backward[count - layer], high: forward[layer] });
  type Entry = { cost: Cost; via: number };
  let before = new Map<number, Entry>([[0, { cost: [0, 0, 0], via: -1 }]]);
  const layers: Array<Map<number, Entry>> = [before];
  for (let layer = 1; layer <= count; layer += 1) {
    const { low, high } = reach(layer);
    const previousLow = reach(layer - 1).low;
    const here = new Map<number, Entry>();
    for (let to = low; to <= high; to += 1) {
      let chosen: Entry | undefined;
      for (let from = to - 1; from >= previousLow; from -= 1) {
        if (!fits(from, to)) break;
        const prior = before.get(from);
        if (!prior) continue;
        const size = positions[to] - positions[from];
        const cost: Cost = [
          prior.cost[0] + (size < tiny ? 1 : 0),
          prior.cost[1] + (to < last ? MAX_SCORE - blocks[to].score : 0),
          prior.cost[2] + size * size,
        ];
        if (!chosen || costLess(cost, chosen.cost)) chosen = { cost, via: from };
      }
      if (chosen) here.set(to, chosen);
    }
    layers.push(here);
    before = here;
  }
  const splits: number[] = [];
  for (let layer = count, index = last; layer > 0; layer -= 1) {
    splits.push(positions[index]);
    index = layers[layer].get(index)!.via;
  }
  return splits.reverse();
}

function chunksFrom(source: string, format: "markdown" | "plaintext", blocks: Block[], target: number): Chunk[] {
  const ends = pack(blocks, source.length, target);
  const chunks: Chunk[] = [];
  const stack: Array<{ level: number; text: string }> = [];
  const headings = blocks.filter((block) => block.heading);
  let headingIndex = 0;
  let start = 0;
  for (const end of ends) {
    if (end - start > REVIEW_LIMITS.source) throw new ReviewValidationError(sectionTooLargeMessage);
    for (; headingIndex < headings.length && headings[headingIndex].start <= start; headingIndex += 1) {
      const heading = headings[headingIndex].heading!;
      while (stack.length && stack[stack.length - 1].level >= heading.level) stack.pop();
      stack.push(heading);
    }
    const section = format === "markdown" ? sectionLabel(stack) : undefined;
    chunks.push({ start, end, ...(section ? { section } : {}) });
    start = end;
  }
  return chunks;
}

/**
 * Divides a document into contiguous chunks at safe block boundaries, each at most `target` characters
 * unless it is a single block. Throws when a block is too big for one request.
 */
export function chunkDocument(source: string, format: "markdown" | "plaintext", target: number = CHUNK_TARGET): Chunk[] {
  if (source.length <= target) return [{ start: 0, end: source.length }];
  return chunksFrom(source, format, format === "markdown" ? documentState(source).blocks : plainBlocks(source), target);
}

/**
 * Like chunkDocument, but hands control back between parse windows (a million characters take seconds)
 * and gives up with `undefined` as soon as `isStopped` says so.
 */
export async function chunkDocumentAsync(source: string, format: "markdown" | "plaintext", isStopped: () => boolean, target: number = CHUNK_TARGET): Promise<Chunk[] | undefined> {
  if (source.length <= target || format === "plaintext") return isStopped() ? undefined : chunkDocument(source, format, target);
  const generator = buildState(source, cached);
  for (;;) {
    const step = generator.next();
    if (step.done) { cached = step.value; return chunksFrom(source, format, step.value.blocks, target); }
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (isStopped()) return undefined;
  }
}

/**
 * The top-level blocks of a Markdown document above the request limit as separately parseable slices, or
 * undefined when it has a block too big or too complex to read. Each block is at most REVIEW_LIMITS.source.
 */
export function documentBlockSlices(source: string): Array<{ start: number; text: string }> | undefined {
  let state: DocState;
  try { state = documentState(source); } catch { return undefined; }
  return state.blocks.map((block, index) => ({ start: block.start, text: source.slice(block.start, state.blocks[index + 1]?.start ?? source.length) }));
}

/** Excluded ranges for a document of any size up to REVIEW_LIMITS.document; small ones keep the whole-document parse. */
export function documentExcludedRanges(source: string, requireAvailable = false): OffsetRange[] {
  if (source.length <= REVIEW_LIMITS.source) return markdownExcludedRanges(source, requireAvailable);
  if (source.length > REVIEW_LIMITS.document) throw new ReviewValidationError(`document exceeds ${REVIEW_LIMITS.document} characters`);
  try {
    return documentState(source).ranges;
  } catch (error) {
    if (requireAvailable) throw error;
    return [{ start: 0, end: source.length }];
  }
}
