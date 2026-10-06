# Changelog

## Unreleased

- Recognize VS Code's agent, prompt, instruction and skill Markdown language modes, or any filename ending in `.md` (case-insensitive), so the review button and Markdown handling remain available.
- Analyse documents of up to 1,000,000 characters (previously 100,000) in sections: each section is a separate AI request, at most three run at once, and its suggestions appear as soon as it finishes. The status shows "Analyzed 3 of 7 sections". A failed section is reported without discarding the others.
- Editing, reconciling suggestions and applying changes stay responsive in large documents by re-parsing only the blocks you touched.

## 0.3.0

- Review documents in their own language, detected automatically from the text with nothing to set. sharp-pen reviews by that language's rules, keeps its spelling variant (US or UK English, Brazilian or European Portuguese), writes its notes in it, and never translates.
- Review documents that mix languages passage by passage: each passage is checked in its own language and gets notes in that language. Only short insertions from another language, such as quotations, loanwords and names, are left unchanged.
- Leave quoted text, product names, technical terms, code-like text such as `camelCase` or file names, and deliberate fragments alone.
- Prefer fewer, confident suggestions: sentences that read well get none.
- More reliable responses from every AI client: the prompt includes a worked example, states the response format once, and repeats the output rule after the document.

## 0.2.0

- Render ```` ```mermaid ```` fenced code blocks as diagrams in the preview, following the preview theme. Invalid diagrams fall back to their source.
- Use a single review panel that follows the active Markdown or plain-text editor, and replace the shown review when opening another. Each document keeps its review state while hidden.
- Use the `edit-sparkle` icon for the Open Review editor button.
- New Marketplace icon: the sharp-pen nib on a round white background, readable on dark and light themes.
- Accept newer Codex, GitHub Copilot and OpenCode CLI versions instead of refusing every version except one. A CLI is refused only when it lacks a flag or feature sharp-pen needs to run it without tools.

## 0.1.1

- Add split-view and inline-review screenshots to the Marketplace page.

## 0.1.0

- Initial VS Code extension release for Markdown and plain-text review.
