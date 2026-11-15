"""Use case diagrams 3.5–3.12 in UML notation, drawn with the SmartBook tokens and orthogonal routing.
Content transcribed from the thesis' original figures. usage: python fig_usecase.py <out_dir>"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from dd import C, t, r4, tw, html
from xml.sax.saxutils import escape

W = 800
BX0, BX1 = 248, 560            # system boundary
EW = 272                        # ellipse width
ECX = (BX0 + BX1) // 2 - 4      # ellipse centre x (leaves an inner right gutter)
FS = 13


def actor_svg(cx, top, name, color):
    """UML stick figure; returns svg and the bottom y of its name."""
    out = [f'<circle cx="{cx}" cy="{top + 10}" r="10" fill="#ffffff" stroke="{color}" stroke-width="1.4"/>',
           f'<path d="M {cx} {top + 20} V {top + 44} M {cx - 16} {top + 28} H {cx + 16} M {cx} {top + 44} L {cx - 12} {top + 60} M {cx} {top + 44} L {cx + 12} {top + 60}" fill="none" stroke="{color}" stroke-width="1.4"/>']
    lines = name.split("\n")
    for i, s in enumerate(lines):
        out.append(t(cx, top + 78 + 16 * i, s, FS, False, C["ink"], weight="700"))
    return "\n".join(out), top + 78 + 16 * (len(lines) - 1) + 4


def diagram(slug, title, h1, desc, ucs, left, right=(), rels=(), packages=(), generalize=None, row_gap=14, note=""):
    """ucs: list of text ('\\n' lines). left/right: list of (name, [uc indexes], row_hint or None).
    rels: (from, to, '«include»'|'«extend»'). packages: (label, first, last). generalize: (parent name, [left actor indexes])."""
    # ---- rows
    rows, y = [], 84
    pk_start = {p[1]: p for p in packages}
    pk_end = {p[2]: p for p in packages}
    for i, text in enumerate(ucs):
        if i in pk_start:
            y += 36
        n = len(text.split("\n"))
        h = 40 if n == 1 else (52 if n == 2 else 64)
        rows.append((y, h))
        y += h + row_gap
        if i in pk_end:
            y += 12
    box_bottom = y + 6
    A, L, N, F = [], [], [], []
    # system boundary + packages
    F.append(f'<rect x="{BX0}" y="40" width="{BX1 - BX0}" height="{box_bottom - 40}" rx="8" fill="{C["paper2"]}" stroke="{C["muted"]}" stroke-width="1.2"/>')
    F.append(t((BX0 + BX1) / 2, 64, title, 14, False, C["ink"], weight="700"))
    for label, a, b in packages:
        top = rows[a][0] - 32; bot = rows[b][0] + rows[b][1] + 8
        F.append(f'<rect x="{BX0 + 10}" y="{top}" width="{BX1 - BX0 - 20}" height="{bot - top}" rx="4" fill="rgba(31,56,100,0.02)" stroke="rgba(31,56,100,0.35)" stroke-width="1"/>')
        tw_ = r4(tw(label, 12, bold=True) + 16)
        F.append(f'<rect x="{BX0 + 10}" y="{top}" width="{tw_}" height="20" rx="2" fill="{C["paper"]}" stroke="rgba(31,56,100,0.35)" stroke-width="1"/>')
        F.append(t(BX0 + 18, top + 14, label, 12, False, C["ink"], anchor="start", weight="700"))
    # ellipses
    for i, text in enumerate(ucs):
        yt, h = rows[i]
        cy = yt + h / 2
        N.append(f'<ellipse cx="{ECX}" cy="{cy}" rx="{EW / 2}" ry="{h / 2}" fill="#ffffff" stroke="{C["ink"]}" stroke-width="1"/>')
        lines = text.split("\n")
        for k, s in enumerate(lines):
            N.append(t(ECX, cy - 8 * (len(lines) - 1) + 16 * k + 5, s, FS, False, C["ink"]))
            if tw(s, FS) > EW - 36:
                print("WARN", slug, "uc text wide:", s)
    cyr = [r[0] + r[1] / 2 for r in rows]

    def ex(i, side, dy=0):
        """point on ellipse i's left/right side at vertical offset dy from centre."""
        yt, h = rows[i]; ry = h / 2; cy = cyr[i] + dy
        k = max(0.0, 1 - (dy / ry) ** 2) ** 0.5
        return (ECX + side * EW / 2 * k, cy)

    # usage counters per ellipse side so several connectors on one side get distinct points
    taken = {}   # (ellipse, side) -> offsets already used, so ports stay >= 12px apart

    def attach_p(i, side, p):
        t_ = taken.setdefault((i, side), [])
        for dy in [0, 12 * p, -12 * p, 20 * p, -20 * p]:
            if all(abs(dy - o) >= 12 for o in t_):
                t_.append(dy)
                return ex(i, side, dy)
        raise ValueError(f"no free port on ellipse {i}")

    def attach(i, side):
        return attach_p(i, side, 1)

    hop_v = []   # vertical dashed segments (x, y0, y1) inside the right gutter, for hops

    # ---- include / extend
    gutter = BX1 - 18
    used_gaps = {min(a, b) for a, b, _ in rels if abs(a - b) == 1}
    for a, b, kind in rels:
        if abs(a - b) == 1:
            ya = rows[a][0] if a > b else rows[a][0] + rows[a][1]
            yb = rows[b][0] + rows[b][1] if a > b else rows[b][0]
            x = ECX
            A.append(f'<path d="M {x} {ya} V {yb + (2 if a > b else -2)}" fill="none" stroke="{C["muted"]}" stroke-width="1.2" stroke-dasharray="5,4" marker-end="url(#{slug}-open)"/>')
            ym = (ya + yb) / 2
            w = r4(tw(kind, 12) + 12)
            L.append(f'<rect x="{x + 10}" y="{ym - 9}" width="{w}" height="18" rx="2" fill="{C["paper2"]}"/>')
            L.append(t(x + 10 + w / 2, ym + 4, kind, 12, False, C["muted"]))
        else:
            (xa, ya), (xb, yb) = attach(a, +1), attach(b, +1)
            gx = gutter
            A.append(f'<path d="M {xa:.1f} {ya} H {gx - 8} Q {gx} {ya} {gx} {ya + (-8 if yb < ya else 8)} V {yb + (8 if yb < ya else -8)} Q {gx} {yb} {gx - 8} {yb} H {xb + 2:.1f}" fill="none" stroke="{C["muted"]}" stroke-width="1.2" stroke-dasharray="5,4" marker-end="url(#{slug}-open)"/>')
            hop_v.append((gx, min(ya, yb), max(ya, yb)))
            w = r4(tw(kind, 12) + 12)
            ym = (ya + yb) / 2
            lo_, hi_ = min(a, b), max(a, b)   # label sits in the row gap nearest the middle, clear of ellipses
            free = [j for j in range(lo_, hi_) if j not in used_gaps] or list(range(lo_, hi_))
            j = min(free, key=lambda j: abs((rows[j][0] + rows[j][1] + rows[j + 1][0]) / 2 - ym))
            used_gaps.add(j)
            ym = (rows[j][0] + rows[j][1] + rows[j + 1][0]) / 2
            L.append(f'<rect x="{gx - 8 - w}" y="{ym - 9}" width="{w}" height="18" rx="2" fill="{C["paper2"]}"/>')
            L.append(t(gx - 8 - w / 2, ym + 4, kind, 12, False, C["muted"]))

    def hline(x0, y, x1, verts):
        """horizontal segment from x0 to x1 with a hop over each vertical it crosses"""
        parts = [gx for gx, g0, g1 in verts if min(x0, x1) + 2 < gx < max(x0, x1) - 2 and g0 + 1 < y < g1 - 1]
        s = ""
        sgn = 1 if x1 > x0 else -1
        for gx in sorted(parts, reverse=x1 < x0):
            s += f" H {gx - 6 * sgn:.1f} A 6 6 0 0 {1 if sgn > 0 else 0} {gx + 6 * sgn:.1f} {y:.1f}"
        return s + f" H {x1:.1f}"

    def place(actors):
        """anchor y (arm line) per actor. Single-link actors sit level with their use case;
        multi-link actors take the free slot nearest their centre inside their bus range."""
        n = len(actors)
        lines = [len(a[0].split(chr(10))) for a in actors]
        want = [h if h is not None else sum(cyr[i] for i in c) / len(c) for _, c, h in actors]
        pos = [None] * n

        def ok(k, y):
            for j in range(n):
                if pos[j] is None or j == k:
                    continue
                up, lo = (j, k) if pos[j] <= y else (k, j)
                yu, yl = (pos[j], y) if up == j else (y, pos[j])
                if yl - yu < 90 + 16 * (lines[up] - 1):
                    return False
            return y >= 68

        singles = sorted([k for k in range(n) if len(actors[k][1]) == 1], key=lambda k: want[k])
        for k in singles:
            y = max(want[k], 68)
            while not ok(k, y):
                y += 4
            pos[k] = y
        for k in sorted([k for k in range(n) if len(actors[k][1]) > 1], key=lambda k: want[k]):
            c = actors[k][1]
            lo, hi = min(cyr[i] for i in c), max(cyr[i] for i in c)
            cands = sorted({cyr[i] for i in range(len(cyr)) if lo <= cyr[i] <= hi}
                           | {(cyr[i] + cyr[i + 1]) / 2 for i in range(len(cyr) - 1) if lo <= cyr[i] < hi},
                           key=lambda y: abs(y - want[k]))
            for y in cands:
                if ok(k, y):
                    pos[k] = y; break
            else:
                y = max(want[k], 68)
                while not ok(k, y):
                    y += 4
                pos[k] = y
        return pos

    def plan(actors, side):
        """route plan per actor: ('straight', i, y) | ('elbow', i) | ('bus', conns)"""
        pos = place(actors)
        plans = []
        for (name, conns, _), ay in zip(actors, pos):
            if len(conns) == 1:
                i = conns[0]; ry = rows[i][1] / 2
                plans.append(("straight", i) if abs(ay - cyr[i]) <= ry - 8 else ("elbow", i))
            else:
                plans.append(("bus", conns))
        return pos, plans

    def pref(ay, i):
        return 1 if ay > cyr[i] else -1


    SL = dict(fill="none", stroke=C["ink"])
    def path(d, arrow=True):
        A.append(f'<path d="{d}" fill="none" stroke="{C["ink"]}" stroke-width="1.2"' + (f' marker-end="url(#{slug}-arrow)"' if arrow else "") + "/>")

    ax_l = 120 if not generalize else 176
    ax_r = 692
    lpos, lplan = plan(left, -1)
    rpos, rplan = plan(right, +1)
    # vertical segment x positions
    lbus = {}; m = 0
    for k, pl in enumerate(lplan):
        if pl[0] == "bus":
            lbus[k] = BX0 - 20 - 14 * m; m += 1
    rbus = {}; m = 0
    for k, pl in enumerate(rplan):
        if pl[0] in ("bus", "elbow"):
            rbus[k] = BX1 + 24 + 14 * m; m += 1
    lelb = BX0 - 20 - 14 * len(lbus)
    # pre-compute verticals (approximate by centre spans) for hops
    verts = list(hop_v)
    for k, x in lbus.items():
        ys = [cyr[i] for i in lplan[k][1]] + [lpos[k]]
        verts.append((x, min(ys) - 14, max(ys) + 14))
    for k, pl in enumerate(lplan):
        if pl[0] == "elbow":
            verts.append((lelb, min(lpos[k], cyr[pl[1]]), max(lpos[k], cyr[pl[1]])))
    for k, x in rbus.items():
        pl = rplan[k]; cs = pl[1] if pl[0] == "bus" else [pl[1]]
        ys = [cyr[i] for i in cs] + [rpos[k]]
        verts.append((x, min(ys) - 14, max(ys) + 14))

    def draw(actors, pos, plans, side, ax, buses):
        hand = ax + 22 * (-side)          # actor hand x facing the system
        for k, ((name, conns, _), ay) in enumerate(zip(actors, pos)):
            svg, _ = actor_svg(ax, ay - 28, name, C["soft"])
            N.append(svg)
            pl = plans[k]
            if pl[0] == "straight":
                i = pl[1]
                px, py = ex(i, side, ay - cyr[i])
                if side < 0:
                    path(f"M {hand} {ay:.1f}" + hline(hand, ay, px - 2, verts))
                else:
                    path(f"M {px:.1f} {ay:.1f}" + hline(px, ay, hand, verts))
            elif pl[0] == "elbow":
                i = pl[1]; p = pref(ay, i)
                px, py = attach_p(i, side, p)
                mx = lelb if side < 0 else buses[k]
                d = 1 if ay > py else -1      # direction from ellipse point towards actor
                if side < 0:
                    path(f"M {hand} {ay:.1f} H {mx + 8} Q {mx} {ay:.1f} {mx} {ay - 8 * d:.1f} V {py + 8 * d:.1f} Q {mx} {py:.1f} {mx - 8 * side} {py:.1f}" + hline(mx, py, px - 2, verts))
                else:
                    path(f"M {px:.1f} {py:.1f}" + hline(px, py, mx - 8, verts) + f" Q {mx} {py:.1f} {mx} {py + 8 * d:.1f} V {ay - 8 * d:.1f} Q {mx} {ay:.1f} {mx + 8} {ay:.1f} H {hand}")
            else:
                bx = buses[k]; ys = [ay]
                own = [v for v in verts if v[0] != bx]
                for i in conns:
                    px, py = attach_p(i, side, pref(ay, i))
                    ys.append(py)
                    if side < 0:
                        path(f"M {bx} {py:.1f}" + hline(bx, py, px - 2, own))
                    else:
                        path(f"M {px:.1f} {py:.1f}" + hline(px, py, bx, own), arrow=False)
                path(f"M {bx} {min(ys):.1f} V {max(ys):.1f}", arrow=False)
                if side < 0:
                    path(f"M {hand} {ay:.1f}" + hline(hand, ay, bx, own), arrow=False)
                else:
                    path(f"M {bx} {ay:.1f}" + hline(bx, ay, hand, own))
                A.append(f'<circle cx="{bx}" cy="{ay:.1f}" r="2.5" fill="{C["ink"]}"/>')

    for actors_, pos_, plans_, side_ in ((left, lpos, lplan, -1), (right, rpos, rplan, +1)):
        for pl, ay in zip(plans_, pos_):
            if pl[0] == "straight":
                taken.setdefault((pl[1], side_), []).append(ay - cyr[pl[1]])
    draw(left, lpos, lplan, -1, ax_l, lbus)
    draw(right, rpos, rplan, +1, ax_r, rbus)
    actor_pos = [(ax_l, y) for y in lpos]

    # ---- generalization of the left actors to a parent actor
    if generalize:
        parent, kids = generalize
        ys = [lpos[k] for k in kids]
        pcy = (min(ys) + max(ys)) / 2
        px = 84
        svg, _ = actor_svg(px, pcy - 28, parent, C["soft"])
        N.append(svg)
        trunk = 128
        for k in kids:
            A.append(f'<path d="M {ax_l - 22} {lpos[k]:.1f} H {trunk}" fill="none" stroke="{C["muted"]}" stroke-width="1.2"/>')
        A.append(f'<path d="M {trunk} {min(ys):.1f} V {max(ys):.1f}" fill="none" stroke="{C["muted"]}" stroke-width="1.2"/>')
        A.append(f'<path d="M {trunk} {pcy:.1f} H {px + 24}" fill="none" stroke="{C["muted"]}" stroke-width="1.2" marker-end="url(#{slug}-gen)"/>')
    all_bottoms = [y + 58 + 16 * (len(a[0].split(chr(10))) - 1) for a, y in zip(list(left) + list(right), lpos + rpos)]
    H = r4(max([box_bottom] + all_bottoms) + 64)
    leg_y = H - 24
    leg = [f'<line x1="40" y1="{leg_y - 20}" x2="760" y2="{leg_y - 20}" stroke="{C["rule"]}" stroke-width="1"/>']
    cur = 44
    items = [("solid", "tác nhân – use case"), ("dash", "«include» / «extend»")] + ([("gen", "khái quát hóa")] if generalize else [])
    for kind, txt in items:
        if kind == "gen":
            leg.append(f'<path d="M {cur} {leg_y} H {cur + 18}" stroke="{C["muted"]}" stroke-width="1.2" marker-end="url(#{slug}-gen)"/>')
        else:
            dash = ' stroke-dasharray="5,4"' if kind == "dash" else ""
            leg.append(f'<line x1="{cur}" y1="{leg_y}" x2="{cur + 20}" y2="{leg_y}" stroke="{C["ink"] if kind == "solid" else C["muted"]}" stroke-width="1.2"{dash}/>')
        leg.append(t(cur + 28, leg_y + 4, txt, 12, False, C["muted"], anchor="start")); cur += 28 + r4(tw(txt, 12)) + 20
    defs = f'''<defs>
  <marker id="{slug}-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="{C['ink']}"/></marker>
  <marker id="{slug}-open" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto"><polyline points="0 0, 8 3.5, 0 7" fill="none" stroke="{C['muted']}" stroke-width="1.2"/></marker>
  <marker id="{slug}-gen" markerWidth="12" markerHeight="12" refX="11" refY="6" orient="auto"><polygon points="0 0, 11 6, 0 12" fill="#ffffff" stroke="{C['muted']}" stroke-width="1.2"/></marker>
</defs>'''
    svg = (f'<svg viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="{slug}-title {slug}-desc">\n'
           f'<title id="{slug}-title">{escape(h1)}</title>\n<desc id="{slug}-desc">{escape(desc)}</desc>\n{defs}\n'
           f'<rect width="100%" height="100%" fill="{C["paper"]}"/>\n' + "\n".join(F + A + L + N + leg) + "\n</svg>")
    out = pathlib.Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
    (out / f"{slug}.html").write_text(html(slug, "Use case · UML · SmartBook", h1, svg, W,
                                           f'<p class="note">Chép từ hình gốc của báo cáo{(" (" + note + ")") if note else ""}; ký pháp UML, phong cách SmartBook.</p>'), encoding="utf-8")
    print("wrote", slug, "H=", H)


