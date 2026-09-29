import type { Lang } from "./languageCases";

/**
 * Words and letters typical of each language. A marker two candidates share (Norwegian and Danish
 * "skal") counts for both and cancels out; "og" is left out because it would only ever tie.
 * ponytail: marker lists, not a real language identifier; short notes often score "unknown", which
 * the eval reports but never fails on. Swap in an n-gram detector if unknowns hide real problems.
 */
const markerWords: Record<Lang, string[]> = {
  en: ["the", "is", "are", "should", "need", "needs", "missing", "spelling", "agreement", "subject", "possessive", "typo", "verb", "comma", "means"],
  es: ["falta", "tilde", "concordancia", "oración", "debe", "sobra", "ortográfico", "ortografía", "verbo", "auxiliar", "escribe", "lleva", "la", "el", "del", "que", "con"],
  hu: ["hiba", "helyesírás", "vessző", "kell", "szükséges", "egyeztet", "mondat", "tagmondat", "körmondat", "kisbetű", "nagybetű", "hiány", "többes", "szám", "melléknév", "segédige", "középfok", "írandó", "írjuk", "és", "az"],
  sv: ["och", "är", "inte", "att", "för", "stavfel", "stavning", "saknas", "särskrivning", "särskrivet", "skrivas", "böjning", "ska", "ordet", "verbet"],
  no: ["feil", "stavefeil", "skrivefeil", "særskriving", "bøyning", "etter", "av", "gjerne", "å", "skrives", "skal", "mangler", "ordet", "verbet"],
  da: ["fejl", "stavefejl", "særskrivning", "bøjning", "efter", "af", "gerne", "at", "skrives", "skal", "mangler", "ordet", "verbet"],
};

/** Letters only one candidate uses. Not Swedish "ö": Hungarian has it too ("többször"), which misread Hungarian as Swedish. */
const markerLetters: Partial<Record<Lang, string>> = { es: "ñ¿¡", hu: "őű", sv: "ä" };

// Hungarian adds suffixes ("hibás", "mondatba"), so its markers match word beginnings.
const suffixed = new Set<Lang>(["hu"]);

// `\b` only knows ASCII letters, so "és" or "särskrivning" would never match; use Unicode letter lookarounds.
const markers = Object.fromEntries(Object.entries(markerWords).map(([lang, words]) => {
  const letters = markerLetters[lang as Lang];
  const end = suffixed.has(lang as Lang) ? "" : "(?!\\p{L})";
  return [lang, new RegExp(`(?<!\\p{L})(?:${words.join("|")})${end}${letters ? `|[${letters}]` : ""}`, "giu")];
})) as Record<Lang, RegExp>;

/** The candidate language with the most markers in `text`, or undefined when none leads. */
export function detectLanguage(text: string, candidates: readonly Lang[]): Lang | undefined {
  const scores = candidates.map((lang) => ({ lang, score: text.match(markers[lang])?.length ?? 0 }))
    .sort((a, b) => b.score - a.score);
  if (!scores.length || scores[0].score === 0 || scores[0].score === scores[1]?.score) return undefined;
  return scores[0].lang;
}
