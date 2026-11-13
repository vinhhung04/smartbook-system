# Phase F — Báo cáo triển khai

> Nhánh `hungg`, baseline `63c2fa8`. **Chưa commit, chưa push, chưa deploy.** Không migration, không thay đổi schema.
> Ảnh Docker cục bộ `smartbook-system-ai-service:latest` đã được build lại từ working tree để chạy E2E; bản trước được giữ ở tag
> `smartbook-system-ai-service:pre-phase-f` (rollback: `docker tag smartbook-system-ai-service:pre-phase-f smartbook-system-ai-service:latest`
> rồi `docker compose --profile ai up -d --no-deps --no-build ai-service`).

## 1. Nguyên nhân gốc và giải pháp

| # | Vấn đề (đã xác minh) | Nguyên nhân gốc | Giải pháp |
|---|---|---|---|
| 1 | User nhiều role chỉ nhận dữ liệu cá nhân của một role | `build_user_personal_context` dùng `get_primary_role()` | `ai_core/capabilities.py`: registry role AND permission; `personal_endpoints()` = hợp mọi năng lực |
| 2 | Báo cáo ngoại lệ của nhân viên kho không bao giờ đọc được | gọi `/api/my-exception-reports` (không tồn tại) | đường đúng `/api/exception-reports/my` |
| 3 | SUPPLIER không có AI | không có endpoint cá nhân, không có chatbot trên `/supplier` | năng lực `supplier.orders` → `/api/supplier-account/orders` (API thật, lọc theo nhà cung cấp); chatbot trên trang Supplier |
| 4 | Gợi ý câu hỏi không khớp quyền | hard-code theo primary role ở web | `GET /capabilities` sinh gợi ý từ năng lực |
| 5 | Ảnh không vào hội thoại; endpoint quét bìa tin `content_type` | không có tích hợp; không kiểm tra chữ ký/dung lượng | `/vision/identify`, `image_input.py`, ngữ cảnh ảnh theo chủ sở hữu; harden `/find-book-by-cover` |
| 6 | Ảnh sách không có trong thư viện bị nhận nhầm 100% | endpoint luôn trả top-1 | `vision_context.decide()` |
| 7 | Mobile hiện "Rất khớp, 82%" | dùng điểm fusion như xác suất | trạng thái bằng lời + độ tương đồng ghi rõ không phải xác suất |
| 8 | Chatbot không có bằng chứng từng nhận định | chỉ có `context_sources` + cảnh báo số | `ai_core/explainability.py` (chung hợp đồng với assistant) |
| 9 | "Trong số đó…" không lọc danh sách lượt trước | planner chỉ gắn nhãn `last_items` | `entities.subset_items` + ghi chú cho model + chọn tool phù hợp |
| 10 | "Chi nhánh Hà Nội" đoán thành Kho Hà Nội | alias tên ngắn khớp trước | kiểm tra chi nhánh trùng tên trước → hỏi lại |
| 11 | Semantic planner không được đọc câu luật hỏi "chỉ số nào?"; định tuyến thừa | `guarded()` chặn mọi câu hỏi lại; động từ phân tích bị tính là vế chưa hiểu | cho phép với câu thiếu chỉ số có ≥ 3 từ nội dung; coi "so sánh/vì sao + kho/kỳ" là đã hiểu |

## 2. File thay đổi