AI = ("Dịch vụ AI", None)

# 3.6 Khách hàng
diagram("usecase-customer-dd", "SmartBook – Cổng bạn đọc", "Sơ đồ use case của tác nhân Khách hàng",
        "Khách hàng tra cứu, tìm bằng ảnh bìa, đặt giữ, theo dõi mượn, thanh toán phạt, quản lý yêu thích, đánh giá, xem gợi ý và thông báo.",
        ["UC05. Tra cứu danh mục\nvà xem chi tiết sách", "UC06. Tìm sách\nbằng ảnh bìa", "UC07. Đặt giữ sách",
         "UC08. Theo dõi phiếu mượn\nvà yêu cầu gia hạn", "UC09. Thanh toán phí phạt\ntrực tuyến",
         "UC10. Quản lý yêu thích và\nđăng ký báo có sách", "UC11. Đánh giá sách", "UC12. Xem gợi ý đọc sách\ncá nhân hóa",
         "UC13. Xem thông báo và\nthống kê đọc sách"],
        left=[("Khách hàng", list(range(9)), None)],
        right=[("Dịch vụ AI", [1, 7], None), ("Cổng VNPay", [4], None)],
        rels=[(1, 0, "«extend»"), (5, 2, "«extend»")], note="Hình 3.6")

