# Markdown Preview Rendering Fixture

> **Fixture only:** use this document to visually validate Markdown rendering. Do not analyze, edit, or apply its contents as source material.

This is a normal paragraph with Mixed Case text, punctuation, and a backslash after this sentence for a hard break.\
This line follows the hard break.
This line follows a soft
line break in the source.

## Heading Level Two — Mixed Case

### Heading Level Three — Mixed Case

#### Heading Level Four — Mixed Case

##### Heading Level Five — Mixed Case

###### Heading Level Six — Mixed Case

---

## Inline Formatting

*italic text*, **strong text**, ***bold italic text***, and ~~struck through~~ text.

Use inline code such as `const MixedCase = true;` beside ordinary words.

[Inline link](./local-placeholder.md "Local placeholder") and <mailto:fixture@example.invalid>.

<https://example.invalid/markdown-preview>

This sentence uses a [reference link][fixture-reference] and a [shortcut reference].

## Lists

- Dash item
  - Nested dash item
    - Deeply nested dash item
* Asterisk item
  * Nested asterisk item
+ Plus item
  + Nested plus item

3. Ordered list starts at three
4. Its next item
   1. Nested ordered item
   2. Another nested item
5. Final outer item

- [x] Completed task
- [ ] Incomplete task
  - [x] Nested completed task

## Blockquotes

> A quoted paragraph with **emphasis**.
>
> > A nested quote.
> >
> > - A list inside a nested quote
> > - Another item

---

## Code Blocks

```typescript
const greeting: string = "Hello, Mixed Case!";
console.log(greeting);
```

```
Plain fenced code: `not inline` and **not bold**.
```

~~~text
Tilde-fenced code block.
~~~

    Indented code block.
    It preserves spacing and `characters`.

## Table Alignment

| Left | Center | Right |
| :--- | :----: | ----: |
| alpha | beta | 1 |
| Mixed Case | 😀 | 42 |

## Literal Markdown Characters

\*not italic\*, \*\*not strong\*\*, \[not a link\], \#not a heading, and \`not code\`.

Backslash: \\; angle brackets: \<tag\>; pipe: \|; plus: \+; minus: \-.

## Image and Raw HTML

![Safe placeholder image](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw== "1×1 fixture placeholder")

`<mark>Raw HTML shown safely as inline code</mark>`

<mark>Raw inline HTML shown safely as text</mark>

<div class="example">Raw block HTML shown safely as text</div>

<script>Harmless script-looking text</script>

```html
<div class="example">Raw HTML shown safely as code</div>
```

## Unicode, Emoji, and Repeated Anchors

Café, naïve, 日本語, العربية, Ελληνικά, and mathematical symbols: ≤ ≥ ≠ →.

Emoji: 😀 🚀 ✨ ❤️.

### Repeated Anchor Text

First occurrence of this heading text.

### Repeated Anchor Text

Second occurrence of this heading text should receive a distinct generated anchor.

## Thematic Edge Cases

Three hyphens below form a thematic break:

---

Three asterisks below form another thematic break:

***

Three underscores below form the final thematic break:

___

[fixture-reference]: ./reference-target.md "Reference destination"
[shortcut reference]: ./shortcut-target.md
