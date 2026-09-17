#!/usr/bin/env python3
"""
sharp-pen builder.

Takes the untouched source text plus a changes JSON and emits ONE self-contained
HTML file: no network, no CDN, no build step.

    python3 scripts/build.py --source draft.md --changes changes.json --out review.html

Exit code 1 means the change set did not validate. The error lists exactly which
entries failed and why; fix changes.json and run again. Never edit the source
text to make a change "fit" — the left pane must stay byte-identical to what the
user handed over.
"""

import argparse
import json
import re
import sys
from pathlib import Path

TOKEN = "\u27e6{}\u27e7"          # ⟦c1⟧ — outside markdown syntax, survives rendering
SENTINEL = re.compile(r"[\u27e6\u27e7]")


class ValidationError(Exception):
    pass


def locate(source, entry, kind, index):
    """Resolve one entry to a (start, end) span in source. Raises on ambiguity."""
    label = "{}[{}]".format(kind, index)
    frm = entry.get("from")
    if not isinstance(frm, str) or frm == "":
        raise ValidationError("{}: 'from' must be a non-empty string".format(label))

    hits = [m.start() for m in re.finditer(re.escape(frm), source)]
    if not hits:
        raise ValidationError(
            "{}: 'from' text not found in source: {!r}\n"
            "         Copy it verbatim from the source, including punctuation, "
            "apostrophes and spacing.".format(label, frm[:90])
        )

    occ = entry.get("occurrence")
    if len(hits) > 1:
        if occ is None:
            raise ValidationError(
                "{}: 'from' occurs {} times in the source: {!r}\n"
                "         Add \"occurrence\": <1-based index> to say which one, "
                "or widen 'from' with surrounding words until it is unique."
                .format(label, len(hits), frm[:60])
            )
        if not (1 <= occ <= len(hits)):
            raise ValidationError(
                "{}: occurrence {} is out of range (found {} matches)."
                .format(label, occ, len(hits))
            )
        start = hits[occ - 1]
    else:
        if occ not in (None, 1):
            raise ValidationError(
                "{}: occurrence {} given but 'from' appears exactly once."
                .format(label, occ)
            )
        start = hits[0]

    return start, start + len(frm)


def check_options(entry, kind, index):
    label = "{}[{}]".format(kind, index)
    opts = entry.get("options")
    if not isinstance(opts, list) or not opts:
        raise ValidationError("{}: 'options' must be a non-empty list".format(label))
    for o in opts:
        if not isinstance(o, str) or o == "":
            raise ValidationError("{}: every option must be a non-empty string".format(label))
    if opts[0] == entry["from"]:
        raise ValidationError(
            "{}: the first option is identical to the original text. "
            "Options are replacements, not repeats.".format(label)
        )
    if not entry.get("note"):
        raise ValidationError(
            "{}: 'note' is required — one short line saying what is wrong.".format(label)
        )


def overlaps(spans):
    ordered = sorted(spans, key=lambda s: s[0])
    for a, b in zip(ordered, ordered[1:]):
        if a[1] > b[0]:
            return a, b
    return None