# 3.7 Thủ thư
diagram("usecase-librarian-dd", "SmartBook – Lưu thông", "Sơ đồ use case của tác nhân Thủ thư",
        "Thủ thư quản lý hồ sơ bạn đọc và gói hội viên, xử lý đặt giữ, phát và nhận trả sách, duyệt gia hạn, thu phạt, tìm sách bằng ảnh bìa và hỏi chatbot.",
        ["UC14. Quản lý hồ sơ bạn đọc\nvà thẻ hội viên", "UC15. Quản lý gói hội viên", "UC16. Xác nhận đặt giữ\nvà chuẩn bị sách",
         "UC17. Phát sách bằng\nmã nhận sách", "UC18. Lập phiếu mượn\ntrực tiếp tại quầy", "UC19. Tiếp nhận trả sách",
         "UC20. Duyệt yêu cầu gia hạn", "UC21. Thu và miễn giảm\nphí phạt tại quầy", "UC06. Tìm sách bằng ảnh bìa",
         "UC52. Hỏi đáp nghiệp vụ\nvới chatbot"],
        left=[("Thủ thư", list(range(10)), None)],
        right=[("Dịch vụ AI", [8, 9], None)],
        rels=[(7, 5, "«extend»")], note="Hình 3.7")

# 3.8 Nhân viên kho
diagram("usecase-warehouse-staff-dd", "SmartBook – Vận hành kho", "Sơ đồ use case của tác nhân Nhân viên kho",
        "Nhân viên kho nhận việc, tạo yêu cầu mua, kiểm đếm, xếp kệ, lấy hàng, đóng gói, xuất kho, nhận chuyển kho, kiểm kê, báo sự cố và hỏi chatbot.",
        ["UC22. Xem và nhận\ncông việc kho", "UC23. Tạo yêu cầu mua hàng", "UC24. Kiểm đếm hàng nhập\ntheo phiếu nhập",
         "UC25. Xếp sách lên kệ\ntheo gợi ý vị trí", "UC26. Lấy hàng và\nxử lý lấy lại", "UC27. Đóng gói kèm\nbằng chứng hình ảnh",
         "UC28. Xác nhận xuất kho", "UC29. Nhận hàng chuyển kho", "UC30. Kiểm đếm theo\nphiếu kiểm kê", "UC31. Báo cáo sự cố kho",
         "UC52. Hỏi đáp nghiệp vụ\nvới chatbot"],
        left=[("Nhân viên kho", list(range(11)), None)],
        right=[("Dịch vụ AI", [3, 5, 10], None)], note="Hình 3.8")

