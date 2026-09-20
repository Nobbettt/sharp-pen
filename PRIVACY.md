# Privacy

sharp-pen collects nothing, stores nothing, and transmits nothing.

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
assistant handles the text you give it. If your draft is sensitive, that
relationship is the one to check.

## Questions

Open an issue at https://github.com/Nobbettt/sharp-pen/issues.
