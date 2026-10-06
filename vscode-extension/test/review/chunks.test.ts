import assert from "node:assert/strict";
import test from "node:test";

import { CHUNK_TARGET, chunkDocument, quickAnalysisProblem, documentBlockSlices, documentCacheStats, definitionScanStats, documentExcludedRanges, parseStats, resetDocumentCache } from "../../src/review/chunks";
import { straddlingComplexChunkDocument } from "./straddlingDocument";
import { prepareApply } from "../../src/review/edits";
import { markdownFences } from "../../src/review/fences";
import { markdownTasks } from "../../src/review/tasks";
import { reconcileSourceChanges } from "../../src/review/reconcile";
import { createReview, validateAndResolve } from "../../src/review/validate";
import { markdownExcludedRanges, markdownTooComplex, parseGfmMarkdown, REVIEW_LIMITS } from "../../src/review/validate";

/** A small seeded generator, so a failing document can be rebuilt from its seed. */
function random(seed: number): () => number {
  let state = seed;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32; };
}

const sentence = "The quick brown fox jumps over the lazy dog and keeps running.";
const fragments: Array<(n: number) => string> = [
  (n) => `# Title ${n}\n\n${sentence}\n`,
  (n) => `## Part ${n}\n\n${sentence} ${sentence}\n`,
  (n) => `${sentence}\n${sentence}\n`,
  () => "```js\nconst a = 1;\n\n# not a heading\n\n---\n\nconst b = 2;\n```\n",
  () => "~~~\nline\n\n\n## still code\n~~~\n",
  () => "- item one\n\n- item two\n\n  continued paragraph in item\n\n  ```\n  code\n\n  more\n  ```\n- item three\n",
  () => "1. first\n\n2. second\n\n   nested text\n",
  () => "| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n",
  () => "<!-- a comment\n\n# not a heading either\n\n-->\n",
  () => "<div>\n\n</div>\n",
  () => "<pre>\nkeep\n\n# literal\n</pre>\n",
  () => "> quoted line\n> another\n>\n> still quoted\n",
  () => "***\n",
  () => "Setext heading\n==============\n\nBody text.\n",
  () => "    indented code\n\n    more indented code\n",
];

function generated(seed: number, size: number, front = false): string {
  const next = random(seed);
  let source = front ? "---\ntitle: x\n\nauthor: y\n---\n" : "";
  for (let n = 0; source.length < size; n += 1) source += `${fragments[Math.floor(next() * fragments.length)](n)}${"\n".repeat(1 + Math.floor(next() * 2))}`;
  return source;
}

/** Offsets where a top-level mdast block begins, with its leading indentation skipped. */
function topLevelStarts(source: string): Set<number> {
  const bom = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  const tree = parseGfmMarkdown(source.slice(bom)) as { children: Array<{ position: { start: { offset: number } } }> };
  return new Set(tree.children.map((child) => child.position.start.offset + bom));
}

function assertCoversWithoutGaps(source: string, chunks: Array<{ start: number; end: number }>): void {
  assert.equal(chunks[0].start, 0);
  assert.equal(chunks.at(-1)!.end, source.length);
  for (let index = 1; index < chunks.length; index += 1) assert.equal(chunks[index].start, chunks[index - 1].end);
  for (const chunk of chunks) assert.ok(chunk.end > chunk.start);
}

test("every split of a generated Markdown document is the start of a top-level block", () => {
  for (let seed = 1; seed <= 12; seed += 1) {
    const source = generated(seed, 60_000, seed % 3 === 0);
    const chunks = chunkDocument(source, "markdown", 1_500);
    assert.ok(chunks.length > 10, `seed ${seed} produced ${chunks.length} chunks`);
    assertCoversWithoutGaps(source, chunks);
    const starts = topLevelStarts(source);
    for (const chunk of chunks.slice(1)) {
      const indent = /^ */.exec(source.slice(chunk.start))![0].length;
      assert.ok(starts.has(chunk.start) || starts.has(chunk.start + indent), `seed ${seed}: split at ${chunk.start} is inside a block: ${JSON.stringify(source.slice(chunk.start - 30, chunk.start + 30))}`);
    }
  }
});

