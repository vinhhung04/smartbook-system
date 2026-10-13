# SmartBook AI Assistant → Management Copilot (2026-10-13)

Phạm vi: `/assistant` và `/assistant/stream` (trang **Trợ lý AI**, ADMIN/WAREHOUSE_MANAGER). Chatbot nổi (`/chat`) không đổi: layout chỉ hiển thị nó cho vai trò **không** có trang Trợ lý AI.

## 1. Audit hiện trạng (trước thay đổi)

| Thành phần | Đã có | Khoảng trống / lỗi tìm thấy |
|---|---|---|
| `conversation_store.get_or_create_conversation` | Lưu hội thoại, nạp 10 message gần nhất | **Lỗ hổng phân quyền**: trả về hội thoại theo `conversation_id` mà không kiểm tra `user_id`. Đo trên hệ thống thật: manager01 gửi `conversation_id` của admin và nhận *"Câu hỏi trước của bạn là: Top 3 sách…"* ở cả `/assistant` và `/assistant/stream`. Các route GET/PATCH/DELETE hội thoại đã có `_require_owner`. |
| `intent.py` / `nlu.py` | Rule-based + LLM classifier (chỉ dùng cho `/chat`) | `/assistant` chỉ dùng `detect_intent` cho fast path một/hai tool; không có kỳ "tháng trước/tuần này/quý", không có so sánh kỳ, không có ngân sách, không xử lý viết tắt/lỗi gõ ngoài keyword. |
| Prompt `/assistant` | Quy tắc grounding, tiền tệ | **Không có ngày hiện tại** → LLM gọi tool với năm 2023/2024 (baseline: 72% câu hỏi có mốc thời gian bị sai kỳ). |
| `assistant_tools._get` | Cắt list còn 12 dòng | **Lỗi số liệu**: `evidence.py` cộng "Tổng lượt mượn trong khoảng thời gian" trên danh sách đã cắt → 30 ngày thật 530 lượt bị báo 363 (12 ngày đầu). Tương tự số sách tồn lâu. |
| `tool_context.py` | Render qua evidence (2–3 dòng/tool) | Quá ít dữ liệu cho câu "vì sao/nên làm gì"; LLM phải tự cộng/so sánh. |
| Multi-tool | Gọi song song nhiều tool | Không có phép **nối dữ liệu** (top mượn × tồn kho), không so sánh kỳ/kho, không mô phỏng ngân sách xác định. |
| Ngữ cảnh hội thoại | Lịch sử text 10 message | Không có state có cấu trúc (kho, kỳ, ngân sách, mục vừa hiển thị). |
| analytics `warehouse-stock-risk` | Đếm theo kho | **Lỗi định nghĩa**: đếm theo *từng vị trí lưu trữ* → đầu sách có 1 vị trí = 0 bị tính hết hàng. Kho HCM Chinh: báo 7 hết hàng, thực tế 3. KPI dashboard đã đếm đúng (theo đầu sách). |
| inventory `/api/stock-balances/low-stock?warehouse_id=` | Danh sách tồn thấp | **Luôn HTTP 500** khi truyền `warehouse_id` (thiếu `::uuid`). |
| `evidence.py`, `retrieval_confidence.py`, `number_grounding` | Có | Giữ nguyên; được tái sử dụng. |
| Pending action / xác nhận | Có, kiểm tra người tạo khi confirm | Giữ nguyên luồng (câu "tạo/lập…" không bị planner seed tool). |

## 2. File thay đổi và lý do

