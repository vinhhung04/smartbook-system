# Phase F — Báo cáo kiểm thử

> Tất cả lệnh dưới đây đã chạy thật ngày 2026-11-13 trên máy phát triển (Windows, Python 3.14, Node 24). Lỗi và lần chạy hỏng được ghi đủ.

## 1. Baseline (trước mọi thay đổi Phase F, HEAD 63c2fa8)

| Bộ | Lệnh | Kết quả |
|---|---|---|
| ai-service pytest | `python -m pytest -q` | 1356 pass, 12 skip |
| web unit | `node --test tests/*.test.mjs` | 49 pass |
| web typecheck | `npx tsc --noEmit -p .` | sạch |
| mobile jest / typecheck | `npx jest`, `npx tsc --noEmit` | 216 pass / sạch |

## 2. Sau Phase F

| Bộ | Kết quả | Ghi chú |
|---|---|---|
| ai-service pytest toàn bộ | **1427 pass**, 12 skip, **0 fail** (vòng 2) | vòng 1: 1422 pass + 1 fail flaky có sẵn (`test_two_concurrent_confirms_execute_once`, fail 2/6 trên bản sạch HEAD). Vòng 2 tìm ra nguyên nhân gốc và sửa (§7) |
| Unit test mới | 71 test (+ subtest) | `test_phase_f_role_aware.py` 18, `test_phase_f_multimodal.py` 24, `test_phase_f_planner.py` 14, `test_phase_f_explainability.py` 12, `test_llm_provider.py` +3 (chờ khi 429, stream retry) |
| Test cũ được sửa | 1 dòng | `test_phase_e_personal_context`: tham chiếu `capabilities.personal_endpoints` thay cho hằng `_ROLE_ENDPOINTS` đã bị registry thay thế; khẳng định giữ nguyên. Không xóa test nào |
| web typecheck / eslint (file đổi) / build | sạch / sạch / `vite build` thành công | |
| web unit | 49 pass | |
| mobile typecheck / eslint / jest | sạch / sạch / 216 pass | |

## 3. Integration / E2E trên stack thật

Stack Docker cục bộ (gateway, auth, inventory, borrow, analytics, Postgres, Redis, RabbitMQ) + ai-service build từ working tree + OpenRouter thật.

| Bộ | Lần 1 | Lần 2 | Nội dung |
|---|---|---|---|
| `eval/phase_f_e2e.py` (API, 6 role) | 38/39 | **39/39** (lần 3 cờ ON: 39/39; lần 4 bản cuối: 39/39) | lần 1: ADMIN nhận diện ảnh trả HTTP 200 nhưng sách top khác kỳ vọng; gọi lại 2/2 đúng — nghi lỗi OCR tạm thời của provider (cùng ngày ghi nhận lỗi HTTP từ OpenRouter) |
| Playwright UI (Edge, Vite 5174, context riêng) | customer flow timeout (chờ chip ngữ cảnh ảnh > 90 s), 4 kiểm tra khác pass | **5/5** pass | luồng độc giả: gợi ý theo năng lực → thông báo → chọn ảnh → preview → nhận diện → trả lời có tồn theo chi nhánh → panel "Vì sao"; localStorage không chứa dữ liệu ảnh; supplier không có nút ảnh; manager có nút ảnh trong `/ai-assistant`; staff có gợi ý kho; 390 px không tràn ngang. Ảnh chụp: `docs/AI/phase-f-evidence/` |
| Hồi quy `e2e/ai-chat-streaming`, `ai-copilot-decision`, `ai-copilot-visualization` | **15/15** | – | config Edge tạm, đã xóa sau khi chạy |

Các kiểm tra E2E API (đều PASS ở lần 2): `capabilities` đúng trải nghiệm 6 role + ẩn danh; supplier/khách không có ảnh/có ảnh đúng quyền;
4 role ngoài quản lý → `/assistant` 403; supplier chỉ đọc đơn của mình, không chạm `/analytics`, `/api/books`, `/borrow`; khách hỏi KPI hệ thống không có
nguồn analytics; ảnh: supplier 403, thiếu xác nhận 428, SVG 415, ẩn danh 401; khách nhận diện đúng sách có trong catalog; câu trả lời theo sau dùng ngữ
cảnh ảnh + bằng chứng IMAGE_RECOGNITION; câu hỏi tiếp "Sách này có được mượn nhiều không?" giữ sách; đổi chủ đề không dùng sách cũ; thủ thư dùng
attachment của khách → 410; book_id giả → 400; staff/librarian/admin/manager nhận diện được; manager hỏi assistant về sách trong ảnh có `image_context`
và hợp đồng `explainability`; logout thật → `/capabilities` và `/vision/identify` 401.

