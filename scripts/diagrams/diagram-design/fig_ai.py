import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from seqauto import SeqDiagram

OUT = pathlib.Path(sys.argv[1])
XS6 = [92, 220, 348, 484, 596, 708]
QL = ("Q", "Quản lý kho", "WAREHOUSE_MANAGER", "input")
W = ("W", "Web App", "React · apps/web")
G = ("G", "API Gateway", "api-gateway")
AI = ("AI", "AI Service", "FastAPI")
I = ("I", "Inventory", "inventory-service")
OR = ("OR", "OpenRouter", "Qwen", "external")
LK = ("LK", "Nguồn tra cứu", "ISBN", "external")


def src(name, steps, extra=""):
    return f'<p class="note">Nguồn: <code>docs/diagrams/source/sequence/{name}.mmd</code>, bước {steps}.{(" " + extra) if extra else ""}</p>'


# ================================================================ Hình 4.15 — OCR nhiều ảnh
S = "ai-book-ocr-multi-image"
SeqDiagram(f"{S}-dd-p1", [QL, ("W", "Web App", "AI Import"), G, AI, I, ("OR", "OpenRouter", "Qwen VL", "external")], [
    ("msg", "Q", "W", "1. Chọn 1–3 ảnh: bìa trước, bìa sau, trang thông tin xuất bản", "call"),
    ("note", "W", "Thu nhỏ ≤ 2048 px, băm SHA-256 nội dung ảnh,\ngiải mã mã vạch EAN-13 ở bìa sau\n(trên trình duyệt)"),
    ("msg", "W", "G", "2. POST\n`/ai/book-metadata/`\n`scan-images (multipart)`", "link"),
    ("msg", "G", "AI", "3. Chuyển tiếp kèm JWT người dùng", "link"),
    ("msg", "AI", "I", "4. GET\n`/api/metadata-reconciliations/`\n`capabilities/import`", "link"),
    ("frame", "break", "[Không có quyền inventory.catalog.write]"),
    ("msg", "I", "AI", "5. 403", "return"),
    ("msg", "AI", "W", "6. 403 (chưa tốn chi phí suy luận)", "return"),
    ("end",),
    ("note", "AI", "images.py: kiểm tra magic bytes, chống ảnh bom,\nxoay theo EXIF, thu nhỏ ≤ 1600 px, xóa EXIF/GPS"),
    ("msg", "AI", "OR", "7. Một lời gọi đa phương thức chứa cả 3 ảnh có nhãn", "link"),
    ("msg", "OR", "AI", "8. JSON trường đọc được + đoạn chữ chép lại", "return"),
    ("note", ("I", "OR"), "validation.py: chuẩn hóa, kiểm tra checksum ISBN,\ngiá trị phải nằm trong đoạn chữ đã chép (grounding),\nđúng vai trò (dịch giả ≠ tác giả, NXB ≠ nhà phát hành)"),
], box_w=104, xs=XS6, title="Nhập sách bằng OCR nhiều ảnh, phần 1: đọc ảnh",
   desc="Quản lý kho chọn tối đa 3 ảnh; trình duyệt thu nhỏ và băm ảnh, AI Service kiểm tra quyền ghi danh mục qua Inventory, làm sạch ảnh, gọi một lần mô hình thị giác và kiểm tra kết quả bám vào chữ đã chép.").write(
    OUT / f"{S}-dd-p1.html", "Nhập sách bằng OCR nhiều ảnh (1/2): kiểm tra quyền và đọc ảnh", src(S, "1–8"))

