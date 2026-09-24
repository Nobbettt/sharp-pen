export interface FenceLanguageOption {
  language: string;
  label: string;
  disabled: boolean;
  selected: boolean;
}

/** Plain text is one UI choice for both an empty source token and `plaintext`. */
export function fenceLanguageOptions(sourceLanguage: string, installed: readonly string[]): FenceLanguageOption[] {
  const current = sourceLanguage === "" || sourceLanguage === "plaintext" ? "" : sourceLanguage;
  const languages = ["", ...installed.filter((item) => item !== "plaintext")];
  if (current && !installed.includes(current)) languages.splice(1, 0, current);
  return languages.map((language) => ({
    language,
    label: language || "Plain text",
    disabled: Boolean(language && !installed.includes(language)),
    selected: language === current,
  }));
}
