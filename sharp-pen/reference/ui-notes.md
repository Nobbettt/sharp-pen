# UI notes

`assets/template.html` is finished and correct. Ship it as-is: inject data and
deliver. Only read this file if you are asked to change the UI itself.

## Layout contract

- Fixed viewport: `html, body { height:100%; overflow:hidden }`, body is a flex
  column, header and footer are `flex:0 0 auto`, `main` is `flex:1; min-height:0`,
  panes are flex columns, `.doc` is `flex:1; min-height:0; overflow:auto`. The
  page never scrolls; only the text panes do.
- Under 880px this is undone — `html,body{height:auto;overflow:auto}`, panes
  stack, `.doc{max-height:70vh}` — because two locked panes on a phone are
  unreadable.
- Views: `split` (default, two panes) and `inline` (one pane, track-changes:
  original struck through, suggestion after it). Toggled by a class on `main`.
- Levels 1 and 2 keep independent state, counters and progress bars.

## Bugs already fixed here — do not reintroduce

**Chrome selectors must be direct-child scoped.** `.pane h2` also matched every
`##` heading in the rendered document, which inherited sticky positioning,
uppercase and the header border. It is `.pane > h2`.

**Sticky sticks by the margin box.** A sticky heading with `margin-top:1.5em`
pins its *margin* edge at `top:0`, leaving a transparent band above it with text
scrolling through. Rendered headings use padding for their spacing, never a top
margin.

**Sticky also stops below the scroll container's own padding.** `.doc` therefore
has `padding-top:0` and a `.doc::before` spacer element instead, so a pinned
heading sits flush against the pane header.

**Re-rendering resets scroll.** `render()` rebuilds both panes from scratch on
every state change; it saves and restores `scrollTop` for all three docs around
the rebuild.

**Level nesting.** Level-2 spans wrap level-1 ones. In level-2 view, an unaccepted
level-2 span displays the *current* draft (the author's accepted level-1 picks
applied). Accepting a level-2 option supersedes every level-1 fix inside it;
rejecting it hands those back. `sourceFor()` is the single place this is decided.

**No network.** `mdLite()` is a small built-in markdown renderer. The page must
keep working from `file://` with no connection — never swap it for a CDN script.

**Tokens.** Level-1 spans are `⟦c1⟧` in the source string, converted to `@@c1@@`
sentinels before rendering and replaced with DOM nodes afterwards, because
markdown parsing must not mangle them and `@@` has no meaning in markdown.

## Interaction contract

- Single-option change: one click accepts, click again reopens the menu.
- Multi-option change: shows `▾` in the suggested pane, click opens the dropdown
  (options first, "keep" last, current choice ticked).
- Each pane has its own Copy button offering Markdown or raw text. Left copies
  the working draft, right copies the suggested version.
- Hover shows the note; the menu suppresses the tooltip while open.
