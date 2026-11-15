"""Small SVG helpers that emit Diagram Design markup with the SmartBook profile tokens.

Geometry follows the skill: 4px grid, arrows before nodes, opaque label masks with a
6-10px gap, orthogonal connectors. Sizes follow the profile's "SmartBook thesis output" ramp.
"""
import math
from xml.sax.saxutils import escape

C = dict(
    paper="#ffffff", paper2="#f3f6fa", ink="#1f3864", muted="#475569", soft="#5b6b82",
    rule="rgba(31,56,100,0.14)", rule_solid="#c5cedb", accent="#b45309",
    accent_tint="rgba(180,83,9,0.08)", link="#2f5597",
)
SANS = "Arial, 'Helvetica Neue', Helvetica, sans-serif"
MONO = "Consolas, 'Courier New', ui-monospace, monospace"
SERIF = "'Times New Roman', Times, serif"

NAME = 14      # node-name
LABEL = 12     # arrow label / sublabel (thesis ramp)
TAG = 11       # Latin eyebrow / type tag


def r4(v):
    return int(math.ceil(v / 4.0) * 4)


_NARROW = set("ijlI.,:;'|!()[]{} ")
_WIDE = set("mwMW@%")


def tw(text, size, mono=False, bold=False):
    """Estimated advance width. Consolas is 0.55em fixed; Arial per character class."""
    if mono:
        return len(text) * size * 0.55
    import unicodedata
    w = 0.0
    for ch in text:
        base = unicodedata.normalize("NFD", ch)[0]
        if base in _NARROW:
            w += 0.28
        elif base in _WIDE:
            w += 0.86
        elif base.isupper():
            w += 0.70
        elif base.isdigit():
            w += 0.56
        else:
            w += 0.54
    return w * size * (1.08 if bold else 1.0)


def t(x, y, s, size=LABEL, mono=False, fill=None, anchor="middle", weight=None, extra=""):
    fam = MONO if mono else SANS
    w = f' font-weight="{weight}"' if weight else ""
    return (f'<text x="{x}" y="{y}" fill="{fill or C["ink"]}" font-size="{size}" '
            f'font-family="{fam}" text-anchor="{anchor}"{w}{extra}>{escape(s)}</text>')


def label_block(cx, line_y, lines, color, gap=8):
    """Arrow label above a horizontal line at line_y. lines: [(text, mono)]. Returns svg."""
    n = len(lines)
    h = 18 + 16 * (n - 1)
    width = r4(max(tw(s, LABEL, m) for s, m in lines) + 12)
    top = line_y - gap - h
    out = [f'<rect x="{cx - width / 2:g}" y="{top}" width="{width}" height="{h}" rx="2" fill="{C["paper"]}"/>']
    for i, (s, m) in enumerate(lines):
        out.append(t(cx, top + 13 + 16 * i, s, LABEL, m, color))
    return "\n".join(out)