test("a fence, HTML block or front matter containing blank lines and heading-like lines is never split", () => {
  const fence = `\`\`\`\n${("code line\n\n# not a heading\n\n").repeat(200)}\`\`\`\n`;
  const html = `<!--\n${("note\n\n# not a heading\n\n").repeat(200)}-->\n`;
  const front = `---\n${("key: value\n\n").repeat(200)}---\n`;
  for (const [block, name] of [[fence, "fence"], [html, "html"], [front, "front matter"]] as const) {
    const source = `${name === "front matter" ? "" : "Intro.\n\n"}${block}\n${name === "front matter" ? "Intro.\n\n" : ""}Outro.\n`;
    const begin = source.indexOf(block);
    for (const chunk of chunkDocument(source, "markdown", 800)) {
      assert.ok(!(chunk.start > begin && chunk.start < begin + block.length - 1), `${name}: split at ${chunk.start} is inside the block`);
    }
  }
});

test("a list with blank lines between its items is never split", () => {
  const list = Array.from({ length: 300 }, (_, n) => `- item ${n}\n\n  more of item ${n}\n`).join("\n");
  const source = `Intro paragraph.\n\n${list}\n\nOutro paragraph.\n`;
  const begin = source.indexOf("- item 0");
  const end = begin + list.length;
  for (const chunk of chunkDocument(source, "markdown", 800)) assert.ok(!(chunk.start > begin && chunk.start < end), `split at ${chunk.start} is inside the list`);
});

test("a split prefers the strongest heading over an ordinary paragraph break", () => {
  const paragraph = (n: number) => `Paragraph ${n} ${"x".repeat(80)}\n\n`;
  // The first 14 paragraphs plus the H1 fit in one chunk; the H1 is at an offset where a paragraph break also fits.
  const before = Array.from({ length: 14 }, (_, n) => paragraph(n)).join("");
  const source = `${before}# Big heading\n\n${Array.from({ length: 14 }, (_, n) => paragraph(n + 20)).join("")}`;
  const chunks = chunkDocument(source, "markdown", Math.ceil(source.length * 0.6));
  assert.equal(chunks.length, 2);
  assert.equal(chunks[1].start, before.length);
});

test("it uses as few chunks as the limit allows", () => {
  const source = Array.from({ length: 450 }, (_, n) => `Paragraph ${n} ${"w".repeat(40)}\n\n`).join("");
  const chunks = chunkDocument(source, "markdown");
  assert.equal(chunks.length, Math.ceil(source.length / CHUNK_TARGET));
  for (const chunk of chunks) assert.ok(chunk.end - chunk.start <= CHUNK_TARGET);
});

test("it avoids a tiny last chunk even when a heading sits just before the end", () => {
  const body = Array.from({ length: 200 }, (_, n) => `Paragraph ${n} ${"w".repeat(90)}\n\n`).join("");
  const source = `${body.slice(0, CHUNK_TARGET - 20)}\n\n# Late heading\n\n${body.slice(0, 200)}${"\n\n"}${body.slice(0, 120)}`;
  const chunks = chunkDocument(source, "markdown");
  assert.equal(chunks.length, 2);
  for (const chunk of chunks) assert.ok(chunk.end - chunk.start > CHUNK_TARGET / 4, `chunk of ${chunk.end - chunk.start} characters`);
});

test("a section larger than the target is split between its paragraphs", () => {
  const section = `# Everything\n\n${Array.from({ length: 700 }, (_, n) => `Paragraph ${n} ${"s".repeat(60)}\n\n`).join("")}`;
  const chunks = chunkDocument(section, "markdown");
  assert.ok(chunks.length >= 3);
  assertCoversWithoutGaps(section, chunks);
});

test("a single block up to the request limit becomes its own chunk, and a bigger one fails", () => {
  const big = "a".repeat(30_000);
  const source = `First.\n\n${big}\n\nLast.\n`;
  const chunks = chunkDocument(source, "markdown");
  assert.ok(chunks.some((chunk) => chunk.end - chunk.start >= big.length));
  for (const chunk of chunks) assert.ok(chunk.end - chunk.start <= REVIEW_LIMITS.source);
  assert.throws(() => chunkDocument(`First.\n\n${"a".repeat(REVIEW_LIMITS.source + 1)}\n`, "markdown"), /Document has a section too large to analyze\./);
});

test("plain text splits only at blank lines and prefers a longer run of them", () => {
  const paragraph = (n: number) => `Line ${n} ${"p".repeat(60)}\nsecond line ${n}`;
  const parts = Array.from({ length: 30 }, (_, n) => paragraph(n));
  const source = parts.map((part, n) => (n === 14 ? `${part}\n\n\n\n` : `${part}\n\n`)).join("");
  const chunks = chunkDocument(source, "plaintext", Math.ceil(source.length * 0.6));
  assert.equal(chunks.length, 2);
  assert.equal(chunks[1].start, source.indexOf("Line 15"));
  for (const chunk of chunkDocument(source, "plaintext", 300)) {
    assert.ok(chunk.start === 0 || /\n\n$/.test(source.slice(0, chunk.start)), `split at ${chunk.start} is not after a blank line`);
  }
});

