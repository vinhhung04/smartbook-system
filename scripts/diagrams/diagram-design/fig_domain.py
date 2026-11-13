"""Hình 4.3 / 4.4 — domain models, transcribed from the thesis' original figures and drawn with the
same ELK layout + SmartBook rendering as the ERDs. usage: python fig_domain.py <out_dir>"""
import sys, pathlib, math
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from dd import C, t, r4, tw, html
from fig_erd_legacy import elk, rounded, place_card, draw_card, _hit
from xml.sax.saxutils import escape


def size(name, attrs):
    w = max(tw(name, 14, bold=True) + 28, max((tw(a, 12) + 24 for a in attrs), default=0), 112)
    h = 36 if not attrs else 36 + 8 + 16 * len(attrs) + 6
    return r4(w), r4(h)


def build(slug, nodes, edges, title, desc, h1, note, focal=None):
    N = [{"id": k, "w": size(n, a)[0], "h": size(n, a)[1]} for k, (n, a) in nodes.items()]
    E = [{"id": f"e{i}", "src": e[0], "dst": e[1]} for i, e in enumerate(edges)]
    best = None
    configs = [("DOWN", None), ("RIGHT", None)]
    for lb in ("4", "3"):
        for d in ("DOWN", "RIGHT"):
            configs.append((d, {"elk.layered.layering.strategy": "COFFMAN_GRAHAM", "elk.layered.layering.coffmanGraham.layerBound": lb}))
    for ar in ("1.0", "0.75", "0.5", "0.35"):
        configs.append(("DOWN", {"elk.layered.wrapping.strategy": "MULTI_EDGE", "elk.aspectRatio": ar}))
        for d in ("DOWN", "RIGHT"):
            configs.append((d, {"elk.separateConnectedComponents": "true", "elk.aspectRatio": ar}))
            configs.append((d, {"elk.separateConnectedComponents": "true", "elk.aspectRatio": ar,
                                "elk.layered.layering.strategy": "COFFMAN_GRAHAM", "elk.layered.layering.coffmanGraham.layerBound": "3"}))
    WIDE = {"elk.layered.spacing.nodeNodeBetweenLayers": "96", "elk.layered.spacing.edgeNodeBetweenLayers": "40", "elk.spacing.edgeEdge": "28"}
    for d, extra in configs:
        lay = elk(N, E, d, {**(extra or {}), **WIDE})
        fits = lay["width"] <= 720 and lay["height"] <= 1080
        score = (0 if fits else 1, lay["height"] if fits else lay["width"] * lay["height"])
        if best is None or score < best[0]:
            best = (score, lay, d)
    lay = best[1]
    print(f"{slug}: {best[2]} {lay['width']:.0f}x{lay['height']:.0f}" + ("" if best[0][0] == 0 else "  DOES NOT FIT"))
    ox = 40 + max(0, (720 - lay["width"]) / 2); oy = 40
    pos = {c["id"]: (c["x"] + ox, c["y"] + oy) for c in lay["children"]}
    boxes = [(pos[n["id"]][0], pos[n["id"]][1], n["w"], n["h"]) for n in N]
    routes = []
    for e in lay["edges"]:
        i = int(e["id"][1:])
        for sec in e["sections"]:
            pts = [(sec["startPoint"]["x"] + ox, sec["startPoint"]["y"] + oy)] + [(p["x"] + ox, p["y"] + oy) for p in sec.get("bendPoints", [])] + \
                  [(sec["endPoint"]["x"] + ox, sec["endPoint"]["y"] + oy)]
            routes.append((edges[i], pts))
    segs = []
    for _, pts in routes:
        for (xa, ya), (xb, yb) in zip(pts, pts[1:]):
            segs.append((min(xa, xb) - 0.5, min(ya, yb) - 0.5, abs(xb - xa) + 1, abs(yb - ya) + 1))
    A, L, placed = [], [], []
    for e, pts in routes:
        src, dst, m_src, m_dst, label, dashed = e
        dash = ' stroke-dasharray="5,4"' if dashed else ""
        marker = f' marker-end="url(#{slug}-arrow)"' if dashed and label in ("áp dụng vào", "ghi sổ sinh ra") else ""
        A.append(f'<path d="{rounded(pts)}" fill="none" stroke="{C["muted"]}" stroke-width="1.2"{dash}{marker}/>')
        for end, text, pref in ((0, m_src, +1), (1, m_dst, -1)):
            if not text:
                continue
            (xa, ya), (xb, yb) = (pts[0], pts[1]) if end == 0 else (pts[-1], pts[-2])
            dx, dy = (0, 1 if yb > ya else -1) if abs(xb - xa) < 0.5 else (1 if xb > xa else -1, 0)
            r, _ = place_card(xa, ya, dx, dy, text, boxes, segs, placed, pref)
            draw_card(r, text, L)
        if label:
            # relationship name on the longest segment, beside it, clear of everything else
            (xa, ya), (xb, yb) = max(zip(pts, pts[1:]), key=lambda s: math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]))
            w = r4(tw(label, 12) + 12); h = 18
            mx, my = (xa + xb) / 2, (ya + yb) / 2
            cands = []
            for k in (0, -20, 20, -40, 40, -60, 60, -90, 90, -120, 120):
                if abs(xa - xb) < 0.5:
                    cands += [(mx + 10, my - h / 2 + k, w, h), (mx - 10 - w, my - h / 2 + k, w, h)]
                else:
                    cands += [(mx - w / 2 + k, my - 8 - h, w, h), (mx - w / 2 + k, my + 8, w, h), (mx - w / 2 + k, my - 12 - 2 * h, w, h)]
            pick = next((r for r in cands if 40 <= r[0] and r[0] + w <= 760 and not any(_hit(r, b, 2) for b in boxes)
                         and not any(_hit(r, p_, 2) for p_ in placed) and not any(_hit(r, sg, 3) for sg in segs)), cands[0])
            placed.append(pick)
            L.append(f'<rect x="{pick[0]:.1f}" y="{pick[1]:.1f}" width="{w}" height="{h}" rx="2" fill="{C["paper"]}"/>')
            L.append(t(round(pick[0] + w / 2, 1), round(pick[1] + 13, 1), label, 12, False, C["muted"], extra=' font-style="italic"'))
    NN = []
    for n in N:
        x, y = pos[n["id"]]; w, h = n["w"], n["h"]
        name, attrs = nodes[n["id"]]
        fill, stroke, sw = ("#ffffff", C["ink"], 1) if n["id"] != focal else (C["accent_tint"], C["accent"], 1.2)
        out = [f'<rect x="{x:.1f}" y="{y:.1f}" width="{w}" height="{h}" rx="6" fill="{C["paper"]}"/>',
               f'<rect x="{x:.1f}" y="{y:.1f}" width="{w}" height="{h}" rx="6" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>',
               t(round(x + w / 2, 1), round(y + 23, 1), name, 14, False, C["ink"], weight="700")]
        if attrs:
            out.append(f'<path d="M {x:.1f} {y + 36:.1f} H {x + w:.1f}" stroke="rgba(31,56,100,0.22)" stroke-width="1"/>')
            for i, a in enumerate(attrs):
                out.append(t(round(x + 12, 1), round(y + 36 + 8 + 12 + 16 * i, 1), a, 12, False, C["soft"], anchor="start"))
        NN.append("\n".join(out))
    H = r4(oy + lay["height"] + 40); leg_y = H + 28
    leg = [f'<line x1="40" y1="{leg_y - 20}" x2="760" y2="{leg_y - 20}" stroke="{C["rule"]}" stroke-width="1"/>']
    cur = 44
    for kind, txt in (("solid", "liên kết, bội số ở hai đầu"), ("dash", "phụ thuộc / liên kết logic")):
        dash = ' stroke-dasharray="5,4"' if kind == "dash" else ""
        leg.append(f'<line x1="{cur}" y1="{leg_y}" x2="{cur + 20}" y2="{leg_y}" stroke="{C["muted"]}" stroke-width="1.2"{dash}/>')
        leg.append(t(cur + 28, leg_y + 4, txt, 12, False, C["muted"], anchor="start")); cur += 28 + r4(tw(txt, 12)) + 20
    Ht = leg_y + 28
    svg = (f'<svg viewBox="0 0 800 {Ht}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="{slug}-title {slug}-desc">\n'
           f'<title id="{slug}-title">{escape(title)}</title>\n<desc id="{slug}-desc">{escape(desc)}</desc>\n'
           f'<defs><marker id="{slug}-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="{C["muted"]}"/></marker></defs>\n'
           f'<rect width="100%" height="100%" fill="{C["paper"]}"/>\n' + "\n".join(A + L + NN + leg) + "\n</svg>")
    out = pathlib.Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
    (out / f"{slug}.html").write_text(html(slug, "Domain model · Diagram Design · SmartBook", h1, svg, 800, f'<p class="note">{note}</p>'), encoding="utf-8")


