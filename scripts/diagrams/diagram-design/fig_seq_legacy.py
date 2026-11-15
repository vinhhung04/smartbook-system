"""Sequence diagrams that existed only as PlantUML images in the thesis (demo4–demo6), transcribed
verbatim from those images and redrawn in the SmartBook Diagram Design style. Step numbers are the
originals'. Figure numbers below are demo6's."""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from seqauto import SeqDiagram

OUT = pathlib.Path(sys.argv[1])
XS6 = [92, 220, 348, 484, 596, 708]

# ---- participants
KH = ("U", "Khách hàng", "CUSTOMER", "input")
TT = ("U", "Thủ thư", "LIBRARIAN", "input")
QL = ("Q", "Quản lý kho", "WAREHOUSE_MANAGER", "input")
NV = ("N", "Nhân viên kho", "WAREHOUSE_STAFF", "input")
NCC = ("S", "Nhà cung cấp", "SUPPLIER", "input")
W = ("W", "Web UI", "apps/web")
WM = ("W", "Web/Mobile", "apps/web · mobile")
G = ("G", "API Gateway", "api-gateway")
B = ("B", "Borrow", "borrow-service")
I = ("I", "Inventory", "inventory-service")
AI = ("AI", "AI Service", "FastAPI")
AN = ("AN", "Analytics", "analytics-service")
BDB = ("BDB", "borrow_db", "PostgreSQL", "store")
IDB = ("IDB", "inventory_db", "PostgreSQL", "store")
ADB = ("ADB", "ai_db", "PostgreSQL", "store")
R = ("R", "Redis", "redis:7", "store")
OR_V = ("OR", "OpenRouter", "mô hình thị giác", "external")
OR_Q = ("OR", "OpenRouter", "Qwen", "external")
OP = ("OP", "Outbox", "publisher")
MQ = ("MQ", "RabbitMQ", "message broker", "store")
EY = "Sequence · Diagram Design · SmartBook"


def note(fig, steps, extra=""):
    return f'<p class="note">{fig}, bước {steps} (chép từ hình gốc của báo cáo, giữ nguyên số bước).{(" " + extra) if extra else ""}</p>'


def make(slug, parts, events, title, desc, h1, html_note, **kw):
    SeqDiagram(slug, parts, events, title=title, desc=desc, **kw).write(OUT / f"{slug}.html", h1, html_note, EY)


# ================================================================ 4.7 Đặt giữ sách
make("borrow-reservation-create-dd-p1", [KH, W, G, B, BDB], [
    ("msg", "U", "W", "1. chọn sách, kho nhận, nhấn \"Đặt giữ\"", "call"),
    ("msg", "W", "G", "2. POST /my/reservations\n`(Idempotency-Key)`", "link"),
    ("msg", "G", "B", "3. chuyển tiếp thành\n`/borrow/my/reservations`", "link"),
    ("msg", "B", "BDB", "4. kiểm tra hội viên còn hiệu lực, giới hạn số lượt mượn và đặt giữ", "call"),
    ("frame", "alt", "[khóa idempotency đã dùng]"),
    ("msg", "B", "W", "5. trả lại phiếu cũ (200)", "return"),
    ("end",),
    ("note", ("G", "B"), "Khóa mới → Phần 2 (bước 6–13)"),
], "Đặt giữ sách, phần 1", "Khách hàng đặt giữ qua API Gateway; Borrow Service kiểm tra hội viên và giới hạn, trả lại phiếu cũ nếu khóa idempotency đã dùng.",
     "Sơ đồ tuần tự đặt giữ sách (1/2)", note("Hình 4.7", "1–5"))
