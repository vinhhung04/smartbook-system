"""Render docs/research/cover-search/RESEARCH_PAPER.md into a Word file that
reuses the layout of the group's NCKH template (NHD82_NCKH_demo16.docx):
A4, margins and header of the template, one-column title block followed by a
two-column body, Times New Roman, 9-pt abstract, centred roman section
headings, italic sub-headings, "Bảng I –" table captions above tables,
"Hình n." captions below figures, IEEE-style numbered references.

    python build_paper_docx.py <template.docx> <paper.md> <out.docx>

Markdown subset understood (written that way on purpose):
  # Title                     -> title
  @authors / @affil / @email  -> author block lines
  **Tóm tắt –** text          -> abstract paragraph
  **Thuật ngữ –** text        -> keywords paragraph
  ## I. Heading               -> section heading
  ### A. Heading              -> sub-heading
  Bảng I – Caption            -> table caption (line directly before a pipe table)
  | a | b |                   -> table (header row bold)
  ![Hình 1. Caption](path)    -> figure (column width) + caption
  [1] Reference text          -> reference paragraph
  $$ formula $$               -> centred formula line
  anything else               -> body paragraph (**bold** / *italic* inline)
"""
from __future__ import annotations

import copy
import re
import sys
from pathlib import Path

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, Twips

COLUMN_WIDTH_IN = 4870 / 1440  # template column width (dxa) in inches
PAGE_TEXT_WIDTH_IN = (11906 - 2 * 936) / 1440  # A4 width minus template margins


def section_props(template_sect, cols):
    """Continuous section break copied from the template's final sectPr;
    cols=None keeps its 2 columns, cols=1 makes a single-column section."""
    sect = copy.deepcopy(template_sect)
    for old in sect.findall(qn("w:type")):
        sect.remove(old)
    type_el = sect.makeelement(qn("w:type"), {qn("w:val"): "continuous"})
    sect.insert(0, type_el)
    if cols == 1:
        for c in sect.findall(qn("w:cols")):
            c.attrib.clear()
            c.set(qn("w:space"), "720")
    return sect


def add_runs(paragraph, text: str, size: float | None = None, italic: bool = False, bold: bool = False) -> None:
    for part in re.split(r"(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)", text):
        if not part:
            continue
        run_bold, run_italic, value = bold, italic, part
        if part.startswith("**") and part.endswith("**"):
            run_bold, value = True, part[2:-2]
        elif part.startswith("*") and part.endswith("*"):
            run_italic, value = (not italic), part[1:-1]
        elif part.startswith("`") and part.endswith("`"):
            value = part[1:-1]
        run = paragraph.add_run(value)
        run.bold = run_bold or None
        run.italic = run_italic or None
        if size:
            run.font.size = Pt(size)


def para(doc, text="", *, align=None, before=None, after=None, first_line=None, size=None, italic=False, bold=False,
         keep_next=False, line=None):
    p = doc.add_paragraph()
    fmt = p.paragraph_format
    if align is not None:
        p.alignment = align
    if before is not None:
        fmt.space_before = Twips(before)
    if after is not None:
        fmt.space_after = Twips(after)
    if first_line is not None:
        fmt.first_line_indent = Twips(first_line)
    if keep_next:
        fmt.keep_with_next = True
    if line is not None:
        fmt.line_spacing = line
    add_runs(p, text, size=size, italic=italic, bold=bold)
    return p


def set_table_borders(table) -> None:
    tbl_pr = table._tbl.tblPr
    borders = tbl_pr.find(qn("w:tblBorders"))
    if borders is None:
        borders = tbl_pr.makeelement(qn("w:tblBorders"), {})
        tbl_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        el = borders.makeelement(qn(f"w:{edge}"), {qn("w:val"): "single", qn("w:sz"): "4", qn("w:space"): "0", qn("w:color"): "auto"})
        borders.append(el)


TABLE_WIDTH_DXA = 4870  # template table width (one column)


