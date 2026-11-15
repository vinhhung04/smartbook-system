"""Shared primitives for architecture / deployment / flow figures (SmartBook profile)."""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from dd import C, SANS, MONO, t, r4, tw, html
from xml.sax.saxutils import escape

TREAT = {
    "backend": ("#ffffff", C["ink"], 1, ""),
    "input": ("rgba(71,85,105,0.10)", C["soft"], 1, ""),
    "store": ("rgba(31,56,100,0.05)", C["muted"], 1, ""),
    "external": ("rgba(31,56,100,0.03)", "rgba(31,56,100,0.40)", 1, ' stroke-dasharray="4,3"'),
    "focal": (C["accent_tint"], C["accent"], 1.2, ""),
    "note": (C["paper2"], C["rule_solid"], 1, ""),
}


class Fig:
    def __init__(self, slug, W=800):
        self.slug, self.W = slug, W
        self.Z, self.A, self.L, self.N, self.F = [], [], [], [], []
        self.used = set()
        self.warn = []

    def zone(self, x, y, w, h, title):
        self.Z.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="{C["paper2"]}" stroke="{C["rule"]}" stroke-width="1"/>')
        self.Z.append(t(x + 16, y + 22, title, 14, False, C["muted"], anchor="start", weight="700"))

    def box(self, x, y, w, h, name, subs=(), kind="backend", tag=None, name_mono=False):
        """subs: list of (text, mono)."""
        fill, stroke, sw, dash = TREAT[kind]
        self.used.add(kind)
        cx = x + w / 2
        out = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="{C["paper"]}"/>',
               f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{dash}/>']
        nl = len(subs)
        head = 20 if name else 0
        top = y + h / 2 - (head + 16 * nl) / 2
        if name:
            out.append(t(cx, top + 15, name, 14 if not name_mono else 13, name_mono, C["ink"], weight="700"))
            if tw(name, 14, name_mono, bold=True) + 16 > w:
                self.warn.append(f"name too wide: {name}")
        for i, (s, m) in enumerate(subs):
            out.append(t(cx, top + head + 16 * i + 13, s, 12, m, C["soft"] if (m and name) else C["ink"]))
            if tw(s, 12, m) + 12 > w:
                self.warn.append(f"sub too wide: {s}")
        self.N.append("\n".join(out))

    def note(self, x, y, w, lines):
        h = r4(16 + 18 * len(lines))
        out = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="4" fill="{C["paper2"]}" stroke="{C["rule_solid"]}" stroke-width="1"/>']
        for i, (s, m) in enumerate(lines):
            out.append(t(x + 12, y + 21 + 18 * i, s, 12, m, C["ink"], anchor="start"))
            if tw(s, 12, m) + 24 > w:
                self.warn.append(f"note too wide: {s}")
        self.N.append("\n".join(out))
        return h

    def arrow(self, d, kind="call", dashed=False):
        color = {"call": C["muted"], "link": C["link"], "accent": C["accent"]}[kind]
        marker = {"call": "arrow", "link": "arrow-link", "accent": "arrow-accent"}[kind]
        dash = ' stroke-dasharray="5,4"' if dashed else ""
        self.used.add(("edge", kind, dashed))
        self.A.append(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="1.2"{dash} marker-end="url(#{self.slug}-{marker})"/>')

    def label(self, x, y, lines, color=None, anchor="start", plate=None):
        """Plate whose top-left (anchor start) / top-center (middle) / top-right (end) is at (x, y)."""
        plate = plate or C["paper"]
        w = r4(max(tw(s, 12, m) for s, m in lines) + 12)
        h = 18 + 16 * (len(lines) - 1)
        x0 = x if anchor == "start" else (x - w / 2 if anchor == "middle" else x - w)
        out = [f'<rect x="{x0:g}" y="{y}" width="{w}" height="{h}" rx="2" fill="{plate}"/>']
        for i, (s, m) in enumerate(lines):
            out.append(t(x0 + w / 2, y + 13 + 16 * i, s, 12, m, color or C["muted"]))
        self.L.append("\n".join(out))

    def legend(self, y, items, rule=True):
        out = [f'<line x1="40" y1="{y - 20}" x2="{self.W - 40}" y2="{y - 20}" stroke="{C["rule"]}" stroke-width="1"/>'] if rule else []
        cur = 44
        for kind, text in items:
            if kind in TREAT:
                fill, stroke, sw, dash = TREAT[kind]
                out.append(f'<rect x="{cur}" y="{y - 6}" width="20" height="12" rx="2" fill="{fill}" stroke="{stroke}" stroke-width="1"{dash}/>')
            else:
                color = {"call": C["muted"], "link": C["link"], "accent": C["accent"], "dash": C["muted"]}[kind]
                dash = ' stroke-dasharray="5,4"' if kind == "dash" else ""
                out.append(f'<line x1="{cur}" y1="{y}" x2="{cur + 20}" y2="{y}" stroke="{color}" stroke-width="1.2"{dash}/>')
            out.append(t(cur + 28, y + 4, text, 12, False, C["muted"], anchor="start"))
            cur += 28 + r4(tw(text, 12)) + 16
        if cur > self.W - 40:
            self.warn.append("legend too wide")
        self.F.extend(out)

    def write(self, out_html, H, title, desc, h1, eyebrow, note_html=""):
        s = self.slug
        defs = f'''<defs>
  <marker id="{s}-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="{C['muted']}"/></marker>
  <marker id="{s}-arrow-accent" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="{C['accent']}"/></marker>
  <marker id="{s}-arrow-link" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="{C['link']}"/></marker>
</defs>'''
        body = "\n".join(["<!-- zones -->", *self.Z, "<!-- arrows -->", *self.A, "<!-- labels -->", *self.L, "<!-- nodes -->", *self.N, "<!-- legend -->", *self.F])
        svg = (f'<svg viewBox="0 0 {self.W} {H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="{s}-title {s}-desc">\n'
               f'<title id="{s}-title">{escape(title)}</title>\n<desc id="{s}-desc">{escape(desc)}</desc>\n{defs}\n'
               f'<rect width="100%" height="100%" fill="{C["paper"]}"/>\n{body}\n</svg>')
        pathlib.Path(out_html).parent.mkdir(parents=True, exist_ok=True)
        pathlib.Path(out_html).write_text(html(s, eyebrow, h1, svg, self.W, note_html), encoding="utf-8")
        for w in self.warn: print("WARN", s, w)
        print("wrote", out_html, "H=", H)