NOTE = "Chép từ hình gốc của báo cáo (lớp khái niệm, thuộc tính tóm tắt, bội số, nhãn quan hệ giữ nguyên)."
# ---------------------------------------------------------------- 4.3 danh mục và kho vận
n43 = {
    "NCC": ("Nhà cung cấp", []), "YCM": ("Yêu cầu mua", []), "PO": ("Đơn đặt hàng (PO)", ["trạng thái, tổng tiền"]),
    "HD": ("Hóa đơn giao hàng", []), "PN": ("Phiếu nhập (GoodsReceipt)", ["DRAFT / POSTED"]),
    "KHO": ("Kho (Warehouse)", ["mã kho, loại kho"]), "VT": ("Vị trí (Location)", ["mã vị trí, sức chứa"]),
    "TK": ("Tồn kho (StockBalance)", ["on_hand, available, reserved,", "borrowed, damaged, in_transit"]),
    "BDK": ("Biến động kho", ["loại, số lượng, chứng từ"]),
    "AB": ("Ấn bản (BookVariant)", ["ISBN-13/10, SKU, mã vạch", "loại bìa, giá vốn, giá bìa"]),
    "GT": ("Giữ tồn (StockReservation)", []),
    "SACH": ("Sách (Book)", ["mã sách, nhan đề, phụ đề", "lần xuất bản, số trang"]),
    "TG": ("Tác giả", []), "NXB": ("Nhà xuất bản", []), "TL": ("Thể loại", []),
    "BN": ("Bản nháp đối soát metadata", []), "DX": ("Đơn xuất (OutboundOrder)", []),
    "CVDG": ("Công việc đóng gói", []), "BC": ("Bằng chứng camera", []),
}
e43 = [
    ("NCC", "PO", "1", "*", None, False), ("YCM", "PO", "*", "0..1", "chuyển thành", False), ("PO", "HD", "1", "*", None, False),
    ("HD", "PN", "1", "0..*", None, False), ("PN", "BDK", None, None, "ghi sổ sinh ra", True),
    ("KHO", "VT", "1", "*", None, False), ("KHO", "TK", "1", "*", None, False), ("AB", "TK", "1", "*", None, False),
    ("AB", "GT", "1", "*", None, False), ("TK", "BDK", "1", "*", None, False), ("SACH", "AB", "1", "1..*", None, False),
    ("SACH", "TG", "*", "*", None, False), ("SACH", "NXB", "*", "0..1", None, False), ("SACH", "TL", "*", "*", None, False),
    ("BN", "SACH", None, None, "áp dụng vào", True), ("DX", "CVDG", "1", "*", None, False), ("CVDG", "BC", "1", "*", None, False),
]
def part(slug, nodes, edges, keys, title, desc, h1, note, focal=None):
    sub = {k: nodes[k] for k in keys}
    build(slug, sub, [e for e in edges if e[0] in sub and e[1] in sub], title, desc, h1, note, focal)