make("borrow-reservation-create-dd-p2", [W, G, B, I, IDB, BDB], [
    ("msg", "B", "I", "6. POST\n`/api/borrow-integration/`\n`reservations/reserve`\n(khóa nội bộ)", "link"),
    ("msg", "I", "IDB", "7. giao dịch: available_qty − n, reserved_qty + n, stock_reservations, stock_movements, outbox", "call"),
    ("msg", "I", "B", "8. đã giữ tồn", "return"),
    ("msg", "B", "BDB", "9. giao dịch: loan_reservations (PENDING, expires_at), borrow_audit_logs, customer_notifications", "call"),
    ("frame", "alt", "[ghi borrow_db thất bại]"),
    ("msg", "B", "I", "10. giải phóng tồn đã giữ (thử lại, sau đó đối soát)", "link"),
    ("msg", "B", "W", "11. 502", "return"),
    ("else", "[thành công]"),
    ("msg", "B", "G", "12. POST /internal/push-event\n(khách hàng, thủ thư)", "link"),
    ("msg", "B", "W", "13. 201 + phiếu đặt giữ", "accent"),
    ("end",),
], "Đặt giữ sách, phần 2", "Borrow Service nhờ Inventory giữ tồn trong một giao dịch, ghi phiếu đặt giữ; nếu ghi borrow_db thất bại thì giải phóng tồn và trả 502, nếu thành công thì đẩy sự kiện và trả 201.",
     "Sơ đồ tuần tự đặt giữ sách (2/2)", note("Hình 4.7", "6–13"), box_w=104, xs=XS6)

# ================================================================ 4.8 Nhận sách bằng mã
make("borrow-pickup-convert-dd", [TT, W, G, B, I, BDB], [
    ("msg", "U", "W", "1. quét QR hoặc nhập mã\n`PU-XXXX-XXXX`", "call"),
    ("msg", "W", "G", "2. POST\n`/borrow/reservations/`\n`pickup/convert-to-loan`", "link"),
    ("msg", "G", "B", "3. chuyển tiếp", "link"),
    ("msg", "B", "BDB", "4. tìm phiếu theo mã, khóa bản ghi", "call"),
    ("self", "B", "5. kiểm tra READY_FOR_PICKUP,\nmã chưa dùng, chưa hết hạn"),
    ("frame", "alt", "[mã đã dùng cho phiếu này]"),
    ("msg", "B", "W", "6. trả về phiếu mượn đã tạo (idempotent)", "return"),
    ("else", "[hợp lệ]"),
    ("msg", "B", "I", "7. POST\n`/api/borrow-integration/`\n`reservations/consume`", "link"),
    ("msg", "I", "B", "8. reserved_qty → borrowed_qty", "return"),
    ("msg", "B", "BDB", "9. tạo loan_transactions, loan_items (hạn trả theo gói)", "call"),
    ("msg", "B", "BDB", "10. phiếu đặt giữ CONVERTED_TO_LOAN, pickup_code_used_at", "call"),
    ("msg", "B", "G", "11. POST /internal/push-event (phòng bạn đọc)", "link"),
    ("msg", "B", "W", "12. phiếu mượn", "accent"),
    ("end",),
], "Nhận sách bằng mã và chuyển thành phiếu mượn", "Thủ thư quét mã nhận sách; Borrow Service khóa phiếu, kiểm tra trạng thái, nhờ Inventory chuyển tồn giữ thành tồn mượn và tạo phiếu mượn.",
     "Sơ đồ tuần tự nhận sách bằng mã và chuyển thành phiếu mượn", note("Hình 4.8", "1–12"), box_w=104, xs=XS6)

# ================================================================ 4.9 Trả sách
make("borrow-loan-return-dd", [TT, W, G, B, I, BDB], [
    ("msg", "U", "W", "1. chọn cuốn trả, ghi tình trạng", "call"),
    ("msg", "W", "G", "2. POST\n`/borrow/loans/{id}/return`", "link"),
    ("msg", "G", "B", "3. chuyển tiếp", "link"),
    ("msg", "B", "BDB", "4. đọc loan_items, gói hội viên", "call"),
    ("self", "B", "5. tính số ngày trễ; phí quá hạn,\nmất, hư hỏng"),
    ("msg", "B", "I", "6. POST\n`/api/borrow-integration/`\n`loans/return` (trừ sách mất)", "link"),
    ("msg", "I", "B", "7. borrowed_qty → available_qty", "return"),
    ("msg", "B", "BDB", "8. cập nhật loan_items, loan_transactions (RETURNED)", "call"),
    ("msg", "B", "BDB", "9. tạo/cập nhật fines, total_fine_balance", "call"),
    ("msg", "B", "BDB", "10. ghi borrow_audit_logs, customer_notifications", "call"),
    ("msg", "B", "W", "11. biên nhận trả sách + phí phạt (nếu có)", "accent"),
], "Trả sách và tính phí phạt", "Thủ thư ghi nhận trả sách; Borrow Service tính phí, nhờ Inventory đưa sách về khả dụng, cập nhật phiếu mượn, khoản phạt, nhật ký và thông báo.",
     "Sơ đồ tuần tự trả sách và tính phí phạt", note("Hình 4.9", "1–11"), box_w=104, xs=XS6)

