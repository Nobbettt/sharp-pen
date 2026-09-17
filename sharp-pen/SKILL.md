---
name: sharp-pen
description: Review a piece of writing and hand back an interactive two-pane page where the author accepts each suggested change one click at a time, choosing between alternative phrasings. Use whenever someone pastes or points at a draft — article, blog post, essay, README, newsletter, cover letter, email, documentation — and asks for proofreading, grammar and spelling checks, sentence-level or sentence-construction feedback, copy-editing, or just "look over this text". Also use when they type sharp-pen followed by text. Do NOT use when they want the corrected text applied directly with no review step, a rewrite in a different voice, a translation, a summary, or feedback on argument and structure rather than wording.
---

# sharp-pen

Builds a review page from a draft: author's text left, suggestions right, every
difference clickable. One click accepts; changes with more than one reasonable
phrasing open a dropdown. Two passes toggled in the page — **Level 1** spelling
and grammar, **Level 2** sentence construction (*meningsbyggnad*).

## Workflow

**1. Save the source untouched** to `source.md` — no fixed typos, no normalised
quotes, no reflowed lines. Every anchor matches it byte for byte.

**2. Read `reference/analysis-guide.md`, write `changes.json`:**

```json
{
  "title": "Agentic engineering article",
  "level1": [
    {"from": "planing", "occurrence": 2, "options": ["planning"],
     "note": "Typo (planing = shaving wood)."},
    {"from": "I already done", "options": ["I have already done", "I've already done", "I already did"],
     "note": "Missing auxiliary verb."}
  ],
  "level2": [
    {"from": "Have to state that I'm no game designer.",
     "options": ["I should say up front that I am no game designer.",
                 "For context: I am not a game designer."],
     "note": "Missing subject — reads as a fragment."}
  ]
}
```

**3. Build:**

```bash
python3 scripts/build.py --source source.md --changes changes.json --out sharp-pen-review.html
```

Validation runs before anything is written; errors name the failing entry. Fix
`changes.json` and re-run — never edit the source to make an anchor match.
Iterating once or twice is normal and not worth reporting.

**4. Deliver.**

- *Outputs directory available (Claude app, Cowork):* build into
  `/mnt/user-data/outputs/`, call `present_files`. A local file, never a
  published or hosted artifact.
- *Terminal client (Claude Code, Codex, Copilot CLI):* build into the working
  directory, then `python3 scripts/serve.py sharp-pen-review.html` — binds
  127.0.0.1 on a free port, prints the URL, foreground until Ctrl-C. `--open`
  launches a browser, `--port N` pins the port. If the client cannot hold a
  foreground process, give the author the command. The file also opens fine by
  double-clicking.

**5. Reply briefly:** counts per level, then anything you were unsure about —
guesses at intent, placeholders left in the text, typos inside quoted material
or code they may want verbatim. Do not restate corrections; the page shows them.

## Non-negotiables

- The left pane is the author's text exactly as given.
- Suggest form, not substance. Never change what a sentence claims, remove their
  hedges, or make casual prose corporate.
- One entry = one decision. Fixes that must be accepted together are one entry.
- Level 1 contains nothing that is merely an improvement.

## Files

- `assets/template.html` — the complete UI, self-contained and offline. Inject
  and ship; not a starting point to rebuild from.
- `scripts/build.py` — validates the change set, writes the page.
- `scripts/serve.py` — localhost server for CLI clients.
- `reference/analysis-guide.md` — read before writing `changes.json`.
- `reference/ui-notes.md` — read only if asked to change the UI.
- `examples/` — a worked source and change set.
