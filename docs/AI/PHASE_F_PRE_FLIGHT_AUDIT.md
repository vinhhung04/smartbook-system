# Phase F — Pre-flight audit

> Ngày 2026-11-13, nhánh `hungg`, HEAD `63c2fa81213a6041092aa99ceaf3d772f1bd36b0` (trùng baseline của yêu cầu).
> Nguồn sự thật là code tại HEAD này. Mọi nhận định dưới đây được đối chiếu bằng cách đọc file (đường dẫn kèm theo).

## 1. Trạng thái repository

| Mục | Kết quả |
|---|---|
| Branch | `hungg` |
| HEAD | `63c2fa8` (feat(phase-e)…) |
| Working tree | Có thay đổi chưa commit **không thuộc AI** của người dùng: xóa skill `ponytail*`, sửa `.claude/settings.json`, `CLAUDE.md`, `skills-lock.json`, `docs/diagrams/**`, các file `.docx`. Phase F **không chạm** vào các file này. |
| `AGENTS.md` | Có (pnpm workspace, không push `main`, chạy lint/build trước merge). Không có quy tắc mâu thuẫn với yêu cầu. |
| Docker | Docker Desktop không chạy lúc audit (`dockerDesktopLinuxEngine` không tồn tại) → E2E trên stack thật cần khởi động Docker. |
| OpenRouter | `.env` có `OPENROUTER_API_KEY` (không đọc giá trị), model `qwen/qwen3.7-flash` cho text/assistant/vision. |

## 2. Kiến trúc AI hiện tại (đã xác minh)

Một service `ai-service` (FastAPI, `main.py` 6.079 dòng + các router `routes_*.py`), hai trải nghiệm dùng chung `ai_core`:

| | General Chatbot | Decision Assistant |
|---|---|---|
| Endpoint | `POST /chat`, `/chat/stream` (`main.py:3913`, `:5170`) | `POST /assistant`, `/assistant/stream` (`main.py:4966`, `:5049`) |
| Prologue | `_prepare_chat_turn` (`main.py:3705`) | `_start_assistant_turn` (`main.py:4881`) |
| Cổng | mọi người đăng nhập + ẩn danh (FAQ) | `can_use_assistant` = role ADMIN/WAREHOUSE_MANAGER **và** quyền analytics (`routes_conversations.py`) |
| Lịch sử | client (localStorage, chỉ `user`/`assistant`) | `conversation_store` PostgreSQL, kiểm tra chủ sở hữu |
| Hiểu câu | `nlu.classify_user_message` (luật + LLM khi mơ hồ) | `copilot_plan.build_plan` + `copilot_semantic_planner` (cờ, mặc định OFF) |
| Kiểm chứng | `ensure_source_line` + `verify_numeric_grounding` (một cảnh báo chuỗi) | `copilot_explain`, `copilot_verification` (claim SUPPORTED/CONTRADICTED/UNSUPPORTED/UNVERIFIABLE), `copilot_faithfulness`, `copilot_claims` |
| Hành động | `plan_agent_action` → pending action | reorder/… qua `_build_assistant_pending_action` |

Lõi dùng chung: `ai_core/policy.py` (danh tính fail-closed, rate limit, cổng, scope), `ai_core/tools.py` (READ / DRAFT_THEN_CONFIRM / FORBIDDEN, `run_read_tool` là đường thực thi duy nhất), `ai_core/prompts.py`, `agent_actions.ACTION_CONFIG` (policy role AND permission khớp guard service đích).

Gateway (`apps/api-gateway/src/index.js:585`) proxy `/ai/*` → ai-service, chặn `/ai/internal`, `/ai/metrics`, `/ai/docs`; không tự kiểm tra quyền — ai-service kiểm tra.

## 3. Đối chiếu các hiện trạng đã biết (mục 3.3 của yêu cầu)