**ai-service**
- `conversation_store.py` — `ConversationAccessDenied`, `is_conversation_owner`: từ chối `conversation_id` của người khác (kể cả superuser, vì đường này ghi dữ liệu).
- `copilot_plan.py` (mới) — planner xác định: chuẩn hoá (viết tắt, teen code, lỗi gõ an toàn), năng lực dữ liệu, loại phân tích, kỳ thời gian theo lịch VN, kỳ so sánh, kho (khớp danh sách thật, giả định được ghi lại, mơ hồ → hỏi lại), ngân sách/% cắt/thời gian chờ/limit/ưu tiên, state hội thoại và câu nối tiếp, hỏi lại khi mơ hồ, từ chối yêu cầu dữ liệu cá nhân. Chỉ phát ra tool trong `PLANNABLE_TOOLS`.
- `copilot_tools.py` (mới) — 9 tool đọc tổng hợp, nối theo `variant_id`/`warehouse_id`, tính toán trong code; cache gộp request theo token người dùng.
- `tool_registry.py` (mới) — whitelist tool đầy đủ (tránh import vòng giữa hai module tool).
- `copilot_response.py` (mới) — system prompt mới, ghi chú ngữ cảnh theo lượt, renderer cho LLM, khuyến nghị/lưu ý/gợi ý tiếp theo/thời điểm dữ liệu dựng từ dữ liệu tool.
- `main.py` — hai endpoint dùng chung prologue/finalize; planner seed tool; hỏi lại không gọi LLM; grounding tính cả giá trị backend đã tính và ngày do hệ thống cung cấp; chặn câu trả lời dạng JSON thô; response thêm `plan`, `suggested_followups`, `caveats`, `recommendations`, `data_as_of` (tùy chọn, tương thích ngược).
- `assistant_loop.py` — `answer_from_collected_data`: hết số vòng tool thì trả lời từ dữ liệu đã có.
- `assistant_tools.py` — `get_borrow_trends`, `get_aging_inventory` không còn cắt dữ liệu trước khi evidence cộng; `get_reorder_suggestions` trả thêm `listed_totals`.
- `tool_context.py` — dùng renderer copilot; lỗi 403 diễn đạt rõ là "không có quyền".
- `routes_conversations.py` — trả `extras` của message để UI khôi phục khuyến nghị khi mở lại hội thoại.

**analytics-service**: `utils/warehouse-stock.js` (mới, định nghĩa chung), `warehouse-stock-risk` đếm theo đầu sách, endpoint đọc mới `GET /analytics/warehouse-stock-items?warehouseId=` (cùng định nghĩa, cùng quyền với `warehouse-stock-risk`).

**inventory-service**: `stock-balance.controller.js` ép `::uuid`, `warehouse_id` sai → 400; `uuid-params.middleware.js` export `UUID_RE`.

**web**: `services/ai.ts` (kiểu mới), `components/ai-copilot-insights.tsx` (mới: render markdown nhẹ, thẻ đề xuất, lưu ý, gợi ý tiếp theo, thời điểm dữ liệu), `pages/ai-assistant.tsx` (câu hỏi gợi ý theo quyền đọc dữ liệu mượn, hiển thị phần có cấu trúc, khôi phục khi mở lại hội thoại; streaming và ActionCard giữ nguyên).

**Docs/eval**: `docs/SERVICES/AI_SERVICE.md`, `eval/README.md` §4, `eval/build_copilot_dataset.py`, `eval/copilot_dataset.json`, `eval/eval_copilot.py`.

## 3. Test bổ sung

| File | Nội dung |
|---|---|
| `test_conversation_store.py` (+2), `test_assistant_conversation_access.py` | Regression phân quyền hội thoại cho store và cả hai endpoint (403 trước khi đọc lịch sử/gọi LLM). |
| `test_copilot_plan.py` (36) | Chuẩn hoá, kỳ thời gian, ngân sách, kho, tool cho từng loại câu, nối tiếp, hỏi lại, PII, whitelist trên toàn bộ dataset. |
| `test_copilot_tools.py` (19) | Join theo `variant_id` (không theo tên), so sánh kho/kỳ, mô phỏng ngân sách, giải thích thiếu hàng, xếp hạng việc, cache không trộn người dùng. |
| `test_copilot_response.py` (9), `test_copilot_endpoints.py` (7) | Ghi chú ngày, renderer, khuyến nghị/rủi ro/độ tin cậy theo quy tắc, gợi ý theo quyền; stream và non-stream cùng body; state không lẫn giữa hội thoại; hỏi lại không gọi LLM; grounding; chặn JSON. |
| `test_assistant_loop.py` (+3), `test_tool_context.py` (+1) | Trả lời từ dữ liệu đã có; thông báo 403. |
| analytics `test/warehouse-stock.test.js`, inventory `test/stock-balance-low-stock.test.js` | Định nghĩa tồn theo đầu sách; `warehouse_id` sai → 400. |

Kết quả: ai-service **789 passed, 8 skipped** (trước: 710); `pnpm verify` pass (lint, typecheck, build, inventory 169, borrow 143, analytics 119 test, ai-service).

## 4. Benchmark trước/sau