# 3.9 Quản lý kho
diagram("usecase-warehouse-manager-dd", "SmartBook – Vận hành kho và mua hàng", "Sơ đồ use case của tác nhân Quản lý kho – vận hành kho và mua hàng",
        "Quản lý kho duyệt yêu cầu mua, lập và gửi đơn, ghi sổ phiếu nhập, đối soát, nhập kho bằng OCR, quản lý nhà cung cấp, kho, kiểm kê, xuất chuyển kho, điều phối và danh mục.",
        ["UC32. Duyệt yêu cầu mua hàng", "UC33. Lập và trình duyệt\nđơn đặt hàng", "UC34. Duyệt và gửi đơn\ncho nhà cung cấp",
         "UC35. Lập và ghi sổ\nphiếu nhập kho", "UC37. Đối soát đơn hàng\nvà xử lý thiếu hàng", "UC36. Nhập kho thông minh\nbằng OCR hóa đơn",
         "UC38. Quản lý nhà cung cấp", "UC39. Quản lý kho và\nvị trí lưu trữ", "UC40. Lập và duyệt\nphiếu kiểm kê",
         "UC41. Tạo và duyệt yêu cầu\nxuất kho, chuyển kho", "UC42. Điều phối công việc\nvà xử lý sự cố kho", "UC43. Quản lý danh mục\nsách và biến thể"],
        left=[("Quản lý kho", list(range(12)), None)],
        right=[("Nhà cung cấp", [2, 4], None), ("Dịch vụ AI", [5], None)],
        rels=[(4, 3, "«extend»"), (5, 3, "«extend»")], note="Hình 3.9")

