import { type Decision, type Decisions, type EffectiveEdit, type Review, type Suggestion } from "./types";
import { markdownExcludedRanges, rangeTouchesExcluded, rangesOverlap } from "./validate";

function accepted(suggestion: Suggestion, decisions: Decisions): number | undefined {
  const decision = decisions[suggestion.id];
  return suggestion.status === "active" && decision !== null && decision !== undefined
    ? decision.option
    : undefined;
}

export function effectiveEdits(review: Review, decisions: Decisions): EffectiveEdit[] {
  const acceptedLevel2 = review.level2.filter((suggestion) => accepted(suggestion, decisions) !== undefined);
  const edits = [...acceptedLevel2, ...review.level1.filter((suggestion) => {
    if (accepted(suggestion, decisions) === undefined) return false;
    return !acceptedLevel2.some((sentence) => sentence.start <= suggestion.start && suggestion.end <= sentence.end);
  })].map((suggestion) => ({
    suggestionId: suggestion.id,
    start: suggestion.start,
    end: suggestion.end,
    text: suggestion.options[accepted(suggestion, decisions) as number],
  }));

  const ordered = [...edits].sort((a, b) => a.start - b.start);
  for (let index = 1; index < ordered.length; index += 1) {
    if (rangesOverlap(ordered[index - 1], ordered[index])) {
      throw new Error("effective edits overlap");
    }
  }
  return ordered;
}

/** Applies non-overlapping edits to an in-memory source, from back to front. */
export function applyEdits(source: string, edits: readonly EffectiveEdit[]): string {
  return [...edits].sort((a, b) => b.start - a.start).reduce(
    (result, edit) => `${result.slice(0, edit.start)}${edit.text}${result.slice(edit.end)}`,
    source,
  );
}

/** Accepts only pending suggestions, preserving explicit choices and keeps. */
export function acceptAll(review: Review, decisions: Decisions, level: 1 | 2): Decisions {
  const next: Record<string, Decision> = { ...decisions };
  for (const suggestion of review[`level${level}`]) {
    if (suggestion.status === "active" && !Object.hasOwn(next, suggestion.id)) {
      next[suggestion.id] = { option: 0 };
    }
  }
  return next;
}

export interface PrepareApplyResult {
  review: Review;
  decisions: Decisions;
  edits: EffectiveEdit[];
  canApply: boolean;
  reason?: string;
}

/** Checks the live source immediately before handing edits to WorkspaceEdit. */
export function prepareApply(
  review: Review,
  decisions: Decisions,
  liveSource: string,
  liveDocumentVersion: number,
): PrepareApplyResult {
  if (liveDocumentVersion !== review.currentDocumentVersion) {
    return { review, decisions, edits: [], canApply: false, reason: "document version changed" };
  }

  const invalid = new Set<string>();
  const excluded = review.format === "markdown" ? markdownExcludedRanges(liveSource) : [];
  for (const suggestion of [...review.level1, ...review.level2]) {
    if (accepted(suggestion, decisions) !== undefined && (
      liveSource.slice(suggestion.start, suggestion.end) !== suggestion.from ||
      rangeTouchesExcluded(excluded, suggestion.start, suggestion.end)
    )) {
      invalid.add(suggestion.id);
    }
  }
  if (!invalid.size) return { review, decisions, edits: effectiveEdits(review, decisions), canApply: true };

  const mark = (suggestion: Suggestion): Suggestion => invalid.has(suggestion.id)
    ? { ...suggestion, status: "invalidated" }
    : suggestion;
  const nextReview = { ...review, level1: review.level1.map(mark), level2: review.level2.map(mark) };
  const nextDecisions: Record<string, Decision> = { ...decisions };
  for (const id of invalid) delete nextDecisions[id];
  return {
    review: nextReview,
    decisions: nextDecisions,
    edits: effectiveEdits(nextReview, nextDecisions),
    canApply: true,
  };
}
