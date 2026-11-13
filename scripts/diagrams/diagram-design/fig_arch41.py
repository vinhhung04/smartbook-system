"""Hình 4.1 — Kiến trúc tổng thể (faithful redraw of docs/diagrams/drawio/architecture-system-overview.drawio)."""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from arch import Fig

OUT = pathlib.Path(sys.argv[1])
V, M = False, True
f = Fig("architecture-system-overview-dd")

# Lớp trình bày
f.zone(64, 40, 672, 128, "Lớp trình bày")
f.box(80, 72, 204, 80, "Website công khai", [("(tra cứu không cần", V), ("đăng nhập)", V)], "input")
f.box(298, 72, 204, 80, "Ứng dụng web React", [("nhân viên · cổng bạn đọc ·", V), ("cổng NCC", V)], "input")
f.box(516, 72, 204, 80, "Ứng dụng di động Expo", [("bạn đọc · nhân viên kho", V)], "input")
# Caddy, Gateway
f.arrow("M 400 168 V 215", "link"); f.label(412, 182, [("HTTPS / WSS", M)], "#2f5597")
f.box(244, 216, 312, 56, "Caddy 2 – HTTPS, Let's Encrypt", [("(chỉ ở production)", V)])
f.arrow("M 400 272 V 315", "call"); f.label(412, 284, [("reverse proxy", V)])
f.box(176, 316, 448, 64, "API Gateway (Express, http-proxy-middleware)", [("giới hạn tần suất · Socket.IO · tiêu thụ sự kiện RabbitMQ", V)], "focal")
f.arrow("M 400 380 V 435", "link"); f.label(412, 398, [("HTTP theo tiền tố đường dẫn, kèm JWT", V)], "#2f5597")
# Lớp dịch vụ
f.zone(64, 436, 672, 212, "Lớp dịch vụ (mỗi service một cơ sở dữ liệu)")
f.box(80, 468, 204, 76, "Auth Service", [("JWT, RBAC, OTP email,", V), ("phạm vi kho", V)])
f.box(298, 468, 204, 76, "Inventory Service", [("danh mục, kho vận,", V), ("mua hàng, outbox", V)])
f.box(516, 468, 204, 76, "Borrow Service", [("lưu thông, phí phạt,", V), ("VNPay, thông báo", V)])
f.box(189, 556, 204, 76, "Analytics Service", [("dự báo, đề xuất nhập,", V), ("rủi ro (đọc chỉ-đọc)", V)])
f.box(407, 556, 204, 76, "AI Service (FastAPI)", [("Copilot, OCR, ISBN,", V), ("RAG, gợi ý sách", V)])
# Lớp dữ liệu (phải) và dịch vụ ngoài (trái)
f.arrow("M 520 648 V 703", "call"); f.label(532, 664, [("Prisma / pg / asyncpg", V)])
f.arrow("M 172 648 V 703", "link"); f.label(184, 664, [("HTTPS ra ngoài", V)], "#2f5597")
f.zone(304, 704, 432, 196, "Lớp dữ liệu (mạng nội bộ)")
f.box(320, 736, 400, 60, "PostgreSQL 15 + pgvector", [("auth_db · inventory_db · borrow_db · ai_db", M)], "store")
f.box(320, 808, 192, 76, "Redis 7", [("thu hồi token,", V), ("refresh token, bộ nhớ đệm", V)], "store")
f.box(528, 808, 192, 76, "RabbitMQ 3.13", [("sự kiện tích hợp", V), ("(Transactional Outbox)", V)], "store")
f.zone(64, 704, 216, 340, "Dịch vụ bên ngoài")
f.box(80, 736, 184, 76, "OpenRouter (Qwen):", [("hội thoại, công cụ,", V), ("thị giác, nhúng", V)], "external")
f.box(80, 824, 184, 60, "Google Books,", [("Open Library, nhà sách", V)], "external")
f.box(80, 896, 184, 60, "Máy chủ SMTP", [("(OTP, đặt lại mật khẩu)", V)], "external")
f.box(80, 968, 184, 44, "VNPay (sandbox)", [], "external")
f.note(304, 916, 432, [("Prometheus + Grafana: profile monitoring tùy chọn", V),
                       ("ở môi trường phát triển; production dùng", V),
                       ("healthcheck, healthcheck.sh và log Docker.", V)])
# RabbitMQ → Gateway: sự kiện outbox → Socket.IO (dashed, right gutter outside every zone)
f.arrow("M 720 846 H 744 Q 752 846 752 838 V 356 Q 752 348 744 348 H 625", "call", dashed=True)
f.label(684, 306, [("sự kiện outbox", V), ("→ Socket.IO", V)], anchor="middle")
f.legend(1088, [("input", "Máy khách"), ("backend", "Dịch vụ"), ("focal", "Điểm vào duy nhất"), ("store", "Lưu trữ"), ("external", "Dịch vụ ngoài")])
f.legend(1116, [("link", "HTTP(S)"), ("call", "Truy cập dữ liệu, proxy"), ("dash", "Sự kiện bất đồng bộ")], rule=False)
f.write(OUT / "architecture-system-overview-dd.html", 1144,
        "Kiến trúc tổng thể của hệ thống SmartBook",
        "Ba ứng dụng khách đi qua Caddy và API Gateway tới năm dịch vụ, mỗi dịch vụ một cơ sở dữ liệu trong PostgreSQL; Redis, RabbitMQ và các dịch vụ bên ngoài hỗ trợ, sự kiện outbox quay về Gateway qua Socket.IO.",
        "Kiến trúc tổng thể của hệ thống SmartBook", "Architecture · Diagram Design · SmartBook",
        '<p class="note">Nguồn: <code>docs/diagrams/drawio/architecture-system-overview.drawio</code> (Hình 4.1), vẽ lại ở mức faithful.</p>')