# 3.10 Phân hệ AI
diagram("usecase-ai-dd", "SmartBook – Phân hệ AI", "Sơ đồ use case phân hệ AI: trích xuất thông tin sách và hỗ trợ ra quyết định",
        "Biên mục sách bằng AI kèm kiểm tra trùng lặp; bảng điều khiển, đề xuất nhập hàng, gợi ý thanh lý, hỏi đáp trợ lý, xác nhận hành động, bản tin hằng đêm và dự báo rủi ro.",
        ["UC45. Kiểm tra trùng lặp\nấn phẩm", "UC44. Biên mục sách\ntừ ISBN với AI", "UC46. Xem bảng điều khiển\nvà báo cáo vận hành",
         "UC47. Xem đề xuất nhập hàng\ntheo dự báo nhu cầu", "UC48. Xem gợi ý thanh lý\nsách tồn đọng", "UC49. Hỏi đáp với trợ lý AI\nhỗ trợ ra quyết định",
         "UC50. Xác nhận hành động\ndo AI đề xuất", "UC51. Duyệt bản tin\ntổng hợp hằng đêm", "UC55. Xem dự báo rủi ro trả trễ\nvà không đến nhận"],
        left=[("Quản lý kho", [1, 2, 3, 4, 5, 7], None), ("Quản trị\nhệ thống", [5, 8], None), ("Bộ lập lịch", [7], None)],
        right=[("Nguồn metadata\nbên ngoài", [1], None), ("Dịch vụ mô hình\nngôn ngữ\n(OpenRouter)", [1, 5], None)],
        rels=[(1, 0, "«include»"), (6, 5, "«extend»"), (7, 6, "«include»")],
        packages=[("Trích xuất thông tin sách", 0, 1), ("Hỗ trợ ra quyết định", 2, 8)], note="Hình 3.10")

