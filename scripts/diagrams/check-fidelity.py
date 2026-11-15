#!/usr/bin/env python3
"""Content-fidelity check for Diagram Design redraws of a Mermaid source.

Extracts the source IR with the installed diagram-design skill's mermaid_extract.py
(--json), then checks that every node label, edge label and sequence message of the
source appears verbatim (whitespace-insensitive) in the text of the redrawn SVG/HTML
files. Anything reported missing must either be fixed or listed in the fidelity ledger.

Usage:
  python scripts/diagrams/check-fidelity.py <source.mmd> <redrawn.svg|html> [more files...]
Environment:
  DIAGRAM_DESIGN_SKILL_DIR  override the skill directory (default: newest installed
                            ~/.claude/plugins/cache/diagram-design/diagram-design/*/skills/diagram-design)
Exit code: 0 all items found, 1 some items missing, 2 usage/extractor error.
"""
import html
import json
import os
import pathlib
import re
import subprocess
import sys


def skill_dir() -> pathlib.Path:
    env = os.environ.get("DIAGRAM_DESIGN_SKILL_DIR")
    if env:
        return pathlib.Path(env)
    base = pathlib.Path.home() / ".claude/plugins/cache/diagram-design/diagram-design"
    versions = sorted(base.glob("*/skills/diagram-design"), key=lambda p: [int(x) if x.isdigit() else x for x in p.parent.parent.name.split(".")])
    if not versions:
        sys.exit("diagram-design skill not found; set DIAGRAM_DESIGN_SKILL_DIR")
    return versions[-1]


def drawn_text(files) -> str:
    out = []
    for f in files:
        x = pathlib.Path(f).read_text(encoding="utf-8")
        x = re.sub(r"<tspan[^>]*>|</tspan>", "", x)
        out += [html.unescape(m) for m in re.findall(r"<text[^>]*>(.*?)</text>", x, re.S)]
    return re.sub(r"\s+", "", "".join(out))


def norm(s: str) -> str:
    return re.sub(r"\s+", "", s.replace("⏎", " "))


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    src, files = sys.argv[1], sys.argv[2:]
    extractor = skill_dir() / "scripts" / "mermaid_extract.py"
    res = subprocess.run([sys.executable, "-I", str(extractor), src, "--json"], capture_output=True, text=True, encoding="utf-8")
    if res.returncode != 0:
        print(res.stderr or res.stdout)
        return 2
    ir = json.loads(res.stdout)
    d = ir["diagrams"][0] if "diagrams" in ir else ir
    items = [("node", n.get("label") or n.get("id")) for n in d.get("nodes", [])]
    for e in d.get("edges", []):
        label = e.get("label")
        if not label:
            continue
        # ER edges carry Mermaid crow's-foot notation before the label: "|| -- o{ · gồm".
        # Check the label text; cardinality is drawn as 1 / 0..* and is reviewed in the ledger.
        m = re.match(r"^([|o}{\-. ]+)·\s*(.*)$", label)
        items.append(("edge", m.group(2) if m else label))
    items += [("message", m.get("label") or m.get("text")) for m in d.get("messages", []) if (m.get("label") or m.get("text"))]
    drawn = drawn_text(files)
    missing = [(k, v) for k, v in items if v and norm(v) not in drawn]
    print(f"{src}: {len(items)} source items, {len(items) - len(missing)} verbatim, {len(missing)} missing")
    for k, v in missing:
        print(f"  MISSING {k}: {re.sub(r'\s+', ' ', v.replace('⏎', ' ')).strip()}")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
