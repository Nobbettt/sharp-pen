<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark-transparent.png">
    <img src="docs/assets/logo-transparent.png" alt="sharp-pen" height="150">
  </picture>
</p>

<p align="center">
  <strong>Grammarly-style proofreading, run by your AI assistant. You keep the pen.</strong>
</p>

<p align="center">
  <a href="https://nobbettt.github.io/sharp-pen/"><img src="https://img.shields.io/badge/Demo-Live-blue?style=for-the-badge" alt="Live demo"></a>
  <a href="#install"><img src="https://img.shields.io/badge/Claude%20%7C%20ChatGPT%20%7C%20Codex-Plugin-d97757?style=for-the-badge" alt="Claude, ChatGPT and Codex plugin"></a>
  <a href="https://github.com/Nobbettt/sharp-pen/releases/latest/download/sharp-pen-latest.zip"><img src="https://img.shields.io/badge/Download-Skill%20.zip-green?style=for-the-badge&logo=github&logoColor=white" alt="Download the skill as a zip"></a>
</p>

---

Grammarly-style proofreading, run by your AI assistant. It fixes your writing
without changing your tone or reformulating what you wanted to say. Hand it a
draft and it hands back a review page: your text on the left, suggestions on
the right, every difference clickable. Accept a change with one click; when
there is more than one reasonable phrasing, pick from a dropdown. Nothing is
applied until you say so.

https://github.com/user-attachments/assets/7fab5412-2428-4cd1-8e86-4208745bcfe7

It is packaged as an agent skill and plugin: a folder with instructions and two
small Python scripts that work in Claude, ChatGPT, Codex, Copilot CLI and other
clients that read the skill format.

There is also a separate [VS Code extension](vscode-extension/README.md) for
reviewing Markdown and plain-text editors with a user-installed local AI CLI.

Two passes, toggled in the page:

- **Level 1 — spelling and grammar.** Things that are wrong: typos, agreement,
  prepositions, missing articles, homophones, comma splices.
- **Level 2 — sentence construction.** Fragments, broken parallelism, buried
  points, sentences that trail off. One entry per sentence.

The left pane is always your text byte for byte. The skill suggests form, not
substance: it never changes what a sentence claims, strips a hedge, or makes
casual prose corporate.

## Why

Many writers want to do the rough draft themselves. Getting the words down is
part of the thinking, and handing it to a model takes that away. What they
want afterwards is what Grammarly offers: catch the typos, fix the grammar,
flag the sentence that doesn't quite work, and leave everything else alone.
Asking a general assistant for that is surprisingly hard. Tell it to proofread
and it rewrites, smooths out the voice, drops a hedge the author meant, or
quietly changes a claim. And it hands back one version, take it or leave it.
sharp-pen constrains the model to form, not substance, and splits its
suggestions into hard errors and optional sentence fixes. Where more than one
phrasing would do, it offers two or three alternatives rather than picking for
you, so the choice of wording stays with the author. Every suggestion is a
separate click. The author stays the author. The AI is a careful copy editor
that never touches the text without asking.

## Try it

No install needed: the **[live demo](https://nobbettt.github.io/sharp-pen/)** is
a 400-word blog draft reviewed by sharp-pen. Toggle between Level 1 and Level 2, click a highlight to
accept it, open a dropdown where more than one phrasing fits, then download the
result.

## Install

You don't need a terminal. sharp-pen is free on every Claude plan, including
Free, and on ChatGPT desktop.

**Claude — web or desktop app**

1. Download [`sharp-pen-latest.zip`](https://github.com/Nobbettt/sharp-pen/releases/latest/download/sharp-pen-latest.zip).
2. In Claude, open **Settings → Customize → Skills**.
3. Click **+**, choose **Create skill**, then **Upload a skill**, and pick the zip.
4. It appears in your skills list, switched on. Paste a draft into any chat and
   ask for proofreading.

Works the same in Cowork. Older versions are on the
[Releases](https://github.com/Nobbettt/sharp-pen/releases) page.

**ChatGPT desktop / Codex**

```bash
codex plugin marketplace add Nobbettt/sharp-pen
codex plugin add sharp-pen@sharp-pen
```

Restart ChatGPT desktop after adding the marketplace. Then type `$sharp-pen`
followed by your text, or just ask for proofreading.

For a standalone Codex skill instead, unzip
[`sharp-pen-latest.zip`](https://github.com/Nobbettt/sharp-pen/releases/latest/download/sharp-pen-latest.zip)
into `~/.agents/skills/`, or `.agents/skills/` at a project root.

**Claude Code**

```
/plugin marketplace add Nobbettt/sharp-pen
/plugin install sharp-pen@sharp-pen
```

Then paste a draft into any project and ask for proofreading, or run
`/sharp-pen:review` followed by the text.

**VS Code extension**

The extension supports VS Code's Markdown and plain-text language modes on
desktop and remote workspace extension hosts. Install a VSIX with
`code --install-extension sharp-pen-0.1.0.vsix`, or open `vscode-extension/`,
run `npm install`, and press `F5` in desktop VS Code to develop it. It is not
currently published to the VS Code Marketplace. See the
[extension README](vscode-extension/README.md) for requirements, provider and
model selection, remote-host setup, and privacy details.

**Other clients (Copilot CLI, …)** — unzip the same release into your client's
skills directory so it contains a `sharp-pen/` folder with `SKILL.md` at its
root.

Requirements: Python 3. The scripts use only the standard library.

## Use

Paste or point at a draft and ask for proofreading, or type `sharp-pen`
followed by the text:

```
/sharp-pen please look over this before I publish it:

Last month I set myself a challenge: build a small side project in one
weekend. Have to say it took alot longer then that.
```

The assistant saves your text untouched, works out the suggestions, builds the
review page and opens it for you. Click through the changes, pick the phrasing
you want where there are alternatives, and download the finished text from the
page. Your original is never edited in place.

In the ChatGPT desktop app the review opens in a browser pane beside the
conversation:

![sharp-pen in the ChatGPT desktop app: a draft in the conversation on the left and the interactive Level 1 review page with highlighted corrections in a browser pane on the right](docs/assets/chatGPT-desktop-use-example.png)

In the Claude desktop app the review page opens right beside the conversation:

![sharp-pen in the Claude desktop app: the /sharp-pen prompt with a pasted draft on the left, the assistant's short summary of what it changed and left alone, and the review page with Level 1 highlights open beside it](docs/assets/claude-desktop-use-example.png)

## Privacy

The Sharp Pen service collects, stores, and transmits nothing. The review page is
a single self-contained HTML file with no external resources; the local server
binds to `127.0.0.1` only. Your draft is read by whichever assistant you run the
skill in, and a selected CLI sends review prose to its provider under that
provider's terms. Sharp Pen adds no transmission of its own. Details in
[PRIVACY.md](PRIVACY.md).

## About the author

I'm Norbert Laszlo, an AI solutions architect with a background in data
science and software engineering. I build tools for working with AI agents and
write about evaluation, agents and practical AI product work at
[norbertlaszlo.com](https://norbertlaszlo.com/) and on
[Medium](https://medium.com/@norbert-laszlo).