# 3.11 Quản trị và tác vụ tự động
diagram("usecase-admin-scheduler-dd", "SmartBook – Quản trị và tác vụ tự động", "Sơ đồ use case của tác nhân Quản trị hệ thống và Bộ lập lịch",
        "Quản trị hệ thống quản lý người dùng, vai trò và quyền, xem dự báo rủi ro, nhật ký kiểm toán, giám sát hệ thống; Bộ lập lịch tự xử lý quá hạn và nhắc hạn trả.",
        ["UC53. Quản lý người dùng", "UC54. Quản lý vai trò và quyền", "UC55. Xem dự báo rủi ro trả trễ\nvà không đến nhận",
         "UC56. Xem nhật ký kiểm toán", "UC57. Giám sát tình trạng\nhệ thống", "UC61. Tự động xử lý quá hạn\nvà hết hạn giữ chỗ",
         "UC62. Nhắc hạn trả\ntheo mức rủi ro"],
        left=[("Quản trị\nhệ thống", [0, 1, 2, 3, 4], None), ("Bộ lập lịch", [5, 6], None)], note="Hình 3.11")

# 3.12 Nhà cung cấp
diagram("usecase-supplier-dd", "SmartBook – Cổng nhà cung cấp", "Sơ đồ use case của tác nhân Nhà cung cấp",
        "Nhà cung cấp xem và xác nhận đơn đặt hàng, gửi hóa đơn giao hàng và phản hồi báo cáo thiếu hàng.",
        ["UC58. Xem và xác nhận\nđơn đặt hàng", "UC59. Gửi hóa đơn giao hàng", "UC60. Phản hồi báo cáo thiếu hàng\nvà giao bù"],
        left=[("Nhà cung cấp", [0, 1, 2], None)], note="Hình 3.12")

