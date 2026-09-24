# Privacy

The sharp-pen service collects, stores, and transmits nothing. Selected AI
clients may send review prose to their providers under those providers' terms.

- The review page is a single self-contained HTML file, built on your machine.
  It loads no external scripts, fonts, or other resources, and makes no network
  requests.
- `serve.py` binds to `127.0.0.1` only. Nothing is exposed beyond your machine.
- No analytics, no telemetry, no accounts, no cookies, no third-party services.
- Your draft and the review page it produces are ordinary local files. Delete
  them and nothing remains.

## The demo website

The one exception is the hosted demo at https://nobbettt.github.io/sharp-pen/,
which carries a cookieless page-view counter (Cloudflare Web Analytics) so we
can tell whether anyone finds the project. It counts page views and referrers
in aggregate; it sets no cookies and does not track you across sites. It exists
only on that demo page — a review page you build yourself never contains it.

## What sharp-pen does not control

The suggestions themselves are produced by the AI assistant you run the skill
in — Claude, ChatGPT, Codex, Copilot CLI, or another client that reads the
skill format. Your draft is processed by that provider, under that provider's
terms and privacy policy.

sharp-pen adds no transmission of its own, but it cannot change how your
assistant or selected CLI handles the review prose you give it. If your draft is
sensitive, that relationship is the one to check.

## VS Code extension

The VS Code extension has no sharp-pen service, accounts, API keys, analytics,
or telemetry. It passes a document snapshot to the AI CLI selected in the
extension's settings; authentication, local data handling, and any provider
transmission belong to that CLI and its provider. sharp-pen does not read or
manage provider credentials.

The CLI runs on the workspace extension host. In a remote VS Code session,
that is normally the remote machine or container, so its CLI installation and
sign-in are used there. Claude Code, Codex, and Copilot receive the snapshot on
stdin. OpenCode receives it through a private temporary file that is deleted
when the process ends; its user/project configuration is replaced with a
deny-all, plugin-free sharp-pen configuration for that run.

## Questions

Open an issue at https://github.com/Nobbettt/sharp-pen/issues.