def column_widths(rows: list[list[str]], total: int) -> list[int]:
    """Width per column proportional to its longest cell (header words count
    once each line can wrap), clamped so no column is starved."""
    weights = []
    for j in range(len(rows[0])):
        body = max((len(r[j].strip().replace("*", "")) for r in rows[1:]), default=1)
        header = rows[0][j].strip().replace("*", "")
        # short headers (≤ 10 chars, e.g. "CLIP-only") must fit on one line
        head = len(header) if len(header) <= 10 else max((len(w) for w in header.split()), default=1)
        weights.append(min(max(body, head + 1, 5), 26))
    scale = total / sum(weights)
    widths = [int(w * scale) for w in weights]
    widths[-1] += total - sum(widths)
    return widths


def add_table(doc, rows: list[list[str]]) -> None:
    table = doc.add_table(rows=len(rows), cols=len(rows[0]))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    set_table_borders(table)
    tbl_pr = table._tbl.tblPr
    layout = tbl_pr.makeelement(qn("w:tblLayout"), {qn("w:type"): "fixed"})
    tbl_pr.append(layout)
    tbl_w = tbl_pr.find(qn("w:tblW"))
    if tbl_w is None:
        tbl_w = tbl_pr.makeelement(qn("w:tblW"), {})
        tbl_pr.append(tbl_w)
    tbl_w.set(qn("w:w"), str(TABLE_WIDTH_DXA)); tbl_w.set(qn("w:type"), "dxa")
    margins = tbl_pr.makeelement(qn("w:tblCellMar"), {})
    for side in ("left", "right"):
        margins.append(margins.makeelement(qn(f"w:{side}"), {qn("w:w"): "50", qn("w:type"): "dxa"}))
    tbl_pr.append(margins)
    widths = column_widths(rows, TABLE_WIDTH_DXA)
    grid = table._tbl.tblGrid
    for col, w in zip(grid.findall(qn("w:gridCol")), widths):
        col.set(qn("w:w"), str(w))
    for i, row in enumerate(rows):
        tr_pr = table.rows[i]._tr.get_or_add_trPr()
        tr_pr.append(tr_pr.makeelement(qn("w:cantSplit"), {}))
        if i == 0:  # repeat-header semantics are not needed; keep the header with the body
            pass
        for j, cell_text in enumerate(row):
            cell = table.cell(i, j)
            cell.width = Twips(widths[j])
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Twips(0)
            # keep every row with the next one so a table never breaks across a column/page
            p.paragraph_format.keep_with_next = i < len(rows) - 1
            text = cell_text.strip()
            short = len(text.replace("*", "")) <= 16
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER if (i == 0 or (j > 0 and short)) else WD_ALIGN_PARAGRAPH.LEFT
            add_runs(p, text, size=7.5, bold=(i == 0))
    para(doc, "", after=40)


