---
name: sharp-pen
description: Review a piece of writing and hand back an interactive two-pane page where the author accepts each suggested change one click at a time, choosing between alternative phrasings. Use whenever someone pastes or points at a draft — article, blog post, essay, README, newsletter, cover letter, email, documentation — and asks for proofreading, grammar and spelling checks, sentence-level or sentence-construction feedback, copy-editing, or just "look over this text". Also use when they type sharp-pen followed by text. Do NOT use when they want the corrected text applied directly with no review step, a rewrite in a different voice, a translation, a summary, or feedback on argument and structure rather than wording.
---

# sharp-pen

Turns a rough draft into a review page: the author's text on the left, the
suggested text on the right, every difference highlighted and clickable. One
click accepts a change and updates the left side. Changes with more than one
reasonable phrasing open a dropdown so the author picks.

Two passes, toggled in the page:

- **Level 1** — spelling and grammar. Things that are wrong.
- **Level 2** — sentence construction (*meningsbyggnad*). Whole-sentence
  rewrites for parallelism, fragments, overloaded clauses, awkward idiom.

The author works Level 1 first, then switches. Their picks persist across the
toggle.

## Workflow

**1. Save the source, untouched.**

Write exactly what the author gave you to `source.md` — no fixed typos, no
normalised quotes, no reflowed lines. Everything downstream matches against this
byte for byte. If they pointed at a file, copy it; do not re-type it.

**2. Ask only if the input is ambiguous.** If they pasted a draft and asked for a
review, just go. Ask only when it is genuinely unclear what the text is or which
parts are in scope (for example, a repo with several documents).

**3. Read `reference/analysis-guide.md` and write `changes.json`.**

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
    {"from": "Have to state that I'm no game designer and have little experience with game development.",
     "options": ["I should say up front that I am no game designer and have little experience with game development.",
                 "For context: I am not a game designer, and I have barely touched game development."],
     "note": "Missing subject — reads as a fragment."}
  ]
}
```

`from` is copied verbatim from the source. `occurrence` is the 1-based index
when the same text appears more than once. Option 0 is the recommended one.
Every entry needs a `note`. See the analysis guide — it covers scale, when to
give alternatives, and how to anchor level-2 sentences that contain level-1
fixes.

**4. Build.**

```bash
python3 scripts/build.py --source source.md --changes changes.json --out sharp-pen-review.html
```

The builder validates before it writes anything: anchors that are missing,
ambiguous, overlapping, or that cut a level-1 span in half all fail with an
error naming the entry. **Fix `changes.json` and re-run. Never edit the source
text to make an anchor match.** Expect to iterate once or twice — that is the
build working, not a problem worth reporting to the author.

**5. Deliver — this step depends on the client.**

*Claude app, Claude Cowork, or anything with an outputs directory:*
build straight to `/mnt/user-data/outputs/` and call `present_files` on the HTML.
Deliver it as a downloadable local file. Do **not** publish it as a hosted or
live artifact — the author's draft is theirs, and the page works offline.

*Claude Code, Codex, Copilot CLI, or any terminal client:*
build into the working directory, then start the server and give them the URL:

```bash
python3 scripts/serve.py sharp-pen-review.html
```

It binds 127.0.0.1 on a free port, prints the URL, and runs in the foreground
until Ctrl-C. Add `--open` to launch a browser, `--port N` to pin the port. If
the client cannot hold a foreground process, tell the author to run that command
themselves. The file also opens fine by double-clicking it — there is no build
step and no network dependency.

**6. Reply in chat, briefly.** Say how many changes there are at each level, and
then — the part that matters — flag anything you were unsure about: guesses at
intent, placeholders the author left in the text, typos inside quoted material
or code they may want kept verbatim, and anything you deliberately did not
touch. Do not restate the corrections; the page shows them.

## Rules

- The left pane is the author's text, exactly as given. Nothing silently edits it.
- Suggest form, not substance. Never change what a sentence claims, never remove
  their hedges or their jokes, never make casual prose corporate.
- One entry = one decision. If two fixes must be accepted together, they are one
  entry.
- Uncertain readings are labelled as guesses in the note, not smuggled in.
- Level 1 contains nothing that is merely an improvement.

## Files

- `assets/template.html` — the complete UI. Self-contained, no network, no
  dependencies. Inject and ship; it is not a starting point to rebuild from.
- `scripts/build.py` — validates the change set and writes the page.
- `scripts/serve.py` — localhost server for CLI clients.
- `reference/analysis-guide.md` — how to produce the two levels. Read before
  writing `changes.json`.
- `reference/ui-notes.md` — layout contract and the bugs already fixed in the
  template. Read only if asked to change the UI.
- `examples/changes.json` — a small worked example.
