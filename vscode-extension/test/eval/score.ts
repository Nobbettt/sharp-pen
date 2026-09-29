import type { ResolvedReview, Suggestion } from "../../src/review/types";
import { detectLanguage } from "./detectLanguage";
import type { Lang, LanguageCase, PlantedIssue } from "./languageCases";

interface Range { start: number; end: number }
interface Located<T> extends Range { lang: Lang; value: T }

export interface CaseDocument {
  source: string;
  languages: Lang[];
  sections: Array<Range & { lang: Lang }>;
  issues: Array<Located<PlantedIssue>>;
  keep: Array<Located<string>>;
}

export interface RunScore {
  found: number;
  total: number;
  missed: string[];
  /** Suggestions that changed text which must survive: quotations, names, spelling variants, control sentences. */
  keepViolations: string[];
  /** Level 1 suggestions that aren't small edits: rewrites, or translations into another language. */
  levelOneRewrites: string[];
  /** Notes and replacements confidently detected as another language than their passage. */
  languageMismatches: string[];
  unknownNoteLanguage: number;
  unplaced: number;
  extras: string[];
}

/** Level 1 options at least this similar to their `from` count as edits; below it, a rewrite or translation. */
export const LEVEL_ONE_MIN_SIMILARITY = 0.5;

export const SECTION_SEPARATOR = "\n\n";

/** Joins the sections and locates every planted issue and kept text; each must occur once in its section. */
export function buildDocument(testCase: LanguageCase): CaseDocument {
  const document: CaseDocument = { source: "", languages: [], sections: [], issues: [], keep: [] };
  for (const section of testCase.sections) {
    if (document.source) document.source += SECTION_SEPARATOR;
    const start = document.source.length;
    document.source += section.text;
    document.sections.push({ lang: section.lang, start, end: document.source.length });
    if (!document.languages.includes(section.lang)) document.languages.push(section.lang);
    const locate = (text: string): Range => {
      const at = section.text.indexOf(text);
      if (at < 0 || section.text.indexOf(text, at + 1) >= 0) throw new Error(`"${text}" must occur exactly once in the ${section.lang} section of ${testCase.id}`);
      return { start: start + at, end: start + at + text.length };
    };
    for (const issue of section.issues) document.issues.push({ ...locate(issue.text), lang: section.lang, value: issue });
    for (const text of section.keep) document.keep.push({ ...locate(text), lang: section.lang, value: text });
  }
  return document;
}

const overlaps = (a: Range, b: Range): boolean => a.start < b.end && b.start < a.end;

const apply = (source: string, suggestion: Suggestion, option: string): string =>
  source.slice(0, suggestion.start) + option + source.slice(suggestion.end);

/** 1 minus the normalized Levenshtein distance, case-insensitive. */
export function similarity(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (!x.length && !y.length) return 1;
  let previous = Array.from({ length: y.length + 1 }, (_, index) => index);
  for (let i = 1; i <= x.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= y.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return 1 - previous[y.length] / Math.max(x.length, y.length);
}

/** Whether a suggestion fixes the planted issue: Level 1 needs a matching fix in one of its options. */
function fixes(document: CaseDocument, issue: Located<PlantedIssue>, suggestion: Suggestion): boolean {
  if (suggestion.level !== issue.value.level || !overlaps(suggestion, issue)) return false;
  if (issue.value.level === 2) return true;
  return suggestion.options.some((option) => {
    const delta = option.length - (suggestion.end - suggestion.start);
    const from = Math.min(issue.start, suggestion.start);
    const to = Math.max(issue.end, suggestion.end) + Math.max(0, delta) + 1;
    return issue.value.fix!.test(apply(document.source, suggestion, option).slice(from, to));
  });
}

const describe = (suggestion: Suggestion): string => `${JSON.stringify(suggestion.from)} → ${JSON.stringify(suggestion.options[0])}`;

/** Scores one analysis against the case's answer key and rules. */
export function scoreRun(document: CaseDocument, review: ResolvedReview): RunScore {
  const suggestions = [...review.level1, ...review.level2];
  const passageOf = (suggestion: Suggestion): Lang =>
    document.sections.find((section) => suggestion.start >= section.start && suggestion.start < section.end)!.lang;
  const found = document.issues.filter((issue) => suggestions.some((suggestion) => fixes(document, issue, suggestion)));
  const score: RunScore = {
    found: found.length,
    total: document.issues.length,
    missed: document.issues.filter((issue) => !found.includes(issue)).map((issue) => `${issue.lang}: ${JSON.stringify(issue.value.text.length > 40 ? `${issue.value.text.slice(0, 37)}...` : issue.value.text)}`),
    keepViolations: [],
    levelOneRewrites: [],
    languageMismatches: [],
    unknownNoteLanguage: 0,
    unplaced: review.skipped,
    extras: suggestions.filter((suggestion) => !document.issues.some((issue) => overlaps(suggestion, issue))).map(describe),
  };
  for (const suggestion of suggestions) {
    for (const kept of document.keep) {
      if (overlaps(suggestion, kept) && !apply(document.source, suggestion, suggestion.options[0]).includes(kept.value)) {
        score.keepViolations.push(`${describe(suggestion)} changes ${JSON.stringify(kept.value)}`);
      }
    }
    if (suggestion.level === 1 && similarity(suggestion.from, suggestion.options[0]) < LEVEL_ONE_MIN_SIMILARITY) {
      score.levelOneRewrites.push(describe(suggestion));
    }
    const passage = passageOf(suggestion);
    const noteLanguage = detectLanguage(suggestion.note, document.languages);
    if (!noteLanguage) score.unknownNoteLanguage += 1;
    else if (noteLanguage !== passage) score.languageMismatches.push(`${passage} text, ${noteLanguage} note: ${JSON.stringify(suggestion.note)}`);
    // Similarity alone can't catch this: Norwegian "bruker grensesnittet" "fixed" into Swedish is still 0.5 similar.
    const replacementLanguage = detectLanguage(suggestion.options[0], document.languages);
    if (replacementLanguage && replacementLanguage !== passage && replacementLanguage !== detectLanguage(suggestion.from, document.languages)) {
      score.languageMismatches.push(`${passage} text replaced in ${replacementLanguage}: ${describe(suggestion)}`);
    }
  }
  return score;
}