SeqDiagram(f"{S}-dd-p2", [QL, W, G, I, AI, LK], [
    ("frame", "opt", "[Có đúng một ISBN hợp lệ]"),
    ("msg", "AI", "LK", "9. Tra cứu ISBN", "link"),
    ("note", ("AI", "LK"), "lookup_book_by_isbn (Google Books, Open Library, nhà sách)"),
    ("msg", "LK", "AI", "10. Bản ghi metadata", "return"),
    ("end",),
    ("note", ("I", "LK"), "reconcile.py: đối chiếu ảnh ↔ tra cứu theo khóa strict (giữ dấu),\ngán EXTRACTED / CORROBORATED / LOOKUP_ONLY / REVIEW_REQUIRED /\nCONFLICTED / INVALID, autofill_policy() quyết định safeToApply"),
    ("msg", "AI", "W", "11. proposals theo từng ô của biểu mẫu + bằng chứng", "return"),
    ("msg", "W", "Q", "12. Panel \"Kết quả đọc ảnh\": giá trị, trạng thái, bằng chứng", "return"),
    ("msg", "Q", "W", "13. Áp dụng từng trường hoặc các trường an toàn", "call"),
    ("msg", "W", "G", "14. Tạo bản nháp đối soát và kiểm tra trùng", "link"),
    ("msg", "G", "I", "15. POST /api/metadata-reconciliations, kiểm tra trùng lặp", "link"),
    ("msg", "I", "W", "16. Bản nháp + ứng viên trùng (EXACT_DUPLICATE, SAME_EDITION...)", "return"),
    ("msg", "Q", "W", "17. Xử lý trùng lặp, chuẩn hóa thực thể, bấm Lưu", "call"),
    ("msg", "W", "G", "18. Áp dụng bản nháp đã duyệt", "link"),
    ("msg", "G", "I", "19. Ghi các trường đã chấp nhận trong một giao dịch", "link"),
    ("msg", "I", "W", "20. Sách đã lưu", "accent"),
], box_w=104, xs=[92, 248, 364, 480, 596, 708], title="Nhập sách bằng OCR nhiều ảnh, phần 2: đối chiếu và lưu",
   desc="AI Service tra cứu ISBN khi có đúng một mã hợp lệ, đối chiếu ảnh với nguồn tra cứu, trả đề xuất theo từng ô; người dùng áp dụng, xử lý trùng lặp và lưu qua bản nháp đối soát của Inventory.").write(
    OUT / f"{S}-dd-p2.html", "Nhập sách bằng OCR nhiều ảnh (2/2): đối chiếu, duyệt và lưu",
    src(S, "9–20", "OCR chỉ đề xuất giá trị; việc ghi sách luôn đi qua bản nháp đối soát, kiểm tra trùng và nút Lưu."))

# ================================================================ Hình 4.17 — đề xuất nhập hàng
S = "analytics-reorder-budget"
AN = ("AN", "Analytics", "analytics-service")
SeqDiagram(f"{S}-dd-p1", [QL, ("W", "Web App", "Đề xuất nhập"), G, AN, ("AU", "Auth Service", "auth-service")], [
    ("msg", "Q", "W", "1. Chọn kỳ nhu cầu (7/30/90 ngày), nhập ngân sách (tùy chọn)", "call"),
    ("msg", "W", "G", "2. GET\n`/analytics/reorder-suggestions`\n`?budgetVnd=...`", "link"),
    ("msg", "G", "AN", "3. Chuyển tiếp kèm JWT", "link"),
    ("msg", "AN", "AU", "4. Đọc phạm vi kho của người dùng (nội bộ, có bộ nhớ đệm)", "link"),
    ("frame", "break", "[Không đọc được phạm vi kho]"),
    ("msg", "AN", "W", "5. 503 (fail-closed, không trả \"mọi kho\")", "return"),
    ("end",),
    ("note", ("G", "AN"), "Đọc được phạm vi kho → Phần 2 (bước 6–12)"),
], title="Đề xuất nhập hàng, phần 1: phạm vi kho",
   desc="Quản lý kho yêu cầu đề xuất nhập hàng qua API Gateway; Analytics Service đọc phạm vi kho của người dùng từ Auth Service và trả 503 nếu không đọc được, không bao giờ trả mọi kho.").write(
    OUT / f"{S}-dd-p1.html", "Đề xuất nhập hàng và phân bổ ngân sách (1/2): yêu cầu và phạm vi kho", src(S, "1–5"))