test("chunks cover a document with a BOM and CRLF line endings with no gap or overlap", () => {
  const source = `\uFEFF${generated(7, 20_000).replace(/\n/g, "\r\n")}`;
  const chunks = chunkDocument(source, "markdown", 1_200);
  assert.ok(chunks.length > 5);
  assertCoversWithoutGaps(source, chunks);
  const starts = topLevelStarts(source);
  for (const chunk of chunks.slice(1)) assert.ok(starts.has(chunk.start) || starts.has(chunk.start + /^ */.exec(source.slice(chunk.start))![0].length));
});

test("a document that fits in one request is a single chunk without a section label", () => {
  const source = `# Title\n\n${sentence}\n`;
  assert.deepEqual(chunkDocument(source, "markdown"), [{ start: 0, end: source.length }]);
});

test("each chunk is labelled with the headings above where it starts", () => {
  const filler = Array.from({ length: 20 }, () => `${sentence}\n\n`).join("");
  const source = `# Install\n\n${filler}## macOS\n\n${filler}${filler}`;
  const chunks = chunkDocument(source, "markdown", 700);
  assert.equal(chunks[0].section, "Install");
  assert.equal(chunks.at(-1)!.section, "Install › macOS");
});

test("splitting a million characters parses a bounded amount of text", () => {
  const source = generated(3, 1_000_000);
  resetDocumentCache();
  const before = parseStats.characters;
  const chunks = chunkDocument(source, "markdown");
  assert.ok(chunks.length >= 50 && chunks.length <= 70, `${chunks.length} chunks`);
  assert.ok(parseStats.characters - before < source.length * 3, "parser work must stay bounded");
});

test("excluded ranges of a 300k document keep prose open and exclude code", () => {
  const source = generated(9, 300_000);
  const ranges = documentExcludedRanges(source);
  const touches = (index: number) => ranges.some((range) => range.start <= index && index < range.end);
  assert.equal(touches(source.indexOf("The quick brown fox")), false);
  assert.equal(touches(source.indexOf("const a = 1;")), true);
  assert.equal(touches(source.lastIndexOf("# not a heading")), true);
});

test("large-document parsing is bounded and edits reuse unchanged blocks", () => {
  const source = generated(4, 990_000);
  resetDocumentCache();
  const before = parseStats.characters;
  documentExcludedRanges(source);
  const first = parseStats.characters - before;
  assert.ok(first < source.length * 3);
  const at = Math.floor(source.length / 2);
  const edited = `${source.slice(0, at)}x${source.slice(at)}`;
  const restarted = parseStats.characters;
  const ranges = documentExcludedRanges(edited);
  assert.ok(parseStats.characters - restarted < first / 2, "an edit must reuse unchanged blocks");
  assert.ok(ranges.length > 0);
});

/** Pads `block` with filler paragraphs so the document is split, then returns where the block sits. */
function padded(block: string, target = 600): { source: string; begin: number; target: number } {
  const filler = (n: number) => `Filler ${n} ${"f".repeat(70)}\n\n`;
  const head = Array.from({ length: 12 }, (_, n) => filler(n)).join("");
  const tail = Array.from({ length: 12 }, (_, n) => filler(n + 50)).join("");
  return { source: `${head}${block}${tail}`, begin: head.length, target };
}

function assertNoSplitInside(block: string, name: string): void {
  const { source, begin, target } = padded(block);
  const chunks = chunkDocument(source, "markdown", target);
  assert.ok(chunks.length > 2, `${name}: not split`);
  for (const chunk of chunks) assert.ok(!(chunk.start > begin && chunk.start < begin + block.length - 1), `${name}: split at ${chunk.start} is inside the block`);
}

test("a tilde fence whose closer is indented more than three spaces stays one block", () => {
  const code = `~~~\n${"code line\n\n".repeat(60)}    ~~~\n\n# still code\n\n`;
  const { source, begin } = padded(`${code}`);
  // The indented ~~~ does not close the fence, so everything to the end of the document is code.
  for (const chunk of chunkDocument(source, "markdown", 600)) assert.ok(!(chunk.start > begin), `split at ${chunk.start} is inside the unclosed fence`);
});