Vòng 2, Playwright bổ sung: `/ai-assistant` hiển thị panel `explainability` dưới câu trả lời thật (`manager-assistant-evidence-panel-v2.png`);
app mobile (bản web, 390 px) chọn ảnh có sẵn → nhận diện → trạng thái bằng lời, không có phần trăm (`mobile-scan-cover-result.png`).
Lần chạy đầu của kiểm tra panel assistant gặp câu trả lời "AI không khả dụng" do OpenRouter 429 trên đường stream → đã sửa (§7) và chạy lại pass.

## 4. Security tests (tổng hợp)

| Nhóm | Số ca | Vi phạm |
|---|---|---|
| Role/permission matrix (unit) | 18 test + 16 subtest | 0 |
| NLU security turns | bộ mới 9 lượt × 6 lần chạy; bộ Phase 1 11 lượt × 5 lần chạy | 0 |
| E2E bảo mật (mỗi lần chạy) | 17 check từ chối/cô lập (gate 4, supplier 3, khách 1, ảnh 4, ngữ cảnh ảnh 3, token thu hồi 2) | 0 (cả 2 lần) |

## 5. Không chạy được / không phủ

- Mobile E2E trên thiết bị/emulator: không chạy (chỉ typecheck, lint, jest). Màn hình quét bìa mới chưa được thử với camera thật.
- Production: không deploy, không đo.
- Đa replica ai-service (ngữ cảnh ảnh + rate limit trong bộ nhớ): không kiểm.
- Dữ liệu ảnh chụp thật trong E2E: không có; dùng ảnh bìa tổng hợp (đo offline trên bộ nghiên cứu có ảnh thật).

## 6. Vấn đề tồn tại

1. ~~Test flaky~~ → đã sửa (§7).
2. ~~OpenRouter 429~~ → đã sửa ở `llm_provider`; semantic planner bật mặc định sau khi đo lại (`PHASE_F_BENCHMARK_REPORT.md` §2.4).
3. Ngữ cảnh ảnh và rate limit ảnh nằm trong bộ nhớ process — **giữ nguyên có chủ đích**: dev và prod đều chạy 1 replica, 1 process
   uvicorn (`Dockerfile` CMD không có `--workers`, compose không có `replicas`); chuyển Redis/DB cần thêm dependency hoặc bảng mới mà
   chưa có nhu cầu chứng minh. Cần làm nếu tăng số worker/replica (khi đó ngữ cảnh ảnh sẽ không thấy giữa các process).
4. Near-miss RAG (Phase E E10) vẫn được trả lời; hợp đồng mới đánh dấu PARTIAL, chưa chặn (ngoài phạm vi F1–F4).
5. ~~Mobile chọn ảnh từ thư viện~~ → đã thêm (`expo-image-picker`). Chưa thử trên thiết bị thật (không có thiết bị/emulator).
6. ~~Panel `explainability` trên `/ai-assistant`~~ → đã thêm.

## 7. Vòng 2 (làm tiếp các vấn đề còn lại)

| Vấn đề | Nguyên nhân gốc | Sửa | Bằng chứng |
|---|---|---|---|
| `test_two_concurrent_confirms_execute_once` flaky | SQLite in-memory + `StaticPool`: mọi session dùng **một** kết nối, nên khi test đóng session đọc trạng thái, ROLLBACK luôn câu UPDATE "claim" chưa commit của request song song (đo được: CONFIRMED → PENDING_CONFIRMATION trong khi request vẫn chạy). Lỗi harness test, không phải production (Postgres mỗi session một kết nối; có test PG riêng) | test dùng file SQLite tạm, mỗi session một kết nối | 8/8 lần chạy cả file pass; pytest toàn bộ 0 fail |
| Semantic planner rơi về luật 18–35% | OpenRouter 429; retry ngay lập tức lại 429 | chờ theo `Retry-After` (≤ 2 s) trước retry | lượt rơi về luật 0/17, 0/17, 1/23, 3/23 |
| Assistant trả "AI không khả dụng" khi bị 429 | đường stream không retry | một lần chờ-và-retry khi 429 đến trước token đầu | unit test + Playwright pass |
| Panel bằng chứng `/ai-assistant` báo "Đã kiểm chứng" cho câu trả lời "không có quyền xem dữ liệu" | không có nhận định nào được kiểm nhưng trạng thái assistant là PASSED | không có nhận định → `NO_EVIDENCE` / `NO_FACTUAL_CLAIMS`, không bao giờ PASSED; bỏ dòng lặp | unit test, ảnh v2 |