# ================================================================ 4.11 Đơn đặt hàng
make("inventory-purchase-order-dd-p1", [QL, W, G, I, IDB], [
    ("msg", "Q", "W", "1. lập đơn đặt hàng", "call"),
    ("msg", "W", "G", "2. POST /api/purchase-orders", "link"),
    ("msg", "G", "I", "3. chuyển tiếp", "link"),
    ("msg", "I", "IDB", "4. purchase_orders DRAFT + purchase_order_items", "call"),
    ("msg", "Q", "W", "5. trình duyệt", "call"),
    ("msg", "W", "I", "6. POST\n`/api/purchase-orders/{id}/submit`", "link"),
    ("msg", "I", "IDB", "7. PENDING_APPROVAL", "call"),
    ("msg", "Q", "W", "8. duyệt đơn", "call"),
    ("msg", "W", "I", "9. POST\n`/api/purchase-orders/{id}/approve`", "link"),
    ("msg", "I", "IDB", "10. APPROVED + outbox purchase_order.approved (cùng giao dịch)", "call"),
    ("msg", "Q", "W", "11. gửi nhà cung cấp", "call"),
], "Lập, duyệt và gửi đơn đặt hàng, phần 1", "Quản lý kho lập đơn nháp, trình duyệt và duyệt; Inventory Service ghi trạng thái và sự kiện outbox trong cùng giao dịch.",
     "Sơ đồ tuần tự lập, duyệt và gửi đơn đặt hàng (1/3)", note("Hình 4.11", "1–11"))
make("inventory-purchase-order-dd-p2", [W, I, IDB, OP, MQ], [
    ("msg", "W", "I", "12. POST\n`/api/purchase-orders/{id}/`\n`send-to-supplier`", "link"),
    ("msg", "I", "IDB", "13. supplier_order_dispatches (token), SENT_TO_SUPPLIER + outbox purchase_order.sent", "call"),
    ("msg", "OP", "IDB", "14. đọc sự kiện chưa phát", "call"),
    ("msg", "OP", "MQ", "15. publish", "call"),
], "Lập, duyệt và gửi đơn đặt hàng, phần 2", "Gửi đơn cho nhà cung cấp tạo bản ghi gửi có token và sự kiện outbox; bộ phát outbox đọc sự kiện chưa phát và đẩy lên RabbitMQ.",
     "Sơ đồ tuần tự lập, duyệt và gửi đơn đặt hàng (2/3)", note("Hình 4.11", "12–15"), box_w=128)
make("inventory-purchase-order-dd-p3", [NCC, G, I, IDB], [
    ("msg", "S", "G", "16. POST\n`/api/supplier-account/`\n`orders/{poId}/confirm`", "link"),
    ("msg", "G", "I", "17. chuyển tiếp", "link"),
    ("msg", "I", "IDB", "18. SUPPLIER_CONFIRMED", "accent"),
], "Lập, duyệt và gửi đơn đặt hàng, phần 3", "Nhà cung cấp xác nhận đơn qua API Gateway và Inventory Service ghi trạng thái SUPPLIER_CONFIRMED.",
     "Sơ đồ tuần tự lập, duyệt và gửi đơn đặt hàng (3/3)", note("Hình 4.11", "16–18"))