test("a heading-like line directly after a table row belongs to the table in the GFM parser", () => {
  const table = `| a | b |\n|---|---|\n${"| x | y |\n".repeat(30)}# heading\n${"| x | y |\n".repeat(30)}`;
  const { source, target } = padded(table);
  const starts = topLevelStarts(source);
  for (const chunk of chunkDocument(source, "markdown", target).slice(1)) {
    assert.ok(starts.has(chunk.start) || starts.has(chunk.start + /^ */.exec(source.slice(chunk.start))![0].length), `split at ${chunk.start} is not a block start`);
  }
});

test("a fence opened inside a list item is not mistaken for a block of its own", () => {
  const item = `- ~~~\n  code\n\n  more code\n  ~~~\n\nParagraph after the list one.\n\n`;
  const source = item.repeat(80);
  const chunks = chunkDocument(source, "markdown", 700);
  assert.ok(chunks.length > 5);
  const starts = topLevelStarts(source);
  for (const chunk of chunks.slice(1)) assert.ok(starts.has(chunk.start), `split at ${chunk.start} is not a block start`);
});

test("a document of paragraphs the old thinning mishandled still packs within the target in the fewest chunks", () => {
  const build = (sizes: number[]) => sizes.map((size) => `${"p".repeat(size - 2)}\n\n`).join("");
  const first = chunkDocument(build([100, 19_700, 200, 20_000]), "markdown");
  assert.deepEqual(first.map((chunk) => chunk.end - chunk.start), [20_000, 20_000]);
  const second = chunkDocument(build([100, 19_700, 200, 19_800, 200]), "markdown");
  assert.equal(second.length, 2);
  for (const chunk of second) assert.ok(chunk.end - chunk.start <= CHUNK_TARGET);
});

test("a chunk is only over the target when it is one block that is itself bigger", () => {
  const source = `Intro.\n\n${"b".repeat(30_000)}\n\n${Array.from({ length: 400 }, (_, n) => `Paragraph ${n} ${"x".repeat(60)}\n\n`).join("")}`;
  const chunks = chunkDocument(source, "markdown");
  const big = chunks.filter((chunk) => chunk.end - chunk.start > CHUNK_TARGET);
  assert.equal(big.length, 1);
  assert.ok(source.slice(big[0].start, big[0].end).includes("b".repeat(30_000)));
});

test("a mid-document pair of --- lines is not front matter in the stitched exclusions", () => {
  const filler = Array.from({ length: 700 }, (_, n) => `Paragraph ${n} ${"x".repeat(150)}\n\n`).join("");
  const source = `${filler}---\nVisible prose\n---\n\n${filler}`;
  assert.ok(source.length > REVIEW_LIMITS.source);
  const at = source.indexOf("Visible prose");
  const ranges = documentExcludedRanges(source);
  assert.equal(ranges.some((range) => range.start <= at && at < range.end), false);
  const slices = documentBlockSlices(source)!;
  assert.ok(slices.length > 100);
});

test("a short paragraph followed by one near the request limit does not overflow the stack in tasks or fences", () => {
  const source = `${"a".repeat(98)}\n\n${"b".repeat(REVIEW_LIMITS.source - 100)}\n\nEnd.\n${"c".repeat(20_000)}\n`;
  assert.ok(source.length > REVIEW_LIMITS.source);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { markdownTasks } = require("../../src/review/tasks");
  const { markdownFences } = require("../../src/review/fences");
  assert.deepEqual(markdownTasks(source), []);
  assert.deepEqual(markdownFences(source), []);
  assert.ok(documentExcludedRanges(source).length > 0);
});

test("a one-character edit re-reads only the blocks near it, not every later block", () => {
  const source = Array.from({ length: 1_000 }, (_, n) => `Unique paragraph ${n} ${"u".repeat(960)}\n\n`).join("");
  documentExcludedRanges(source);
  const edited = source.slice(1);
  const started = performance.now();
  const incremental = documentExcludedRanges(edited);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 300, `edit pass took ${elapsed} ms (a full read of 1,000,000 characters takes seconds)`);
  resetDocumentCache();
  assert.deepEqual(incremental, documentExcludedRanges(edited));
});

