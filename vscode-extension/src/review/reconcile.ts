import { type Decision, type Decisions, type Review, type SourceChange, type Suggestion } from "./types";
import { assertReviewSource, markdownExcludedRanges, rangeTouchesExcluded } from "./validate";

export interface ReconciliationResult {
  review: Review;
  decisions: Decisions;
}

function reconciliationExcludedRanges(review: Review, source: string) {
  try {
    if (review.format === "markdown") return markdownExcludedRanges(source, true);
    assertReviewSource(source);
    return [];
  } catch {
    return undefined;
  }
}

function reconcileSuggestion(suggestion: Suggestion, change: SourceChange): Suggestion {
  const changeEnd = change.rangeOffset + change.rangeLength;
  if (changeEnd <= suggestion.start) {
    const delta = change.text.length - change.rangeLength;
    return { ...suggestion, start: suggestion.start + delta, end: suggestion.end + delta };
  }
  if (change.rangeOffset >= suggestion.end) return suggestion;
  // Collapse to an empty range at the edit position rather than covering the inserted text: the
  // webview renders a suggestion's range as one span, and the user's new text must never be wrapped in it.
  return {
    ...suggestion,
    start: change.rangeOffset,
    end: change.rangeOffset,
    status: "invalidated",
  };
}

/** Reconciles VS Code content changes, whose offsets are relative to the old document. */
export function reconcileSourceChanges(
  review: Review,
  decisions: Decisions,
  changes: readonly SourceChange[],
  nextSource: string,
  nextDocumentVersion: number,
): ReconciliationResult {
  const ordered = [...changes].sort((a, b) => b.rangeOffset - a.rangeOffset);
  const reconcile = (suggestion: Suggestion): Suggestion => ordered.reduce(reconcileSuggestion, suggestion);
  const shiftedLevel1 = review.level1.map(reconcile);
  const shiftedLevel2 = review.level2.map(reconcile);
  const excluded = reconciliationExcludedRanges(review, nextSource);
  if (!excluded) {
    const invalidate = (suggestion: Suggestion): Suggestion => ({ ...suggestion, status: "invalidated" });
    return {
      review: {
        ...review,
        currentDocumentVersion: nextDocumentVersion,
        currentSource: nextSource,
        level1: shiftedLevel1.map(invalidate),
        level2: shiftedLevel2.map(invalidate),
      },
      decisions: {},
    };
  }
  const invalid = new Set<string>();
  const check = (suggestion: Suggestion): Suggestion => {
    if (suggestion.status === "active" && (
      nextSource.slice(suggestion.start, suggestion.end) !== suggestion.from ||
      rangeTouchesExcluded(excluded, suggestion.start, suggestion.end)
    )) {
      invalid.add(suggestion.id);
      return { ...suggestion, status: "invalidated" };
    }
    if (suggestion.status === "invalidated") invalid.add(suggestion.id);
    return suggestion;
  };
  const level1 = shiftedLevel1.map(check);
  const level2 = shiftedLevel2.map(check);
  const nextDecisions: Record<string, Decision> = { ...decisions };
  for (const id of invalid) delete nextDecisions[id];
  return {
    review: {
      ...review,
      currentDocumentVersion: nextDocumentVersion,
      currentSource: nextSource,
      level1,
      level2,
    },
    decisions: nextDecisions,
  };
}
