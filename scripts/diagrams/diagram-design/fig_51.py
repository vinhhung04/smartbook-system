"""Faithful redraw of docs/diagrams/source/architecture/ai-copilot-pipeline.mmd (16 nodes, 4 zones, 15 edges)."""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from dd import C, t, r4, tw, html, SANS, MONO

OUT = pathlib.Path(sys.argv[1])
SLUG = "ai-copilot-pipeline-dd"
W = 800
Z = []        # zone frames + headings
A = []        # arrows
L = []        # labels
N = []        # nodes
V, M = False, True


def zone(y, h, title):
    Z.append(f'<rect x="40" y="{y}" width="720" height="{h}" rx="8" fill="{C["paper2"]}" stroke="{C["rule"]}" stroke-width="1"/>')
    Z.append(t(56, y + 24, title, 14, False, C["muted"], anchor="start", weight="700"))


def box(x, y, w, h, name, subs, kind="backend"):
    fill, stroke, sw = {"backend": ("#ffffff", C["ink"], 1), "store": ("rgba(31,56,100,0.05)", C["muted"], 1),
                        "focal": (C["accent_tint"], C["accent"], 1.2)}[kind]
    cx = x + w / 2
    out = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="{C["paper"]}"/>',
           f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>']
    top = y + h / 2 - (20 + 16 * len(subs)) / 2
    out.append(t(cx, top + 15, name, 14, False, C["ink"], weight="700"))
    for i, (s, m) in enumerate(subs):
        out.append(t(cx, top + 20 + 16 * i + 13, s, 12, m, C["soft"] if m else C["ink"]))
    N.append("\n".join(out))


def diamond(cx, cy, w, h, lines, kind="backend"):
    fill, stroke, sw = {"backend": ("#ffffff", C["ink"], 1), "focal": (C["accent_tint"], C["accent"], 1.2)}[kind]
    pts = f"{cx},{cy - h / 2} {cx + w / 2},{cy} {cx},{cy + h / 2} {cx - w / 2},{cy}"
    out = [f'<polygon points="{pts}" fill="{C["paper"]}"/>', f'<polygon points="{pts}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>']
    top = cy - (16 * len(lines)) / 2
    for i, (s, m, bold) in enumerate(lines):
        out.append(t(cx, top + 12 + 16 * i, s, 14 if bold else 12, m, C["ink"], weight="700" if bold else None))
    N.append("\n".join(out))


