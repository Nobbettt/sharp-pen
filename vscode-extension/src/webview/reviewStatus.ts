export interface ReviewCountStatus {
  text: string;
  label: string;
}

/** Compact toolbar status; only a current successful zero-result review is "all clear". */
export function reviewCountStatus(
  state: "empty" | "analyzing" | "ready" | "modified" | "applied" | "error",
  level: 1 | 2,
  overall: number,
  accepted: number,
  total: number,
): ReviewCountStatus {
  if (total > 0) return { text: `${accepted}/${total}`, label: `${accepted} of ${total} suggestions accepted` };
  if (overall > 0) return { text: `No L${level} suggestions`, label: `No level ${level} suggestions` };
  if (state === "analyzing") return { text: "Analyzing…", label: "Analysis in progress" };
  if (state === "ready") return { text: "No suggestions — all clear", label: "No suggestions found; all clear" };
  if (state === "applied") return { text: "Applied", label: "Staged changes applied" };
  return { text: "Nothing to show — run analysis", label: "Nothing to show; run analysis" };
}
