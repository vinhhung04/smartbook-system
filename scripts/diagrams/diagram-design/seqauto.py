"""Auto-layout sequence diagrams in the Diagram Design grammar with the SmartBook profile.

Events (in order):
  ("msg", a, b, text, kind)          kind: call | link | return | accent | async
  ("self", a, text)                  self message (U loop to the right)
  ("note", keys, text)               keys: "A" or ("A","DB") ; text lines split by "\n"
  ("frame", op, guard)               open a combined fragment (alt/opt/break/loop)
  ("else", guard)                    divider inside the open frame
  ("end",)                           close the innermost frame
Text: lines separated by "\n"; a line wrapped in backticks `...` is set in Consolas (technical).
Long lines wrap automatically to the space available.
"""
import math, os, re, sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from dd import C, SANS, MONO, SERIF, t, r4, tw, html
from xml.sax.saxutils import escape

# Skin: "mono" (default) mimics the black-and-white PlantUML figures of the thesis (Times, black strokes,
# white heads, actor / cylinder heads, grey fragments, no activation bars, no legend);
# "color" is the SmartBook Diagram Design palette:  SEQ_SKIN=color python fig_x.py ...
SKIN = os.environ.get("SEQ_SKIN", "mono")
MONO_MAP = [("#1f3864", "#000000"), ("#475569", "#222222"), ("#5b6b82", "#444444"), ("#2f5597", "#000000"),
            ("#b45309", "#000000"), ("#f3f6fa", "#fafafa"), ("#c5cedb", "#555555"),
            ("rgba(31,56,100,0.25)", "#8a8a8a"), ("rgba(31,56,100,0.30)", "#333333"), ("rgba(31,56,100,0.02)", "rgba(0,0,0,0.035)"),
            ("rgba(71,85,105,0.10)", "#ffffff"), ("rgba(31,56,100,0.05)", "#ffffff"), ("rgba(31,56,100,0.03)", "#ffffff"),
            ("rgba(31,56,100,0.40)", "#555555"), ("rgba(31,56,100,0.14)", "#cccccc")]
if SKIN == "mono":       # Times New Roman sets about 10% narrower than the Arial estimate of dd.tw
    _tw_arial = tw
    def tw(text, size, mono=False, bold=False):
        return _tw_arial(text, size, mono, bold) * (1.0 if mono else 0.9)
LH = 16          # line step
PAD_TOP = 13     # first baseline inside a plate


def parse_lines(text):
    out = []
    for raw in text.split("\n"):
        mono = raw.startswith("`") and raw.endswith("`") and len(raw) > 1
        out.append((raw[1:-1] if mono else raw, mono))
    return out


def wrap(lines, maxw):
    res = []
    for s, m in lines:
        if tw(s, 12, m) <= maxw:
            res.append((s, m)); continue
        seps = [" ", "/", "_"] if not m else [" ", "/", "-", ",", "_", "."]
        cur = ""
        tokens = []
        buf = ""
        for ch in s:
            buf += ch
            if ch in seps:
                tokens.append(buf); buf = ""
        if buf: tokens.append(buf)
        for tok in tokens:
            # a single token longer than the line is hard-split so no plate outgrows its span
            while tw(tok, 12, m) > maxw and len(tok) > 1:
                cut = len(tok)
                while cut > 1 and tw(tok[:cut], 12, m) > maxw:
                    cut -= 1
                if cur.strip():
                    res.append((cur.rstrip(), m)); cur = ""
                res.append((tok[:cut], m)); tok = tok[cut:]
            if cur.strip() and tw((cur + tok).rstrip(), 12, m) > maxw:
                res.append((cur.rstrip(), m)); cur = tok
            else:
                cur += tok
        if cur.strip(): res.append((cur.rstrip(), m))
    return res


def box_width(name, sub):
    return r4(max(max(tw(n, 14, bold=True) for n in name.split(chr(10))) + 12, tw(sub, 11, True) + 10, 88))