Bộ dữ liệu: `eval/copilot_dataset.json` — 157 case, **171 lượt** (paraphrase 40, multi-intent 20, nguyên nhân 10, so sánh 15, quyết định 12, giả định 10, hội thoại nhiều lượt 12 hội thoại/26 lượt, cần làm rõ 10, ngoài phạm vi 5, prompt injection 10, tra cứu 10, RBAC 3). Cùng harness `eval_copilot.py` (v2), cùng dữ liệu thật, cùng model `qwen/qwen3.7-flash` qua OpenRouter, chạy riêng từng lượt. Baseline = mã ai-service tại commit `940a513` (trước mọi thay đổi). Báo cáo: `eval/reports/copilot_baseline-v2_20261013_085406.md`, `eval/reports/copilot_after-v2_20261013_083139.md`.

| Chỉ số | Trước | Sau |
|---|---|---|
| Năng lực dữ liệu đúng hoàn toàn (exact) | 82,2% | **95,9%** |
| Recall năng lực (micro) | 89,4% | **100%** |
| Precision năng lực (micro) | 92,0% | 93,2% |
| Đúng kỳ thời gian trong tham số tool (25 lượt) | 28% | **100%** |
| Hỏi lại khi câu mơ hồ (10 lượt) | 40% | **100%** |
| Hỏi lại không cần thiết | 14,4% | **0%** |
| Từ chối ngoài phạm vi/injection, không gọi tool | 100% / 0% | 100% / 0% |
| Lộ system prompt | 1,8% | **0%** |
| Lộ tên trường kỹ thuật | 8,2% | **0%** |
| Câu có số không có trong dữ liệu (bộ chấm độc lập) | **3,4%** | 4,8% |
| Câu trích dẫn số liệu | 85,6% | 96,6% |
| RBAC: manager thấy "không có quyền", không bịa số | 100% | 100% |
| Chặn `conversation_id` của người khác (`/assistant`, `/stream`) | **Không** / **Không** | Có / Có |
| Lượt gọi LLM trung bình | 2,04 | **1,25** |
| Độ trễ p50 / p90 | 4,07 s / 7,95 s | 3,28 s / 9,44 s |
| Stream vs non-stream: cùng tool / cùng schema (12 case) | 100% / 100% | 91,7% / 100% |

Đọc kết quả một cách trung thực:
- **Không cải thiện số bịa**: 3,4% → 4,8% (≈5 → 8 câu, chênh lệch nhỏ so với cỡ mẫu). Bản mới trả lời có số nhiều hơn và vẫn còn LLM tự cộng/trừ (ví dụ tự cộng chi phí 3 sách). Ngoài ra bộ chấm coi giá trị evidence là có căn cứ, nên baseline được tính "đúng" cả với tổng 30 ngày sai (363 thay vì 530, lỗi cắt dữ liệu đã sửa) — chỉ số này ưu ái baseline.
- `grounding_warning_rate` (11,0% → 2,7%) **không so sánh trực tiếp được**: bản mới đã sửa bộ kiểm tra để không báo nhầm ngày hệ thống và tổng do backend tính.
- Precision thấp ở câu nguyên nhân/quyết định (74–76%) vì LLM còn gọi thêm tool ngoài nhu cầu; p50 câu quyết định tăng (5,4 s → 11,6 s), p90 tổng tăng.
- 1/12 case stream lệch tool do LLM tự gọi thêm tool ở một lượt (không tất định); schema hai endpoint giống nhau 100%.
- Nhận diện "hỏi lại"/"từ chối" là heuristic văn bản, giống hệt cho hai phiên bản.
- `copilot_baseline_20261013_074347` và `copilot_after_20261013_082055` là lượt chạy với harness v1 (thiếu ánh xạ `explain_reorder_item`, mẫu nhận diện hỏi lại hẹp hơn, chấm số chưa tính evidence/ngày thật; bản "after" đó cũng chưa có các sửa grounding/JSON/địa danh). Giữ lại để đối chiếu; số liệu chính thức là cặp `-v2`.
- Harness gọi trực tiếp hàm endpoint (không qua HTTP) vì limiter 100 request/giờ/IP; gateway còn giới hạn 600 request/15 phút/IP nên hai lượt phải chạy cách nhau (một lần chạy sát nhau đã bị 401 hàng loạt và bị loại bỏ).

## 5. Ví dụ hội thoại nhiều lượt (trích từ lượt chạy after-v2, dữ liệu thật)

