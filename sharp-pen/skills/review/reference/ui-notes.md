# UI notes

`assets/template.html` is finished. Inject data and ship. Read this only if
asked to change the UI itself.

## Layout contract

- Fixed viewport: `html, body { height:100%; overflow:hidden }`, body a flex
  column, header and footer `flex:0 0 auto`, `main` `flex:1; min-height:0`,
  `.doc` `flex:1; min-height:0; overflow:auto`. Only the text panes scroll.
- Under 880px this is undone (`height:auto; overflow:auto`, panes stack,
  `.doc{max-height:70vh}`) — two locked panes on a phone are unreadable.
- Views: `split` (default) and `inline` (track changes in one pane), toggled by
  a class on `main`. Levels 1 and 2 keep independent state and counters.

## Fixed bugs — do not reintroduce

- **Scope chrome selectors to direct children.** `.pane h2` also matched every
  `##` heading in the rendered document, which then inherited sticky
  positioning, uppercase and a border. It is `.pane > h2`.
- **Sticky pins the margin box.** A top margin on a sticky heading becomes a
  transparent band with text scrolling through it. Use padding.
- **Sticky also stops below the scroll container's padding.** `.doc` has
  `padding-top:0` plus a `.doc::before` spacer instead.
- **Rebuilding resets scroll.** `render()` rebuilds both panes on every state
  change and saves/restores `scrollTop` for all three docs.
- **Level nesting.** An unaccepted level-2 span displays the current draft (the
  author's level-1 picks applied). Accepting level 2 supersedes the level-1
  fixes inside it; rejecting hands them back. `sourceFor()` is the only place
  this is decided.
- **No network.** `mdLite()` is a built-in markdown renderer; the page must work
  from `file://`. Never swap it for a CDN script.
- **Tokens.** Level-1 spans are `⟦c1⟧` in the source string, converted to
  `@@c1@@` sentinels before rendering and replaced with DOM nodes after, because
  markdown parsing must not mangle them.
- **Downloads.** Blob + anchor click. Works from a local file or localhost;
  silently blocked inside a hosted artifact preview.
- **Copy must never fail silently.** Sandboxed previews (Claude desktop
  artifacts) deny `navigator.clipboard`; a bare `try/catch` left the old
  clipboard contents in place and the author pasted their unedited draft.
  `doCopy()` now falls back to `execCommand('copy')`, and if that fails too
  opens the `#copyfb` dialog with the text selected for a manual copy.
- **Two copy buttons, two meanings.** Left copies the draft with only the
  accepted changes applied; right copies every suggestion, accepted or not.
  The menu headings say so. Do not merge them.
