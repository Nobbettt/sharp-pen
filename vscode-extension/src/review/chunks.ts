import { frontMatterRange, markdownExcludedRanges, ReviewValidationError, REVIEW_LIMITS, type OffsetRange } from "./validate";

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

interface Heading { offset: number; level: number; text: string }
interface Scan {
  /** Where each top-level block starts, ascending, beginning with 0. */
  starts: number[];
  /** How good a place each start is to split: a heading beats a rule beats a paragraph break. 0 for the first. */
  scores: number[];
  headings: Heading[];
}

/** Split strength of a heading: H1 is the strongest, then down to H6; a rule and a paragraph break come after. */
const headingScore = (level: number) => 9 - level;
const RULE_SCORE = 2;
const BREAK_SCORE = 1;
const MAX_SCORE = headingScore(1);

const htmlBlockEnds: Array<[RegExp, RegExp]> = [
  [/^<(?:script|pre|style|textarea)(?:[ \t>]|$)/i, /<\/(?:script|pre|style|textarea)>/i],
  [/^<!--/, /-->/],
  [/^<\?/, /\?>/],
  [/^<![A-Za-z]/, />/],
  [/^<!\[CDATA\[/, /\]\]>/],
];
const htmlBlockStartsUntilBlank = /^<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[ \t>]|\/>|$)/i;
const lonelyTag = /^<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^>]*)?\/?>[ \t]*$/;
const blankLine = /^[ \t]*$/;
const atxHeading = /^ {0,3}(#{1,6})(?:[ \t]|$)/;
const thematicBreak = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const listMarker = /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/;
const fenceOpening = /^( *)(`{3,}|~{3,})(.*)$/;
const setextUnderline = /^ {0,3}(=+|-+)[ \t]*$/;

let lastScan: { source: string; format: string; scan: Scan } | undefined;

/**
 * One linear pass over the lines that finds where top-level blocks start, without parsing the whole
 * document (a whole-document mdast parse of 1,000,000 characters takes about 7 s). It is deliberately
 * conservative: when unsure whether a line continues a block it reports no boundary, because a missed
 * boundary only makes a chunk bigger while a false one would cut a fence, list or table in half.
 */
function scan(source: string, format: "markdown" | "plaintext"): Scan {
  if (lastScan && lastScan.source === source && lastScan.format === format) return lastScan.scan;
  const result: Scan = { starts: [0], scores: [0], headings: [] };
  const markdown = format === "markdown";
  const frontMatterEnd = markdown ? (frontMatterRange(source)?.end ?? 0) : 0;
  let prevBlank = true;
  let blankRun = 0;
  let fence: { char: string; length: number } | undefined;
  let html: RegExp | "blank" | undefined;
  let inList = false;
  const add = (start: number, score: number) => { if (start > 0) { result.starts.push(start); result.scores.push(score); } };

  for (let lineStart = 0; lineStart < source.length;) {
    const newline = source.indexOf("\n", lineStart);
    const next = newline === -1 ? source.length : newline + 1;
    let lineEnd = newline === -1 ? source.length : newline;
    if (lineEnd > lineStart && source.charCodeAt(lineEnd - 1) === 13) lineEnd -= 1;
    const text = source.slice(lineStart + (lineStart === 0 && source.charCodeAt(0) === 0xfeff ? 1 : 0), lineEnd);
    const blank = blankLine.test(text);

    if (lineStart < frontMatterEnd) {
      prevBlank = false;
    } else if (!markdown) {
      if (blank) {
        blankRun += 1;
        prevBlank = true;
      } else {
        if (prevBlank) add(lineStart, Math.min(blankRun, MAX_SCORE));
        prevBlank = false;
        blankRun = 0;
      }
    } else if (fence) {
      const closing = /^ *(`{3,}|~{3,})[ \t]*$/.exec(text);
      if (closing && closing[1][0] === fence.char && closing[1].length >= fence.length) fence = undefined;
      prevBlank = false;
    } else if (html && (html === "blank" ? blank : html.test(text))) {
      html = undefined;
      prevBlank = blank;
    } else if (html) {
      prevBlank = false;
    } else if (blank) {
      prevBlank = true;
    } else {
      let indent = 0;
      for (const char of text) { if (char === " ") indent += 1; else if (char === "\t") indent += 4; else break; }
      const heading = indent < 4 ? atxHeading.exec(text) : null;
      // After a blank line, an indented line may continue an open list item or a code block, and a
      // list goes on while its items or their content keep coming; only a flush-left line closes it.
      const continuesList = inList && (indent > 0 || (prevBlank && listMarker.test(text)));
      let boundary = false;
      let score = BREAK_SCORE;
      if (!continuesList && (heading || (prevBlank && indent < 4))) {
        boundary = true;
        if (heading) score = headingScore(heading[1].length);
        else if (thematicBreak.test(text)) score = RULE_SCORE;
        else {
          const afterNext = source.indexOf("\n", next);
          const underline = setextUnderline.exec(source.slice(next, afterNext === -1 ? source.length : afterNext).replace(/\r$/, ""));
          if (underline) score = headingScore(underline[1][0] === "=" ? 1 : 2);
        }
        add(lineStart, score);
        inList = false;
      }
      if (heading && boundary) {
        result.headings.push({ offset: lineStart, level: heading[1].length, text: text.replace(/^ {0,3}#{1,6}[ \t]*/, "").replace(/[ \t]+#+[ \t]*$/, "").trim() });
      } else if (boundary && score >= headingScore(2)) {
        result.headings.push({ offset: lineStart, level: 9 - score, text: text.trim() });
      }
      if (listMarker.test(text) && !thematicBreak.test(text)) inList = true;
      const opening = indent < 4 || inList ? fenceOpening.exec(text) : null;
      if (opening && !(opening[2][0] === "`" && opening[3].includes("`"))) {
        fence = { char: opening[2][0], length: opening[2].length };
      } else if (indent < 4 || inList) {
        const trimmed = text.trimStart();
        for (const [start, end] of htmlBlockEnds) {
          if (start.test(trimmed)) { if (!end.test(trimmed)) html = end; break; }
        }
        if (!html && (htmlBlockStartsUntilBlank.test(trimmed) || (prevBlank && lonelyTag.test(trimmed)))) html = "blank";
      }
      prevBlank = false;
    }
    lineStart = next;
  }
  lastScan = { source, format, scan: result };
  return result;
}

/** "Install › macOS": the last three headings that are open where a chunk starts. */
function sectionLabel(stack: readonly Heading[]): string | undefined {
  const parts = stack.slice(-3).map((heading) => (heading.text.length > 60 ? `${heading.text.slice(0, 59)}…` : heading.text)).filter(Boolean);
  return parts.length ? parts.join(" › ") : undefined;
}

/** Lexicographic cost of a packing: fewer requests, then fewer tiny chunks, then weaker split points, then uneven sizes. */
type Cost = [number, number, number, number];
const costLess = (a: Cost, b: Cost) => { for (let index = 0; index < 4; index += 1) if (a[index] !== b[index]) return a[index] < b[index]; return false; };

/**
 * Chooses the split offsets. The cost is a vector that adds up over chunks and is compared
 * lexicographically, which is exactly what makes the cheapest packing of a prefix reusable (dynamic programming).
 * A unit larger than `target` (one huge block) is still allowed as its own chunk.
 */
function pack(starts: readonly number[], scores: readonly number[], length: number, target: number): number[] {
  // Thin the candidates so the search stays near-linear: within a short window only the strongest one survives.
  const gap = Math.max(1, Math.floor(target / 40));
  const positions = [0];
  const strengths = [0];
  for (let index = 1; index < starts.length; index += 1) {
    const last = positions.length - 1;
    if (last > 0 && starts[index] - positions[last] < gap) {
      if (scores[index] > strengths[last]) { positions[last] = starts[index]; strengths[last] = scores[index]; }
    } else {
      positions.push(starts[index]);
      strengths.push(scores[index]);
    }
  }
  positions.push(length);
  strengths.push(0);
  const last = positions.length - 1;
  const tiny = target / 4;
  const best: Cost[] = [[0, 0, 0, 0]];
  const from = [0];
  for (let i = 1; i <= last; i += 1) {
    let chosen: Cost | undefined;
    let chosenFrom = i - 1;
    for (let j = i - 1; j >= 0; j -= 1) {
      const size = positions[i] - positions[j];
      // Always allow the single unit just before i, however large: it may be one indivisible block.
      if (size > target && j !== i - 1) break;
      const before = best[j];
      const cost: Cost = [before[0] + 1, before[1] + (size < tiny ? 1 : 0), before[2] + (i < last ? MAX_SCORE - strengths[i] : 0), before[3] + size * size];
      if (!chosen || costLess(cost, chosen)) { chosen = cost; chosenFrom = j; }
    }
    best[i] = chosen!;
    from[i] = chosenFrom;
  }
  const splits: number[] = [];
  for (let i = last; i > 0; i = from[i]) splits.push(positions[i]);
  return splits.reverse();
}

/**
 * Divides a document into contiguous chunks at safe block boundaries, each at most `target` characters
 * unless it is a single block. Throws when a block is too big for one request.
 */
export function chunkDocument(source: string, format: "markdown" | "plaintext", target: number = CHUNK_TARGET): Chunk[] {
  if (source.length <= target) return [{ start: 0, end: source.length }];
  const { starts, scores, headings } = scan(source, format);
  const ends = pack(starts, scores, source.length, target);
  const chunks: Chunk[] = [];
  const stack: Heading[] = [];
  let heading = 0;
  let start = 0;
  for (const end of [...ends]) {
    if (end - start > REVIEW_LIMITS.source) throw new ReviewValidationError(sectionTooLargeMessage);
    for (; heading < headings.length && headings[heading].offset <= start; heading += 1) {
      while (stack.length && stack[stack.length - 1].level >= headings[heading].level) stack.pop();
      stack.push(headings[heading]);
    }
    const section = format === "markdown" ? sectionLabel(stack) : undefined;
    chunks.push({ start, end, ...(section ? { section } : {}) });
    start = end;
  }
  return chunks;
}

/** Below this a segment is not worth its own parse: each fromMarkdown call has a fixed cost. */
const SEGMENT_MIN = 2_000;
let lastSegments: { source: string; starts: number[] } | undefined;

/** Groups top-level blocks into runs of at least SEGMENT_MIN characters that can be parsed on their own. */
function segmentStarts(source: string): number[] {
  if (lastSegments && lastSegments.source === source) return lastSegments.starts;
  const blocks = scan(source, "markdown").starts;
  const starts = [0];
  for (const block of blocks) if (block - starts[starts.length - 1] >= SEGMENT_MIN) starts.push(block);
  lastSegments = { source, starts };
  return starts;
}

const CACHE_LIMIT = 5_000;

/**
 * Runs `compute` on each segment's text, memoised by that text in `cache`, so an edit only recomputes
 * the segment it touched. Values are relative to the segment; `start` says where it sits in the document.
 */
export function mapDocumentSegments<T>(source: string, cache: Map<string, T>, compute: (text: string) => T): Array<{ start: number; value: T }> {
  const starts = segmentStarts(source);
  if (cache.size > CACHE_LIMIT) cache.clear();
  return starts.map((start, index) => {
    const text = source.slice(start, starts[index + 1] ?? source.length);
    let value = cache.get(text);
    if (value === undefined) { value = compute(text); cache.set(text, value); }
    return { start, value };
  });
}

/** `null` marks a segment that cannot be parsed (too complex, or bigger than one request). */
const excludedCache = new Map<string, OffsetRange[] | null>();
let lastExcluded: { source: string; ranges: OffsetRange[] } | undefined;

/**
 * Excluded ranges stitched together from each segment parsed on its own. This differs from a
 * whole-document parse only where Markdown reaches across a block boundary, i.e. a link reference
 * definition in a different segment from its link.
 */
export function stitchedExcludedRanges(source: string, requireAvailable = false): OffsetRange[] {
  const segments = mapDocumentSegments(source, excludedCache, (text) => {
    if (text.length > REVIEW_LIMITS.source) return null;
    try { return markdownExcludedRanges(text, true); } catch { return null; }
  });
  const ranges: OffsetRange[] = [];
  const add = (start: number, end: number) => {
    if (end <= start) return;
    const previous = ranges[ranges.length - 1];
    if (previous && start <= previous.end) previous.end = Math.max(previous.end, end);
    else ranges.push({ start, end });
  };
  segments.forEach(({ start, value }, index) => {
    const end = segments[index + 1]?.start ?? source.length;
    if (value === null) {
      if (requireAvailable) throw new ReviewValidationError("Markdown is too structurally complex to analyze");
      add(start, end);
    } else for (const range of value) add(start + range.start, start + range.end);
  });
  return ranges;
}

/** Excluded ranges for a document of any size up to REVIEW_LIMITS.document; small ones keep the whole-document parse. */
export function documentExcludedRanges(source: string, requireAvailable = false): OffsetRange[] {
  if (source.length <= REVIEW_LIMITS.source) return markdownExcludedRanges(source, requireAvailable);
  if (source.length > REVIEW_LIMITS.document) throw new ReviewValidationError(`document exceeds ${REVIEW_LIMITS.document} characters`);
  // Reconcile and the status line ask again after every keystroke; the same text needs no second pass.
  if (!requireAvailable && lastExcluded?.source === source) return lastExcluded.ranges;
  const ranges = stitchedExcludedRanges(source, requireAvailable);
  if (!requireAvailable) lastExcluded = { source, ranges };
  return ranges;
}
