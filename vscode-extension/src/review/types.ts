export type Level = 1 | 2;

export type Decision = null | { option: number };
export type Decisions = Readonly<Record<string, Decision>>;

export interface AgentSuggestion {
  from: string;
  occurrence?: number;
  options: string[];
  note: string;
}

export interface AgentResponse {
  title: string;
  level1: AgentSuggestion[];
  level2: AgentSuggestion[];
}

export interface Suggestion {
  id: string;
  level: Level;
  start: number;
  end: number;
  from: string;
  options: string[];
  note: string;
  status: "active" | "invalidated";
}

export interface ResolvedReview {
  title: string;
  level1: Suggestion[];
  level2: Suggestion[];
  /** Suggestions the agent proposed but whose anchor could not be placed without conflict. */
  skipped: number;
}

export interface Review {
  format: "markdown" | "plaintext";
  currentDocumentVersion: number;
  currentSource: string;
  level1: Suggestion[];
  level2: Suggestion[];
}

export interface ReviewMetadata {
  documentVersion: number;
  format?: "markdown" | "plaintext";
}

export interface SourceChange {
  rangeOffset: number;
  rangeLength: number;
  text: string;
}

export interface EffectiveEdit {
  suggestionId: string;
  start: number;
  end: number;
  text: string;
}