test("incremental exclusions after each of several edits equal a computation from scratch", () => {
  let source = generated(21, 150_000);
  documentExcludedRanges(source);
  for (const [at, text, remove] of [[70_000, "x", 0], [70_001, "", 1], [10, "```\n", 0], [120_000, "\n\n# New\n\n", 0], [5, "", 400], [40_000, "\n\n", 0]] as const) {
    source = `${source.slice(0, at)}${text}${source.slice(at + remove)}`;
    const incremental = documentExcludedRanges(source);
    resetDocumentCache();
    assert.deepEqual(incremental, documentExcludedRanges(source), `after the edit at ${at}`);
  }
});

test("a section that is not the document start keeps a --- pair as prose, in the prompt mask and in validation", () => {
  const text = "---\nVisible prose teh\n---\n\nEnd.\n";
  const { maskMarkdownForPrompt, validateAndResolve } = require("../../src/review/validate");
  assert.ok(!maskMarkdownForPrompt(text, true).includes("Visible prose"));
  assert.ok(maskMarkdownForPrompt(text, false).includes("Visible prose teh"));
  const response = { title: "T", level1: [{ from: "teh", options: ["the"], note: "Typo" }], level2: [] };
  assert.equal(validateAndResolve(text, response, "markdown", "T", false).level1.length, 1);
});

test("a last block over the request limit at the end of the document is refused, and tasks and fences degrade without recursing", () => {
  const source = `${"a".repeat(98)}\n\n\`\`\`js\n${"b".repeat(99_991)}\n\`\`\``;
  assert.ok(source.length > REVIEW_LIMITS.source);
  assert.equal(documentBlockSlices(source), undefined);
  assert.deepEqual(markdownFences(source), []);
  assert.deepEqual(markdownTasks(source), []);
  assert.throws(() => chunkDocument(source, "markdown"), /section too large/);
});

const referenceDocument = (label: string) => `[${label}]: /dest\n\nText [label][id].\n\n${"Ordinary paragraph.\n\n".repeat(5_500)}`;

test("changing a link reference definition gives the same exclusions as a computation from scratch", () => {
  resetDocumentCache();
  documentExcludedRanges(referenceDocument("xx"));
  const incremental = documentExcludedRanges(referenceDocument("id"));
  resetDocumentCache();
  assert.deepEqual(incremental, documentExcludedRanges(referenceDocument("id")));
});

test("Apply refuses a correction that would break a link whose definition was just added", () => {
  const source = referenceDocument("id");
  const start = source.indexOf("[label]");
  resetDocumentCache();
  documentExcludedRanges(referenceDocument("xx"));
  const review = createReview(source, { documentVersion: 3, format: "markdown" }, {
    title: "T", level1: [{ id: "a", level: 1, start, end: start + 7, from: "[label]", options: ["label"], note: "Brackets", status: "active" }], level2: [], skipped: 0,
  });
  const prepared = prepareApply(review, { a: { option: 0 } }, source, 3);
  assert.deepEqual(prepared.edits, []);
  assert.equal(prepared.review.level1[0].status, "invalidated");
});

test("sizing 40,000 tiny paragraphs stays fast, so packing does not grow quadratically", () => {
  const source = "a\n\n".repeat(40_000);
  const started = performance.now();
  const chunks = chunkDocument(source, "plaintext");
  const elapsed = performance.now() - started;
  assertCoversWithoutGaps(source, chunks);
  assert.ok(elapsed < 500, `packing took ${elapsed} ms`);
});

test("one list-item fence followed by more than 100k of ordinary prose is accepted and chunked", () => {
  const source = `- ~~~\n  code\n  ~~~\n\n${Array.from({ length: 1_500 }, (_, n) => `Ordinary paragraph ${n} ${"w".repeat(80)}\n\n`).join("")}`;
  assert.ok(source.length > REVIEW_LIMITS.source);
  const chunks = chunkDocument(source, "markdown");
  assertCoversWithoutGaps(source, chunks);
  for (const chunk of chunks) assert.ok(chunk.end - chunk.start <= CHUNK_TARGET);
});

test("deleting the first character of a 1,000-paragraph document re-parses only the blocks near it", () => {
  const source = Array.from({ length: 1_000 }, (_, n) => `Unique paragraph ${n} ${"u".repeat(960)}\n\n`).join("");
  documentExcludedRanges(source);
  const before = parseStats.characters;
  documentExcludedRanges(source.slice(1));
  // A full read is about 1,000,000 characters; the edit pass needs a few windows around the edit.
  assert.ok(parseStats.characters - before < 40_000, `${parseStats.characters - before} characters were parsed again`);
});