def main() -> None:
    template, source, out = map(Path, sys.argv[1:4])
    volume = sys.argv[4] if len(sys.argv) > 4 else None  # e.g. "II": rewrites "VOLUME I," in the template header
    doc = Document(str(template))
    if volume:
        for part in doc.part.package.iter_parts():
            if str(part.partname).startswith("/word/header"):
                for t in part._element.iter(qn("w:t")):
                    if t.text and re.search(r"VOLUME [IVX]+,", t.text):
                        t.text = re.sub(r"VOLUME [IVX]+,", f"VOLUME {volume},", t.text)
    body = doc.element.body
    # keep the title-block section break (single column) and the final 2-column sectPr
    title_sect = None
    for p in body.iter(qn("w:p")):
        s = p.find(qn("w:pPr") + "/" + qn("w:sectPr"))
        if s is not None:
            title_sect = copy.deepcopy(s)
            break
    final_sect = copy.deepcopy(body.find(qn("w:sectPr")))
    for child in list(body):
        body.remove(child)
    body.append(final_sect)

    lines = source.read_text(encoding="utf-8").splitlines()
    i = 0
    header_done = False
    pending_caption = None
    while i < len(lines):
        line = lines[i].rstrip()
        if not line.strip():
            i += 1
            continue
        if line.startswith("# "):
            para(doc, line[2:], align=WD_ALIGN_PARAGRAPH.CENTER, before=60, after=100, size=22, bold=True)
        elif line.startswith("@authors "):
            para(doc, line[9:], align=WD_ALIGN_PARAGRAPH.CENTER, size=11)
        elif line.startswith("@affil "):
            para(doc, line[7:], align=WD_ALIGN_PARAGRAPH.CENTER, italic=True)
        elif line.startswith("@email "):
            p = para(doc, line[7:], align=WD_ALIGN_PARAGRAPH.CENTER, after=200)
            if title_sect is not None and not header_done:
                p._p.get_or_add_pPr().append(title_sect)
                header_done = True
        elif line.startswith("**Tóm tắt –**") or line.startswith("**Thuật ngữ –**"):
            is_kw = line.startswith("**Thuật ngữ")
            para(doc, line, align=WD_ALIGN_PARAGRAPH.JUSTIFY, after=60 if is_kw else 20, first_line=200, size=9,
                 italic=is_kw)
        elif line.startswith("## "):
            para(doc, line[3:], align=WD_ALIGN_PARAGRAPH.CENTER, before=140, after=60, bold=True, keep_next=True)
        elif line.startswith("### "):
            para(doc, line[4:], before=80, after=20, italic=True, keep_next=True)
        elif re.match(r"^Bảng [IVXL]+ –", line):
            pending_caption = line
            para(doc, line, align=WD_ALIGN_PARAGRAPH.CENTER, before=80, after=20, size=8, keep_next=True)
        elif line.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].startswith("|"):
                cells = [c for c in lines[i].strip().strip("|").split("|")]
                if not all(re.fullmatch(r"\s*:?-+:?\s*", c) for c in cells):
                    rows.append(cells)
                i += 1
            add_table(doc, rows)
            pending_caption = None
            continue
        elif line.startswith("!["):
            m = re.match(r"!\[(.*)\]\((.*)\)", line)
            caption, path = m.group(1), m.group(2)
            wide = caption.startswith("[wide]")
            caption = caption.removeprefix("[wide]")
            custom = re.match(r"^\[w=([\d.]+)\]", caption)
            if custom:
                caption = caption[custom.end():]
            if wide:  # close the 2-column section; the figure sits in a 1-column continuous section
                end_two = para(doc, "", after=0)
                end_two._p.get_or_add_pPr().append(section_props(final_sect, cols=None))
            pic = para(doc, "", align=WD_ALIGN_PARAGRAPH.CENTER, after=20)
            width = (PAGE_TEXT_WIDTH_IN - 0.1) if wide else (float(custom.group(1)) if custom else COLUMN_WIDTH_IN)
            pic.paragraph_format.keep_with_next = True  # figure stays with its caption
            pic.add_run().add_picture(str((source.parent / path).resolve()), width=Inches(width))
            if wide:
                cap = para(doc, caption, align=WD_ALIGN_PARAGRAPH.CENTER, after=80, size=7, italic=True)
                cap._p.get_or_add_pPr().append(section_props(final_sect, cols=1))
                i += 1
                continue
            para(doc, caption, align=WD_ALIGN_PARAGRAPH.JUSTIFY, after=80, size=7, italic=True)
        elif re.match(r"^\[\d+\] ", line):
            para(doc, line, align=WD_ALIGN_PARAGRAPH.JUSTIFY, size=8)
        elif line.startswith("$$"):
            para(doc, line.strip("$ "), align=WD_ALIGN_PARAGRAPH.CENTER, before=20, after=20, italic=True)
        else:
            para(doc, line, align=WD_ALIGN_PARAGRAPH.JUSTIFY, first_line=200, line=1.15)
        i += 1
    out.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(out))
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
