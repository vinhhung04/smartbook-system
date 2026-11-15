"""Thesis figures 1.1 and 2.1–2.6 redrawn in the SmartBook Diagram Design style.
Content transcribed verbatim from the original PlantUML images in the report.
usage: python fig_ch2.py <designed_dir>   (writes into architecture/, sequence/, activity/)"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from dd import C, t, r4, tw
from arch import Fig, TREAT
from seqauto import SeqDiagram
from fig_activity import activity

ROOT = pathlib.Path(sys.argv[1])
EY = "Diagram Design · SmartBook"


def tbox(f, x, y, w, h, lines, kind="backend"):
    """box whose text lines are (text, size, bold, mono)"""
    fill, stroke, sw, dash = TREAT[kind]
    f.used.add(kind)
    out = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="{C["paper"]}"/>',
           f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{dash}/>']
    hs = [17 if s >= 13 else 16 for _, s, _, _ in lines]
    top = y + h / 2 - sum(hs) / 2
    for (txt, size, bold, mono), lh in zip(lines, hs):
        out.append(t(x + w / 2, top + lh - 4, txt, size, mono, C["ink"], weight="700" if bold else None))
        if tw(txt, size, mono, bold) + 12 > w:
            f.warn.append(f"text too wide: {txt}")
        top += lh
    f.N.append("\n".join(out))


def actor(f, cx, top, lines):
    c = C["soft"]
    out = [f'<circle cx="{cx}" cy="{top + 10}" r="10" fill="#ffffff" stroke="{c}" stroke-width="1.4"/>',
           f'<path d="M {cx} {top + 20} V {top + 44} M {cx - 16} {top + 28} H {cx + 16} M {cx} {top + 44} L {cx - 12} {top + 60} M {cx} {top + 44} L {cx + 12} {top + 60}" fill="none" stroke="{c}" stroke-width="1.4"/>']
    for i, (s, size, bold) in enumerate(lines):
        out.append(t(cx, top + 78 + 16 * i, s, size, False, C["ink"], weight="700" if bold else None))
    f.N.append("\n".join(out))


def line(f, d, dot=None):
    f.A.append(f'<path d="{d}" fill="none" stroke="{C["muted"]}" stroke-width="1.2"/>')
    if dot:
        f.A.append(f'<circle cx="{dot[0]}" cy="{dot[1]}" r="2.5" fill="{C["muted"]}"/>')


def vhop(x, y):
    """vertical segment hop (bulging right) over a horizontal line at y"""
    return f"V {y - 6} A 6 6 0 0 0 {x} {y + 6}"


# ---------------------------------------------------------------- 1.1
def fig_1_1():
    f = Fig("overview-subsystems-actors-dd")
    names = [["Khách hàng"], ["Thủ thư"], ["Nhân viên kho"], ["Quản lý kho"], ["Quản trị", "hệ thống"], ["Nhà cung cấp"]]
    xs = [100, 217, 334, 451, 568, 684]
    X = 392                                    # spine: web, gateway, PostgreSQL
    for x, nm in zip(xs, names):
        actor(f, x, 40, [(s, 13, True) for s in nm])
        line(f, f"M {x} 150 V 164")
    line(f, f"M {xs[0]} 164 H {xs[-1]}", dot=(X, 164))
    f.arrow(f"M {X} 164 V 210")
    f.zone(40, 180, 704, 324, "Hệ thống SmartBook")
    tbox(f, X - 120, 212, 240, 56, [("Ứng dụng web (React)", 14, True, False), ("Ứng dụng di động (Expo)", 14, True, False)])
    f.arrow(f"M {X} 268 V 298")
    tbox(f, X - 140, 300, 280, 56, [("API Gateway", 14, True, False), ("định tuyến • xác thực • Socket.IO", 12, False, False)])
    svc = [("Analytics Service", ["KPI, dự báo nhu cầu,", "mô hình rủi ro"], "backend"),
           ("Borrow Service", ["lưu thông, hội viên,", "phí phạt, VNPay"], "backend"),
           ("Auth Service", ["tài khoản, vai trò,", "quyền"], "backend"),
           ("AI Service", ["trợ lý ra quyết định,", "trích xuất thông", "tin sách"], "focal"),
           ("Inventory Service", ["danh mục, kho vận,", "mua hàng,", "nhà cung cấp"], "backend")]
    SW = 128
    sx = [52, 190, 328, 466, 604]
    c = [x + SW / 2 for x in sx]
    line(f, f"M {X} 356 V 376", dot=(X, 376))
    line(f, f"M {c[0]} 376 H {c[-1]}")
    for x, (nm, subs, kind) in zip(sx, svc):
        f.arrow(f"M {x + SW / 2} 376 V 402")
        tbox(f, x, 404, SW, 80, [(nm, 13, True, False)] + [(s, 12, False, False) for s in subs], kind)
    # services -> PostgreSQL (shared trunk), Analytics read-only
    for cc in c:
        line(f, f"M {cc} 484 V 528")
    line(f, f"M {c[0]} 528 H {c[-1]}", dot=(X, 528))
    f.arrow(f"M {X} 528 V 566")
    f.label(c[0] + 8, 494, [("chỉ đọc", False)])
    tbox(f, X - 92, 568, 184, 64, [("PostgreSQL + pgvector", 13, True, False), ("auth_db • inventory_db", 12, False, True),
                                   ("borrow_db • ai_db", 12, False, True)], "store")
    # external / asynchronous
    f.arrow(f"M 226 484 {vhop(226, 528)} V 566", dashed=True)
    tbox(f, 171, 568, 110, 44, [("Cổng VNPay", 13, True, False)], "external")
    f.arrow(f"M 576 484 {vhop(576, 528)} V 566", dashed=True)
    tbox(f, 502, 568, 148, 56, [("OpenRouter (Qwen)", 13, True, False), ("Nguồn metadata sách", 12, False, False)], "external")
    f.arrow("M 704 484 V 566", dashed=True)
    tbox(f, 660, 568, 88, 56, [("RabbitMQ", 13, True, False), ("(outbox)", 12, False, False)], "store")
    f.arrow(f"M 748 596 Q 756 596 756 588 V 336 Q 756 328 748 328 H {X + 142}", dashed=True)
    f.legend(684, [("backend", "thành phần nội bộ"), ("focal", "phân hệ AI"), ("store", "lưu trữ, hàng đợi"),
                   ("external", "dịch vụ ngoài"), ("dash", "bất đồng bộ, bên ngoài")])
    f.write(ROOT / "architecture" / f"{f.slug}.html", 712, "Tổng quan các phân hệ và nhóm người dùng của hệ thống SmartBook",
            "Sáu nhóm người dùng truy cập ứng dụng web và di động, đi qua API Gateway tới năm service, PostgreSQL, RabbitMQ và các dịch vụ bên ngoài.",
            "Tổng quan các phân hệ và nhóm người dùng của hệ thống SmartBook", "Architecture · " + EY,
            '<p class="note">Chép từ Hình 1.1 của báo cáo. Sáu tác nhân và năm service nối qua đường trục chung (orthogonal) thay cho các mũi tên chéo; mọi quan hệ giữ nguyên.</p>')


# ---------------------------------------------------------------- 2.1
def fig_2_1():
    f = Fig("microservices-gateway-pattern-dd")
    tbox(f, 280, 40, 240, 56, [("Client", 14, True, False), ("(trình duyệt, ứng dụng di động)", 12, False, False)], "input")
    f.arrow("M 400 96 V 150")
    f.label(408, 114, [("HTTP / WebSocket", True)])
    tbox(f, 240, 152, 320, 88, [("API Gateway", 14, True, False), ("• định tuyến theo tiền tố đường dẫn", 12, False, False),
                                ("• CORS, xác thực sơ bộ", 12, False, False), ("• che giấu cấu trúc nội bộ", 12, False, False)])
    A, BR, B, Cc = (40, 112), (216, 128), (408, 112), (648, 112)
    cx = lambda b: b[0] + b[1] / 2
    line(f, "M 400 240 V 264", dot=(400, 264))
    line(f, f"M {cx(A)} 264 H {cx(Cc)}")
    for b in (A, B, Cc):
        f.arrow(f"M {cx(b)} 264 V 302")
        f.label(cx(b) + 8, 272, [("REST", True)])
    tbox(f, A[0], 304, A[1], 48, [("Service A", 14, True, False)])
    tbox(f, BR[0], 304, BR[1], 48, [("Message broker", 13, True, False)], "store")
    tbox(f, B[0], 304, B[1], 48, [("Service B", 14, True, False)])
    tbox(f, Cc[0], 304, Cc[1], 48, [("Service C", 14, True, False)])
    f.arrow(f"M {A[0] + A[1]} 328 H {BR[0] - 2}", dashed=True)
    f.label((A[0] + A[1] + BR[0]) / 2, 306, [("sự kiện", False)], anchor="middle")
    f.arrow(f"M {BR[0] + BR[1]} 328 H {B[0] - 2}", dashed=True)
    f.label((BR[0] + BR[1] + B[0]) / 2, 306, [("sự kiện", False)], anchor="middle")
    f.arrow(f"M {B[0] + B[1]} 328 H {Cc[0] - 2}", dashed=True)
    f.label((B[0] + B[1] + Cc[0]) / 2, 336, [("REST nội bộ", False), ("(khóa dịch vụ)", False)], anchor="middle")
    for b, nm in ((A, "CSDL A"), (B, "CSDL B"), (Cc, "CSDL C")):
        f.arrow(f"M {cx(b)} 352 V 398")
        tbox(f, b[0], 400, b[1], 44, [(nm, 14, True, False)], "store")
    f.legend(484, [("call", "gọi đồng bộ"), ("dash", "sự kiện, gọi nội bộ"), ("store", "lưu trữ, broker")])
    f.write(ROOT / "architecture" / f"{f.slug}.html", 528, "Mô hình kiến trúc microservices với API Gateway và cơ sở dữ liệu riêng cho từng service",
            "Client gọi API Gateway qua HTTP/WebSocket; Gateway định tuyến REST tới các service, mỗi service có CSDL riêng; Service A phát sự kiện qua message broker tới Service B; Service B gọi REST nội bộ tới Service C.",
            "Mô hình kiến trúc microservices với API Gateway và cơ sở dữ liệu riêng cho từng service", "Architecture · " + EY,
            '<p class="note">Chép từ Hình 2.1 của báo cáo; bố cục chuyển sang ngang để vừa trang, giữ nguyên các thành phần và quan hệ.</p>')


# ---------------------------------------------------------------- 2.3
def fig_2_3():
    f = Fig("dss-components-mapping-dd")
    actor(f, 400, 40, [("Người ra quyết định", 13, True), ("(quản lý kho, quản trị)", 12, False)])
    line(f, "M 400 140 V 156", dot=(400, 156))
    line(f, "M 250 156 H 550")
    f.zone(40, 168, 720, 96, "Thành phần hội thoại")
    f.arrow("M 250 156 V 198")
    f.arrow("M 550 156 V 198")
    tbox(f, 140, 200, 220, 52, [("Trợ lý AI trò chuyện", 14, True, False), ("(LLM gọi công cụ)", 12, False, False)], "focal")
    tbox(f, 440, 200, 220, 52, [("Bảng điều khiển,", 14, True, False), ("trung tâm hành động", 12, False, False)])
    f.zone(40, 284, 720, 240, "Thành phần mô hình")
    # conversation -> models, channel y=274
    f.arrow("M 216 252 V 334")
    f.arrow("M 300 252 V 266 Q 300 274 308 274 H 364 Q 372 274 372 282 V 334")
    f.arrow("M 500 252 V 266 Q 500 274 492 274 H 436 Q 428 274 428 282 V 334")
    f.arrow("M 600 252 V 266 Q 600 274 608 274 H 646 Q 654 274 654 282 V 334")
    tbox(f, 56, 336, 180, 52, [("Mô hình rủi ro", 14, True, False), ("(hồi quy logistic)", 12, False, False)])
    tbox(f, 276, 336, 248, 52, [("Dự báo nhu cầu", 14, True, False), ("(EWMA + xu hướng + mùa vụ)", 12, False, False)])
    tbox(f, 564, 336, 180, 52, [("Thanh lọc,", 14, True, False), ("phân bổ ngân sách", 14, True, False)])
    f.arrow("M 356 388 V 430", dashed=True)
    tbox(f, 256, 432, 200, 52, [("Chính sách tồn kho", 14, True, False), ("(tồn kho an toàn, lead time)", 12, False, False)])
    f.zone(40, 556, 720, 84, "Thành phần dữ liệu")
    # models -> data, channel y=540
    f.arrow("M 146 388 V 532 Q 146 540 154 540 H 292 Q 300 540 300 548 V 582")
    f.arrow("M 480 388 V 582")
    f.arrow("M 356 484 V 532 Q 356 540 364 540 H 432 Q 440 540 440 548 V 582")
    f.arrow("M 654 388 V 532 Q 654 540 646 540 H 528 Q 520 540 520 548 V 582")
    tbox(f, 220, 584, 160, 40, [("borrow_db", 13, True, True)], "store")
    tbox(f, 420, 584, 160, 40, [("inventory_db", 13, True, True)], "store")
    f.legend(680, [("focal", "thành phần trọng tâm"), ("store", "cơ sở dữ liệu"), ("call", "sử dụng"), ("dash", "suy ra")])
    f.write(ROOT / "architecture" / f"{f.slug}.html", 720, "Ba thành phần của hệ hỗ trợ ra quyết định và cách ánh xạ vào SmartBook",
            "Người ra quyết định dùng trợ lý AI và bảng điều khiển; hai thành phần này dùng mô hình rủi ro, dự báo nhu cầu và thanh lọc ngân sách; các mô hình đọc borrow_db và inventory_db.",
            "Ba thành phần của hệ hỗ trợ ra quyết định và cách ánh xạ vào SmartBook", "Architecture · " + EY,
            '<p class="note">Chép từ Hình 2.3 của báo cáo; giữ nguyên ba nhóm thành phần và chín quan hệ.</p>')


# ---------------------------------------------------------------- 2.2 / 2.4 (sequence)
def seqs():
    nl = lambda p: tuple([p[0], p[1].replace('|', chr(10))] + list(p[2:]))
    out = ROOT / "sequence"
    SV = ("SV", "Service|nghiệp vụ", "")
    DB = ("DB", "CSDL (nghiệp vụ|+ outbox)", "", "store")
    PUB = ("PUB", "Tác vụ|phát sự kiện", "")
    MQ = ("MQ", "Message|broker", "", "store")
    CON = ("CON", "Service|tiêu thụ", "")
    ev = [("msg", "SV", "DB", "BEGIN", "call"), ("msg", "SV", "DB", "cập nhật dữ liệu nghiệp vụ", "call"),
          ("msg", "SV", "DB", "ghi sự kiện vào outbox", "call"), ("msg", "SV", "DB", "COMMIT", "call"),
          ("note", "DB", "dữ liệu và sự kiện\ncùng thành công\nhoặc cùng thất bại"),
          ("frame", "loop", "định kỳ"),
          ("msg", "PUB", "DB", "đọc sự kiện chưa phát", "call"), ("msg", "PUB", "MQ", "publish", "call"),
          ("frame", "alt", "thành công"), ("msg", "PUB", "DB", "đánh dấu đã phát", "call"),
          ("else", "thất bại"), ("msg", "PUB", "DB", "tăng số lần thử", "call"), ("end",), ("end",),
          ("msg", "MQ", "CON", "giao sự kiện", "call"), ("self", "CON", "kiểm tra inbox,\nbỏ qua sự kiện trùng")]
    SeqDiagram("transactional-outbox-pattern-dd", [nl(p) for p in (SV, DB, PUB, MQ, CON)], ev,
               title="Mẫu Transactional Outbox bảo đảm sự kiện không bị mất khi phát bất đồng bộ",
               desc="Service ghi dữ liệu và sự kiện outbox trong cùng giao dịch; tác vụ phát định kỳ đọc outbox, publish lên broker, đánh dấu hoặc tăng số lần thử; service tiêu thụ kiểm tra inbox để bỏ trùng.").write(
        out / "transactional-outbox-pattern-dd.html", "Mẫu Transactional Outbox bảo đảm sự kiện không bị mất khi phát bất đồng bộ",
        '<p class="note">Chép nguyên văn từ Hình 2.2 của báo cáo.</p>', "Sequence · " + EY)
    U = ("U", "Người dùng", "", "input")
    TL = ("TL", "Trợ lý AI (điều phối)", "")
    LM = ("LM", "Mô hình ngôn ngữ", "")
    TO = ("TO", "Công cụ phân tích", "")
    ev = [("msg", "U", "TL", "câu hỏi", "call"), ("msg", "TL", "LM", "câu hỏi + mô tả công cụ", "call"),
          ("frame", "loop", "tối đa N vòng"),
          ("msg", "LM", "TL", "yêu cầu gọi công cụ", "return"), ("msg", "TL", "TO", "thực thi (JWT người dùng)", "call"),
          ("msg", "TO", "TL", "kết quả JSON", "return"), ("msg", "TL", "LM", "đưa kết quả vào ngữ cảnh", "call"), ("end",),
          ("msg", "LM", "TL", "câu trả lời", "return"), ("self", "TL", "kiểm tra căn cứ\ncác con số"),
          ("frame", "alt", "có số không có căn cứ"),
          ("msg", "TL", "LM", "yêu cầu sinh lại", "call"), ("msg", "LM", "TL", "câu trả lời mới", "return"), ("end",),
          ("msg", "TL", "U", "trả lời + bằng chứng\n+ công cụ đã gọi", "return")]
    SeqDiagram("ai-tool-calling-loop-dd", [U, TL, LM, TO], ev,
               title="Vòng lặp gọi công cụ của trợ lý AI và bước kiểm tra căn cứ số liệu",
               desc="Trợ lý gửi câu hỏi và mô tả công cụ cho mô hình, lặp gọi công cụ phân tích bằng JWT người dùng, kiểm tra căn cứ các con số và yêu cầu sinh lại khi cần.").write(
        out / "ai-tool-calling-loop-dd.html", "Vòng lặp gọi công cụ của trợ lý AI và bước kiểm tra căn cứ số liệu",
        '<p class="note">Chép nguyên văn từ Hình 2.4 của báo cáo.</p>', "Sequence · " + EY)


# ---------------------------------------------------------------- 2.5 / 2.6 (activity, no lanes)
def flows():
    out = ROOT / "activity"
    activity("hybrid-retrieval-confidence-dd", "Quy trình truy xuất lai có đánh giá độ tin cậy trước khi sinh câu trả lời",
             "Câu hỏi được tìm song song theo ngữ nghĩa và toàn văn, hợp nhất thứ hạng, đánh giá độ tin cậy rồi trả lời từ chối hoặc sinh câu trả lời có dẫn nguồn.",
             None,
             [("s", 0, "start", ""), ("a1", 0, "action", "Câu hỏi của người dùng"), ("f1", 0, "bar", "", {"w": 440}),
              ("b1", 0, "action", "Nhúng câu hỏi thành véc-tơ", {"dx": -120}),
              ("c1", 0, "action", "Chuẩn hóa, bỏ dấu tiếng Việt", {"dx": 120, "with": "b1"}),
              ("b2", 0, "action", "Tìm kiếm ngữ nghĩa\n(cosine, chỉ mục HNSW)", {"dx": -120}),
              ("c2", 0, "action", "Tìm kiếm toàn văn\n(từ khóa)", {"dx": 120, "with": "b2"}),
              ("j1", 0, "bar", "", {"w": 440}), ("a2", 0, "action", "Hợp nhất thứ hạng (RRF)"),
              ("a3", 0, "action", "Đánh giá độ tin cậy truy xuất\n(điểm chuẩn hóa, đồng thuận hai nhánh, luật khớp tuyệt đối)"),
              ("d1", 0, "decision", "Mức tin cậy?"),
              ("l1", 0, "action", "Trả lời \"chưa đủ thông tin\ntrong dữ liệu nội bộ\"", {"dx": -140}),
              ("r1", 0, "action", "Đưa tài liệu vào ngữ cảnh\n(đánh dấu nếu chưa chắc chắn)", {"dx": 140, "with": "l1"}),
              ("e1", 0, "end", "", {"dx": -140}),
              ("r2", 0, "action", "LLM sinh câu trả lời có dẫn nguồn", {"dx": 140, "with": "e1"}),
              ("e2", 0, "end", "", {"dx": 140})],
             [("s", "a1", ""), ("a1", "f1", ""), ("f1", "b1", ""), ("f1", "c1", ""), ("b1", "b2", ""), ("c1", "c2", ""),
              ("b2", "j1", ""), ("c2", "j1", ""), ("j1", "a2", ""), ("a2", "a3", ""), ("a3", "d1", ""),
              ("d1", "l1", "Không có bằng chứng", "L>T"), ("d1", "r1", "Tin cậy / chưa chắc chắn", "R>T"),
              ("l1", "e1", ""), ("r1", "r2", ""), ("r2", "e2", "")],
             note="Hình 2.5", width=640, out=out)
    activity("metadata-evidence-fusion-dd", "Quy trình hợp nhất bằng chứng metadata theo từng trường",
             "Từ ISBN, truy vấn nguồn có cấu trúc, bổ sung nguồn khi thiếu hoặc xung đột, chuẩn hóa, gom nhóm, tính độ hỗ trợ noisy-OR, chọn nhóm mạnh nhất và để con người duyệt.",
             None,
             [("s", 0, "start", ""), ("a1", 0, "action", "Nhận ISBN, kiểm tra tổng kiểm tra"),
              ("a2", 0, "action", "Truy vấn nguồn có cấu trúc\n(Google Books, Open Library)"),
              ("a3", 0, "action", "Đo độ đầy đủ từng trường"),
              ("d1", 0, "decision", "Trường quan trọng thiếu,\nđộ tin cậy thấp hoặc xung đột?"),
              ("a4", 0, "action", "Gọi thêm nguồn có khả năng bổ sung\n(nhà sách trong nước, tìm kiếm web)\ntrong ngân sách thời gian"),
              ("m1", 0, "merge", ""),
              ("a5", 0, "action", "Chuẩn hóa giá trị\n(bỏ dấu, tiền tố NXB, tách tác giả, năm)"),
              ("a6", 0, "action", "Gom nhóm giá trị tương thích theo từng trường"),
              ("a7", 0, "action", "Tính độ hỗ trợ mỗi nhóm = noisy-OR\n(độ tin cậy nguồn × phương pháp trích xuất)"),
              ("a8", 0, "action", "Chọn nhóm mạnh nhất, tính độ tin cậy,\nphát hiện xung đột"),
              ("a9", 0, "action", "Trả về giá trị + độ tin cậy + ứng viên + nguồn gốc"),
              ("a10", 0, "action", "Con người duyệt từng trường"), ("e1", 0, "end", "")],
             [("s", "a1", ""), ("a1", "a2", ""), ("a2", "a3", ""), ("a3", "d1", ""), ("d1", "a4", "có"),
              ("d1", "m1", "không", "R>R"), ("a4", "m1", ""), ("m1", "a5", ""), ("a5", "a6", ""), ("a6", "a7", ""),
              ("a7", "a8", ""), ("a8", "a9", ""), ("a9", "a10", ""), ("a10", "e1", "")],
             note="Hình 2.6", width=560, out=out)


fig_1_1()
fig_2_1()
fig_2_3()
seqs()
flows()