def arrow(d, dashed=False, accent=False):
    color = C["accent"] if accent else C["muted"]
    marker = "arrow-accent" if accent else "arrow"
    dash = ' stroke-dasharray="5,4"' if dashed else ""
    A.append(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="1.2"{dash} marker-end="url(#{SLUG}-{marker})"/>')


def side_label(x, ymid, lines, plate):
    """Label plate to the right of a vertical segment, plate starts at x (8px gap from the line)."""
    w = r4(max(tw(s, 12, m) for s, m in lines) + 12)
    h = 18 + 16 * (len(lines) - 1)
    y = ymid - h / 2
    out = [f'<rect x="{x}" y="{y:g}" width="{w}" height="{h}" rx="2" fill="{plate}"/>']
    for i, (s, m) in enumerate(lines):
        if s.startswith("cờ "):  # Vietnamese word in sans, identifier in mono
            out.append(f'<text x="{x + 6}" y="{y + 13 + 16 * i:g}" fill="{C["muted"]}" font-size="12" font-family="{SANS}">'
                       f'cờ <tspan font-family="{MONO}">{s[3:]}</tspan></text>')
        else:
            out.append(t(x + 6, y + 13 + 16 * i, s, 12, m, C["muted"], anchor="start"))
    L.append("\n".join(out))


def top_label(cx, y, text, plate):
    w = r4(tw(text, 12) + 12)
    L.append(f'<rect x="{cx - w / 2:g}" y="{y - 26}" width="{w}" height="18" rx="2" fill="{plate}"/>\n' + t(cx, y - 13, text, 12, False, C["muted"]))


P2 = C["paper2"]
FLAG1 = [("cờ COPILOT_SEMANTIC_PLANNER", M), ("(mặc định off)", V)]
FLAG2 = [("cờ COPILOT_SEMANTIC_CLAIMS", M), ("(mặc định off)", V)]

# ---- Zone 1 (y 40..272)
zone(40, 232, "1. Hiểu câu hỏi và lập kế hoạch")
box(56, 80, 176, 60, "Câu hỏi tiếng Việt", [("+ trạng thái hội thoại", V)])
box(288, 80, 192, 60, "Lập kế hoạch luật", [("copilot_plan.build_plan", M)])
box(280, 180, 208, 76, "Semantic Planner:", [("LLM chỉ đọc nghĩa,", V), ("backend kiểm tra, luật thắng", V)])
arrow("M 232 110 H 287")
arrow("M 384 140 V 179", dashed=True)
side_label(396, 160, FLAG1, P2)

# ---- Zone 2 (y 304..536)
zone(304, 232, "2. Thu thập bằng chứng")
box(56, 352, 200, 60, "20 công cụ chỉ đọc", [("gọi API bằng JWT người dùng", V)])
box(304, 352, 176, 60, "Dữ liệu có cấu trúc", [("+ bảng bằng chứng", V)], "store")
box(528, 344, 192, 76, "Giải thích:", [("FACT · INFERENCE ·", M), ("ASSUMPTION · UNKNOWN", M)])
box(292, 444, 200, 76, "Đặc tả biểu đồ", [("line · bar · area ·", M), ("pie · kpi · table (Pydantic)", M)])
arrow("M 256 382 H 303")
arrow("M 480 382 H 527")
arrow("M 392 412 V 443")

# ---- Zone 3 (y 568..848)
zone(568, 280, "3. Sinh và kiểm chứng câu trả lời")
box(56, 624, 192, 64, "LLM viết câu trả lời", [("(OpenRouter, Qwen)", V)])
diamond(396, 656, 200, 96, [("Kiểm chứng", V, True), ("Layer 1 tất định", V, False)], "focal")
box(544, 608, 200, 96, "PASSED / REPAIRED ·", [("WARNING (lược câu sai) ·", V), ("BLOCKED (sinh lại ≤ 1 lần", V), ("vẫn lỗi)", V)])
box(300, 760, 192, 76, "Layer 2–3:", [("LLM trích claim,", V), ("backend phán quyết", V)])
arrow("M 248 656 H 295", accent=True)
arrow("M 496 656 H 543", accent=True)
arrow("M 396 704 V 759", dashed=True)
side_label(408, 732, FLAG2, P2)

# ---- Zone 4 (y 880..1120)
zone(880, 240, "4. Phản hồi và hành động có kiểm soát")
box(56, 920, 168, 76, "Văn bản + biểu đồ", [("+ bằng chứng", V), ("+ rủi ro và giới hạn", V)])
diamond(336, 958, 128, 76, [("safe_to_act?", M, False)])
box(472, 920, 184, 76, "Hành động", [("chờ xác nhận", V), ("(5 loại, hết hạn 10 phút)", V)])
box(56, 1040, 232, 64, "Web: sanitize đặc tả,", [("chỉ vẽ bằng component whitelist", V)])
box(484, 1040, 160, 64, "Con người", [("xác nhận hoặc hủy", V)])
arrow("M 224 958 H 271")
arrow("M 400 958 H 471")
top_label(436, 958, "Có", P2)
arrow("M 140 996 V 1039")
arrow("M 564 996 V 1039")

# ---- zone -> zone (s1 -> s2 -> s3 -> s4)
for y0, y1 in ((272, 303), (536, 567), (848, 879)):
    arrow(f"M 640 {y0} V {y1}")

# NOTE: box(56,1040,...) is 200 wide but its sub line is long; width checked by measure.py.
leg_y = 1164
legend = [f'<line x1="40" y1="{leg_y - 20}" x2="760" y2="{leg_y - 20}" stroke="{C["rule"]}" stroke-width="1"/>']
items = [("solid", "Luồng xử lý"), ("dash", "Bật bằng cờ (mặc định off)"), ("accent", "Kiểm chứng (trọng tâm)"), ("store", "Dữ liệu")]
cur = 40
for kind, text in items:
    if kind == "store":
        legend.append(f'<rect x="{cur}" y="{leg_y - 6}" width="20" height="12" rx="2" fill="rgba(31,56,100,0.05)" stroke="{C["muted"]}" stroke-width="1"/>')
    else:
        color = C["accent"] if kind == "accent" else C["muted"]
        dash = ' stroke-dasharray="5,4"' if kind == "dash" else ""
        legend.append(f'<line x1="{cur}" y1="{leg_y}" x2="{cur + 20}" y2="{leg_y}" stroke="{color}" stroke-width="1.2"{dash}/>')
    legend.append(t(cur + 28, leg_y + 4, text, 12, False, C["muted"], anchor="start"))
    cur += 28 + r4(tw(text, 12)) + 16
H = leg_y + 32

svg = f'''<svg viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="{SLUG}-title {SLUG}-desc">
<title id="{SLUG}-title">Kiến trúc xử lý của Trợ lý AI (Copilot)</title>
<desc id="{SLUG}-desc">Bốn giai đoạn của Copilot: hiểu câu hỏi và lập kế hoạch, thu thập bằng chứng, sinh và kiểm chứng câu trả lời, phản hồi và hành động có con người xác nhận; hai nhánh LLM chỉ bật bằng cờ.</desc>
<defs>
  <marker id="{SLUG}-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="{C['muted']}"/></marker>
  <marker id="{SLUG}-arrow-accent" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="{C['accent']}"/></marker>
</defs>
<rect width="100%" height="100%" fill="{C['paper']}"/>
<!-- zones -->
{chr(10).join(Z)}
<!-- arrows -->
{chr(10).join(A)}
<!-- labels -->
{chr(10).join(L)}
<!-- nodes -->
{chr(10).join(N)}
<!-- legend -->
{chr(10).join(legend)}
</svg>'''

(OUT / f"{SLUG}.html").write_text(html(SLUG, "Flowchart · Diagram Design · SmartBook",
                                       "Kiến trúc xử lý của Trợ lý AI (Copilot)", svg, W,
                                       '<p class="note">Vẽ lại từ <code>docs/diagrams/source/architecture/ai-copilot-pipeline.mmd</code> ở mức <em>faithful</em>: 16/16 nút, 15/15 cạnh, 4/4 zone. Bảng đối chiếu: <code>docs/diagrams/tests/diagram-design/README.md</code>.</p>'),
                                  encoding="utf-8")
print("ok", H)