# ================================================================ 4.12 Nhận hàng và ghi sổ phiếu nhập
make("inventory-goods-receipt-post-dd", [NCC, QL, NV, I, IDB], [
    ("msg", "S", "I", "1. POST\n`/api/supplier-account/orders/{poId}/invoices`", "link"),
    ("msg", "I", "IDB", "2. supplier_delivery_invoices (kiểm tra ≤ số còn lại)", "call"),
    ("msg", "Q", "I", "3. POST\n`/api/supplier-deliveries/{id}/`\n`create-goods-receipt`", "link"),
    ("msg", "I", "IDB", "4. goods_receipts DRAFT + goods_receipt_items", "call"),
    ("msg", "Q", "I", "5. PATCH\n`/api/goods-receipts/{id}/assign`", "link"),
    ("msg", "N", "I", "6. PATCH /api/goods-receipts/{id}\n(số thực nhận, tình trạng)", "link"),
    ("self", "I", "7. chặn nhận vượt\nhóa đơn/đơn hàng"),
    ("msg", "Q", "I", "8. PATCH /api/goods-receipts/{id}\n(status = POSTED)", "link"),
    ("msg", "I", "IDB", "9. giao dịch: stock_balances +, stock_movements IN, cập nhật số đã nhận và trạng thái đơn", "call"),
    ("frame", "alt", "[thực nhận < hóa đơn]"),
    ("msg", "I", "IDB", "10. supplier_shortage_reports", "call"),
    ("end",),
    ("msg", "I", "IDB", "11. outbox goods_receipt.posted", "call"),
    ("msg", "I", "Q", "12. phiếu nhập POSTED, sinh công việc xếp kệ", "accent"),
], "Nhận hàng và ghi sổ phiếu nhập", "Nhà cung cấp gửi hóa đơn giao hàng; quản lý tạo và giao phiếu nhập, nhân viên ghi số thực nhận, quản lý ghi sổ để cộng tồn, ghi thiếu hàng nếu có và sinh công việc xếp kệ.",
     "Sơ đồ tuần tự nhận hàng và ghi sổ phiếu nhập", note("Hình 4.12", "1–12"))

# ================================================================ 4.13 Xếp kệ
make("inventory-putaway-suggestion-dd", [NV, WM, I, R, AI, IDB], [
    ("msg", "N", "W", "1. mở công việc xếp kệ của phiếu nhập", "call"),
    ("msg", "W", "I", "2. POST /api/storage-suggestions", "link"),
    ("msg", "I", "R", "3. đọc bộ nhớ đệm gợi ý", "call"),
    ("frame", "alt", "[chưa có trong bộ nhớ đệm]"),
    ("msg", "I", "IDB", "4. vị trí trống, sức chứa, cùng biến thể/đầu sách/thể loại, lịch sử di chuyển", "call"),
    ("self", "I", "5. chấm điểm quy tắc,\nxếp hạng, mức tin cậy"),
    ("msg", "I", "AI", "6. POST\n`/explain-storage-suggestion`", "link"),
    ("msg", "AI", "I", "7. giải thích bằng ngôn ngữ tự nhiên", "return"),
    ("msg", "I", "R", "8. lưu kết quả", "call"),
    ("end",),
    ("msg", "I", "W", "9. danh sách vị trí gợi ý + giải thích", "return"),
    ("msg", "N", "W", "10. quét mã vị trí và mã sách", "call"),
    ("msg", "W", "I", "11. POST\n`/api/putaway/receipts/{id}/confirm`", "link"),
    ("msg", "I", "IDB", "12. tồn theo vị trí, stock_movements, tiến độ công việc", "call"),
    ("msg", "I", "W", "13. xác nhận", "accent"),
], "Xếp kệ với gợi ý vị trí", "Inventory Service gợi ý vị trí bằng luật chấm điểm, nhờ AI giải thích, lưu bộ nhớ đệm; nhân viên quét vị trí và sách để xác nhận cất hàng.",
     "Sơ đồ tuần tự xếp kệ với gợi ý vị trí", note("Hình 4.13", "1–13"), box_w=104, xs=XS6)

