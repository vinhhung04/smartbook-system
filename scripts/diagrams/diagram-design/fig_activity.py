"""UML activity diagrams with swimlanes (thesis figures 3.1–3.4), SmartBook style, orthogonal routing.
Content transcribed verbatim from the original figures. usage: python fig_activity.py <out_dir>"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from dd import C, t, r4, tw, html
from xml.sax.saxutils import escape

W = 800
X0, X1 = 40, 760
HEAD = 40          # lane header band height
FS = 13            # action text size
GAP = 16           # vertical gap between rows (channel sits 6px below a row)


def wrap(text, maxw):
    """keep the original line breaks when they fit; otherwise re-flow the whole text greedily"""
    lines = text.split(chr(10))
    if all(0.95 * tw(s, FS) <= maxw for s in lines):
        return lines
    out, cur = [], ""
    for w in text.replace(chr(10), " ").split(" "):
        cand = (cur + " " + w).strip()
        if cur and 0.95 * tw(cand, FS) > maxw:
            out.append(cur); cur = w
        else:
            cur = cand
    return out + [cur]


def activity(slug, h1, desc, lanes, nodes, edges, weights=None, note="", width=800, out=None):
    """nodes: (id, lane, kind, text, opts) kind in start/end/action/decision/merge; opts: {'with': id, 'dx': px}.
    edges: (a, b, label, ports) ports like 'B>T', 'L>T', 'R>T', 'R>R', 'L>L'."""
    W, X1 = width, width - 40
    head = HEAD if lanes else 0
    n = len(lanes) if lanes else 1
    weights = weights or [1] * n
    tot = sum(weights)
    lx = [X0]
    for w_ in weights:
        lx.append(lx[-1] + (X1 - X0) * w_ / tot)
    lcx = [(lx[i] + lx[i + 1]) / 2 for i in range(n)]
    # ---- sizes
    N = {}
    for nid, lane, kind, text, *rest in nodes:
        o = rest[0] if rest else {}
        maxw = lx[lane + 1] - lx[lane] - 16
        if kind == "action":
            lines = wrap(text, maxw - 20)
            w = r4(min(max(0.95 * tw(s, FS) for s in lines) + 24, maxw)); h = 10 + 16 * len(lines)
        elif kind == "decision":
            lines = wrap(text, maxw - 72)   # leaves room for a side loop inside the lane
            w = r4(max(0.95 * tw(s, FS) for s in lines) + 36); h = 10 + 16 * len(lines)
        elif kind == "merge":
            lines, w, h = [], 20, 20
        elif kind == "bar":                       # fork / join
            lines, w, h = [], o.get("w", 320), 6
        else:
            lines, w, h = [], 20, 20
        N[nid] = dict(lane=lane, kind=kind, lines=lines, w=w, h=h, opts=o, x=lcx[lane] + o.get("dx", 0))
    # ---- rows
    rows = []   # list of [ids]
    for nid, *_ in nodes:
        o = N[nid]["opts"]
        if "with" in o:
            next(r for r in rows if o["with"] in r).append(nid)
        else:
            rows.append([nid])
    y = head + 40 + 12
    rowbot = {}
    for r in rows:
        hmax = max(N[i]["h"] for i in r)
        for i in r:
            N[i]["cy"] = y + hmax / 2
            N[i]["top"] = N[i]["cy"] - N[i]["h"] / 2
            N[i]["bot"] = N[i]["cy"] + N[i]["h"] / 2
            N[i]["row"] = len(rowbot)
        for i in r:
            rowbot[i] = y + hmax
        y += hmax + GAP
    H = r4(y - GAP + 52)
    order = {nid: k for k, (nid, *_) in enumerate(nodes)}

    def port(nid, p):
        d = N[nid]
        return {"T": (d["x"], d["top"]), "B": (d["x"], d["bot"]),
                "L": (d["x"] - d["w"] / 2, d["cy"]), "R": (d["x"] + d["w"] / 2, d["cy"])}[p]

    # ---- route every edge as a polyline
    polys = []
    for a, b, label, *rest in edges:
        ports = rest[0] if rest else "B>T"
        pa, pb = ports.split(">")
        (sx, sy), (tx, ty) = port(a, pa), port(b, pb)
        if N[a]["kind"] == "bar":
            sx = tx
        if N[b]["kind"] == "bar":
            tx = sx
        if pa == "B" and pb == "T":
            if abs(sx - tx) < 1:
                pts = [(sx, sy), (tx, ty)]
            else:
                cy = rowbot[a] + 6
                pts = [(sx, sy), (sx, cy), (tx, cy), (tx, ty)]
        elif pb == "T":
            pts = [(sx, sy), (tx, sy), (tx, ty)]
        else:   # side to the same side of a merge node, around everything in between
            lane = N[a]["lane"]
            r0, r1 = sorted((N[a]["row"], N[b]["row"]))
            span = [d for d in N.values() if d["lane"] == lane and r0 <= d["row"] <= r1]
            if pa == "R":
                X = max(d["x"] + d["w"] / 2 for d in span) + 16
            else:
                X = min(d["x"] - d["w"] / 2 for d in span) - 16
            pts = [(sx, sy), (X, sy), (X, ty), (tx, ty)]
        polys.append((pts, label, pa, a))

    verts = []
    for k, (pts, _, _, _) in enumerate(polys):
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            if abs(x0 - x1) < 0.5:
                verts.append((x0, min(y0, y1), max(y0, y1), k))

    def build(k, pts, r=8):
        d = f"M {pts[0][0]:.1f} {pts[0][1]:.1f}"
        segs = list(zip(pts, pts[1:]))
        for j, ((x0, y0), (x1, y1)) in enumerate(segs):
            ln = abs(x1 - x0) + abs(y1 - y0)
            rin = min(r, ln / 2) if j > 0 else 0          # trimmed at the start (after a corner)
            rout = min(r, ln / 2) if j < len(segs) - 1 else 0
            ux, uy = ((x1 > x0) - (x1 < x0)), ((y1 > y0) - (y1 < y0))
            ex_, ey_ = x1 - ux * rout, y1 - uy * rout
            if uy == 0:   # horizontal: hop over other edges' verticals
                xs = sorted([vx for vx, v0, v1, kk in verts if kk != k and min(x0, x1) + 10 < vx < max(x0, x1) - 10 and v0 + 2 < y0 < v1 - 2],
                            reverse=x1 < x0)
                for vx in xs:
                    d += f" L {vx - 6 * ux:.1f} {y0:.1f} A 6 6 0 0 {0 if ux > 0 else 1} {vx + 6 * ux:.1f} {y0:.1f}"
            d += f" L {ex_:.1f} {ey_:.1f}"
            if j < len(segs) - 1:
                (nx, ny) = segs[j + 1][1]
                vx_, vy_ = ((nx > x1) - (nx < x1)), ((ny > y1) - (ny < y1))
                ln2 = abs(nx - x1) + abs(ny - y1)
                r2 = min(r, ln / 2, ln2 / 2)
                d += f" Q {x1:.1f} {y1:.1f} {x1 + vx_ * r2:.1f} {y1 + vy_ * r2:.1f}"
        return d

    A, L, Nd, F = [], [], [], []
    # lanes
    if lanes:
        F.append(f'<rect x="{X0}" y="40" width="{X1 - X0}" height="{H - 80}" fill="#ffffff" stroke="{C["muted"]}" stroke-width="1"/>')
        F.append(f'<rect x="{X0}" y="40" width="{X1 - X0}" height="{HEAD}" fill="{C["paper2"]}" stroke="{C["muted"]}" stroke-width="1"/>')
        for i in range(1, n):
            F.append(f'<line x1="{lx[i]:.1f}" y1="40" x2="{lx[i]:.1f}" y2="{H - 40}" stroke="{C["rule_solid"]}" stroke-width="1"/>')
        for i, name in enumerate(lanes):
            F.append(t(lcx[i], 40 + HEAD / 2 + 5, name, 14, False, C["ink"], weight="700"))
    for k, (pts, label, pa, src) in enumerate(polys):
        A.append(f'<path d="{build(k, pts)}" fill="none" stroke="{C["ink"]}" stroke-width="1.2" marker-end="url(#{slug}-arrow)"/>')
        if label:
            sx, sy = pts[0]
            w = r4(tw(label, 12) + 10)
            pb = None
            if pa == "B":
                goes_right = len(pts) > 2 and pts[2][0] > sx
                bx, by = (sx - 8 - w if goes_right else sx + 8), sy + 1
            elif len(pts) == 4 and abs(pts[1][0] - pts[2][0]) < 0.5 and pts[3][1] != sy:   # side loop: beside its vertical
                X = pts[1][0]
                down = pts[2][1] > sy
                by = (N[src]['bot'] + 2) if down else (N[src]['top'] - 16)
                bx = X + 6 if pa == "L" else X - 6 - w
            elif pa == "L":
                bx, by = sx - 4 - w, sy - 22
            else:
                bx, by = sx + 4, sy - 22
            L.append(f'<rect x="{bx}" y="{by - 1}" width="{w}" height="16" rx="2" fill="#ffffff"/>')
            L.append(t(bx + w / 2, by + 11, label, 12, False, C["muted"]))
    for nid, d in N.items():
        x, cy, w, h = d["x"], d["cy"], d["w"], d["h"]
        if d["kind"] == "start":
            Nd.append(f'<circle cx="{x}" cy="{cy}" r="9" fill="{C["ink"]}"/>')
        elif d["kind"] == "end":
            Nd.append(f'<circle cx="{x}" cy="{cy}" r="10" fill="#ffffff" stroke="{C["ink"]}" stroke-width="1.4"/><circle cx="{x}" cy="{cy}" r="6" fill="{C["ink"]}"/>')
        elif d["kind"] == "merge":
            Nd.append(f'<polygon points="{x},{cy - 10} {x + 10},{cy} {x},{cy + 10} {x - 10},{cy}" fill="#ffffff" stroke="{C["ink"]}" stroke-width="1.2"/>')
        elif d["kind"] == "bar":
            Nd.append(f'<rect x="{x - w / 2}" y="{cy - 3}" width="{w}" height="6" rx="2" fill="{C["ink"]}"/>')
        elif d["kind"] == "decision":
            l, r_, tp, bt = x - w / 2, x + w / 2, cy - h / 2, cy + h / 2
            Nd.append(f'<polygon points="{l},{cy} {l + 12},{tp} {r_ - 12},{tp} {r_},{cy} {r_ - 12},{bt} {l + 12},{bt}" fill="{C["paper2"]}" stroke="{C["ink"]}" stroke-width="1.2"/>')
        else:
            Nd.append(f'<rect x="{x - w / 2}" y="{cy - h / 2}" width="{w}" height="{h}" rx="6" fill="#ffffff" stroke="{C["ink"]}" stroke-width="1.2"/>')
        for j, s in enumerate(d["lines"]):
            Nd.append(t(x, cy - 8 * (len(d["lines"]) - 1) + 16 * j + 4.5, s, FS, False, C["ink"]))
    # sanity: boxes inside their lane
    for nid, d in N.items():
        if d["x"] - d["w"] / 2 < lx[d["lane"]] + 4 or d["x"] + d["w"] / 2 > lx[d["lane"] + 1] - 4:
            print("WARN", slug, nid, "box crosses its lane")
    defs = f'''<defs>
  <marker id="{slug}-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="{C['ink']}"/></marker>
</defs>'''
    svg = (f'<svg viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="{slug}-title {slug}-desc">\n'
           f'<title id="{slug}-title">{escape(h1)}</title>\n<desc id="{slug}-desc">{escape(desc)}</desc>\n{defs}\n'
           f'<rect width="100%" height="100%" fill="{C["paper"]}"/>\n' + "\n".join(F + A + L + Nd) + "\n</svg>")
    out = pathlib.Path(out or sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
    (out / f"{slug}.html").write_text(html(slug, "Activity · UML · SmartBook", h1, svg, W,
                                           f'<p class="note">Chép nguyên văn từ hình gốc của báo cáo ({note}); ký pháp UML, phong cách SmartBook.</p>'), encoding="utf-8")
    print("wrote", slug, "H=", H)


if __name__ == "__main__":
    # 3.1
    activity("activity-borrow-reservation-dd", "Sơ đồ hoạt động quy trình đặt giữ, nhận sách và trả sách",
             "Khách hàng đặt giữ, hệ thống giữ tồn, thủ thư chuẩn bị và phát sách bằng mã nhận, khách trả sách và hệ thống tính phí phạt nếu có.",
             ["Khách hàng", "Hệ thống", "Thủ thư"],
             [("s", 0, "start", ""), ("a1", 0, "action", "Tra cứu sách, chọn biến thể\nvà kho nhận sách"),
              ("a2", 0, "action", "Gửi yêu cầu đặt giữ"), ("a3", 1, "action", "Kiểm tra thẻ hội viên\nvà giới hạn đặt giữ"),
              ("d1", 1, "decision", "Hợp lệ và còn tồn?"),
              ("a4", 0, "action", "Nhận thông báo từ chối,\ncó thể đăng ký báo có sách"),
              ("a5", 1, "action", "Giữ tồn kho\n(khả dụng → đã giữ)", {"with": "a4"}),
              ("e1", 0, "end", ""), ("a6", 1, "action", "Tạo phiếu đặt giữ PENDING", {"with": "e1"}),
              ("a7", 2, "action", "Xác nhận đặt giữ"), ("a8", 2, "action", "Lấy sách ra quầy,\nđánh dấu sẵn sàng nhận"),
              ("a9", 1, "action", "Cấp mã nhận sách và QR,\nthông báo bạn đọc"),
              ("d2", 0, "decision", "Đến nhận trước hạn giữ?"),
              ("a10", 0, "action", "Xuất trình mã QR"),
              ("a11", 1, "action", "Tác vụ nền hủy phiếu hết hạn,\nnhả tồn đã giữ", {"with": "a10"}),
              ("a12", 2, "action", "Quét mã nhận sách"), ("e2", 1, "end", "", {"with": "a12"}),
              ("a13", 1, "action", "Kiểm tra mã, tiêu thụ tồn đã giữ\n(đã giữ → đang mượn)"),
              ("a14", 1, "action", "Tạo phiếu mượn, tính hạn trả"),
              ("a15", 0, "action", "Nhận sách; sau đó trả sách"),
              ("a16", 2, "action", "Ghi nhận trả sách\nvà tình trạng sách"),
              ("a17", 1, "action", "Trả tồn về khả dụng"),
              ("d3", 1, "decision", "Trễ hạn, mất hoặc hư hỏng?"),
              ("a18", 1, "action", "Sinh phí phạt, thông báo bạn đọc"),
              ("m1", 1, "merge", ""), ("e3", 1, "end", "")],
             [("s", "a1", ""), ("a1", "a2", ""), ("a2", "a3", ""), ("a3", "d1", ""),
              ("d1", "a4", "không", "L>T"), ("d1", "a5", "có"), ("a4", "e1", ""), ("a5", "a6", ""),
              ("a6", "a7", ""), ("a7", "a8", ""), ("a8", "a9", ""), ("a9", "d2", ""),
              ("d2", "a10", "có"), ("d2", "a11", "không", "R>T"), ("a11", "e2", ""), ("a10", "a12", ""),
              ("a12", "a13", ""), ("a13", "a14", ""), ("a14", "a15", ""), ("a15", "a16", ""), ("a16", "a17", ""),
              ("a17", "d3", ""), ("d3", "a18", "có"), ("d3", "m1", "không", "R>R"), ("a18", "m1", ""), ("m1", "e3", "")],
             weights=[1, 1.15, 1], note="Hình 3.1")

    # 3.2
    activity("activity-purchase-receiving-dd", "Sơ đồ hoạt động quy trình mua hàng, nhận hàng và nhập kho",
             "Từ yêu cầu mua hàng, duyệt và gửi đơn, nhà cung cấp giao hàng, kiểm đếm, ghi sổ nhập kho, xử lý thiếu hàng và xếp kệ.",
             ["Nhân viên kho", "Quản lý kho", "Hệ thống", "Nhà cung cấp"],
             [("s", 0, "start", ""), ("a1", 0, "action", "Tạo yêu cầu mua hàng"),
              ("a2", 1, "action", "Duyệt yêu cầu,\nchuyển thành đơn đặt hàng"),
              ("a3", 1, "action", "Trình duyệt và duyệt\nđơn đặt hàng"), ("a4", 1, "action", "Gửi đơn cho nhà cung cấp"),
              ("a5", 2, "action", "Tạo liên kết cổng nhà cung cấp,\nghi sự kiện vào outbox"),
              ("a6", 3, "action", "Xác nhận đơn đặt hàng"), ("a7", 3, "action", "Gửi hóa đơn giao hàng"),
              ("a8", 1, "action", "Lập phiếu nhập nháp từ hóa đơn,\ngiao nhân viên kiểm đếm"),
              ("a9", 0, "action", "Kiểm đếm hàng thực nhận"), ("a10", 1, "action", "Ghi sổ phiếu nhập"),
              ("a11", 2, "action", "Cộng tồn, ghi biến động kho,\ncập nhật trạng thái đơn"),
              ("d1", 2, "decision", "Thực nhận ít hơn hóa đơn?"),
              ("a12", 2, "action", "Sinh báo cáo thiếu hàng"),
              ("a13", 1, "action", "Gửi báo cáo cho nhà cung cấp"),
              ("a14", 3, "action", "Xác nhận và gửi hóa đơn giao bù\nhoặc báo không thể giao"),
              ("m1", 2, "merge", ""), ("a15", 2, "action", "Tạo công việc xếp kệ\nkèm gợi ý vị trí"),
              ("a16", 0, "action", "Quét vị trí và sách,\nxác nhận xếp kệ"),
              ("a17", 2, "action", "Cập nhật tồn theo vị trí"), ("e1", 2, "end", "")],
             [("s", "a1", ""), ("a1", "a2", ""), ("a2", "a3", ""), ("a3", "a4", ""), ("a4", "a5", ""), ("a5", "a6", ""),
              ("a6", "a7", ""), ("a7", "a8", ""), ("a8", "a9", ""), ("a9", "a10", ""), ("a10", "a11", ""), ("a11", "d1", ""),
              ("d1", "a12", "có"), ("d1", "m1", "không", "R>R"), ("a12", "a13", ""), ("a13", "a14", ""), ("a14", "m1", ""),
              ("m1", "a15", ""), ("a15", "a16", ""), ("a16", "a17", ""), ("a17", "e1", "")],
             weights=[0.9, 1.05, 1.15, 1], note="Hình 3.2")

    # 3.3
    activity("activity-ai-cataloging-dd", "Sơ đồ hoạt động quy trình biên mục sách có hỗ trợ AI",
             "Quản lý kho nhập ISBN, AI Service lấy và hợp nhất metadata từ các nguồn, Inventory Service tạo bản nháp đối soát, quản lý kho duyệt và áp dụng.",
             ["Quản lý kho", "AI Service", "Nguồn metadata", "Inventory Service"],
             [("s", 0, "start", ""), ("a1", 0, "action", "Nhập hoặc quét ISBN"),
              ("a2", 1, "action", "Chuẩn hóa, kiểm tra\ntổng kiểm tra ISBN"),
              ("a3", 2, "action", "Trả dữ liệu từ\nGoogle Books, Open Library"),
              ("a4", 1, "action", "Đo độ đầy đủ từng trường"),
              ("d1", 1, "decision", "Thiếu trường quan trọng\nhoặc xung đột?"),
              ("a5", 2, "action", "Trả dữ liệu từ nhà sách\ntrong nước, tìm kiếm web"),
              ("m1", 1, "merge", ""),
              ("a6", 1, "action", "Hợp nhất bằng chứng theo trường\n(giá trị, độ tin cậy, nguồn gốc, xung đột)"),
              ("a7", 1, "action", "Sinh tóm tắt tiếng Việt"),
              ("a8", 3, "action", "Tạo bản nháp đối soát metadata"),
              ("a9", 3, "action", "Chuẩn hóa tác giả, nhà xuất bản,\nthể loại; kiểm tra trùng lặp"),
              ("a10", 0, "action", "Duyệt từng trường\n(chấp nhận, từ chối, sửa)"),
              ("a11", 0, "action", "Chọn cách xử lý trùng lặp"), ("a12", 0, "action", "Áp dụng"),
              ("a13", 3, "action", "Ghi các trường được chấp nhận\ntrong một giao dịch, lưu nguồn gốc"),
              ("e1", 3, "end", "")],
             [("s", "a1", ""), ("a1", "a2", ""), ("a2", "a3", ""), ("a3", "a4", ""), ("a4", "d1", ""),
              ("d1", "a5", "có", "R>T"), ("d1", "m1", "không", "L>L"), ("a5", "m1", ""), ("m1", "a6", ""), ("a6", "a7", ""),
              ("a7", "a8", ""), ("a8", "a9", ""), ("a9", "a10", ""), ("a10", "a11", ""), ("a11", "a12", ""), ("a12", "a13", ""),
              ("a13", "e1", "")],
             weights=[0.95, 1.25, 0.9, 1.1], note="Hình 3.3")

    # 3.4
    activity("activity-ai-decision-support-dd", "Sơ đồ hoạt động quy trình hỗ trợ ra quyết định với trợ lý AI",
             "Quản lý kho đặt câu hỏi, AI Service gọi công cụ lặp đến khi đủ dữ liệu, mô hình sinh câu trả lời được kiểm tra căn cứ, hành động đề xuất chờ xác nhận trước khi thực thi.",
             ["Quản lý kho", "AI Service", "Mô hình ngôn ngữ", "Analytics Service"],
             [("s", 0, "start", ""), ("a1", 0, "action", "Đặt câu hỏi bằng tiếng Việt"),
              ("a2", 1, "action", "Kiểm tra vai trò,\nnạp ngữ cảnh hội thoại"), ("m1", 1, "merge", ""),
              ("a3", 2, "action", "Chọn công cụ và tham số"),
              ("a4", 1, "action", "Gọi công cụ qua API Gateway\nbằng JWT của người hỏi"),
              ("a5", 3, "action", "Tính KPI, dự báo,\nđề xuất, rủi ro"),
              ("a6", 1, "action", "Đưa kết quả vào ngữ cảnh"), ("d1", 1, "decision", "Cần thêm dữ liệu?"),
              ("a7", 2, "action", "Sinh câu trả lời"), ("a8", 1, "action", "Kiểm tra căn cứ số liệu"),
              ("d2", 1, "decision", "Có số không có căn cứ?"), ("a9", 2, "action", "Sinh lại một lần"),
              ("m2", 1, "merge", ""),
              ("a10", 1, "action", "Trả lời kèm bằng chứng,\ncông cụ đã gọi, lưu hội thoại"),
              ("d3", 0, "decision", "Yêu cầu thực hiện hành động?"),
              ("a11", 1, "action", "Tạo hành động chờ xác nhận\n(mức rủi ro, thời hạn)"),
              ("a12", 0, "action", "Xác nhận hoặc hủy"),
              ("a13", 1, "action", "Thực thi qua API nghiệp vụ,\nghi nhật ký vòng đời"),
              ("m3", 0, "merge", ""), ("e1", 1, "end", "")],
             [("s", "a1", ""), ("a1", "a2", ""), ("a2", "m1", ""), ("m1", "a3", ""), ("a3", "a4", ""), ("a4", "a5", ""),
              ("a5", "a6", ""), ("a6", "d1", ""), ("d1", "m1", "có", "L>L"), ("d1", "a7", "không"), ("a7", "a8", ""),
              ("a8", "d2", ""), ("d2", "a9", "có"), ("d2", "m2", "không", "L>L"), ("a9", "m2", ""), ("m2", "a10", ""),
              ("a10", "d3", ""), ("d3", "a11", "có"), ("d3", "m3", "không", "L>L"), ("a11", "a12", ""), ("a12", "a13", ""),
              ("a13", "m3", ""), ("m3", "e1", "")],
             weights=[1.2, 1.3, 0.85, 0.85], note="Hình 3.4")
