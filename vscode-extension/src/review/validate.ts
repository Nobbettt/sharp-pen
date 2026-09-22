import {
  type AgentResponse,
  type AgentSuggestion,
  type Level,
  type ResolvedReview,
  type Review,
  type ReviewMetadata,
  type Suggestion,
} from "./types";

import fromMarkdown = require("mdast-util-from-markdown");

export const REVIEW_LIMITS = {
  source: 100_000,
  title: 256,
  suggestionsPerLevel: 100,
  from: 10_000,
  option: 10_000,
  note: 2_000,
  response: 512_000,
} as const;

export class ReviewValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewValidationError";
  }
}

const responseKeys = new Set(["title", "level1", "level2"]);
const suggestionKeys = new Set(["from", "occurrence", "options", "note"]);
// 20,000 lines and 2,048 container markers keep a maximum-size source below a few hundred milliseconds of Markdown parsing.
const markdownComplexity = { delimiters: 4_096, run: 1_024, containers: 128, lines: 20_000, containerMarkers: 2_048 };
const markdownComplexityMessage = "Markdown is too structurally complex to analyze";

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ReviewValidationError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function onlyKeys(value: Record<string, unknown>, allowed: Set<string>, label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new ReviewValidationError(`${label} has an unknown field: ${key}`);
    }
  }
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new ReviewValidationError(`${label} must be a string`);
  }
  return value;
}

function bounded(value: unknown, label: string, maximum: number): string {
  const result = string(value, label);
  if (result.length > maximum) throw new ReviewValidationError(`${label} exceeds ${maximum} characters`);
  return result;
}

export function assertReviewSource(source: string): void {
  if (source.length > REVIEW_LIMITS.source) {
    throw new ReviewValidationError(`source exceeds ${REVIEW_LIMITS.source} characters`);
  }
}

export interface OffsetRange { start: number; end: number; }

function mask(source: string, ranges: readonly OffsetRange[]): string {
  const chars = source.split("");
  for (const range of ranges) {
    for (let index = range.start; index < range.end; index += 1) {
      if (chars[index] !== "\n" && chars[index] !== "\r") chars[index] = " ";
    }
  }
  return chars.join("");
}

function addRange(ranges: OffsetRange[], start: number, end: number): void {
  if (end > start) ranges.push({ start, end });
}

function normalizedRanges(ranges: OffsetRange[]): OffsetRange[] {
  const result: OffsetRange[] = [];
  for (const range of ranges.sort((a, b) => a.start - b.start || a.end - b.end)) {
    const previous = result[result.length - 1];
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else result.push(range);
  }
  return result;
}

function frontMatterRange(source: string): OffsetRange | undefined {
  const start = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  const firstEnd = source.indexOf("\n", start);
  if (!/^(---|\.\.\.)\s*\r?$/.test(source.slice(start, firstEnd === -1 ? source.length : firstEnd))) return undefined;
  for (let cursor = firstEnd === -1 ? source.length : firstEnd + 1; cursor < source.length;) {
    const end = source.indexOf("\n", cursor);
    const lineEnd = end === -1 ? source.length : end;
    if (/^(---|\.\.\.)\s*\r?$/.test(source.slice(cursor, lineEnd))) return { start: 0, end: end === -1 ? source.length : end + 1 };
    cursor = end === -1 ? source.length : end + 1;
  }
  return source.slice(start, firstEnd === -1 ? source.length : firstEnd).startsWith("---")
    ? { start, end: firstEnd === -1 ? source.length : firstEnd }
    : undefined;
}

interface MdastNode {
  type?: unknown;
  value?: unknown;
  children?: unknown;
  position?: { start?: { offset?: unknown }; end?: { offset?: unknown } };
}

function mdastNode(value: unknown): value is MdastNode {
  return value !== null && typeof value === "object";
}

function markdownTooComplex(source: string): boolean {
  let delimiters = 0;
  let run = 0;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    if (code === 42 || code === 95 || code === 91 || code === 93 || code === 40 || code === 41 || code === 96) {
      if (++delimiters > markdownComplexity.delimiters || ++run > markdownComplexity.run) return true;
    } else {
      run = 0;
    }
  }

  let lines = 0;
  let containerMarkers = 0;
  for (let start = 0; start < source.length;) {
    if (++lines > markdownComplexity.lines) return true;
    const end = source.indexOf("\n", start);
    const limit = end === -1 ? source.length : end;
    let index = start;
    let depth = 0;
    while (index < limit) {
      while (source[index] === " " && index - start < 4) index += 1;
      const marker = source[index];
      if (marker === ">") {
        index += 1;
      } else if ((marker === "-" || marker === "+" || marker === "*") && (source[index + 1] === " " || source[index + 1] === "\t")) {
        index += 2;
      } else {
        let digits = 0;
        while (digits < 9 && /[0-9]/.test(source[index + digits])) digits += 1;
        if (!digits || (source[index + digits] !== "." && source[index + digits] !== ")")
          || (source[index + digits + 1] !== " " && source[index + digits + 1] !== "\t")) break;
        index += digits + 2;
      }
      if (++depth > markdownComplexity.containers || ++containerMarkers > markdownComplexity.containerMarkers) return true;
      if (source[index] === " " || source[index] === "\t") index += 1;
    }
    start = end === -1 ? source.length : end + 1;
  }
  return false;
}