test("the cache keeps only the latest version of a document, however many versions are analysed", () => {
  let source = Array.from({ length: 1_000 }, (_, n) => `Unique paragraph ${n} ${"u".repeat(960)}\n\n`).join("");
  documentExcludedRanges(source);
  const single = documentCacheStats().characters;
  for (let version = 1; version <= 6; version += 1) {
    source = `${"v".repeat(version)}${source.slice(version)}`;
    documentExcludedRanges(source);
  }
  assert.ok(documentCacheStats().characters <= single * 1.1, `${documentCacheStats().characters} retained, one version is ${single}`);
});

test("a document up to the request limit is analysable exactly when the whole-document check of today accepts it", () => {
  const documents = [
    "*abcdefgh* \n".repeat(1_900),
    "*abcdefgh* \n".repeat(2_300),
    ("*abcdefgh*" + " ".repeat(19) + "\n").repeat(3_000),
    "a".repeat(90_000),
    `${"*a* \n".repeat(1_000)}\n${"plain\n".repeat(10_000)}`,
  ];
  for (const source of documents) {
    assert.ok(source.length <= REVIEW_LIMITS.source);
    const quick = quickAnalysisProblem(source, "markdown");
    assert.equal(quick === "complex", markdownTooComplex(source), `${source.length} characters: ${quick}`);
    if (!markdownTooComplex(source)) assert.doesNotThrow(() => chunkDocument(source, "markdown"));
  }
});

test("a document above the request limit that passes the typing check is never refused for complexity when chunked", () => {
  const dense = ("*" + "a".repeat(28) + "\n").repeat(3_000);
  const source = `${dense}\n${"Ordinary paragraph of plain prose.\n\n".repeat(900)}`;
  assert.ok(source.length > REVIEW_LIMITS.source);
  assert.equal(quickAnalysisProblem(source, "markdown"), undefined);
  assert.doesNotThrow(() => chunkDocument(source, "markdown"));
  // Dense enough that one block of this size could not be read: the typing check has to say so up front.
  const tooDense = `${("*abcdefgh*" + " ".repeat(19) + "\n").repeat(3_000)}\n${"Ordinary paragraph of plain prose.\n\n".repeat(900)}`;
  // A window of it cannot be parsed, so there is no safe segmentation (amendment 3): the run fails as a whole.
  if (quickAnalysisProblem(tooDense, "markdown") === undefined) assert.throws(() => chunkDocument(tooDense, "markdown"), /too large or complex/);
});

const definitionVariants: Array<[string, string, string]> = [
  ["a destination added", "[id]: \n", "[id]: /dest\n"],
  ["a destination removed", "[id]: /dest\n", "[id]: \n"],
  ["a destination changed", "[id]: /dest\n", "[id]: <bad dest\n"],
  ["indented into a code block", "[id]: /dest\n", "    [id]: /dest\n"],
  ["indented by three spaces", "[id]: /dest\n", "   [id]: /dest\n"],
];
const referenceWith = (definition: string, definitionFirst: boolean) => {
  const filler = "Ordinary paragraph.\n\n".repeat(5_500);
  return definitionFirst ? `${definition}\nText [label][id].\n\n${filler}` : `Text [label][id].\n\n${filler}${definition}\nTail.\n`;
};

for (const [name, from, to] of definitionVariants) {
  for (const definitionFirst of [true, false]) {
    test(`exclusions after a definition is ${name} equal a computation from scratch (${definitionFirst ? "first" : "last"} block)`, () => {
      resetDocumentCache();
      documentExcludedRanges(referenceWith(from, definitionFirst));
      const incremental = documentExcludedRanges(referenceWith(to, definitionFirst));
      resetDocumentCache();
      assert.deepEqual(incremental, documentExcludedRanges(referenceWith(to, definitionFirst)));
    });
  }
}

test("Apply refuses a correction that breaks a link once a destination was added to its empty definition", () => {
  const source = referenceWith("[id]: /dest\n", true);
  const start = source.indexOf("[label]");
  resetDocumentCache();
  documentExcludedRanges(referenceWith("[id]: \n", true));
  const review = createReview(source, { documentVersion: 3, format: "markdown" }, {
    title: "T", level1: [{ id: "a", level: 1, start, end: start + 7, from: "[label]", options: ["label"], note: "Brackets", status: "active" }], level2: [], skipped: 0,
  });
  const prepared = prepareApply(review, { a: { option: 0 } }, source, 3);
  assert.deepEqual(prepared.edits, []);
  assert.equal(prepared.review.level1[0].status, "invalidated");
});