P43 = [("p1", ["NCC", "YCM", "PO", "HD", "PN", "BDK"], "mua hàng và nhận hàng", None),
       ("p2", ["KHO", "VT", "TK", "BDK", "AB", "GT"], "kho và tồn kho", "TK"),
       ("p3", ["SACH", "AB", "TG", "NXB", "TL", "BN", "DX", "CVDG", "BC"], "danh mục sách và xuất kho", "SACH")]
_done = set()
for i, (suf, keys, what, foc) in enumerate(P43, 1):
    es = [e for e in e43 if e[0] in keys and e[1] in keys and (e[0], e[1]) not in _done]
    _done |= {(e[0], e[1]) for e in es}
    build(f"domain-catalog-warehouse-dd-{suf}", {k: n43[k] for k in keys}, es,
          f"Mô hình miền: danh mục và kho vận, phần {i}", f"Mô hình miền phần {what}.",
          f"Mô hình miền nhóm danh mục và kho vận ({i}/3): {what}", NOTE + " Hình 4.3.", focal=foc)

# ---------------------------------------------------------------- 4.4 người dùng, lưu thông và AI
n44 = {
    "U": ("Người dùng (User)", ["tên đăng nhập, email, trạng thái"]), "R": ("Vai trò (Role)", []), "P": ("Quyền (Permission)", []),
    "KH": ("Bạn đọc (Customer)", ["mã bạn đọc, số dư phạt"]),
    "GHV": ("Gói hội viên", ["số cuốn tối đa, số ngày mượn,", "phí phạt/ngày, giờ giữ chỗ"]),
    "HT": ("Hội thoại AI", []), "HD": ("Hành động chờ xác nhận", ["loại, mức rủi ro, trạng thái,", "hết hạn sau 10 phút"]),
    "PDG": ("Phiếu đặt giữ", ["trạng thái, hạn giữ,", "mã nhận PU-XXXX-XXXX"]), "TB": ("Thông báo", []),
    "HV": ("Hội viên (Membership)", []), "TN": ("Tin nhắn AI", []), "NK": ("Nhật ký hành động AI", []),
    "PM": ("Phiếu mượn", ["trạng thái"]), "CM": ("Cuốn mượn (LoanItem)", ["hạn trả, ngày trả, tình trạng"]),
    "GH": ("Gia hạn", []), "PP": ("Phí phạt (Fine)", ["loại, số tiền, trạng thái"]), "TT": ("Thanh toán phạt", []),
}
e44 = [
    ("U", "R", "*", "*", None, False), ("R", "P", "*", "*", None, False), ("U", "KH", "1", "0..1", "liên kết theo email", True),
    ("U", "HT", "1", "*", None, False), ("U", "HD", "1", "*", None, False), ("KH", "PDG", "1", "*", None, False),
    ("KH", "PM", "1", "*", None, False), ("KH", "TB", "1", "*", None, False), ("KH", "HV", "1", "*", None, False),
    ("GHV", "HV", "1", "*", None, False), ("HT", "TN", "1", "*", None, False), ("HD", "NK", "1", "*", None, False),
    ("PDG", "PM", "0..1", "0..1", "chuyển thành", False), ("PM", "CM", "1", "1..*", None, False),
    ("CM", "GH", "1", "*", None, False), ("CM", "PP", "1", "*", None, False), ("PP", "TT", "1", "*", None, False),
]
P44 = [("p1", ["U", "R", "P", "KH", "HT", "TN", "HD", "NK"], "người dùng, quyền và AI", "U"),
       ("p2", ["KH", "GHV", "HV", "PDG", "TB", "PM", "CM", "GH", "PP", "TT"], "lưu thông của bạn đọc", "KH")]
for i, (suf, keys, what, foc) in enumerate(P44, 1):
    es = [e for e in e44 if e[0] in keys and e[1] in keys]
    build(f"domain-users-circulation-ai-dd-{suf}", {k: n44[k] for k in keys}, es,
          f"Mô hình miền: người dùng, lưu thông và AI, phần {i}", f"Mô hình miền phần {what}.",
          f"Mô hình miền nhóm người dùng, lưu thông và AI ({i}/2): {what}", NOTE + " Hình 4.4.", focal=foc)