class Seq:
    def __init__(self, slug, width, height):
        self.slug, self.W, self.H = slug, width, height
        self.x = {}
        self.layers = {"frames": [], "lifelines": [], "bars": [], "arrows": [], "labels": [], "notes": [], "nodes": []}

    def actor(self, key, cx, name, sub, kind="backend", top=40, w=112, h=64):
        self.x[key] = cx
        x0 = cx - w / 2
        fill, stroke = {"backend": ("#ffffff", C["ink"]), "input": ("rgba(71,85,105,0.10)", C["soft"]),
                        "store": ("rgba(31,56,100,0.05)", C["muted"]), "external": ("rgba(31,56,100,0.03)", "rgba(31,56,100,0.30)")}[kind]
        self.layers["nodes"].append("\n".join([
            f'<rect x="{x0:g}" y="{top}" width="{w}" height="{h}" rx="6" fill="{C["paper"]}"/>',
            f'<rect x="{x0:g}" y="{top}" width="{w}" height="{h}" rx="6" fill="{fill}" stroke="{stroke}" stroke-width="1"/>',
            t(cx, top + 28, name, NAME, False, C["ink"], weight="700"),
            t(cx, top + 48, sub, TAG, True, C["soft"]),
        ]))
        self.top_y = top + h

    def lifelines(self, bottom):
        for cx in self.x.values():
            self.layers["lifelines"].append(
                f'<line x1="{cx}" y1="{self.top_y}" x2="{cx}" y2="{bottom}" stroke="rgba(31,56,100,0.25)" stroke-width="1" stroke-dasharray="3,3"/>')

    def bar(self, key, y0, y1):
        cx = self.x[key]
        self.layers["bars"].append(
            f'<rect x="{cx - 4}" y="{y0}" width="8" height="{y1 - y0}" fill="rgba(31,56,100,0.06)" stroke="{C["muted"]}" stroke-width="0.8"/>')

    def msg(self, a, b, y, lines, kind="call", label_x=None):
        xa, xb = self.x[a], self.x[b]
        d = 1 if xb > xa else -1
        x1, x2 = xa + 4 * d, xb - 4 * d
        color, marker, dash, sw = {
            "call": (C["muted"], "arrow", "", 1.2),
            "link": (C["link"], "arrow-link", "", 1.2),
            "return": (C["muted"], "arrow", ' stroke-dasharray="5,4"', 1.2),
            "accent": (C["accent"], "arrow-accent", "", 1.4),
        }[kind]
        self.layers["arrows"].append(
            f'<line x1="{x1}" y1="{y}" x2="{x2}" y2="{y}" stroke="{color}" stroke-width="{sw}"{dash} marker-end="url(#{self.slug}-{marker})"/>')
        cx = label_x if label_x is not None else (xa + xb) / 2
        lc = C["ink"] if kind in ("call", "return") else color
        self.layers["labels"].append(label_block(cx, y, lines, lc))

    def self_loop(self, key, y, lines, dy=24, out=32):
        cx = self.x[key] + 4
        self.layers["arrows"].append(
            f'<path d="M {cx} {y} H {cx + out - 8} Q {cx + out} {y} {cx + out} {y + 8} V {y + dy - 8} Q {cx + out} {y + dy} {cx + out - 8} {y + dy} H {cx + 2}" '
            f'fill="none" stroke="{C["muted"]}" stroke-width="1.2" marker-end="url(#{self.slug}-arrow)"/>')
        width = r4(max(tw(s, LABEL, m) for s, m in lines) + 12)
        lx = cx + out + 8
        h = 18 + 16 * (len(lines) - 1)
        top = y + dy / 2 - h / 2
        out_s = [f'<rect x="{lx}" y="{top:g}" width="{width}" height="{h}" rx="2" fill="{C["paper"]}"/>']
        for i, (s, m) in enumerate(lines):
            out_s.append(t(lx + 6, top + 13 + 16 * i, s, LABEL, m, C["ink"], anchor="start"))
        self.layers["labels"].append("\n".join(out_s))

    def note(self, cx, y, lines, w):
        h = 12 + 16 * len(lines)
        x0 = cx - w / 2
        out = [f'<rect x="{x0:g}" y="{y}" width="{w}" height="{h}" rx="4" fill="{C["paper2"]}" stroke="{C["rule_solid"]}" stroke-width="1"/>']
        for i, (s, m) in enumerate(lines):
            out.append(t(x0 + 10, y + 19 + 16 * i, s, LABEL, m, C["ink"], anchor="start"))
        self.layers["notes"].append("\n".join(out))
        return y + h

    def frame(self, x, y, w, h, op, guards, dividers=()):
        out = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="4" fill="rgba(31,56,100,0.02)" stroke="rgba(31,56,100,0.30)" stroke-width="1"/>',
               f'<rect x="{x}" y="{y}" width="44" height="20" rx="2" fill="{C["paper"]}" stroke="rgba(31,56,100,0.30)" stroke-width="1"/>',
               t(x + 22, y + 14, op.upper(), TAG, True, C["muted"], weight="700", extra=' letter-spacing="0.12em"')]
        for dy in dividers:
            out.append(f'<line x1="{x + 8}" y1="{dy}" x2="{x + w - 8}" y2="{dy}" stroke="rgba(31,56,100,0.30)" stroke-width="1" stroke-dasharray="4,3"/>')
        self.layers["frames"].append("\n".join(out))
        # Guards paint after lifelines (labels layer) so no lifeline strikes through them.
        g = []
        for gy, gtext in guards:
            g.append(f'<rect x="{x + 52}" y="{gy - 14}" width="{r4(tw(gtext, LABEL) * 0.94 + 12)}" height="18" rx="2" fill="{C["paper"]}"/>')
            g.append(t(x + 58, gy, gtext, LABEL, False, C["muted"], anchor="start", extra=' font-style="italic"'))
        self.layers["labels"].append("\n".join(g))

    def svg(self, title, desc, legend=None):
        s = self.slug
        defs = f'''<defs>
  <marker id="{s}-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="{C['muted']}"/></marker>
  <marker id="{s}-arrow-accent" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="{C['accent']}"/></marker>
  <marker id="{s}-arrow-link" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="{C['link']}"/></marker>
</defs>'''
        body = []
        for k in ("frames", "lifelines", "bars", "arrows", "labels", "notes", "nodes"):
            if self.layers[k]:
                body.append(f"<!-- {k} -->\n" + "\n".join(self.layers[k]))
        if legend:
            body.append("<!-- legend -->\n" + legend)
        return (f'<svg viewBox="0 0 {self.W} {self.H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="{s}-title {s}-desc">\n'
                f'<title id="{s}-title">{escape(title)}</title>\n<desc id="{s}-desc">{escape(desc)}</desc>\n{defs}\n'
                f'<rect width="100%" height="100%" fill="{C["paper"]}"/>\n' + "\n".join(body) + "\n</svg>")