# ================================================================ 4.14 Đóng gói có bằng chứng hình ảnh
make("inventory-packing-evidence-dd-p1", [NV, WM, I, AI, OR_V, IDB], [
    ("msg", "N", "W", "1. quét phiếu xuất", "call"),
    ("msg", "W", "I", "2. POST /api/packing/scan-invoice, nhận việc", "link"),
    ("frame", "loop", "[từng sản phẩm]"),
    ("msg", "N", "W", "3. quét mã sách", "call"),
    ("msg", "W", "I", "4. POST\n`/api/packing/tasks/{id}/`\n`items/scan`", "link"),
    ("msg", "I", "IDB", "5. packing_scan_events", "call"),
    ("end",),
    ("msg", "N", "W", "6. tải ảnh kiện hàng và video", "call"),
    ("msg", "W", "I", "7. POST\n`/api/packing/tasks/{id}/`\n`evidence`", "link"),
    ("msg", "I", "AI", "8. POST /verify-packing-photo\n(ảnh + danh sách sách)", "link"),
    ("msg", "AI", "OR", "9. đọc ảnh, đếm và nhận diện nhan đề", "link"),
    ("msg", "OR", "AI", "10. kết quả", "return"),
    ("msg", "AI", "I", "11. MATCH / MISMATCH + chi tiết", "return"),
    ("msg", "I", "IDB", "12. packing_camera_evidence", "call"),
], "Đóng gói có bằng chứng hình ảnh, phần 1", "Nhân viên quét phiếu xuất và từng sản phẩm, tải ảnh và video kiện hàng; AI Service đối chiếu ảnh với danh sách sách bằng mô hình thị giác và Inventory lưu bằng chứng.",
     "Sơ đồ tuần tự đóng gói có bằng chứng hình ảnh (1/2)", note("Hình 4.14", "1–12"), box_w=104, xs=XS6)
make("inventory-packing-evidence-dd-p2", [NV, WM, I, IDB], [
    ("msg", "N", "W", "13. hoàn tất đóng gói", "call"),
    ("msg", "W", "I", "14. POST\n`/api/packing/tasks/{id}/complete`", "link"),
    ("frame", "alt", "[thiếu video]"),
    ("msg", "I", "W", "15. chặn (quản lý được bỏ qua kèm lý do, ghi nhật ký)", "return"),
    ("else", "[đủ bằng chứng]"),
    ("msg", "I", "IDB", "16. công việc hoàn tất", "accent"),
    ("end",),
], "Đóng gói có bằng chứng hình ảnh, phần 2", "Khi hoàn tất đóng gói, Inventory chặn nếu thiếu video, trừ khi quản lý bỏ qua có lý do, và ghi công việc hoàn tất khi đủ bằng chứng.",
     "Sơ đồ tuần tự đóng gói có bằng chứng hình ảnh (2/2)", note("Hình 4.14", "13–16"))

# ================================================================ 4.15 Biên mục sách với AI
MS = ("MS", "Nguồn metadata", "Google Books, …", "external")
make("ai-metadata-cataloging-dd-p1", [QL, W, AI, MS, I], [
    ("msg", "Q", "W", "1. nhập/quét ISBN", "call"),
    ("msg", "W", "AI", "2. POST /ai/isbn-intelligence\n(qua API Gateway)", "link"),
    ("self", "AI", "3. chuẩn hóa, kiểm tra\ntổng kiểm tra"),
    ("msg", "AI", "MS", "4. truy vấn nguồn có cấu trúc", "link"),
    ("note", ("MS", "I"), "Nguồn metadata: Google Books, Open Library,\nnhà sách, web"),
    ("self", "AI", "5. đo độ đầy đủ\ntừng trường"),
    ("frame", "opt", "[còn trường thiếu, độ tin cậy thấp hoặc xung đột]"),
    ("msg", "AI", "MS", "6. gọi thêm nguồn phù hợp (trong ngân sách thời gian)", "link"),
    ("end",),
    ("self", "AI", "7. hợp nhất bằng chứng\ntheo trường"),
    ("msg", "AI", "I", "8. POST /internal/authority/normalize\n(khóa nội bộ)", "link"),
    ("msg", "I", "AI", "9. AUTO_MATCH / REVIEW_REQUIRED / NEW_ENTITY", "return"),
    ("msg", "AI", "W", "10. giá trị, độ tin cậy, ứng viên, nguồn gốc, xung đột", "return"),
], "Biên mục sách với trích xuất thông tin bằng AI, phần 1", "AI Service chuẩn hóa ISBN, truy vấn nguồn metadata, gọi thêm nguồn khi thiếu, hợp nhất bằng chứng theo trường và chuẩn hóa thực thể qua Inventory.",
     "Sơ đồ tuần tự biên mục sách với trích xuất thông tin bằng AI (1/2)", note("Hình 4.15", "1–10"))
