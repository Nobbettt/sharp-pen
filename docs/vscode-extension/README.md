# sharp-pen for VS Code: design pack

Status: implemented for the initial 0.1 release.

This pack defines the first VS Code extension release:

- [Requirements](requirements.md) — scope, behavior, and acceptance criteria.
- [Technical design](technical-design.md) — components, data contracts, CLI adapters,
  validation, security, and lifecycle.
- [UX specification](ux-spec.md) — review surface, toolbar, settings, themes, and states.
- [Research notes](research.md) — verified platform and CLI constraints with primary
  sources.

## Product decisions

The design uses these defaults unless review changes them:

1. The normal Markdown or plain-text editor remains the source of truth; Sharp
   Pen opens a review webview beside it.
2. Accepting suggestions is staged in the review. **Apply** commits all accepted
   choices as one undoable edit.
3. **Accept all** accepts the first option only for pending suggestions in the
   active level; explicit Keep original and chosen alternatives are preserved.
4. `Auto` selects the first installed client in this order: Claude Code, Codex,
   GitHub Copilot CLI, OpenCode. sharp-pen never switches provider after a failed run.
5. The preview defaults to sharp-pen's light palette; Dark and Auto are available
   in settings, with Auto following VS Code's theme.
6. Version 1 is a desktop/workspace extension. VS Code for the Web cannot run
   the required local CLI processes.
7. Version 1 supports VS Code's `markdown` and `plaintext` language modes. Other
   prose formats wait until their parsing rules are explicitly designed.

## Review gates

Confirmed by the product owner on 2026-09-21:

- Accept all affects only pending suggestions in the active level; explicit Keep
  original and chosen alternatives are preserved.
- Choices are staged and committed through one explicit Apply action.
- Markdown code, front matter, raw HTML, and link destinations are excluded from
  analysis.
- Version 1 is desktop/workspace-only.

The implementation, extension README, privacy policy, and CI workflow now follow
these decisions.