test("an edit in a document full of unclosed link labels is not quadratic", () => {
  const source = ("[x" + "p".repeat(60) + "\n\n").repeat(8_000);
  documentExcludedRanges(source);
  const started = performance.now();
  const incremental = documentExcludedRanges(`q${source.slice(1)}`);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 600, `the edit took ${elapsed} ms`);
  resetDocumentCache();
  assert.deepEqual(incremental, documentExcludedRanges(`q${source.slice(1)}`));
});

test("the definition scan looks at each character a bounded number of times, however many labels are left open", () => {
  for (const unit of ["[x" + "p".repeat(60) + "\n\n", "[".repeat(50) + "\n\n", "[a\\]" + "b".repeat(2_000) + "\n"]) {
    const source = unit.repeat(Math.ceil(500_000 / unit.length));
    resetDocumentCache();
    documentExcludedRanges(source);
    const before = definitionScanStats.characters;
    documentExcludedRanges(`q${source.slice(1)}`);
    const looked = definitionScanStats.characters - before;
    assert.ok(looked <= 4 * 8_000 + 2 * 100_000, `${looked} characters scanned for one edit`);
  }
});

for (const labelLength of [999, 1000]) {
  const label = "x".repeat(labelLength);
  const withDefinition = (destination: string) => `[${label}]: ${destination}\n\nText [label][${label}].\n\n${"Ordinary paragraph.\n\n".repeat(5_500)}`;
  test(`a destination added to a definition with a ${labelLength}-character label gives the exclusions of a computation from scratch`, () => {
    resetDocumentCache();
    documentExcludedRanges(withDefinition(""));
    const incremental = documentExcludedRanges(withDefinition("/dest"));
    resetDocumentCache();
    assert.deepEqual(incremental, documentExcludedRanges(withDefinition("/dest")));
  });

  // A 1000-character label is no definition, so the correction is harmless there; only 999 must be refused.
  if (labelLength === 999) test(`Apply refuses a correction that breaks a link once a destination was added to a ${labelLength}-character label's definition`, () => {
    const source = withDefinition("/dest");
    const start = source.indexOf("[label]");
    resetDocumentCache();
    documentExcludedRanges(withDefinition(""));
    const review = createReview(source, { documentVersion: 3, format: "markdown" }, {
      title: "T", level1: [{ id: "a", level: 1, start, end: start + 7, from: "[label]", options: ["label"], note: "Brackets", status: "active" }], level2: [], skipped: 0,
    });
    const prepared = prepareApply(review, { a: { option: 0 } }, source, 3);
    assert.deepEqual(prepared.edits, []);
  });
}

// ---- Amendment 3: a window that cannot be parsed leaves the document with no safe segmentation ----

const fenceUnparseable = () => `\`\`\`\n${"*abcdefgh* \n".repeat(2_300)}${"inside code\n\n".repeat(300)}teh UNIQUE\n\`\`\`\n\n${"Ordinary paragraph of plain prose.\n\n".repeat(2_400)}`;
const growthComplex = () => `${"a".repeat(70_000)}${"*abcdefgh* ".repeat(2_100)}\n\n${"Plain paragraph.\n\n".repeat(1_200)}`;

for (const [name, build] of [["a fence", fenceUnparseable], ["a growing window", growthComplex]] as const) {
  test(`a document with an unparseable window (${name}) fails to chunk with the too-large-or-complex message`, () => {
    resetDocumentCache();
    const source = build();
    assert.ok(source.length > REVIEW_LIMITS.source);
    assert.throws(() => chunkDocument(source, "markdown"), (error: unknown) => error instanceof Error && error.message === "Document is too large or complex to analyze.");
  });

  test(`a document with an unparseable window (${name}) is excluded as a whole, so nothing in it is valid, kept or applied`, () => {
    resetDocumentCache();
    const source = build();
    assert.deepEqual(documentExcludedRanges(source), [{ start: 0, end: source.length }]);
    const at = source.indexOf("teh UNIQUE") >= 0 ? source.indexOf("teh UNIQUE") : source.lastIndexOf("Plain");
    const typo = { id: "t", level: 1 as const, start: at, end: at + 3, from: source.slice(at, at + 3), options: ["the"], note: "Typo", status: "active" as const };
    assert.throws(() => validateAndResolve(source, { title: "T", level1: [{ from: typo.from, occurrence: 1, options: ["the"], note: "Typo" }], level2: [] }, "markdown", "T"));
    const review = createReview(source, { documentVersion: 1, format: "markdown" }, { title: "T", level1: [typo], level2: [], skipped: 0 });
    assert.equal(reconcileSourceChanges(review, {}, [], source, 1).review.level1[0].status, "invalidated", "reconcile must not keep a suggestion in an unsegmentable document");
    const prepared = prepareApply({ ...review, level1: [typo] }, { t: { option: 0 } }, source, 1);
    assert.deepEqual(prepared.edits, []);
  });

  test(`tasks and fences are empty for a document with an unparseable window (${name})`, () => {
    resetDocumentCache();
    const source = `- [ ] task\n\n\`\`\`js\nx\n\`\`\`\n\n${build()}`;
    assert.deepEqual(markdownTasks(source), []);
    assert.deepEqual(markdownFences(source), []);
  });
}

