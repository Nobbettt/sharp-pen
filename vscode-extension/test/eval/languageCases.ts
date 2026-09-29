/**
 * Mixed-language documents for `npm run eval:languages`. Each section is one language, with planted
 * errors (the answer key) and text that must survive unchanged. Every `text` and `keep` value occurs
 * exactly once in its section, which the unit tests check.
 */
export type Lang = "en" | "es" | "hu" | "sv" | "no" | "da";

export interface PlantedIssue {
  level: 1 | 2;
  /** The erroneous source text; for Level 2, the whole sentence. */
  text: string;
  /** Level 1 only: the corrected text must match this after the suggestion is applied. */
  fix?: RegExp;
}

export interface Section {
  lang: Lang;
  text: string;
  issues: PlantedIssue[];
  /** Text that no suggestion may change: quotations, names, spelling variants, correct control sentences. */
  keep: string[];
}

export interface LanguageCase {
  id: string;
  sections: Section[];
}

const hungarian: Section = {
  lang: "hu",
  text: "## Csapathírek\n\nA csapat a múlt héten befejezte az új verziót, és mindenki nagyon elégedet volt. A fejlesztők nagyon büszke volt az eredményre. Az új funkciók között van a sötét mód és a gyorsab keresés. Holnap a Budapesti irodában tartunk egy megbeszélést.\n\nMivel a határidő közel volt és a tesztek lassan futottak és a szerver is többször leállt, ezért mindenki tovább dolgozott, ami miatt fáradtak voltunk. A tesztek most már mindkét platformon lefutnak. Köszönöm mindenkinek aki segített.",
  issues: [
    { level: 1, text: "elégedet", fix: /elégedett/ },
    { level: 1, text: "büszke volt", fix: /büszkék voltak/ },
    { level: 1, text: "gyorsab", fix: /gyorsabb/ },
    { level: 1, text: "Budapesti", fix: /budapesti/ },
    { level: 1, text: "mindenkinek aki", fix: /mindenkinek, aki/ },
    { level: 2, text: "Mivel a határidő közel volt és a tesztek lassan futottak és a szerver is többször leállt, ezért mindenki tovább dolgozott, ami miatt fáradtak voltunk." },
  ],
  keep: ["A tesztek most már mindkét platformon lefutnak."],
};

const spanish: Section = {
  lang: "es",
  text: "## Noticias del equipo\n\nEl equipo a terminado la nueva versión y todos estavan muy contentos con el resultado. Los usuarios pueden ahora usar el modo oscuro, y la búsqueda es mas rápida. Mañana tendremos una reunion en la oficina de Madrid.\n\nPorque el plazo era corto y las pruebas eran lentas y el servidor falló varias veces, trabajamos hasta tarde, lo cual fue por eso que la gente estaban cansados. Como dijo nuestro jefe: \"ship it\". Gracias a todos los que usan sharp-pen.",
  issues: [
    { level: 1, text: "a terminado", fix: /ha terminado/ },
    { level: 1, text: "estavan", fix: /estaban/ },
    { level: 1, text: "mas rápida", fix: /más rápida/ },
    { level: 1, text: "reunion", fix: /reunión/ },
    { level: 1, text: "estaban cansados", fix: /estaba cansada/ },
    { level: 2, text: "Porque el plazo era corto y las pruebas eran lentas y el servidor falló varias veces, trabajamos hasta tarde, lo cual fue por eso que la gente estaban cansados." },
  ],
  keep: ["\"ship it\"", "sharp-pen"],
};

const english: Section = {
  lang: "en",
  text: "## News from the team\n\nThe team has finalised the new colour scheme for the app. Their going to present it at the next meeting. The results was better then we expected, and the app and it's settings now load in under a second. Thanks to everyone who tested sharp-pen.",
  issues: [
    { level: 1, text: "Their going", fix: /They're going|They are going/ },
    { level: 1, text: "results was", fix: /results were/ },
    { level: 1, text: "better then", fix: /better than/ },
    { level: 1, text: "it's settings", fix: /\bits settings/ },
  ],
  // UK spellings must stay UK: the spelling variant is kept, not "corrected".
  keep: ["finalised", "colour", "Thanks to everyone who tested sharp-pen."],
};

// The three Scandinavian sections plant the same kinds of error in near-identical sentences, so a
// model that mixes the languages up (e.g. "fixes" Norwegian into Swedish) shows up in the scores.
const swedish: Section = {
  lang: "sv",
  text: "## Nyheter från teamet\n\nVi har gjort om användar gränssnittet så att det blir enklare att hitta rätt. Dem nya funktionerna gör appen snabbare. Den nya sökfunktionen är mycket snabbt. Vi vill gärna tackar alla testare. Förhopningsvis kommer nästa version redan i december. Tack till alla som har hjälpt till.",
  issues: [
    { level: 1, text: "användar gränssnittet", fix: /användargränssnittet/ },
    { level: 1, text: "Dem nya", fix: /De nya/ },
    { level: 1, text: "mycket snabbt", fix: /mycket snabb(?!t)/ },
    { level: 1, text: "gärna tackar", fix: /gärna tacka(?!r)/ },
    { level: 1, text: "Förhopningsvis", fix: /Förhoppningsvis/ },
  ],
  keep: ["Tack till alla som har hjälpt till."],
};

const norwegian: Section = {
  lang: "no",
  text: "## Nytt fra teamet\n\nVi har gjort om bruker grensesnittet slik at det blir enklere å finne fram. Det nye funksjonene gjør appen raskere. Den nye søkefunksjonen er veldig raskt. Vi vil gjerne takker alle testerne. Forhåpenligvis kommer neste versjon allerede i desember. Takk til alle som har hjulpet til.",
  issues: [
    { level: 1, text: "bruker grensesnittet", fix: /brukergrensesnittet/ },
    { level: 1, text: "Det nye funksjonene", fix: /De nye funksjonene/ },
    { level: 1, text: "veldig raskt", fix: /veldig rask(?!t)/ },
    { level: 1, text: "gjerne takker", fix: /gjerne takke(?!r)/ },
    { level: 1, text: "Forhåpenligvis", fix: /Forhåpentligvis/ },
  ],
  keep: ["Takk til alle som har hjulpet til."],
};

const danish: Section = {
  lang: "da",
  text: "## Nyt fra teamet\n\nVi har lavet bruger grænsefladen om, så det bliver nemmere at finde rundt. Dem nye funktioner gør appen hurtigere. Den nye søgefunktion er meget hurtigt. Vi vil gerne takker alle testerne. Forhåbenligt kommer næste version allerede i december. Tak til alle, der har hjulpet.",
  issues: [
    { level: 1, text: "bruger grænsefladen", fix: /brugergrænsefladen/ },
    { level: 1, text: "Dem nye", fix: /De nye/ },
    { level: 1, text: "meget hurtigt", fix: /meget hurtig(?!t)/ },
    { level: 1, text: "gerne takker", fix: /gerne takke(?!r)/ },
    { level: 1, text: "Forhåbenligt", fix: /Forhåbentlig/ },
  ],
  keep: ["Tak til alle, der har hjulpet."],
};

export const languageCases: readonly LanguageCase[] = [
  { id: "hu-es", sections: [hungarian, spanish] },
  { id: "es-hu", sections: [spanish, hungarian] },
  { id: "sv-en-hu", sections: [swedish, english, hungarian] },
  { id: "sv-no-da", sections: [swedish, norwegian, danish] },
];
