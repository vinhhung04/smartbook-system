# Phase F — Checklist công việc

> Quy tắc: chỉ đánh dấu `[x]` khi việc đã làm xong **và** có bằng chứng (test chạy, lệnh chạy, file tồn tại).
> Việc không làm được ghi `[ ] … — BLOCKED: <lý do>` hoặc `— PARTIAL: <phần còn thiếu>`.
> Rà soát cuối thực hiện ngày 2026-11-13 (mục 10), rà lại lần 2 sau vòng 2 (mục 11) — mỗi mục đã được đối chiếu với bằng chứng ghi bên cạnh.

Nhánh `hungg`, baseline HEAD `63c2fa8`.

## 0. Pre-flight (F0)
- [x] Đọc CLAUDE.md, AGENTS.md, kiểm tra branch/HEAD/working tree (không ghi đè thay đổi chưa commit) — HEAD = baseline; các thay đổi sẵn có của người dùng (diagrams, docx, skills) không bị chạm
- [x] Đọc 7 tài liệu AI bắt buộc
- [x] Kiểm tra backend AI, frontend web, mobile, Supplier Portal, gateway
- [x] Chạy baseline test ai-service, web, mobile — 1356/12 skip; 49; 216; typecheck sạch
- [x] Viết `docs/AI/PHASE_F_PRE_FLIGHT_AUDIT.md`

## 1. Role-aware AI (F1)
- [x] Capability registry trong `ai_core` — `ai_core/capabilities.py`, tham chiếu `ACTION_CONFIG`/READ tools, không định nghĩa lại
- [x] Multi-role theo mọi role AND permission — `personal_endpoints()`; test `test_multi_role_*`
- [x] SUPPLIER đọc đơn của chính mình qua `/api/supplier-account/orders` — unit + E2E
- [x] Endpoint `GET /capabilities` — E2E 6 role + ẩn danh
- [x] Không mở `/assistant` cho mọi người — test so sánh với `can_use_assistant`; E2E 4 role → 403
- [x] Test bảo mật: đúng/thiếu permission, sai role, multi-role, superuser, token revoked (logout thật), permission thu hồi, dữ liệu người khác (ảnh 410), supplier — `test_phase_f_role_aware.py`, `eval/phase_f_e2e.py`
  - ghi chú: "phạm vi kho thay đổi" dựa trên test sẵn có (`test_warehouse_scope`, `_still_visible`) chạy lại trong bộ pytest; "supplier khác" — AI không có tham số chọn nhà cung cấp, inventory lọc theo tài khoản; không có tài khoản supplier thứ hai được dùng trong E2E

## 2. Contextual reasoning (F2)
- [x] Bộ test held-out mới viết và băm trước khi sửa planner; giữ nguyên bộ Phase 1 — `nlu_phase_f_freeze.json`
- [x] Baseline det + hybrid trên test mới; det trên test cũ
- [x] Sửa planner (danh sách lượt trước, chi nhánh trùng tên, "kho kia", "kho nào … hơn" + top, định tuyến "chỉ số nào?", bớt định tuyến thừa)
- [x] Candidate det + hybrid ×2 (+1 lần bổ sung) trên cả hai bộ, đối chiếu A1–A8 — `PHASE_F_BENCHMARK_REPORT.md` §2
- [x] Quyết định cờ — vòng 1 giữ OFF (lỗi 429); vòng 2 sửa 429, đo lại đạt A1–A8 hai lần trên cả hai bộ → **ON** (`PHASE_F_BENCHMARK_REPORT.md` §2.4)
- [x] Test planner hiện có vẫn pass (165 + 14 test mới)

## 3. Multimodal (F3)
- [x] Kiểm tra ảnh an toàn (chữ ký, 8 MB, 40 MP, ảnh hỏng, chặn SVG/GIF ở endpoint mới) — `image_input.py`, test
- [x] Endpoint nhận diện stream trạng thái thật, tái dùng OCR/CLIP/catalog — `routes_ai_experience.py`
- [x] Bằng chứng từng candidate, không gọi là xác suất
- [x] IDENTIFIED / AMBIGUOUS / NO_MATCH, cho chọn candidate
- [x] Ngữ cảnh ảnh server-side theo chủ sở hữu, TTL, không lưu ảnh; book_id phải thuộc candidate
- [x] `/chat`, `/chat/stream`, `/assistant`, `/assistant/stream` nhận tham chiếu ảnh (tùy chọn)
- [x] Rate limit ảnh, timeout OCR/CLIP, fallback OCR/CLIP, không log ảnh — test fallback
- [x] Không ghi catalog từ ảnh
- [x] Benchmark multimodal trên dữ liệu sẵn có — `eval/cover_search/phase_f_decision_eval.py` (offline; giới hạn đã ghi)