/** Returns Markdown-only regions that cannot be sent to or accepted from an agent. */
export function markdownExcludedRanges(source: string, requireAvailable = false): OffsetRange[] {
  assertReviewSource(source);
  if (markdownTooComplex(source)) {
    if (requireAvailable) throw new ReviewValidationError(markdownComplexityMessage);
    return source.length ? [{ start: 0, end: source.length }] : [];
  }
  const allowed: OffsetRange[] = [];
  const bom = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  const visit = (node: unknown, parent?: MdastNode): void => {
    if (!mdastNode(node)) return;
    const startOffset = node.position?.start?.offset;
    const endOffset = node.position?.end?.offset;
    const start = typeof startOffset === "number" ? startOffset + bom : undefined;
    const end = typeof endOffset === "number" ? endOffset + bom : undefined;
    const autolink = parent?.type === "link" && typeof start === "number" && source[start - 1] === "<";
    if (node.type === "text" && typeof node.value === "string" && typeof start === "number" && typeof end === "number"
      && source.slice(start, end) === node.value && !autolink) addRange(allowed, start, end);
    if (Array.isArray(node.children)) for (const child of node.children) visit(child, node);
  };
  try {
    visit(fromMarkdown(source.slice(bom)));
  } catch {
    if (requireAvailable) throw new ReviewValidationError(markdownComplexityMessage);
    return source.length ? [{ start: 0, end: source.length }] : [];
  }

  const excluded: OffsetRange[] = [];
  let cursor = 0;
  for (const range of normalizedRanges(allowed)) {
    if (range.start > cursor) addRange(excluded, cursor, range.start);
    cursor = Math.max(cursor, range.end);
  }
  addRange(excluded, cursor, source.length);
  const frontMatter = frontMatterRange(source);
  if (frontMatter) excluded.push(frontMatter);
  return normalizedRanges(excluded);
}

/** Keeps offsets and line numbers stable while removing non-prose Markdown from prompts. */
export function maskMarkdownForPrompt(source: string): string {
  return mask(source, markdownExcludedRanges(source));
}

/** Whether a source range intersects a Markdown-only region. */
export function rangeTouchesExcluded(ranges: readonly OffsetRange[], start: number, end: number): boolean {
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (ranges[middle].end <= start) low = middle + 1;
    else high = middle;
  }
  return low < ranges.length && ranges[low].start < end;
}

function suggestion(value: unknown, label: string): AgentSuggestion {
  const input = object(value, label);
  onlyKeys(input, suggestionKeys, label);
  const from = bounded(input.from, `${label}.from`, REVIEW_LIMITS.from);
  if (!from) throw new ReviewValidationError(`${label}.from must not be empty`);

  const options = input.options;
  if (!Array.isArray(options) || options.length < 1 || options.length > 3) {
    throw new ReviewValidationError(`${label}.options must contain one to three strings`);
  }
  if (options.some((option) => typeof option !== "string" || option.length === 0 || option.length > REVIEW_LIMITS.option)) {
    throw new ReviewValidationError(`${label}.options must contain only non-empty strings`);
  }
  if (options[0] === from) {
    throw new ReviewValidationError(`${label}.options[0] must replace the original text`);
  }

  const note = bounded(input.note, `${label}.note`, REVIEW_LIMITS.note);
  if (!note.trim()) throw new ReviewValidationError(`${label}.note must not be empty`);

  const occurrence = input.occurrence;
  let resolvedOccurrence: number | undefined;
  if (occurrence !== undefined) {
    if (typeof occurrence !== "number" || !Number.isSafeInteger(occurrence) || occurrence < 1) {
      throw new ReviewValidationError(`${label}.occurrence must be a positive integer`);
    }
    resolvedOccurrence = occurrence;
  }
  return { from, ...(resolvedOccurrence === undefined ? {} : { occurrence: resolvedOccurrence }), options, note };
}