make("ai-metadata-cataloging-dd-p2", [QL, W, I], [
    ("msg", "W", "I", "11. POST /api/metadata-reconciliations\n(bản nháp)", "link"),
    ("msg", "Q", "W", "12. chấp nhận / từ chối / sửa từng trường", "call"),
    ("msg", "W", "I", "13. PATCH\n`/api/metadata-reconciliations/`\n`{id}/fields/{field}`", "link"),
    ("msg", "W", "I", "14. POST\n`/api/duplicate-intelligence/check`", "link"),
    ("msg", "Q", "W", "15. chọn quyết định trùng lặp, nhấn \"Áp dụng\"", "call"),
    ("msg", "W", "I", "16. POST\n`/api/metadata-reconciliations/`\n`{id}/apply`", "link"),
    ("self", "I", "17. ghi các trường ACCEPTED\ntrong một giao dịch"),
], "Biên mục sách với trích xuất thông tin bằng AI, phần 2", "Kết quả được lưu thành bản nháp đối soát; quản lý duyệt từng trường, kiểm tra trùng lặp và áp dụng, Inventory ghi các trường được chấp nhận trong một giao dịch.",
     "Sơ đồ tuần tự biên mục sách với trích xuất thông tin bằng AI (2/2)", note("Hình 4.15", "11–17"))

# ================================================================ 4.17 Tìm sách bằng ảnh bìa
make("ai-find-book-by-cover-dd", [KH, WM, AI, ("ADB", "ai_db", "ai_cover_embeddings", "store"), OR_V, G], [
    ("msg", "U", "W", "1. chụp hoặc tải ảnh bìa", "call"),
    ("msg", "W", "AI", "2. POST /ai/find-book-by-cover", "link"),
    ("msg", "AI", "G", "3. lấy danh mục sách (JWT người dùng)", "link"),
    ("msg", "AI", "ADB", "4. kiểm tra/đồng bộ bộ sưu tập ảnh bìa", "call"),
    ("frame", "par", "[tín hiệu hình ảnh]"),
    ("self", "AI", "5. nhúng ảnh bằng\nCLIP (CPU)"),
    ("msg", "AI", "ADB", "6. so khớp cosine với ảnh bìa đã lập chỉ mục", "call"),
    ("else", "[tín hiệu văn bản]"),
    ("msg", "AI", "OR", "7. đọc nhan đề, tác giả trên bìa", "link"),
    ("msg", "OR", "AI", "8. văn bản OCR", "return"),
    ("self", "AI", "9. so khớp với\ndanh mục"),
    ("end",),
    ("self", "AI", "10. gộp: 0,6 × hình ảnh +\n0,4 × văn bản,\nlọc độ tin cậy ≥ 0,5"),
    ("msg", "AI", "W", "11. ứng viên + độ tin cậy + bằng chứng", "accent"),
], "Tìm sách bằng ảnh bìa", "AI Service lấy danh mục bằng JWT người dùng, so khớp song song tín hiệu hình ảnh CLIP và văn bản OCR, gộp có trọng số và trả ứng viên kèm độ tin cậy.",
     "Sơ đồ tuần tự tìm sách bằng ảnh bìa", note("Hình 4.17", "1–11"), box_w=104, xs=XS6)

# ================================================================ 4.20 Xác nhận hành động do AI đề xuất
SV = ("SV", "Service", "nghiệp vụ")
make("ai-action-confirm-dd", [QL, W, AI, ADB, G, SV], [
    ("msg", "Q", "W", "1. nhấn \"Xác nhận\" trên thẻ hành động", "call"),
    ("msg", "W", "AI", "2. POST /ai/actions/confirm", "link"),
    ("msg", "AI", "ADB", "3. đọc ai_pending_actions", "call"),
    ("self", "AI", "4. kiểm tra còn hạn (TTL\n10 phút) và danh sách cấm"),
    ("msg", "AI", "G", "5. GET /auth/me (vai trò, quyền hiện tại)", "link"),
    ("frame", "alt", "[không đủ quyền / hết hạn]"),
    ("msg", "AI", "W", "6. từ chối (EXPIRED / 403)", "return"),
    ("else", "[hợp lệ]"),
    ("msg", "AI", "ADB", "7. CONFIRMED + audit log", "call"),
    ("msg", "AI", "G", "8. gọi API nghiệp vụ bằng JWT người dùng (ví dụ POST /api/purchase-requests)", "link"),
    ("msg", "G", "SV", "9. chuyển tiếp", "link"),
    ("msg", "SV", "AI", "10. kết quả", "return"),
    ("msg", "AI", "ADB", "11. EXECUTED hoặc FAILED + audit log", "call"),
    ("msg", "AI", "G", "12. POST /internal/push-event (ai_action)", "link"),
    ("msg", "AI", "W", "13. kết quả thực thi", "accent"),
    ("end",),
], "Xác nhận hành động do AI đề xuất", "Quản lý xác nhận hành động; AI Service kiểm tra hạn và quyền hiện tại, rồi gọi API nghiệp vụ bằng JWT người dùng, ghi trạng thái và nhật ký, đẩy sự kiện kết quả.",
     "Sơ đồ tuần tự xác nhận hành động do AI đề xuất", note("Hình 4.20", "1–13"), box_w=104, xs=XS6)

