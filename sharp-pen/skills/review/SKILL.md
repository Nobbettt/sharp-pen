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

**0. Locate the skill directory and make a run directory.** Every path below is
relative to the folder containing this SKILL.md — *not* the working directory.
Resolve it once and use it throughout:

```bash
SP="${CLAUDE_PLUGIN_ROOT}/skills/review"   # filled in when installed as a Claude Code plugin
[ -f "$SP/SKILL.md" ] || SP=$(dirname "$(find ~ /mnt /opt /workspace -name SKILL.md -path '*sharp-pen*' 2>/dev/null | head -1)")
ls "$SP/scripts/build.py" "$SP/assets/template.html"
```

If either file is missing, **stop and tell the author the skill is installed
incompletely** — the folder needs `SKILL.md`, `scripts/`, `assets/` and
`reference/` together. Do not build a page by hand as a fallback: an
approximation of this UI is worse than no page, because it silently drops the
behaviour the author is relying on.

Then make a scratch directory for this run. **Nothing this skill writes belongs
in the author's working directory** — that is their project, not your workbench:

```bash
RUN=$(mktemp -d)   # or the scratch/session directory your client hands you
```

`source.md`, `changes.json` and the built page all live in `$RUN`. Shell
variables do not survive between tool calls in most clients, so substitute the
resolved path whenever you write a file with anything other than bash.

**1. Save the source untouched** to `$RUN/source.md` — no fixed typos, no
normalised quotes, no reflowed lines. Every anchor matches it byte for byte.

**2. Read `$SP/reference/analysis-guide.md`, write `$RUN/changes.json`:**

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
    {"from": "Have to say the fix turned out simple.",
     "options": ["I have to say the fix turned out to be simple.",
                 "The fix, I have to say, was simple."],
     "note": "Missing subject — reads as a fragment."}
  ]
}
```

**3. Build.** `build.py` is the only thing that produces HTML. Do not write a
page, a component or a styled preview of your own, and do not adapt the template
by hand — the UI is finished and carries fixes that are not obvious from reading
it.

```bash
python3 "$SP/scripts/build.py" --source "$RUN/source.md" --changes "$RUN/changes.json" --out "$RUN/sharp-pen-review.html"
```

Validation runs before anything is written; errors name the failing entry. Fix
`changes.json` and re-run — never edit the source to make an anchor match.
Iterating once or twice is normal and not worth reporting.

**4. Deliver.**

- *Outputs directory available (Claude app, Cowork):* build with `--out
  /mnt/user-data/outputs/sharp-pen-review.html` and call `present_files` — only
  the page is delivered, the intermediates stay in `$RUN`. A local file, never a
  published or hosted artifact.
- *Terminal client (Claude Code, Codex, Copilot CLI):* build into `$RUN`, then
  `python3 "$SP/scripts/serve.py" "$RUN/sharp-pen-review.html"` — binds
  127.0.0.1 on a free port, prints the URL, foreground until Ctrl-C. `--open`
  launches a browser, `--port N` pins the port. If the client cannot hold a
  foreground process, give the author the command. Give them the file path too:
  it sits outside their project and opens fine by double-clicking.

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