## 4. Explainable AI (F4)
- [x] Hợp đồng `explainability` thống nhất chat + assistant (tương thích ngược)
- [x] Claim-level verification cho chatbot
- [x] FACT/INFERENCE/ASSUMPTION/UNKNOWN; không PASSED khi có claim không bằng chứng — test + benchmark (`passed_with_unsupported = 0`)
- [x] Citation chỉ tới tài liệu thật, kiểm tra trùng nội dung đoạn
- [x] Giải thích nhận diện ảnh từ tín hiệu thật
- [x] Không confidence số chưa hiệu chỉnh (web + mobile bỏ "82%"); bằng chứng chỉ từ nguồn lượt này đọc

## 5. UI/UX (F5)
- [x] Web chatbot: đính kèm ảnh, preview, xóa, thay, trạng thái thật, retry, giới hạn, thông báo — Playwright
- [x] Web: thẻ nhận diện, panel "Vì sao AI đưa ra kết quả này?", trạng thái kiểm chứng
- [x] Web: gợi ý theo capability
- [x] Trang Decision Assistant: ảnh + thẻ nhận diện + panel `explainability` (vòng 2; Playwright `manager-assistant-evidence-panel-v2.png`)
- [x] Supplier: entrypoint AI trên `/supplier`
- [x] Mobile customer: camera + chọn ảnh có sẵn (vòng 2, `expo-image-picker`), preview, thẻ candidate, bằng chứng, lỗi — kiểm bằng Playwright trên bản web của app
  - ghi chú: chưa thử trên thiết bị/emulator thật (không có trong môi trường) — BLOCKED cho phần thiết bị
- [x] Không lưu ảnh vào localStorage (Playwright kiểm); không đổi sidebar/dashboard/design system
- [x] `docs/AI/PHASE_F_DESIGN_REFERENCES.md` (tra cứu làm sau khi dựng UI — đã ghi rõ)

## 6. Kiểm thử (F6)
- [x] Unit test mới — 67 test
- [x] Toàn bộ pytest ai-service — vòng 2: **1427 pass, 0 fail** (test flaky có sẵn đã sửa tận gốc ở harness)
- [x] Web: typecheck, eslint file đổi, unit 49, build
- [x] Mobile: typecheck, eslint, jest 216
- [x] Gateway / service khác — không thay đổi code; dùng qua E2E
- [x] E2E trên stack thật — API 39/39 (lần 2, 3, 4; lần 1 38/39), UI 5/5 + 2 kiểm tra vòng 2, hồi quy AI 15/15

## 7. Benchmark (F7)
- [x] Contextual reasoning trước/sau
- [x] Multimodal
- [x] Role-aware
- [x] Explainability

## 8. Tài liệu (F8)
- [x] PHASE_F_PRE_FLIGHT_AUDIT.md
- [x] PHASE_F_ARCHITECTURE.md
- [x] PHASE_F_ROLE_CAPABILITY_MATRIX.md
- [x] PHASE_F_MULTIMODAL.md
- [x] PHASE_F_EXPLAINABILITY.md
- [x] PHASE_F_TEST_REPORT.md
- [x] PHASE_F_BENCHMARK_REPORT.md
- [x] PHASE_F_IMPLEMENTATION_REPORT.md
- [x] Cập nhật AI_SERVICE.md / PERMISSION_MATRIX.md

## 9. Ràng buộc tuyệt đối
- [x] Không commit / push / merge / deploy (chỉ build lại ảnh Docker **cục bộ** để E2E; bản cũ giữ tag `pre-phase-f`)
- [x] Dependency mới duy nhất: `expo-image-picker ~58.0.10` (gói Expo chính chủ, lockfile chỉ thêm gói này + `expo-image-loader`)
- [x] Không migration DB
- [x] Không xóa endpoint, không phá API contract (chỉ thêm trường tùy chọn; `/find-book-by-cover` thêm 413/415 cho file không hợp lệ)
- [x] Không đổi module ngoài phạm vi AI (ngoài 1 dòng gắn chatbot vào trang Supplier)

## 10. Rà soát cuối
- [x] Rà lại toàn bộ checklist, đối chiếu bằng chứng từng mục, cập nhật trạng thái thật — vòng 1 còn 2 mục PARTIAL

## 11. Vòng 2 — làm tiếp vấn đề còn lại
- [x] Sửa test flaky tận gốc (StaticPool dùng chung một kết nối SQLite) — 8/8 lần chạy pass
- [x] Retry có chờ khi OpenRouter 429 (thường + stream), đo lại semantic planner — fallback 0–3 lượt/lần chạy
- [x] Bật cờ semantic planner theo tiêu chí đăng ký
- [x] Panel `explainability` trên `/ai-assistant`; sửa trạng thái "PASSED" khi không có gì được kiểm
- [x] Mobile chọn ảnh có sẵn
- [x] Lưu ngữ cảnh ảnh dùng chung nhiều instance — **không làm có chủ đích**: 1 replica, 1 process (Dockerfile/compose đã kiểm); cần thêm dependency/bảng mới khi chưa có nhu cầu. Ghi vào báo cáo kiểm thử §6.3
- [ ] Thử mobile trên thiết bị thật — BLOCKED: không có thiết bị/emulator trong môi trường
- [x] Rà lại checklist lần 2 sau vòng 2