# ================================================================ 4.21 Bản tin tổng hợp hằng đêm
make("ai-nightly-briefing-dd", [("SCH", "Bộ lập lịch", "nightly briefing"), G, AN, OR_Q, ADB, ("Q", "Quản lý kho", "WAREHOUSE_MANAGER", "input")], [
    ("msg", "SCH", "G", "1. 6 lời gọi /analytics/*\n(khóa nội bộ)", "link"),
    ("msg", "G", "AN", "2. quá hạn, phí phạt, rủi ro tồn kho, đề xuất nhập hàng, phễu đặt giữ, gợi ý thanh lý", "link"),
    ("msg", "AN", "SCH", "3. số liệu", "return"),
    ("msg", "SCH", "OR", "4. tóm tắt thành bản tin tiếng Việt", "link"),
    ("msg", "OR", "SCH", "5. bản tin", "return"),
    ("msg", "SCH", "ADB", "6. tạo CREATE_REPORT_DRAFT (rủi ro LOW)", "call"),
    ("msg", "SCH", "G", "7. POST\n`/internal/push-event`", "link"),
    ("divider", "Sáng hôm sau"),
    ("msg", "Q", "ADB", "8. xem bản tin trong Trung tâm hành động AI", "call"),
    ("msg", "Q", "ADB", "9. xác nhận hoặc hủy (luồng xác nhận hành động)", "accent"),
], "Bản tin tổng hợp hằng đêm", "Bộ lập lịch gọi các chỉ số phân tích qua Gateway, nhờ mô hình tóm tắt thành bản tin, lưu thành hành động chờ xác nhận; sáng hôm sau quản lý xem và xác nhận.",
     "Sơ đồ tuần tự bản tin tổng hợp hằng đêm", note("Hình 4.21", "1–9"), box_w=104, xs=XS6)

# ================================================================ 4.22 Nhắc hạn trả theo mức rủi ro
make("borrow-due-reminder-dd", [("TV", "Tác vụ nhắc hạn", "Borrow Service"), AN, BDB, ("KN", "Kênh thông báo", "email, trong ứng dụng", "external")], [
    ("msg", "TV", "AN", "1. GET\n`/analytics/late-return-risk`\n`?dueWithinDays=3`\n(khóa nội bộ)", "link"),
    ("self", "AN", "2. lấy mô hình trong bộ nhớ đệm\nhoặc huấn luyện lại\n(chia theo thời gian)"),
    ("msg", "AN", "BDB", "3. các cuốn sắp đến hạn và đặc trưng", "call"),
    ("msg", "AN", "TV", "4. danh sách xếp theo điểm rủi ro", "return"),
    ("frame", "alt", "[Analytics lỗi]"),
    ("msg", "TV", "BDB", "5. lấy danh sách theo hạn trả (không có điểm rủi ro)", "call"),
    ("end",),
    ("frame", "loop", "[theo thứ tự rủi ro giảm dần]"),
    ("msg", "TV", "BDB", "6. tạo LOAN_DUE_REMINDER (bỏ qua cuốn đã nhắc)", "call"),
    ("msg", "TV", "KN", "7. gửi theo tùy chọn của bạn đọc", "accent"),
    ("end",),
], "Nhắc hạn trả theo mức rủi ro", "Tác vụ nhắc hạn lấy danh sách cuốn sắp đến hạn xếp theo điểm rủi ro trả trễ từ Analytics, dự phòng theo hạn trả khi Analytics lỗi, rồi tạo và gửi nhắc nhở.",
     "Sơ đồ tuần tự nhắc hạn trả theo mức rủi ro", note("Hình 4.22", "1–7"))