| ID | Phát hiện | Còn đúng? | Bằng chứng |
|---|---|---|---|
| A | Hai trải nghiệm, chung AI Core, tách điều phối/lịch sử/cache/quyền | Đúng | bảng §2 |
| B | `COPILOT_SEMANTIC_PLANNER=off`, context resolution 0,810 < 0,85 | Đúng | `copilot_semantic_planner.py` `ENABLED`, `docs/ANALYSIS/AI_COPILOT_SEMANTIC_UNDERSTANDING.md` §9.3 |
| C | Multimodal có nhưng chưa vào hội thoại | Đúng | `routes_cover_search.find_book_by_cover` chỉ được gọi từ trang quét bìa (web `services/cover-search.ts`, mobile `app/customer/scan-cover.tsx`, `app/audit/[auditId].tsx`); `/chat` và `/assistant` không nhận ảnh |
| D | Explainable AI chủ yếu ở Decision Assistant | Đúng | Chat trả `reply`, `context_sources`, `retrieval_warnings`; không có `explanation`/`verification` |
| E | 6 role, ADMIN/MANAGER dùng assistant riêng, SUPPLIER có portal riêng | Đúng | `layout.tsx` (`hasDedicatedAssistant`), `app/routes.ts:171` `/supplier` (không có `AppLayout` → **không có chatbot**) |

## 4. Chức năng đã có / thiếu / có nhưng chưa tích hợp

### 4.1 Đã có và hoạt động
- RBAC role AND permission cho action (`agent_actions.policy_allows`), kiểm tra lại lúc xác nhận; revocation fail-closed (`require_verified_session`); warehouse scope cho dữ liệu đã lưu (`warehouse_scope.can_view`); cache assistant theo dấu vân tay quyền.
- Planner luật + semantic planner có validate/reconcile; `decompose()` multi-intent; state `last_items`, `recent_warehouses`, `focus_warehouse`.
- Cover search: OCR (OpenRouter vision) + CLIP (local) + `_score_and_rank_books`, fusion `_merge_candidates`; bộ nghiên cứu có harness, dataset card, rights review (`eval/cover_search/`, `docs/research/cover-search/`).
- Public catalog có tồn theo chi nhánh nhận sách, không dữ liệu cá nhân: `GET /public/catalog/books?ids=` (`inventory-service public-catalog.service.js`), đã được `routes_public_discover._fetch_public_books` dùng.
- Supplier account API thật, phạm vi theo nhà cung cấp đăng nhập: `GET /api/supplier-account/orders` (`authorizeAnyPermission(supplier.portal.read|write)`, `findAuthenticatedSupplier(req)` lọc `supplier_id`).

### 4.2 Thiếu
| Thiếu | Bằng chứng |
|---|---|
| Capability registry theo role | Không có; quyền rải ở `user_personal_context._ROLE_ENDPOINTS`, `ANALYTICS_BLOCKED_ROLES`, `rbac.ts`, gợi ý câu hỏi hard-code theo `getPrimaryRole` (`ai-chatbot.tsx:75`) |
| Multi-role cho dữ liệu cá nhân | `build_user_personal_context` dùng **chỉ** `get_primary_role()` (`user_personal_context.py:497`): user CUSTOMER + LIBRARIAN chỉ nhận endpoint thủ thư, không đọc được phiếu mượn của chính mình |
| AI cho SUPPLIER | `_ROLE_ENDPOINTS["SUPPLIER"] = []`; trang `/supplier` không có chatbot |
| Ảnh trong hội thoại | §3 C |
| Claim-level evidence cho chatbot | §3 D |
| Gợi ý câu hỏi theo quyền thật | gợi ý theo primary role; ví dụ MANAGER-only vẫn hiện "Tổng quan loan và phạt" dù MANAGER không có quyền borrow |

### 4.3 Hạn chế bảo mật/độ bền của cover search hiện tại
| Vấn đề | Vị trí |
|---|---|
| Chỉ kiểm tra `content_type` do client khai (`image/*`), không kiểm tra chữ ký file → `image/svg+xml` lọt qua | `routes_cover_search.py:find_book_by_cover`, `main._validate_and_read_image` |
| Không giới hạn dung lượng/pixel; `file.file.read()` đọc toàn bộ | như trên |
| Không rate limit, không yêu cầu đăng nhập (catalog fetch dùng token người gọi; ẩn danh → catalog rỗng nhưng OCR vẫn gọi OpenRouter, tốn tiền) | như trên |
| `confidence` là trung bình có trọng số của cosine và điểm văn bản, hiển thị "Ảnh bìa khớp 82%" → dễ bị đọc như xác suất | `_merge_candidates` |

