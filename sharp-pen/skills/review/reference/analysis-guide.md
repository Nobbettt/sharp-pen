# Producing the change set

Every entry must be small enough to judge at a glance and honest about what it
is. A change set that quietly rewrites the author's voice is a failure even if
the prose is better.

## Language — identify it first

Before writing any entry, work out the draft's language and spelling variant
from the text itself. It is never given, and the author is never asked.

- Review in that language, by its own rules: Swedish *särskrivning* and
  *de/dem*, German noun capitalisation, the space French puts before `; : ! ?`.
  The English examples below show the kind of fault, not the rule to apply.
- A draft may mix languages. Review every passage by the rules of its own
  language — a Spanish section after a Hungarian one gets a full review too.
- Keep the spelling variant — US or UK English (color/colour, -ize/-ise),
  Brazilian or European Portuguese. Never move a draft to another variant; flag
  only a variant used inconsistently within the draft, at level 1.
- Never translate. Leave only short insertions from another language alone:
  quotations, loanwords, names.
- Write each `note` in the language of the text it is about.
- Set `language` in `changes.json` to the BCP 47 tag (`sv`, `en-GB`, `pt-BR`) of
  the language most of the prose is in — the first one, if two share it evenly.
  The page marks the text with it, so screen readers and spellcheck read it
  correctly.

## Level 1 — spelling and grammar

Things that are *wrong*, not things that could be better: typos, agreement,
missing or wrong prepositions, missing articles and auxiliaries, homophones
(its/it's, to/too), hyphenation of compound adjectives, capitalisation, doubled
spaces, comma splices, commas that change the reading.

Never reorders words, never changes vocabulary, never cuts. If you are improving
the sentence, it belongs in level 2.

## Level 2 — sentence structure and clarity

One entry per sentence (or tightly linked pair): broken parallel structure,
fragments, three clauses that want splitting, adverbials wedged between verb and
object, a noun repeated inside one sentence, near-miss idioms, endings that
trail off. Keep the author's register, contractions, humour and opinions.

## Scale

Roughly one level-1 entry per 20–30 words, and one level-2 entry per 2–4
sentences that need it. A 1,200-word rough draft lands around 40–60 level-1 and
15–25 level-2. Sentences that read well get nothing.

## Options

2–3 options where a real choice exists, one where it doesn't. "planing" →
"planning" has one answer; "I already done" has several — contraction or not is
the author's call. Option 0 is what "Accept all" applies and what the right pane
shows, so it goes first. Level-2 options should differ in approach (split vs.
tighten), not just word choice.

Every entry needs a `note`: one short line naming the fault, not the fix.
"Missing auxiliary verb", "'neither' needs a paired 'nor'". The author reads
these to learn.

## Anchors — the part that breaks

`from` is copied verbatim: same apostrophes, spacing, casing, punctuation. The
builder matches exactly and refuses anything else.

- Repeated text ("planing", "a", "or") needs `"occurrence": 2`, the 1-based
  index. The builder counts and tells you how many it found.
- Keep level-1 `from` as short as the error; use an occurrence index rather than
  swallowing half a sentence.
- Level-2 `from` is the full sentence including end punctuation. It may contain
  level-1 spans — that is handled — but must not cut one in half.
- A fix that forces a capital in the next word (`check, if` → `check. If`) is
  ONE entry. Two entries that must be accepted together are a trap.
- If an entry fails, fix the entry. Never edit the source.

## Uncertainty

Do not guess silently. A likely reading goes in as a level-1 entry whose note
says "Guess at intent — check this one." No likely reading means leave the text
alone and raise it in chat instead.

Leave alone entirely: quoted text, product names, technical terms, anything that
looks like code or a file name (`camelCase`, `snake_case`, `name.ext`), and
fragments the author clearly uses on purpose for effect.

Also raise in chat, never in the change set: placeholders the author left in,
missing sections, doubtful facts, and anything you deliberately skipped (typos
inside quoted material or prompts they may want verbatim).

## Before shipping

Would the author recognise every level-2 rewrite as their own sentence? Does any
entry change meaning rather than form? Remove it if so.