/** Parses one JSON value. Schema validation is deliberately separate for adapters. */
export function parseAgentResponse(text: string): unknown {
  if (text.length > REVIEW_LIMITS.response) {
    throw new ReviewValidationError(`agent response exceeds ${REVIEW_LIMITS.response} characters`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ReviewValidationError("agent response is not valid JSON");
  }
}

export function validateAgentResponse(value: unknown): AgentResponse {
  const input = object(value, "agent response");
  onlyKeys(input, responseKeys, "agent response");
  const title = bounded(input.title, "agent response.title", REVIEW_LIMITS.title);
  if (!title.trim()) throw new ReviewValidationError("agent response.title must not be empty");

  const level = (name: "level1" | "level2"): AgentSuggestion[] => {
    const entries = input[name];
    if (!Array.isArray(entries)) throw new ReviewValidationError(`agent response.${name} must be an array`);
    if (entries.length > REVIEW_LIMITS.suggestionsPerLevel) {
      throw new ReviewValidationError(`agent response.${name} exceeds ${REVIEW_LIMITS.suggestionsPerLevel} suggestions`);
    }
    return entries.map((entry, index) => suggestion(entry, `${name}[${index}]`));
  };

  const response = { title, level1: level("level1"), level2: level("level2") };
  const size = response.title.length + [...response.level1, ...response.level2].reduce(
    (total, entry) => total + entry.from.length + entry.note.length + entry.options.reduce((sum, option) => sum + option.length, 0),
    0,
  );
  if (size > REVIEW_LIMITS.response) {
    throw new ReviewValidationError(`agent response exceeds ${REVIEW_LIMITS.response} characters`);
  }
  return response;
}

function occurrences(source: string, from: string): number[] {
  const starts: number[] = [];
  for (let start = source.indexOf(from); start !== -1; start = source.indexOf(from, start + from.length)) {
    starts.push(start);
  }
  return starts;
}

function resolve(source: string, entry: AgentSuggestion, level: Level, index: number, ranges: readonly OffsetRange[]): Suggestion {
  const label = `level${level}[${index}]`;
  const hits = occurrences(source, entry.from).filter((start) => !rangeTouchesExcluded(ranges, start, start + entry.from.length));
  if (!hits.length) throw new ReviewValidationError(`${label}.from is not present in the source`);

  let start: number;
  if (hits.length > 1) {
    if (entry.occurrence === undefined) {
      throw new ReviewValidationError(`${label}.from occurs ${hits.length} times; occurrence is required`);
    }
    if (entry.occurrence > hits.length) {
      throw new ReviewValidationError(`${label}.occurrence is out of range`);
    }
    start = hits[entry.occurrence - 1];
  } else {
    if (entry.occurrence !== undefined && entry.occurrence !== 1) {
      throw new ReviewValidationError(`${label}.occurrence must be 1 for a unique anchor`);
    }
    start = hits[0];
  }

  return {
    id: `l${level}-${index + 1}`,
    level,
    start,
    end: start + entry.from.length,
    from: entry.from,
    options: entry.options,
    note: entry.note,
    status: "active",
  };
}

export function rangesOverlap(a: Pick<Suggestion, "start" | "end">, b: Pick<Suggestion, "start" | "end">): boolean {
  return a.start < b.end && b.start < a.end;
}

function assertDisjoint(suggestions: Suggestion[], level: Level): void {
  const ordered = [...suggestions].sort((a, b) => a.start - b.start);
  for (let index = 1; index < ordered.length; index += 1) {
    if (rangesOverlap(ordered[index - 1], ordered[index])) {
      throw new ReviewValidationError(`level${level} suggestions must not overlap`);
    }
  }
}

function contains(outer: Suggestion, inner: Suggestion): boolean {
  return outer.start <= inner.start && inner.end <= outer.end;
}

export function validateAndResolve(source: string, value: unknown, format: "markdown" | "plaintext" = "plaintext"): ResolvedReview {
  assertReviewSource(source);
  const response = validateAgentResponse(value);
  const ranges = format === "markdown" ? markdownExcludedRanges(source, true) : [];
  const level1 = response.level1.map((entry, index) => resolve(source, entry, 1, index, ranges));
  const level2 = response.level2.map((entry, index) => resolve(source, entry, 2, index, ranges));
  assertDisjoint(level1, 1);
  assertDisjoint(level2, 2);

  for (const sentence of level2) {
    for (const correction of level1) {
      if (rangesOverlap(sentence, correction) && !contains(sentence, correction)) {
        throw new ReviewValidationError("a level2 suggestion must wholly contain each level1 suggestion it intersects");
      }
    }
  }
  return { title: response.title, level1, level2 };
}

export function parseAndResolveAgentResponse(source: string, text: string, format: "markdown" | "plaintext" = "plaintext"): ResolvedReview {
  return validateAndResolve(source, parseAgentResponse(text), format);
}

export function createReview(source: string, metadata: ReviewMetadata, resolved: ResolvedReview): Review {
  return {
    schemaVersion: 1,
    format: metadata.format ?? "plaintext",
    uri: metadata.uri,
    analysisDocumentVersion: metadata.documentVersion,
    analysisSourceHash: metadata.sourceHash,
    currentDocumentVersion: metadata.documentVersion,
    currentSource: source,
    level1: resolved.level1,
    level2: resolved.level2,
  };
}