Các endpoint này **không bị đổi hợp đồng** trong Phase F (client quét bìa đang dùng); phần kiểm tra an toàn mới áp cho endpoint hội thoại mới và được bổ sung (chỉ từ chối file không phải ảnh thật / quá lớn) cho `/find-book-by-cover`.

## 5. Hạn chế đã benchmark (không suy đoán)

| Hạn chế | Số đo | Nguồn |
|---|---|---|
| Context resolution (hybrid) | 17/21 = 0,810 < 0,85 | `AI_COPILOT_SEMANTIC_UNDERSTANDING.md` §9.2 |
| Lượt còn sai | "Trong số đó cuốn nào sắp hết?" (không lọc danh sách lượt trước), "Chi nhánh Hà Nội" (không hỏi lại khi trùng tên), follow-up đổi phạm vi mất kho, câu luật hỏi lại "chỉ số nào?" không được định tuyến | §10.2 |
| Định tuyến thừa | 3/23 lượt kết thúc `keep_rules:no_new_information` | §9.4 |
| Câu cần dữ liệu trả lời không gọi tool khi plan rỗng (cờ off) | 9/82 | §9.4 |
| Chatbot partial-evidence/near-miss | E10 PARTIAL | `PHASE_E_FINAL_SUMMARY.md` |
| Cover search | Kết quả nghiên cứu có trong `docs/research/cover-search/RESULTS_ANALYSIS.md` (bộ dữ liệu có rights review) | |

## 6. Rủi ro bảo mật và regression

| Rủi ro | Biện pháp trong Phase F |
|---|---|
| Mở quyền AI cho mọi role làm lộ analytics | Không bỏ `can_use_assistant`; capability chỉ là bề mặt mô tả + allowlist; mọi đọc vẫn bằng token người dùng, service đích kiểm tra lại |
| Multi-role làm tăng dữ liệu nạp vào prompt | Mỗi endpoint cá nhân yêu cầu role **và** permission; vẫn giữ data minimization theo topic |
| Supplier đọc dữ liệu supplier khác | Chỉ gọi `/api/supplier-account/orders` bằng token supplier; target lọc theo `supplier_id` của tài khoản |
| Candidate id do client gửi | Ngữ cảnh ảnh lưu phía server theo chủ sở hữu; `book_id` phải nằm trong candidate đã xác minh |
| Ảnh độc hại/quá lớn | Kiểm tra chữ ký, dung lượng, pixel, giải mã; chặn SVG; không log ảnh; không lưu ảnh |
| Lộ chain-of-thought | Giải thích chỉ dựng từ dữ liệu/tín hiệu backend |
| Regression chat/assistant | Trường mới đều tùy chọn; chạy lại toàn bộ pytest + test web/mobile |

## 7. Phương án tái sử dụng

| Nhu cầu | Tái sử dụng |
|---|---|
| Policy role AND permission | `agent_actions.policy_allows` |
| Action | `ACTION_CONFIG` (registry capability chỉ tham chiếu tên action) |
| Tool đọc | `tool_registry` / `ai_core.tools.READ_TOOLS` (tham chiếu tên) |
| OCR + CLIP + text match + fusion | `routes_cover_search._run_cover_ocr`, `_match_visual`, `_fetch_catalog`, `_merge_candidates`, `assistant_tools._score_and_rank_books` |
| Tồn theo chi nhánh công khai | `routes_public_discover._fetch_public_books` |
| Kiểm chứng số | `number_grounding`, `rag.verify_numeric_grounding` |
| Giải thích assistant | `copilot_explain.build_explanation`, `copilot_verification.summarize` |
| Benchmark NLU | `eval/nlu_phase1/eval_nlu_phase1.py` (thêm tham số dataset) |
| Benchmark ảnh | `eval/cover_search/harness.py` (gọi đúng endpoint production) |

## 8. Baseline test (trước mọi thay đổi Phase F)

Xem `PHASE_F_TEST_REPORT.md` §1 (số liệu điền từ lần chạy thật).