def legend_strip(y, items, x=40):
    """items: [(kind, text)] kind in link/call/return/accent. Horizontal strip at the bottom."""
    out = [f'<line x1="40" y1="{y - 16}" x2="760" y2="{y - 16}" stroke="{C["rule"]}" stroke-width="1"/>']
    cur = x
    for kind, text in items:
        color, dash = {"link": (C["link"], ""), "call": (C["muted"], ""), "return": (C["muted"], ' stroke-dasharray="5,4"'),
                       "accent": (C["accent"], ""), "note": (None, "")}[kind]
        if kind == "note":
            out.append(f'<rect x="{cur}" y="{y - 6}" width="20" height="12" rx="2" fill="{C["paper2"]}" stroke="{C["rule_solid"]}" stroke-width="1"/>')
        else:
            out.append(f'<line x1="{cur}" y1="{y}" x2="{cur + 20}" y2="{y}" stroke="{color}" stroke-width="1.2"{dash}/>')
        out.append(t(cur + 28, y + 4, text, LABEL, False, C["muted"], anchor="start"))
        cur += 28 + r4(tw(text, LABEL)) + 24
    return "\n".join(out)


def html(slug, eyebrow, h1, svg, width, note_html=""):
    return f'''<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{escape(h1)}</title>
  <!-- Diagram Design · profile: smartbook (Font source: system — không tải Google Fonts) -->
  <style>
    *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
    :root {{
      --color-paper:  {C['paper']};
      --color-ink:    {C['ink']};
      --color-muted:  {C['muted']};
      --color-accent: {C['accent']};
      --font-sans:    {SANS};
      --font-serif:   {SERIF};
      --font-mono:    {MONO};
    }}
    body {{
      font-family: var(--font-sans);
      background: var(--color-paper);
      color: var(--color-ink);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 3rem 2rem;
    }}
    .frame {{ max-width: 1200px; width: 100%; }}
    .diagram-container {{ width: 100%; overflow-x: auto; }}
    .eyebrow {{
      font-family: var(--font-mono);
      font-size: 0.72rem;
      font-weight: 500;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--color-muted);
      margin-bottom: 0.5rem;
    }}
    h1 {{
      font-family: var(--font-serif);
      font-size: clamp(1.5rem, 2.4vw + 0.75rem, 2rem);
      font-weight: 400;
      line-height: 1.25;
      color: var(--color-ink);
      margin-bottom: 1.5rem;
    }}
    .note {{ font-size: 0.85rem; color: var(--color-muted); margin-top: 1rem; max-width: {width}px; line-height: 1.5; }}
    svg {{ width: 100%; min-width: {width}px; max-width: {width}px; display: block; }}
    @media print {{
      .diagram-container {{ overflow-x: visible; }}
      svg {{ min-width: 0; }}
    }}
  </style>
</head>
<body>
  <div class="frame">
    <p class="eyebrow">{escape(eyebrow)}</p>
    <h1>{escape(h1)}</h1>
    <div class="diagram-container">
{svg}
    </div>
    {note_html}
  </div>
</body>
</html>
'''