def build(source, changes, title):
    if SENTINEL.search(source):
        raise ValidationError(
            "The source text contains the private tokens U+27E6 / U+27E7. "
            "Remove them from the source before building."
        )

    l1 = changes.get("level1", [])
    l2 = changes.get("level2", [])
    if not l1 and not l2:
        raise ValidationError("No changes given: both level1 and level2 are empty.")

    l1_spans, l2_spans = [], []

    for i, e in enumerate(l1):
        check_options(e, "level1", i)
        s, t = locate(source, e, "level1", i)
        l1_spans.append((s, t, "c{}".format(i + 1), e))

    for i, e in enumerate(l2):
        check_options(e, "level2", i)
        s, t = locate(source, e, "level2", i)
        l2_spans.append((s, t, "s{}".format(i + 1), e))

    clash = overlaps([(s, t) for s, t, _, _ in l1_spans])
    if clash:
        raise ValidationError(
            "Two level-1 changes overlap in the source at {} and {}. "
            "Level-1 spans must be disjoint.".format(clash[0], clash[1])
        )

    clash = overlaps([(s, t) for s, t, _, _ in l2_spans])
    if clash:
        raise ValidationError(
            "Two level-2 changes overlap in the source at {} and {}. "
            "One sentence gets at most one level-2 entry.".format(clash[0], clash[1])
        )

    # a level-2 span must contain any level-1 span it touches, wholly
    for ls, lt, lid, le in l2_spans:
        for cs, ct, cid, ce in l1_spans:
            straddles = (cs < ls < ct) or (cs < lt < ct)
            if straddles:
                raise ValidationError(
                    "level2 {!r} cuts through level1 {!r}. A level-2 span must "
                    "cover whole level-1 spans or avoid them entirely — extend it "
                    "to a full sentence.".format(le["from"][:50], ce["from"][:30])
                )

    # tokenise level 1 into the raw string, right to left so offsets hold
    raw = source
    for s, t, cid, _ in sorted(l1_spans, key=lambda x: -x[0]):
        raw = raw[:s] + TOKEN.format(cid) + raw[t:]

    # map level-2 spans onto the tokenised string
    def shift(pos):
        delta = 0
        for s, t, cid, _ in l1_spans:
            if t <= pos:
                delta += len(TOKEN.format(cid)) - (t - s)
        return pos + delta

    level1 = {}
    for _, _, cid, e in l1_spans:
        level1[cid] = {"from": e["from"], "opts": e["options"], "note": e["note"]}

    level2 = {}
    for s, t, sid, e in l2_spans:
        anchor = raw[shift(s):shift(t)]
        restored = re.sub(
            r"\u27e6(c\d+)\u27e7",
            lambda m: level1[m.group(1)]["from"],
            anchor,
        )
        if restored != e["from"]:
            raise ValidationError(
                "level2 {!r}: internal mapping check failed — the span does not "
                "line up with the source after tokenising.".format(e["from"][:50])
            )
        if raw.count(anchor) != 1:
            raise ValidationError(
                "level2 {!r}: its anchor is not unique in the tokenised source. "
                "Widen 'from' with surrounding words.".format(e["from"][:50])
            )
        level2[sid] = {"raw": anchor, "opts": e["options"], "note": e["note"]}

    return {
        "title": title,
        "source": raw,
        "level1": level1,
        "level2": level2,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True, help="the user's text, untouched")
    ap.add_argument("--changes", required=True, help="changes JSON")
    ap.add_argument("--out", required=True, help="output HTML path")
    ap.add_argument("--title", default=None, help="label shown in the page title")
    ap.add_argument("--template", default=None)
    args = ap.parse_args()

    source = Path(args.source).read_text(encoding="utf-8")
    changes = json.loads(Path(args.changes).read_text(encoding="utf-8"))
    title = args.title or changes.get("title") or Path(args.source).stem

    template_path = Path(args.template) if args.template else \
        Path(__file__).resolve().parent.parent / "assets" / "template.html"
    template = template_path.read_text(encoding="utf-8")
    if "__SHARP_PEN_DATA__" not in template:
        print("error: template is missing the __SHARP_PEN_DATA__ placeholder", file=sys.stderr)
        return 1

    try:
        data = build(source, changes, title)
    except ValidationError as exc:
        print("sharp-pen: change set did not validate\n", file=sys.stderr)
        print("  " + str(exc), file=sys.stderr)
        return 1

    payload = json.dumps(data, ensure_ascii=False)
    payload = payload.replace("</", "<\\/")  # never break out of the script tag
    html = template.replace("__SHARP_PEN_DATA__", payload)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")

    print("sharp-pen: wrote {} ({:.0f} kB)".format(out, out.stat().st_size / 1024))
    print("           level 1: {} changes   level 2: {} changes"
          .format(len(data["level1"]), len(data["level2"])))
    return 0


if __name__ == "__main__":
    sys.exit(main())