SeqDiagram(f"{S}-dd-p2", [QL, ("W", "Web App", "Đề xuất nhập"), AN, ("IDB", "inventory_db", "chỉ đọc", "store"), ("BDB", "borrow_db", "chỉ đọc", "store")], [
    ("msg", "AN", "BDB", "6. Chuỗi lượt mượn theo ngày, đặt giữ, yêu thích, đăng ký báo có sách", "call"),
    ("msg", "AN", "IDB", "7. Tồn khả dụng theo kho được phép, đơn giá, lịch sử giao hàng", "call"),
    ("note", "AN", "Dự báo EWMA + xu hướng × hệ số mùa vụ,\nthời gian chờ học từ lịch sử giao hàng,\ntồn an toàn z·σ·√L, số lượng và mức ưu tiên"),
    ("frame", "opt", "[Có tham số budgetVnd]"),
    ("msg", "AN", "IDB", "8. Số bản đang về = ordered_qty − received_qty", "call"),
    ("note", ("AN", "IDB"), "(PO APPROVED / SENT_TO_SUPPLIER /\nSUPPLIER_CONFIRMED / PARTIALLY_RECEIVED)"),
    ("msg", "AN", "BDB", "9. Phiếu mượn đang mở + lượt trả 365 ngày", "call"),
    ("note", ("W", "IDB"), "Kaplan–Meier ước lượng số bản dự kiến trả trong thời gian chờ,\nvị thế tồn = khả dụng + đang về + dự kiến trả,\nallocateMarginal: cấp từng bản theo P(D > vị thế + k) / đơn giá"),
    ("end",),
    ("msg", "AN", "W", "10. Danh sách đề xuất + lý do + (funded_qty, budget_plan, giả định)", "accent"),
    ("msg", "W", "Q", "11. Bảng đề xuất, cấp đủ / cấp một phần / chưa cấp", "return"),
    ("msg", "Q", "W", "12. Chọn dòng và tạo đơn đặt hàng nháp", "call"),
    ("note", "W", "Hệ thống không tự tạo hay duyệt đơn đặt hàng,\nđơn nháp đi qua quy trình duyệt thông thường"),
], title="Đề xuất nhập hàng, phần 2: dự báo và phân bổ ngân sách",
   desc="Analytics Service đọc chỉ đọc borrow_db và inventory_db, dự báo nhu cầu, tính tồn an toàn, khi có ngân sách thì ước lượng vị thế tồn và cấp từng bản theo lợi ích biên, rồi trả bảng đề xuất để quản lý tạo đơn nháp.").write(
    OUT / f"{S}-dd-p2.html", "Đề xuất nhập hàng và phân bổ ngân sách (2/2): dự báo và phân bổ", src(S, "6–12"))

# ================================================================ Hình 4.18 — Copilot
S = "ai-copilot-query-verification"
QM = ("Q", "Quản lý", "ADMIN · MANAGER", "input")
WC = ("W", "Web App", "Trợ lý AI")
ADB = ("DB", "ai_db", "PostgreSQL", "store")
AN2 = ("AN", "Analytics", "Inventory API")
SeqDiagram(f"{S}-dd-p1", [QM, WC, G, AI, ADB, ("OR", "OpenRouter", "Qwen", "external")], [
    ("msg", "Q", "W", "1. Đặt câu hỏi tiếng Việt", "call"),
    ("msg", "W", "G", "2. POST\n`/ai/assistant/stream (JWT)`", "link"),
    ("msg", "G", "AI", "3. Chuyển tiếp kèm JWT", "link"),
    ("frame", "break", "[Vai trò không thuộc ADMIN, WAREHOUSE_MANAGER]"),
    ("msg", "AI", "W", "4. 403", "return"),
    ("end",),
    ("msg", "AI", "DB", "5. Đọc lịch sử và trạng thái hội thoại (copilot_state)", "call"),
    ("note", ("G", "AI"), "copilot_plan.build_plan: chuẩn hóa câu (bỏ dấu, viết tắt),\nnhận diện năng lực, kỳ, kho, ngân sách,\nchọn công cụ và đối số trong danh sách 20 công cụ đọc"),
    ("frame", "opt", "[Cờ COPILOT_SEMANTIC_PLANNER=on]"),
    ("note", ("W", "AI"), "Cờ COPILOT_SEMANTIC_PLANNER=on (mặc định off)\nvà kế hoạch luật chưa đủ"),
    ("msg", "AI", "OR", "6. Một lời gọi chat_json chỉ đọc nghĩa câu hỏi", "link"),
    ("msg", "OR", "AI", "7. Gợi ý năng lực, kỳ, kho (backend kiểm tra và hợp nhất)", "return"),
    ("end",),
], box_w=104, xs=XS6, title="Trợ lý AI, phần 1: kiểm tra vai trò và lập kế hoạch",
   desc="Người quản lý đặt câu hỏi; AI Service từ chối vai trò không được phép, đọc trạng thái hội thoại, lập kế hoạch bằng luật và chỉ khi bật cờ mới hỏi LLM để hiểu nghĩa câu hỏi.").write(
    OUT / f"{S}-dd-p1.html", "Trợ lý AI (1/3): kiểm tra vai trò và lập kế hoạch", src(S, "1–7"))

