# Producing the change set

The whole value of sharp-pen is that the author approves each change *with
intention*. That only works if every entry is small enough to judge at a glance
and honest about what it is. A change set that quietly rewrites the author's
voice is a failure even if every sentence it produces is better English.

## The two levels

**Level 1 — spelling and grammar.** Things that are wrong, not things that could
be better. Typos, misspellings, subject/verb and singular/plural agreement,
missing or wrong prepositions, missing articles, missing auxiliaries, wrong
homophones (its/it's, to/too, our/out), hyphenation of compound adjectives,
capitalisation of proper nouns and sentence starts, doubled spaces, comma
splices, missing commas that change the reading.

Level 1 never reorders words, never changes vocabulary, never cuts anything.
If you find yourself improving the sentence, it belongs in level 2.

**Level 2 — sentence construction.** One entry per sentence (or tightly linked
pair). Mixed or broken parallel structure, missing subjects and fragments,
sentences carrying three clauses that want splitting, adverbial phrases wedged
between verb and object, repeated nouns inside one sentence, idioms that are
nearly right, endings that trail off. Preserve the author's register, their
contractions, their humour and their opinions. Do not add claims, do not remove
their hedges, do not make casual prose corporate.

## Scale

Roughly one level-1 entry per 40–60 words of rough draft, and one level-2 entry
per 2–4 sentences of the ones that actually need it. On a 1,200-word draft
expect something like 40–60 level-1 and 15–25 level-2 entries. Do not pad: a
sentence that reads well gets no entry at all.

## Options

Give 2–3 options wherever there is a real choice, and exactly one where there
isn't. "planing" → "planning" has one answer. "I already done" has several:
`I have already done`, `I've already done`, `I already did` — contraction or
not is the author's call, not yours, and they will want to see both.

Order matters: option 0 is what "Accept all" applies and what the right pane
shows, so it goes first. For level 2, options should differ in *approach*
(split into two sentences vs. tighten into one), not just in word choice.

Every entry needs a `note`: one short line naming the fault, not the fix.
"Missing auxiliary verb", "'neither' needs a paired 'nor'", "Two stacked
openers before the subject". The author is reading these to learn, not to be
reassured.

## Anchors — the part that breaks

`from` must be copied verbatim out of the source: same apostrophes (straight vs
curly), same spacing, same casing, same punctuation. The builder does an exact
string match and will refuse anything else.

- If `from` occurs more than once ("planing", "to", "a", "or"), add
  `"occurrence": 2` — the 1-based index of the one you mean. The builder counts
  and tells you how many it found.
- Keep level-1 `from` as short as the error itself. `"a"` → `"an"` is fine with
  an occurrence index; do not swallow half a sentence to make it unique.
- Level-2 `from` is the full sentence, ending punctuation included. It may
  contain level-1 spans — that is expected and handled. It must not cut a
  level-1 span in half; the builder checks and refuses.
- When a level-1 fix needs a capital in the following word (`check, if` →
  `check. If`), make it ONE entry covering both words. Two entries that must be
  accepted together are a trap for the author.

## Fixing, not forcing

If the builder rejects an entry, fix the entry. Never edit the source text to
make an anchor match — the left pane must stay byte-identical to what the author
pasted, or the whole review is untrustworthy.

## Interpretation and gaps

Where the author's intent is genuinely unclear — a word that looks like a typo
for two different words, a placeholder they left in ("functional and …
requirements") — do NOT guess silently.

- If a reading is likely, offer it as a level-1 entry and say so in the note:
  "Guess at intent — check this one."
- If there is no likely reading, leave the text alone and mention it in your
  chat reply instead.

Also flag in chat, not in the change set: placeholders, missing sections, broken
links, factual claims you doubt, and anything you deliberately left untouched
(for example typos inside quoted material the author may want verbatim).

## Voice checks before you ship

- Would the author recognise every level-2 rewrite as their own sentence?
- Does any entry change meaning rather than form? Remove it.
- Did you touch quoted material, code, or prompts the author may want verbatim?
  If so, say so in chat so they can reject those.