**Ngân sách**
1. *Nên nhập sách nào?* → `get_reorder_suggestions`; Đề xuất/Lý do/Rủi ro, 116 đầu sách cần xem xét, 97 ưu tiên cao.
2. *Nếu ngân sách chỉ 10 triệu?* → `simulate_reorder_budget(budgets_vnd=[10000000])`: duyệt 9.876.000 ₫, 8 đầu sách/102 bản, nêu các sách ưu tiên cao bị bỏ lại.
3. *Còn 20 triệu thì sao?* → `simulate_reorder_budget(budgets_vnd=[20000000, 10000000])` (kế thừa phương án trước để so sánh): duyệt 19.888.000 ₫, 11 đầu sách/151 bản, "so với phương án 10 triệu…".

**So sánh và nguyên nhân**
1. *Kho Ha Noi va Kho HCM Chinh kho nao rui ro hon?* (không dấu) → `compare_warehouses`: HCM Chinh rủi ro hơn — hết hàng 3 so với 0, dưới ngưỡng 7 so với 1, kèm tiêu chí xếp hạng.
2. *Tại sao?* → kế thừa hai kho: `explain_warehouse_shortage` cho từng kho; 6 đầu sách thiếu ở HCM Chinh vẫn có lượt mượn (Norwegian Wood 72 lượt), thời gian chờ 30 ngày; lưu ý nhu cầu tính toàn hệ thống.

**Tham chiếu mục vừa hiển thị**
1. *Đề xuất nhập hàng ưu tiên cao* → danh sách HIGH.
2. *Chỉ lấy 3 cuốn đầu thôi* → `limit=3`, giữ `priority=HIGH`; tổng 43 bản/7.470.000 ₫ lấy từ `listed_totals`.
3. *Vì sao cuốn đầu tiên được chọn?* → `explain_reorder_item(variant_id=86936782…)` (lấy từ state, không đoán theo tên): tồn 5/ngưỡng 10, 72 lượt mượn, 88 wishlist, chờ hàng 30 ngày, nhu cầu giảm 40,5%.

**Mơ hồ** — *Tại sao kho này thiếu sách?* (chưa có ngữ cảnh) → không gọi tool/LLM: "Bạn đang hỏi về kho nào? Các kho hiện có: …" kèm 4 câu hỏi gợi ý bấm được.

## 6. Cấu hình và kiểm thử

- Không có biến môi trường mới; model vẫn `OPENROUTER_ASSISTANT_MODEL` (không đổi provider). `ASSISTANT_TOOL_CONTEXT_CHARS` vẫn áp dụng cho renderer cũ; renderer copilot giới hạn 3.500 ký tự.
- Triển khai: analytics-service và inventory-service cần rebuild (`docker compose up -d --build analytics-service inventory-service`); ai-service và web như thường lệ.
- Unit test: `python -m pytest services/ai-service -q`; toàn bộ: `pnpm verify`.
- Benchmark: xem `services/ai-service/eval/README.md` §4. Sau mỗi lần chạy cần chờ ~15 phút trước lần tiếp theo (giới hạn gateway).

## 7. Giới hạn còn lại

- LLM vẫn có thể tự tính (cộng chi phí, trừ ngân sách); grounding phát hiện và thử sửa một lần nhưng không chặn hoàn toàn.
- LLM đôi khi gọi thêm tool không cần thiết ở câu nguyên nhân/quyết định → tốn thời gian, precision thấp hơn.
- "Nguyên nhân" chỉ là các yếu tố tương quan trong dữ liệu; nhu cầu mượn của mô hình reorder là toàn hệ thống, chưa có theo kho.
- Mô phỏng ngân sách dùng thuật toán phân bổ có sẵn của analytics; chưa có ràng buộc nhà cung cấp, số lượng tối thiểu, ngân sách theo kho; analytics trả tối đa 100 dòng đề xuất nên số dòng/số bản vượt 100 dòng không được đếm (có cảnh báo).
- Độ tin cậy dữ liệu là quy tắc trên cỡ mẫu (lượt mượn, nguồn thời gian chờ hàng), không phải xác suất.
- Chuẩn hoá lỗi gõ chỉ sửa khi kết quả rơi vào từ vựng nghiệp vụ; lỗi gõ khác vẫn đi qua LLM.
- Planner là rule-based tiếng Việt; câu hỏi nằm ngoài các mẫu đã biết quay về cơ chế cũ (LLM tự chọn tool).
- Bộ dataset do người phát triển gán nhãn; nhận diện hỏi lại/từ chối là heuristic; chưa có đánh giá chất lượng câu trả lời bởi người dùng thật.