SeqDiagram(f"{S}-dd-p2", [G, AI, AN2, ("OR", "OpenRouter", "Qwen", "external")], [
    ("frame", "par", "[Gọi các công cụ trong kế hoạch]"),
    ("msg", "AI", "G", "8. GET /analytics/... bằng JWT người dùng", "link"),
    ("msg", "G", "AN", "9. Chuyển tiếp, kiểm tra quyền và phạm vi kho", "link"),
    ("msg", "AN", "AI", "10. Dữ liệu có cấu trúc", "return"),
    ("end",),
    ("note", ("G", "AN"), "Bảng bằng chứng (evidence sheet), giải thích FACT /\nINFERENCE / ASSUMPTION / UNKNOWN, đặc tả biểu đồ\nline/bar/area/pie/kpi/table dựng từ dữ liệu công cụ"),
    ("msg", "AI", "OR", "11. Sinh câu trả lời từ bằng chứng (không được tự vẽ biểu đồ)", "link"),
    ("msg", "OR", "AI", "12. Bản nháp câu trả lời", "return"),
    ("note", ("G", "AN"), "Kiểm chứng Layer 1 tất định: đối chiếu số liệu, kỳ, xếp hạng,\nngân sách, NO_DATA, diễn đạt quá mức\n(Layer 2+3 trích claim bằng LLM: cờ COPILOT_SEMANTIC_CLAIMS, mặc định off)"),
    ("frame", "alt", "[Lỗi nghiêm trọng có căn cứ chính xác]"),
    ("msg", "AI", "OR", "13. Sinh lại tối đa 1 lần", "link"),
    ("msg", "OR", "AI", "14. Bản nháp mới", "return"),
    ("note", "AI", "Vẫn lỗi → BLOCKED: trả câu dựng từ dữ liệu,\nkhông đề xuất hành động"),
    ("else", "[Lỗi chỉ ở nhận định suy luận]"),
    ("note", "AI", "Lược bỏ câu sai, trạng thái WARNING, safe_to_act = false"),
    ("else", "[Không phát hiện lỗi]"),
    ("note", "AI", "PASSED (hoặc REPAIRED nếu sửa số an toàn)"),
    ("end",),
], title="Trợ lý AI, phần 2: bằng chứng, sinh câu trả lời và kiểm chứng",
   desc="AI Service gọi các công cụ phân tích bằng JWT người dùng, dựng bằng chứng và đặc tả biểu đồ, nhờ LLM viết câu trả lời rồi kiểm chứng tất định: sinh lại tối đa một lần, lược câu sai hoặc cho qua.").write(
    OUT / f"{S}-dd-p2.html", "Trợ lý AI (2/3): bằng chứng, câu trả lời và kiểm chứng", src(S, "8–14"))

SeqDiagram(f"{S}-dd-p3", [QM, WC, AI, ADB], [
    ("frame", "opt", "[safe_to_act = true và câu hỏi dẫn tới việc cần làm]"),
    ("msg", "AI", "DB", "15. Lưu ai_pending_actions (PENDING_CONFIRMATION, hết hạn 10 phút)", "call"),
    ("end",),
    ("msg", "AI", "DB", "16. Lưu tin nhắn, bằng chứng, đặc tả biểu đồ", "call"),
    ("msg", "AI", "W", "17. SSE: bản nháp → đang kiểm chứng → done {answer, visualizations, evidence, verification}", "accent"),
    ("msg", "W", "Q", "18. Văn bản + biểu đồ (component whitelist) + bằng chứng + trạng thái kiểm chứng", "return"),
], title="Trợ lý AI, phần 3: lưu và trả kết quả",
   desc="Khi an toàn và cần hành động, AI Service lưu hành động chờ xác nhận hết hạn sau 10 phút, lưu tin nhắn cùng bằng chứng, rồi phát luồng SSE tới Web App để hiển thị câu trả lời, biểu đồ và trạng thái kiểm chứng.").write(
    OUT / f"{S}-dd-p3.html", "Trợ lý AI (3/3): lưu hội thoại và trả kết quả", src(S, "15–18"))