test("a too-complex chunk of a segmentable document does not disable tasks or fences on either side of it", () => {
  resetDocumentCache();
  const source = straddlingComplexChunkDocument("- [ ] before\n\n```js\nconst a = 1;\n```\n\n", "- [ ] after\n\n```js\nconst b = 2;\n```\n");
  const chunks = chunkDocument(source, "markdown");
  assert.ok(source.length > REVIEW_LIMITS.source);
  assert.equal(chunks.filter((chunk) => markdownTooComplex(source.slice(chunk.start, chunk.end))).length, 1);
  assert.equal(markdownTasks(source).length, 2);
  assert.equal(markdownFences(source).length, 2);
});


test("distant reference definitions protect link syntax in exclusions, reconciliation and Apply", () => {
  const source = "Text [label][id].\n\n" + "Ordinary paragraph.\n\n".repeat(6000) + "[id]: /dest\n";
  resetDocumentCache();
  const start = source.indexOf("[id]");
  const ranges = documentExcludedRanges(source);
  assert.ok(ranges.some((range) => range.start <= start && range.end >= start + 4));
  const suggestion = { id: "a", level: 1 as const, start, end: start + 4, from: "[id]", options: ["[other]"], note: "Correction", status: "active" as const };
  const review = createReview(source, { documentVersion: 1, format: "markdown" }, { title: "T", level1: [suggestion], level2: [], skipped: 0 });
  assert.deepEqual(prepareApply(review, { a: { option: 0 } }, source, 1).edits, []);
  assert.equal(reconcileSourceChanges(review, {}, [], source, 1).review.level1[0].status, "invalidated");
  const edited = source.replace("Ordinary", "Normal");
  const incremental = documentExcludedRanges(edited);
  resetDocumentCache();
  assert.deepEqual(incremental, documentExcludedRanges(edited));
});


test("reference definitions in block quotes retain context across windows", () => {
  const source = "Text [label][id].\n\n" + "Ordinary paragraph.\n\n".repeat(6000) + "> [id]:\n> /dest\n";
  resetDocumentCache();
  const start = source.indexOf("[id]");
  assert.ok(documentExcludedRanges(source).some((range) => range.start <= start && range.end >= start + 4));
});

test("reference labels keep their original Unicode, escapes, entities and line breaks across windows", () => {
  for (const label of ["İ".repeat(500), "İ".repeat(999), "a\\]b &amp; c", "first\nsecond"]) {
    const from = `[${label}]`;
    const source = `Text [label]${from}.\n\n` + "Ordinary paragraph.\n\n".repeat(6000) + `${from}: /dest\n`;
    resetDocumentCache();
    const ranges = documentExcludedRanges(source);
    const start = source.indexOf(from);
    assert.ok(ranges.some((range) => range.start <= start && range.end >= start + from.length));
    const chunk = chunkDocument(source, "markdown")[0];
    const localRanges = ranges.filter((range) => range.start < chunk.end).map((range) => ({ start: range.start, end: Math.min(range.end, chunk.end) }));
    const response = { title: "T", level1: [{ from, options: ["[other]"], note: "Correction" }], level2: [] };
    assert.equal(validateAndResolve(source.slice(0, chunk.end), response, "markdown", "T", true, localRanges).level1.length, 0);
    const suggestion = { id: "a", level: 1 as const, start, end: start + from.length, from, options: ["[other]"], note: "Correction", status: "active" as const };
    const review = createReview(source, { documentVersion: 1, format: "markdown" }, { title: "T", level1: [suggestion], level2: [], skipped: 0 });
    assert.deepEqual(prepareApply(review, { a: { option: 0 } }, source, 1).edits, []);
  }
});