def auto_layout(parts, events, width):
    """Centers that give each adjacent pair of lifelines room in proportion to the labels it carries."""
    keys = [p[0] for p in parts]
    idx = {k: i for i, k in enumerate(keys)}
    bws = [box_width(p[1], p[2]) for p in parts]
    n = len(parts)
    mind = [(bws[i] + bws[i + 1]) / 2 + 6 for i in range(n - 1)]
    demand = [0.0] * (n - 1)
    for ev in events:
        if ev[0] == "msg":
            a, b = idx[ev[1]], idx[ev[2]]
            lo, hi = min(a, b), max(a, b)
            nat = min(max(tw(s, 12, m) for s, m in parse_lines(ev[3])) + 36, 440)
            for g in range(lo, hi):
                demand[g] = max(demand[g], nat / (hi - lo))
        elif ev[0] == "self":
            a = idx[ev[1]]
            if a < n - 1:
                nat = max(tw(s, 12, m) for s, m in parse_lines(ev[2])) + 56
                demand[a] = max(demand[a], nat)
    gaps = [max(mind[i], demand[i]) for i in range(n - 1)]
    total = (width - 80) - bws[0] / 2 - bws[-1] / 2
    s = sum(gaps)
    if s > total:   # shrink only the part above each minimum
        flex = [g - m for g, m in zip(gaps, mind)]
        fs = sum(flex)
        cut = s - total
        gaps = [m + f * max(0.0, 1 - cut / fs) if fs else m for m, f in zip(mind, flex)]
    else:            # share the slack, more to the busier pairs
        slack = total - s
        wsum = sum(max(d, 1) for d in demand)
        gaps = [g + slack * max(d, 1) / wsum for g, d in zip(gaps, demand)]
    xs, x = [], 40 + bws[0] / 2
    for i in range(n):
        xs.append(int(x // 4 * 4))
        if i < n - 1:
            x += gaps[i]
    return xs, bws


class SeqDiagram:
    def __init__(self, slug, parts, events, width=800, box_w=None, title="", desc="", legend=True, xs=None, skin=None):
        self.slug, self.W, self.events, self.title, self.desc = slug, width, events, title, desc
        self.mono = (skin or SKIN) == "mono"
        auto_xs, bws = auto_layout(parts, events, width)
        self.parts = []
        self.x = {}
        for i, p in enumerate(parts):
            key, name, sub, kind = (list(p) + ["backend"])[:4]
            cx = auto_xs[i]   # explicit xs/box_w are ignored: layout follows the labels
            self.x[key] = cx
            self.parts.append((key, name, sub, kind, cx, bws[i]))
        self.bw = max(bws)
        self.L = {k: [] for k in ("frames", "lifelines", "bars", "arrows", "labels", "notes", "nodes", "legend")}
        self.warn = []
        self.kinds = set()
        self.has_note = False

    # ------------------------------------------------------------------ plates
    def plate(self, cx, top, lines, color, anchor="middle", x_left=None):
        h = 18 + LH * (len(lines) - 1)
        w = r4(max(tw(s, 12, m) for s, m in lines) + 12)
        x0 = x_left if x_left is not None else cx - w / 2
        bg = "#f7f7f7" if (self.mono and getattr(self, "_in_frame", False)) else C["paper"]
        out = [f'<rect x="{x0:g}" y="{top:g}" width="{w}" height="{h}" rx="2" fill="{bg}"/>']
        for i, (s, m) in enumerate(lines):
            num = re.match(r"^(\d+[a-z]?\.)( .*)$", s) if (self.mono and i == 0 and not m) else None
            if num and anchor == "middle":      # PlantUML shows the step number in bold
                el = t(x0 + w / 2, top + PAD_TOP + LH * i, s, 12, m, color)
                el = el.replace(">" + escape(s) + "<", '><tspan font-weight="700">' + escape(num.group(1)) + "</tspan>" + escape(num.group(2)) + "<")
                out.append(el)
            elif anchor == "middle":
                out.append(t(x0 + w / 2, top + PAD_TOP + LH * i, s, 12, m, color))
            else:
                out.append(t(x0 + 6, top + PAD_TOP + LH * i, s, 12, m, color, anchor="start"))
        self.L["labels"].append("\n".join(out))
        return x0, x0 + w

    # ------------------------------------------------------------------ layout
    def build(self):
        top_box = 40
        box_h = 64
        y = top_box + box_h + 8          # cursor: lowest painted y so far
        frames = []                       # stack of dicts
        acts = {k: [] for k in self.x}    # (y) of involvement
        first_key = self.parts[0][0]
        extents = []                      # x extents of content for frame sizing: (y, x0, x1)

        for ev in self.events:
            kind = ev[0]
            self._in_frame = bool(frames)
            if kind == "msg":
                _, a, b, text, mk = ev
                self.kinds.add(mk)
                xa, xb = self.x[a], self.x[b]
                d = 1 if xb > xa else -1
                avail = abs(xb - xa) - 24
                lines = wrap(parse_lines(text), avail - 12)
                h = 18 + LH * (len(lines) - 1)
                ym = y + 8 + h + 8
                ym = int(math.ceil(ym / 4) * 4)
                x1, x2 = xa + 4 * d, xb - 4 * d
                color, marker, dash, sw = {
                    "call": (C["muted"], "arrow", "", 1.2), "link": (C["link"], "arrow-link", "", 1.2),
                    "return": (C["muted"], "arrow", ' stroke-dasharray="5,4"', 1.2),
                    "async": (C["muted"], "arrow-open", ' stroke-dasharray="5,4"', 1.2),
                    "accent": (C["accent"], "arrow-accent", "", 1.4)}[mk]
                self.L["arrows"].append(f'<line x1="{x1}" y1="{ym}" x2="{x2}" y2="{ym}" stroke="{color}" stroke-width="{sw}"{dash} marker-end="url(#{self.slug}-{marker})"/>')
                lc = C["ink"] if mk in ("call", "return", "async") else color
                px0, px1 = self.plate((xa + xb) / 2, ym - 8 - h, lines, lc)
                if px1 - px0 > abs(xb - xa) - 8:
                    self.warn.append(f"label wider than span: {text[:40]!r}")
                extents.append((ym, min(xa, xb), max(xa, xb)))
                acts[a].append(ym); acts[b].append(ym)
                y = ym
            elif kind == "self":
                _, a, text = ev
                self.kinds.add("call")
                lines = wrap(parse_lines(text), 200)
                h = 18 + LH * (len(lines) - 1)
                w = r4(max(tw(s_, 12, m_) for s_, m_ in lines) + 12)
                ys = int(math.ceil((y + 12) / 4) * 4)
                dy = max(24, int(math.ceil(h / 4) * 4))
                left = self.x[a] + 4 + 40 + w > self.W - 40
                d = -1 if left else 1
                cx = self.x[a] + 4 * d
                self.L["arrows"].append(
                    f'<path d="M {cx} {ys} H {cx + 24 * d} Q {cx + 32 * d} {ys} {cx + 32 * d} {ys + 8} V {ys + dy - 8} Q {cx + 32 * d} {ys + dy} {cx + 24 * d} {ys + dy} H {cx + 2 * d}" fill="none" stroke="{C["muted"]}" stroke-width="1.2" marker-end="url(#{self.slug}-arrow)"/>')
                xl = cx + 40 if not left else cx - 40 - w
                x0, x1 = self.plate(0, ys + dy / 2 - h / 2, lines, C["ink"], anchor="start", x_left=xl)
                extents.append((ys, min(self.x[a], x0), max(self.x[a], x1)))
                acts[a] += [ys, ys + dy]
                y = ys + dy
            elif kind == "note":
                _, keys, text = ev
                self.has_note = True
                keys = keys if isinstance(keys, (tuple, list)) else (keys,)
                xs = [self.x[k] for k in keys]
                lines = parse_lines(text)
                maxw = 300 if len(keys) == 1 else min(self.W - 104, max(xs) - min(xs) + 240)
                lines = wrap(lines, maxw)
                w = r4(max(tw(s, 12, m) for s, m in lines) + 24)
                if len(keys) > 1:
                    w = max(w, r4(max(xs) - min(xs) + 48))
                cx = (min(xs) + max(xs)) / 2
                x0 = max(40, min(cx - w / 2, self.W - 40 - w))
                x0 = int(x0 // 4 * 4)
                top = int(math.ceil((y + 12) / 4) * 4)
                h = 12 + LH * len(lines)
                h = int(math.ceil(h / 4) * 4)
                out = [f'<rect x="{x0}" y="{top}" width="{w}" height="{h}" rx="4" fill="{C["paper2"]}" stroke="{C["rule_solid"]}" stroke-width="1"/>']
                for i, (s, m) in enumerate(lines):
                    out.append(t(x0 + 12, top + 19 + LH * i, s, 12, m, C["ink"], anchor="start"))
                self.L["notes"].append("\n".join(out))
                extents.append((top, x0, x0 + w))
                y = top + h
            elif kind == "divider":
                # time separator across every lifeline (UML "== text ==")
                _, text = ev
                yd = int(math.ceil((y + 24) / 4) * 4)
                w = r4(tw(text, 12, bold=True) + 24)
                self.L["notes"].append("\n".join([
                    f'<line x1="40" y1="{yd - 2}" x2="{self.W - 40}" y2="{yd - 2}" stroke="{C["muted"]}" stroke-width="1"/>',
                    f'<line x1="40" y1="{yd + 2}" x2="{self.W - 40}" y2="{yd + 2}" stroke="{C["muted"]}" stroke-width="1"/>',
                    f'<rect x="{self.W / 2 - w / 2:g}" y="{yd - 12}" width="{w}" height="24" rx="4" fill="{C["paper2"]}" stroke="{C["muted"]}" stroke-width="1"/>',
                    t(self.W / 2, yd + 4, text, 12, False, C["ink"], weight="700")]))
                y = yd + 16
            elif kind == "frame":
                _, op, guard = ev
                top = int(math.ceil((y + 12) / 4) * 4)
                frames.append({"op": op, "top": top, "guards": [(top + 15, guard)], "divs": [], "ext": [], "depth": len(frames)})
                y = top + 20
            elif kind == "else":
                _, guard = ev
                f = frames[-1]
                dv = int(math.ceil((y + 12) / 4) * 4)
                f["divs"].append(dv)
                f["guards"].append((dv + 19, guard))
                y = dv + 24
            elif kind == "end":
                f = frames.pop()
                bottom = int(math.ceil((y + 12) / 4) * 4)
                f["bottom"] = bottom
                self._draw_frame(f, extents)
                y = bottom
            # track frame content extents
            for f in frames:
                f["ext"] = extents
        self.bottom = y
        # activation bars: services hold control from first to last involvement, stores per call/return pair
        for key, name, sub, kind, cx, bw in self.parts:
            ys = sorted(set(acts[key]))
            if key == first_key or not ys:
                continue
            if kind in ("store", "external"):
                # one bar per cluster of consecutive involvements closer than 120px
                seg = [ys[0], ys[0]]
                for v in ys[1:]:
                    if v - seg[1] <= 120: seg[1] = v
                    else:
                        self._bar(cx, seg); seg = [v, v]
                self._bar(cx, seg)
            else:
                self._bar(cx, [ys[0], ys[-1]])
        return self

    def _bar(self, cx, seg):
        if self.mono:
            return
        y0, y1 = seg
        if y1 - y0 < 16: y1 = y0 + 16
        self.L["bars"].append(f'<rect x="{cx - 4}" y="{y0}" width="8" height="{y1 - y0}" fill="rgba(31,56,100,0.06)" stroke="{C["muted"]}" stroke-width="0.8"/>')

    def _draw_frame(self, f, extents):
        inside = [(x0, x1) for (yy, x0, x1) in extents if f["top"] <= yy <= f["bottom"]]
        x0 = min(v[0] for v in inside) - 20 if inside else 60
        x1 = max(v[1] for v in inside) + 20 if inside else self.W - 60
        gw = max(r4(tw(g, 12) + 14) for _, g in f["guards"])
        tabw = r4(len(f["op"]) * 11 * 0.6 + 20)
        need = tabw + 8 + gw + 12          # tab + first guard must fit inside the frame
        inset = 8 * f["depth"]
        right_lim = self.W - 40 - inset
        x1 = min(right_lim, max(x1, x0 + need))
        if x1 - x0 < need:                  # guard too long for the space to the right: grow leftwards
            x0 = x1 - need
        x0 = max(40 + inset, int(x0 // 4 * 4)); x1 = min(right_lim, int(math.ceil(x1 / 4) * 4))
        top, bottom = f["top"], f["bottom"]
        self.L["frames"].append("\n".join([
            f'<rect x="{x0}" y="{top}" width="{x1 - x0}" height="{bottom - top}" rx="4" fill="rgba(31,56,100,0.02)" stroke="rgba(31,56,100,0.30)" stroke-width="1"/>',
        ] + [f'<line x1="{x0 + 8}" y1="{dv}" x2="{x1 - 8}" y2="{dv}" stroke="rgba(31,56,100,0.30)" stroke-width="1" stroke-dasharray="4,3"/>' for dv in f["divs"]]))
        if self.mono:      # PlantUML-like tab: lower-case bold operator, guards in [brackets]
            g = [f'<path d="M {x0} {top} H {x0 + tabw} V {top + 12} L {x0 + tabw - 8} {top + 20} H {x0} Z" fill="#eeeeee" stroke="#333333" stroke-width="1"/>',
                 t(x0 + (tabw - 6) / 2, top + 15, f["op"].lower(), 13, False, "#000000", weight="700")]
            for gy, gtext in f["guards"]:
                gx = x0 + tabw + 8 if gy == top + 15 else x0 + 12
                gt = gtext if gtext.startswith("[") else "[" + gtext + "]"
                gwid = r4(tw(gt, 12, bold=True) + 14)
                g.append(f'<rect x="{gx}" y="{gy - 14}" width="{gwid}" height="18" rx="2" fill="#f7f7f7"/>')
                g.append(t(gx + 6, gy, gt, 12, False, "#000000", anchor="start", weight="700"))
            self.L["labels"].append(chr(10).join(g))
            return
        g = [f'<rect x="{x0}" y="{top}" width="{tabw}" height="20" rx="2" fill="{C["paper"]}" stroke="rgba(31,56,100,0.30)" stroke-width="1"/>',
             t(x0 + tabw / 2, top + 14, f["op"].upper(), 11, True, C["muted"], weight="700", extra=' letter-spacing="0.08em"')]
        for gy, gtext in f["guards"]:
            gx = x0 + tabw + 8 if gy == top + 15 else x0 + 12
            gwid = r4(tw(gtext, 12) + 14)
            g.append(f'<rect x="{gx}" y="{gy - 14}" width="{gwid}" height="18" rx="2" fill="{C["paper"]}"/>')
            g.append(t(gx + 6, gy, gtext, 12, False, C["muted"], anchor="start", extra=' font-style="italic"'))
        self.L["labels"].append("\n".join(g))

    def _mono_head(self, key, name, sub, kind, cx, bw, bottom_life):
        """PlantUML-like participant: actor stick figure, database cylinder or plain box; name in Times."""
        K = "#000000"
        names = name.split(chr(10))
        if kind == "input":
            out = [f'<circle cx="{cx}" cy="49" r="7" fill="#ffffff" stroke="{K}" stroke-width="1"/>',
                   f'<path d="M {cx} 56 V 72 M {cx - 11} 61 H {cx + 11} M {cx} 72 L {cx - 9} 84 M {cx} 72 L {cx + 9} 84" fill="none" stroke="{K}" stroke-width="1"/>']
            out += [t(cx, 99 - 16 * (len(names) - 1) + 16 * i, n, 14, False, K) for i, n in enumerate(names)]
        elif kind == "store":
            cw = r4(max(52, tw(sub, 11, True) + 16)) if sub else 48
            l, r = cx - cw / 2, cx + cw / 2
            first = 99 - 16 * (len(names) - 1)          # baseline of the first name line under the cylinder
            bot = first - 20                            # cylinder bottom (arc) stays clear of the name
            out = [f'<path d="M {l} 48 V {bot} A {cw / 2} 6 0 0 0 {r} {bot} V 48" fill="#f5f5f5" stroke="{K}" stroke-width="1"/>',
                   f'<ellipse cx="{cx}" cy="48" rx="{cw / 2}" ry="6" fill="#f5f5f5" stroke="{K}" stroke-width="1"/>']
            if sub:
                out.append(t(cx, (54 + bot) / 2 + 5, sub, 11, True, "#333333"))
            out += [t(cx, 99 - 16 * (len(names) - 1) + 16 * i, n, 14, False, K) for i, n in enumerate(names)]
        else:
            dash = ' stroke-dasharray="4,3"' if kind == "external" else ""
            out = [f'<rect x="{cx - bw / 2:g}" y="40" width="{bw}" height="64" rx="4" fill="#ffffff" stroke="#555555" stroke-width="1"{dash}/>']
            out += [t(cx, (70 if sub else 77) - 8 * (len(names) - 1) + 17 * i, n, 14, False, K) for i, n in enumerate(names)]
            if sub:
                out.append(t(cx, 90, sub, 11, True, "#444444"))
        self.L["lifelines"].append(f'<line x1="{cx}" y1="104" x2="{cx}" y2="{bottom_life}" stroke="#8a8a8a" stroke-width="1" stroke-dasharray="4,4"/>')
        self.L["nodes"].append(chr(10).join(out))

    # ------------------------------------------------------------------ render
    def svg(self):
        bottom_life = self.bottom + 24
        leg_y = bottom_life + 40
        H = int(math.ceil((leg_y + 28) / 4) * 4) if not self.mono else int(math.ceil((bottom_life + 40) / 4) * 4)
        for key, name, sub, kind, cx, bw in self.parts:
            if self.mono:
                self._mono_head(key, name, sub, kind, cx, bw, bottom_life)
                continue
            self.L["lifelines"].append(f'<line x1="{cx}" y1="104" x2="{cx}" y2="{bottom_life}" stroke="rgba(31,56,100,0.25)" stroke-width="1" stroke-dasharray="3,3"/>')
            fill, stroke = {"backend": ("#ffffff", C["ink"]), "input": ("rgba(71,85,105,0.10)", C["soft"]),
                            "store": ("rgba(31,56,100,0.05)", C["muted"]), "external": ("rgba(31,56,100,0.03)", "rgba(31,56,100,0.40)")}[kind]
            x0 = cx - bw / 2
            dash = ' stroke-dasharray="4,3"' if kind == "external" else ""
            self.L["nodes"].append("\n".join([
                f'<rect x="{x0:g}" y="40" width="{bw}" height="64" rx="6" fill="{C["paper"]}"/>',
                f'<rect x="{x0:g}" y="40" width="{bw}" height="64" rx="6" fill="{fill}" stroke="{stroke}" stroke-width="1"{dash}/>',
            ] + [t(cx, (68 if sub else 77) - 8 * (name.count(chr(10))) + 17 * i, n, 14, False, C["ink"], weight="700")
                 for i, n in enumerate(name.split(chr(10)))] + ([t(cx, 88, sub, 11, True, C["soft"])] if sub else [])))
        # legend
        items = [] if self.mono else [("link", "Yêu cầu HTTP"), ("call", "Lời gọi nội bộ"), ("return", "Phản hồi"), ("async", "Bất đồng bộ"), ("accent", "Kết quả chính")]
        leg = [] if self.mono else [f'<line x1="40" y1="{leg_y - 20}" x2="{self.W - 40}" y2="{leg_y - 20}" stroke="{C["rule"]}" stroke-width="1"/>']
        cur = 40
        for k, label in items:
            if k not in self.kinds: continue
            color = {"link": C["link"], "accent": C["accent"]}.get(k, C["muted"])
            dash = ' stroke-dasharray="5,4"' if k in ("return", "async") else ""
            leg.append(f'<line x1="{cur}" y1="{leg_y}" x2="{cur + 20}" y2="{leg_y}" stroke="{color}" stroke-width="1.2"{dash}/>')
            leg.append(t(cur + 28, leg_y + 4, label, 12, False, C["muted"], anchor="start"))
            cur += 28 + r4(tw(label, 12)) + 18
        if self.has_note and not self.mono:
            leg.append(f'<rect x="{cur}" y="{leg_y - 6}" width="20" height="12" rx="2" fill="{C["paper2"]}" stroke="{C["rule_solid"]}" stroke-width="1"/>')
            leg.append(t(cur + 28, leg_y + 4, "Ghi chú", 12, False, C["muted"], anchor="start"))
        self.L["legend"] = leg
        s = self.slug
        defs = f'''<defs>
  <marker id="{s}-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="{C['muted']}"/></marker>
  <marker id="{s}-arrow-accent" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="{C['accent']}"/></marker>
  <marker id="{s}-arrow-link" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="{C['link']}"/></marker>
  <marker id="{s}-arrow-open" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polyline points="0 0, 8 3, 0 6" fill="none" stroke="{C['muted']}" stroke-width="1.2"/></marker>
</defs>'''
        body = "\n".join(f"<!-- {k} -->\n" + "\n".join(v) for k, v in self.L.items() if v)
        if self.mono:
            for a, b in MONO_MAP:
                body = body.replace(a, b)
            defs = defs.replace(C["muted"], "#000000").replace(C["accent"], "#000000").replace(C["link"], "#000000")
            body = body.replace(f'font-family="{SANS}"', f'font-family="{SERIF}"')
        return (f'<svg viewBox="0 0 {self.W} {H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="{s}-title {s}-desc">\n'
                f'<title id="{s}-title">{escape(self.title)}</title>\n<desc id="{s}-desc">{escape(self.desc)}</desc>\n{defs}\n'
                f'<rect width="100%" height="100%" fill="{C["paper"]}"/>\n{body}\n</svg>'), H

    def write(self, out_html, h1, note_html="", eyebrow="Sequence · Diagram Design · SmartBook"):
        self.build()
        svg, H = self.svg()
        pathlib.Path(out_html).parent.mkdir(parents=True, exist_ok=True)
        pathlib.Path(out_html).write_text(html(self.slug, eyebrow, h1, svg, self.W, note_html), encoding="utf-8")
        for w in self.warn: print("WARN", self.slug, w)
        print("wrote", out_html, "H=", H)
        return H