### Backend `services/ai-service`
| File | Thay đổi |
|---|---|
| `ai_core/capabilities.py` (mới) | registry năng lực, persona, trải nghiệm, gợi ý, allowlist tool |
| `ai_core/explainability.py` (mới) | hợp đồng bằng chứng thống nhất; kiểm chứng chatbot; định dạng lại assistant |
| `ai_core/tools.py` | `CALLER` contextvar + từ chối tool ngoài năng lực |
| `routes_ai_experience.py` (mới) | `GET /capabilities`, `POST /vision/identify`, ngữ cảnh ảnh cho lượt sau |
| `image_input.py` (mới) | kiểm tra ảnh, re-encode bỏ EXIF |
| `vision_context.py` (mới) | quyết định, giải thích, ngữ cảnh ảnh |
| `routes_cover_search.py` | `_run_cover_ocr(report_error=False)`; chặn file không phải ảnh / quá lớn |
| `user_personal_context.py` | endpoint theo registry; sửa đường ngoại lệ; dữ liệu supplier; persona nhiều role |
| `main.py` | trường request tùy chọn, ngữ cảnh ảnh trong chat/assistant, `explainability`, gate analytics theo năng lực, đăng ký router |
| `copilot_plan.py`, `copilot_response.py`, `copilot_semantic_planner.py` | F2 (bảng §1, #9–11) |
| `eval/nlu_phase1/eval_nlu_phase1.py` | `--dataset`, `--reports`, kỳ `today`, khóa `subset` (đổi trước baseline) |
| `eval/nlu_phase_f/*` (mới) | bộ held-out Phase F + freeze + băm code ứng viên |
| `eval/cover_search/phase_f_decision_eval.py`, `eval/phase_f_e2e.py`, `eval/phase_f_explainability_eval.py` (mới) | benchmark/E2E |
| `test_phase_f_*.py` (4 file mới), `test_phase_e_personal_context.py` (1 dòng: tham chiếu registry thay cho `_ROLE_ENDPOINTS` đã bỏ) | test |

### Web `apps/web`
`services/ai-experience.ts` (mới), `services/ai.ts` (trường tùy chọn `image`, `explainability`, `image_context`; lỗi HTTP có `detail`),
`components/ai-experience/*` (mới: hook ảnh, composer ảnh, thẻ nhận diện, panel bằng chứng), `components/ai-chatbot.tsx`,
`components/pages/ai-assistant.tsx`, `components/ai-assistant/{assistant-composer,assistant-message,model}.tsx|ts`,
`components/pages/supplier/supplier-account.tsx` (gắn chatbot).

### Mobile `apps/mobile`
`src/api/coverSearch.ts` (`identifyBookByPhoto`), `app/customer/scan-cover.tsx` (endpoint mới, trạng thái bằng lời, bằng chứng, tồn chi nhánh, thông báo),
`app/customer/assistant.tsx` (nút máy ảnh → quét bìa).

### Tài liệu
`docs/AI/PHASE_F_*.md` (9 file), `docs/AI/phase-f-evidence/*.png`, cập nhật `docs/SERVICES/AI_SERVICE.md`, `docs/AI/PERMISSION_MATRIX.md`.

### Vòng 2
| File | Thay đổi |
|---|---|
| `services/ai-service/llm_provider.py` | chờ theo `Retry-After` (≤ `OPENROUTER_RATE_LIMIT_RETRY_MAX_SECONDS`, mặc định 2) trước retry khi 429; stream có một lần chờ-và-retry |
| `services/ai-service/test_action_lifecycle.py` | harness dùng file SQLite tạm thay cho in-memory `StaticPool` (sửa flaky); không đổi khẳng định nào |
| `services/ai-service/ai_core/explainability.py` | không nhận định nào được kiểm → không PASSED; khử dòng lặp |
| `apps/web/src/components/ai-assistant/{assistant-message.tsx, model.ts}`, `pages/ai-assistant.tsx` | panel `explainability` dưới câu trả lời |
| `apps/mobile/{package.json, app.json}`, `pnpm-lock.yaml` | thêm `expo-image-picker ~58.0.10` + plugin (`photosPermission`, tắt micro) |
| `apps/mobile/app/customer/scan-cover.tsx` | nút chọn ảnh có sẵn |
| `copilot_semantic_planner.py`, `docker-compose.yml`, `compose.prod.yml`, `.env.example` | cờ semantic planner mặc định ON |

## 3. API

| Thay đổi | Tương thích |
|---|---|
| `GET /ai/capabilities` (mới) | – |
| `POST /ai/vision/identify` (mới) | – |
| `/chat`, `/chat/stream`, `/assistant`, `/assistant/stream`: request thêm `attachment_id`, `book_id`, `image_turn` (tùy chọn); response thêm `explainability`, `image_context` (tùy chọn) | client cũ không đổi |
| `/find-book-by-cover`: 413/415 cho file quá lớn / không phải ảnh raster | client quét bìa hiện có gửi JPEG — không ảnh hưởng (test cũ pass) |

## 4. Database migration

Không có. Ngữ cảnh ảnh lưu trong bộ nhớ process (TTL 30 phút) — giới hạn đã ghi.

## 5. Cờ tính năng

`COPILOT_SEMANTIC_PLANNER` **bật mặc định (ON)** từ vòng 2 — `copilot_semantic_planner.py`, `docker-compose.yml`, `compose.prod.yml`, `.env.example`. Lý do và số liệu: `PHASE_F_BENCHMARK_REPORT.md` §2.4. Tắt lại: đặt `COPILOT_SEMANTIC_PLANNER=off` trong `.env` rồi khởi động lại ai-service.

## 6. Vấn đề chưa giải quyết

Xem `PHASE_F_TEST_REPORT.md` §6 và `PHASE_F_BENCHMARK_REPORT.md` §6.