# 3.5 Tổng quát
diagram("usecase-overview-dd", "Hệ thống SmartBook", "Sơ đồ use case tổng quát của hệ thống SmartBook",
        "Các tác nhân kế thừa Người dùng và các nhóm chức năng chính của SmartBook cùng các hệ thống bên ngoài.",
        ["Quản lý tài khoản\nvà xác thực (UC01-UC04)", "Tra cứu và tự phục vụ\nbạn đọc (UC05-UC13)", "Lưu thông sách\ntại quầy (UC14-UC21)",
         "Vận hành kho\n(UC22-UC31)", "Mua hàng và nhập kho\n(UC32-UC38)", "Kho, kiểm kê, danh mục\n(UC39-UC43)",
         "Trích xuất thông tin\nsách bằng AI\n(UC06, UC36, UC44, UC45)", "Hỗ trợ ra quyết định\n(UC46-UC52, UC55)",
         "Quản trị và giám sát\nhệ thống (UC53-UC57)", "Cổng nhà cung cấp\n(UC58-UC60)", "Tác vụ tự động\n(UC61-UC62)"],
        left=[("Khách hàng", [1], None), ("Thủ thư", [2], None), ("Nhân viên kho", [3], None), ("Quản lý kho", [4, 5, 6, 7], None),
              ("Quản trị\nhệ thống", [7, 8], None), ("Nhà cung cấp", [9], None), ("Bộ lập lịch", [10], None)],
        right=[("Cổng VNPay", [1], None), ("Nguồn metadata\nbên ngoài", [6], None), ("Dịch vụ mô hình\nngôn ngữ\n(OpenRouter)", [6, 7], None)],
        generalize=("Người dùng", [0, 1, 2, 3, 4, 5]), row_gap=40, note="Hình 3.5")
