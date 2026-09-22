import assert from "node:assert/strict";
import test from "node:test";

import { maskMarkdownForPrompt, ReviewValidationError, validateAndResolve } from "../../src/review/validate";

const response = (from: string) => ({ title: "Draft", level1: [{ from, options: ["the"], note: "Typo" }], level2: [] });

test("Markdown leaves literal less-than text and an unclosed front-matter opener available", () => {
  const source = "\ufeff---\ntitle: teh\n2 < 3, and <unfinished teh stays prose.";
  const masked = maskMarkdownForPrompt(source);
  assert.match(masked, /title: teh|2 < 3|unfinished teh/);
  assert.doesNotMatch(masked, /---/);
  assert.doesNotThrow(() => validateAndResolve(source, response("unfinished teh"), "markdown"));
});

test("MDAST excludes HTML bytes but retains exact text nodes between inline tags", () => {
  const source = "Intro teh <span>outer teh <span>inner teh</span> trailing teh</span> outro teh.";
  const masked = maskMarkdownForPrompt(source);
  assert.doesNotMatch(masked, /<span>|<\/span>/);
  assert.match(masked, /Intro teh|outer teh|inner teh|trailing teh|outro teh/);
  assert.doesNotThrow(() => validateAndResolve(source, response("trailing teh"), "markdown"));
});

test("Markdown masks nested container syntax, escapes, emphasis, and heading closers", () => {
  const source = [
    "> > - **nested teh**",
    "> > # Heading teh ###",
    "> > \\*literal teh\\* and \\[bracket teh\\]",
    "- > 1. _listed teh_",
    "> > ---",
  ].join("\n");
  const masked = maskMarkdownForPrompt(source);
  assert.match(masked, /nested teh|Heading teh|literal teh|bracket teh|listed teh/);
  assert.doesNotMatch(masked, /literal teh|bracket teh/);
  assert.doesNotMatch(masked, />|\*\*|###|---|\\|_/);
  assert.throws(() => validateAndResolve(source, response("###"), "markdown"), ReviewValidationError);
});
