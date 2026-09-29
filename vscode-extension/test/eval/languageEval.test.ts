import assert from "node:assert/strict";
import test from "node:test";

import type { ResolvedReview, Suggestion } from "../../src/review/types";
import { detectLanguage } from "./detectLanguage";
import { languageCases } from "./languageCases";
import { buildDocument, scoreRun, similarity } from "./score";

const svNoDa = buildDocument(languageCases.find((testCase) => testCase.id === "sv-no-da")!);

function suggestion(level: 1 | 2, start: number, end: number, option: string, note: string): Suggestion {
  return { id: `${level}-${start}`, level, start, end, from: svNoDa.source.slice(start, end), options: [option], note, status: "active" };
}

const review = (items: Suggestion[]): ResolvedReview =>
  ({ title: "sv-no-da.md", level1: items.filter((item) => item.level === 1), level2: items.filter((item) => item.level === 2), skipped: 0 });

const issueAt = (text: string, lang: string) => svNoDa.issues.find((issue) => issue.value.text === text && issue.lang === lang)!;

test("every planted issue and kept text occurs exactly once in its section, in every case", () => {
  for (const testCase of languageCases) assert.doesNotThrow(() => buildDocument(testCase), testCase.id);
  assert.deepEqual(buildDocument(languageCases[2]).languages, ["sv", "en", "hu"]);
});

test("the language detector tells the eval's languages apart in typical notes, and says unknown rather than guessing", () => {
  const all = ["en", "es", "hu", "sv", "no", "da"] as const;
  assert.equal(detectLanguage("Särskrivning: ordet ska skrivas ihop", all), "sv");
  assert.equal(detectLanguage("Stavefeil: ordet skal skrives etter reglene", all), "no");
  assert.equal(detectLanguage("Stavefejl: verbet skal stå i infinitiv efter vil", all), "da");
  assert.equal(detectLanguage("Egyeztetési hiba: többes számú alany", all), "hu");
  assert.equal(detectLanguage("Falta la tilde", all), "es");
  assert.equal(detectLanguage("Missing apostrophe: the verb is needed", all), "en");
  assert.equal(detectLanguage("OK", all), undefined);
  // Hungarian shares "ö" with Swedish; these were misread as Swedish before.
  const svHu = ["sv", "hu"] as const;
  assert.equal(detectLanguage("A középfok jele két b-vel írandó.", svHu), "hu");
  assert.equal(detectLanguage("Túl sok mellérendelt tagmondat egyetlen körmondatba zsúfolva", svHu), "hu");
  assert.equal(detectLanguage("Mivel a határidő közel volt, a tesztek lassan futottak, és a szerver is többször leállt, mindenki tovább dolgozott.", svHu), "hu");
});

test("similarity separates small Level 1 edits from rewrites and translations", () => {
  assert.ok(similarity("Their going", "They're going") > 0.7);
  assert.ok(similarity("gärna tackar", "gärna tacka") > 0.9);
  assert.ok(similarity("Porque", "Como") < 0.5);
  // Closely related languages look like a small edit; the language check has to catch those instead.
  assert.ok(similarity("bruker grensesnittet", "användargränssnittet") >= 0.5);
});

test("a perfect review finds every planted issue with no violations", () => {
  const fixes: Record<string, string> = {
    "sv:användar gränssnittet": "användargränssnittet", "sv:Dem nya": "De nya", "sv:mycket snabbt": "mycket snabb", "sv:gärna tackar": "gärna tacka", "sv:Förhopningsvis": "Förhoppningsvis",
    "no:bruker grensesnittet": "brukergrensesnittet", "no:Det nye funksjonene": "De nye funksjonene", "no:veldig raskt": "veldig rask", "no:gjerne takker": "gjerne takke", "no:Forhåpenligvis": "Forhåpentligvis",
    "da:bruger grænsefladen": "brugergrænsefladen", "da:Dem nye": "De nye", "da:meget hurtigt": "meget hurtig", "da:gerne takker": "gerne takke", "da:Forhåbenligt": "Forhåbentlig",
  };
  const notes = { sv: "Särskrivning: ordet ska skrivas ihop", no: "Stavefeil: ordet skal skrives etter reglene", da: "Stavefejl: verbet skal stå efter reglerne" } as const;
  const items = svNoDa.issues.map((issue) => suggestion(1, issue.start, issue.end, fixes[`${issue.lang}:${issue.value.text}`], notes[issue.lang as keyof typeof notes]));
  const score = scoreRun(svNoDa, review(items));
  assert.equal(score.found, score.total);
  assert.deepEqual([score.missed, score.keepViolations, score.levelOneRewrites, score.languageMismatches, score.extras], [[], [], [], [], []]);
});

test("a fix in the wrong language, a note in the wrong language, and a changed control sentence are all caught", () => {
  const norwegian = issueAt("bruker grensesnittet", "no");
  const danish = issueAt("Dem nye", "da");
  const control = svNoDa.keep.find((kept) => kept.lang === "sv")!;
  const score = scoreRun(svNoDa, review([
    suggestion(1, norwegian.start, norwegian.end, "användargränssnittet", "Särskrivning: ordet ska skrivas ihop"),
    suggestion(1, danish.start, danish.end, "De nye", "Stavefeil: ordet skal skrives etter reglene"),
    suggestion(2, control.start, control.end, "Tack alla som hjälpte till.", "Onödigt ord"),
  ]));
  assert.equal(score.found, 1, "only the Danish fix is right; the Norwegian one was 'fixed' into Swedish");
  assert.equal(score.keepViolations.length, 1);
  assert.ok(score.languageMismatches.some((item) => item.startsWith("no text replaced in sv")));
  assert.ok(score.languageMismatches.some((item) => item.startsWith("no text, sv note")));
  assert.ok(score.languageMismatches.some((item) => item.startsWith("da text, no note")));
});
