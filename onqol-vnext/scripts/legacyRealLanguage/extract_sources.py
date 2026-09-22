#!/usr/bin/env python3
"""
Extract ordered paragraphs from the legacy ON QOL session sources.

  python3 scripts/legacyRealLanguage/extract_sources.py <source-dir> <out.json>

The sources carry no role markers in the .md files, so the role of a paragraph is
decided here, once, and written out with the evidence for the decision:

  .docx  a paragraph whose every non-empty run is white (FFFFFF) is LEARNER text.
         That is how the ON QOL export styles the learner bubble on a dark ground;
         every system paragraph is dark. This is a property of the file, not a guess.
  .md    the export lost all styling, so the learner lines are a curated list of
         1-based file line numbers (MD_LEARNER_LINES). Each was checked by hand
         against the alternation "system question -> learner answer -> system
         feedback". The list is data, reviewed in the annotation file.

Output paragraphs are verbatim (no trimming beyond the line itself). Nothing here
interprets the text; the output carries raw learner words and is written under
private/ only.
"""
import json, os, re, sys
import docx
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph

SOURCES = [
    # (file, kind)
    ("ON QOL V1-2.docx", "docx"), ("ON QOL v1-3.docx", "docx"), ("ON QOL v1-4.docx", "docx"), ("V1 сессия .docx", "docx"),
    ("P01.md", "md"), ("P02.md", "md"), ("P03.md", "md"), ("P04.md", "md"), ("P05.md", "md"), ("P06.md", "md"), ("P07.md", "md"),
]
MD_LEARNER_LINES = {
    "P01.md": [27, 51, 107, 129],
    "P02.md": [23, 69, 89, 121, 153, 173, 227],
    "P03.md": [15, 39, 77, 97, 137],
    "P04.md": [9, 15, 21, 31, 39, 53, 63, 71, 79, 85],
    "P05.md": [9, 55, 71, 101, 121, 143],
    "P06.md": [11, 45, 53, 77, 87, 107, 113, 125, 145],
    "P07.md": [15, 69, 93, 129, 195, 311],
}
WHITE = "FFFFFF"

def docx_paragraphs(path):
    d = docx.Document(path)
    out = []
    for ch in d.element.body.iterchildren():
        if ch.tag == qn("w:tbl"):
            raise SystemExit(f"unexpected table in {path}: sources are expected to be paragraphs only")
        if ch.tag != qn("w:p"):
            continue
        p = Paragraph(ch, d)
        runs = [r for r in p.runs if r.text.strip()]
        colors = sorted({(str(r.font.color.rgb) if r.font.color is not None and r.font.color.type is not None else "NONE") for r in runs})
        learner = bool(runs) and all(c == WHITE for c in colors)
        out.append({"text": p.text, "role": "learner" if learner else "system", "roleEvidence": {"runColors": colors}})
    return out

def md_paragraphs(path, learner_lines):
    lines = open(path, encoding="utf-8").read().split("\n")
    out = []
    for i, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        role = "learner" if i in learner_lines else "system"
        out.append({"text": line, "role": role, "roleEvidence": {"line": i, "curated": role == "learner"}})
    missing = [n for n in learner_lines if not lines[n - 1].strip()]
    if missing:
        raise SystemExit(f"{path}: curated learner lines are blank: {missing}")
    return out

def main(src_dir, out_file):
    result = []
    for name, kind in SOURCES:
        path = os.path.join(src_dir, name)
        paras = docx_paragraphs(path) if kind == "docx" else md_paragraphs(path, set(MD_LEARNER_LINES[name]))
        result.append({"file": name, "kind": kind, "paragraphs": paras})
    with open(out_file, "w", encoding="utf-8") as fh:
        json.dump({"schema": "onqol-legacy-real-language-extracted-v1", "sources": result}, fh, ensure_ascii=False, indent=1)
    for s in result:
        print(s["file"], s["kind"], "paragraphs", len(s["paragraphs"]), "learner", sum(1 for p in s["paragraphs"] if p["role"] == "learner"))

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
