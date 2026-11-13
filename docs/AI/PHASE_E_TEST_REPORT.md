# Phase E — Test report

Ngày chạy: 2026-11-13 (giờ máy UTC+7; tên báo cáo eval dùng UTC). Nhánh `hungg`, HEAD `7f8a111` + thay đổi Phase E chưa commit. Môi trường: stack Docker cục bộ (`docker compose`, PostgreSQL 16 dùng chung, Redis, RabbitMQ), image cục bộ build lại từ working tree; image cũ giữ tag `pre-phase-e`. **Không có số liệu nào là ước lượng hay tự tạo; mọi dòng dưới đây là kết quả lệnh đã chạy.** Bằng chứng thô: `docs/AI/phase-e-evidence/`.

## 1. Tổng hợp

| Nhóm | Bộ test | Tổng | Pass | Fail | Skip | Blocked |
|---|---|---:|---:|---:|---:|---:|
| Unit | ai-service `pytest` (toàn bộ) | 1368 | 1356 | 0 | 12 | 0 |
| Unit | borrow-service `node --test` | 156 | 156 | 0 | 0 | 0 |
| Unit | analytics-service `node --test` | 152 | 149 | 0 | 3 | 0 |
| Unit | auth-service | 86 | 86 | 0 | 0 | 0 |
| Unit | inventory-service | 206 | 206 | 0 | 0 | 0 |
| Unit | api-gateway | 15 | 15 | 0 | 0 | 0 |
| Unit | web `node --test tests/*.test.mjs` | 49 | 49 | 0 | 0 | 0 |
| Unit | mobile `jest` (không đổi code mobile) | 216 | 216 | 0 | 0 | 0 |
| Integration (PostgreSQL thật) | borrow `reservation-idempotency.db.test.js` | 10 | 10 | 0 | 0 | 0 |
| Integration (PostgreSQL thật) | ai `test_agent_store_pg.py` | 6 | 6 | 0 | 0 | 0 |
| E2E (stack thật) | `scripts/phase-e/reservation-idempotency-e2e.py` | 10 | 10 | 0 | 0 | 0 |
| E2E (stack thật) | `scripts/phase-e/reconciliation-e2e.py` | 13 | 13 | 0 | 0 | 0 |
| E2E UI (Edge headless, stack thật) | `scripts/phase-e/reconciliation-ui-check.mjs` | 8 | 8 | 0 | 0 | 0 |
| Static | web `tsc --noEmit`, `eslint .` | — | sạch | — | — | — |

Skip: 12 ở ai-service là test cần biến môi trường (`TEST_PG_DSN`, …) — trong đó `test_agent_store_pg.py` đã được chạy riêng trên PostgreSQL (dòng Integration). 3 ở analytics là test DB-gated có sẵn từ trước (không chạy trong đợt này).

Repo **không có** E2E Playwright tự động cho các luồng này trong CI; các script E2E Phase E chạy tay trên stack cục bộ (ghi chú ở mục 7).

## 2. Unit / integration theo hạng mục

| Hạng mục | Test | Kết quả |
|---|---|---|
| Idempotency reservation | `services/borrow-service/test/reservation-idempotency.db.test.js` (controller thật + Prisma + PostgreSQL thật; inventory là stand-in giữ đúng hợp đồng dedup theo `reservation_id`) | **10/10** trên code mới. **Cùng test trên controller của HEAD: 4 pass / 6 fail** — tái hiện đúng các lỗi: retry reservation chạm giới hạn bị 409, retry sau khi membership đổi bị 409, hai request đồng thời làm request thua **nhả stock hold** của request thắng, (thêm 3 test cho hành vi mới: mã `IDEMPOTENCY_KEY_REUSED`, scope theo user, id cũ). |
| Action state machine | `test_action_lifecycle.py` (14), `test_phase_e_actions.py` (14 + 28 subtest), `test_agent_store.py` | pass. Hai lần đối chiếu đồng thời trên SQLite có kết nối riêng: trước sửa `(2 thắng, 0 bị từ chối)`, sau sửa `(1, [409])`. |
| Concurrency PostgreSQL | `test_agent_store_pg.py`: 8 claim đồng thời → 1 thắng; 4 confirm đồng thời → thực thi 1 lần; 6 admin đối chiếu đồng thời → đúng 1 thành công + 1 dòng audit; chạy muộn vs đối chiếu → đúng 1 bên thắng | 6/6 |
| Revocation / session | `test_phase_e_actions.py::test_unverified_revocation_is_refused_on_every_action_endpoint` — 8 endpoint (confirm, hủy-qua-confirm, cancel, pending, reconcile, stats, list, detail) đều 503, action không đổi | pass |
| Lộ kết quả EXECUTED | `test_executed_result_is_not_replayed_to_another_user` | pass (trên HEAD: kết quả trả cho bất kỳ header nào) |
| Multi-role | `ReservationRouteTest`: CUSTOMER, LIBRARIAN, ADMIN, CUSTOMER+LIBRARIAN (có/không khách), CUSTOMER+ADMIN, superuser; từ chối: không role, role thiếu permission (CUSTOMER, LIBRARIAN), WAREHOUSE_STAFF, CUSTOMER+WAREHOUSE_STAFF | pass (14 subtest) |
| Reconciliation | admin-only (LIBRARIAN/CUSTOMER/MANAGER 403), ghi chú rỗng/ngắn 400, EXECUTED thiếu bằng chứng 400, audit đủ trường, không đối chiếu lần 2, FAILED không chạy lại, bộ lọc type/created_by/thời gian + phạm vi non-admin | pass |
| Personal context | `test_phase_e_personal_context.py` (11 + 9 subtest): chọn topic theo câu hỏi, câu hỏi công khai không gọi endpoint nào và prompt không có dữ liệu cá nhân, câu hỏi phạt chỉ tải phạt, lỗi tải không bịa, formatter loans/reservations/tasks/thống kê thủ thư | pass |
| Retrieval | `test_book_index.py::AuthorRouteTest` (2), các test ISBN/title có sẵn | pass |
| Bộ chấm RAG | `test_eval_chat_answers.py` (15): dynamic cần expected facts, không truth → UNVERIFIABLE, số 0 cần câu "không có", id bịa, authorization, "hôm nay", any-of, số liệu theo tài liệu, citation recall, `10.000đ`, `customer01` không phải số, cụm cấm dạng "cho phép hay cấm" | pass |
| Reorder | `reorder-budget-endpoint.test.js` (+1 test): dòng lệch borrow/inventory không được cấp, được báo cáo; dòng nhất quán vẫn được cấp | pass |
| Trace | `test_reservation_actions.py::test_executor_forwards_the_request_id` | pass |

**Test treo có sẵn đã sửa:** `test_action_lifecycle.py::test_two_concurrent_confirms_execute_once` treo **2/3 lần trên HEAD sạch** (worktree tách riêng): test chờ 50 ms rồi mới gửi confirm thứ hai; trên máy chậm, confirm thứ hai claim trước và chờ `gate` mãi. Sửa bằng cách chờ đến khi action thực sự CONFIRMED (không đổi assertion): 5/5 lần pass.

## 3. E2E trên stack thật

### 3.1 Đặt chỗ qua AI — `reservation-idempotency-e2e.py` (10/10)
Bạn đọc `customer01` → `/ai/chat` "Đặt giúp tôi cuốn Truyện Kiều" → bản nháp có variant + chi nhánh nhận sách → confirm → borrow-service tạo `RSV-6531B48E` → confirm lại: replay kết quả đã lưu → retry cùng key: `200 idempotent` cùng id → 4 retry đồng thời: cả 4 cùng id → cùng key khác payload: `409 IDEMPOTENCY_KEY_REUSED` → thủ thư dùng cùng key cho cùng khách/sách: không nhận được reservation của bạn đọc (409 trùng sách) → key mới cùng sách: 409 trùng → **restart borrow-service** rồi retry: `200` cùng id → tổng reservation của bạn đọc tăng đúng 1 (80 → 81). Reservation được hủy khi kết thúc. Chạy lại lần nữa để lưu log (`phase-e-evidence/reservation-idempotency-e2e.txt`): 10/10, 81 → 82.

Hai lần chạy đầu thất bại và dẫn tới sửa code (không phải sửa test để qua): (1) bản nháp không có variant vì `RESERVATION_QUERY` không lấy catalog → thêm tra catalog trong planner; (2) inventory từ chối "Selected warehouse is not a valid pickup location" vì dùng kho mặc định → chọn chi nhánh nhận sách giống dialog đặt chỗ của cổng bạn đọc. Lần chạy thứ ba lỗi ở bước 10 do script đếm trang 20 dòng → sửa script dùng `meta.total`.

### 3.2 Đối chiếu — `reconciliation-e2e.py` (13/13)
`manager01` → `/ai/chat` tạo `CREATE_REORDER_DRAFT` → **dừng inventory-service** → confirm → kết quả không xác định → `RECONCILE_REQUIRED` (lý do: "some lines have an unknown outcome") → confirm lại: 409 → `customer01` đọc: 403 → `librarian01` đối chiếu: 403 → `hung` (ADMIN) thấy trong hàng đợi (lọc status+type) → đọc chi tiết + audit → ghi chú rỗng: 400 → đối chiếu FAILED (kiểm tra danh sách đề xuất nhập; **xác nhận thêm bằng DB: 0 purchase request tạo trong 30 phút**) → audit `RECONCILED` có actor, role ADMIN, RECONCILE_REQUIRED→FAILED, ghi chú → lần 2: 409 → đọc lại: vẫn FAILED.

### 3.3 Giao diện — `reconciliation-ui-check.mjs` (8/8, Edge headless, context riêng)
Admin: chip "Chờ đối chiếu" hiện action với người tạo + lý do; nút gửi bị khóa khi chưa chọn kết quả/ghi chú và khi chọn "Đã thực hiện" mà không có mã tham chiếu; gửi "Chưa thực hiện" → toast thành công → timeline có "Admin đã đối chiếu" + ghi chú → tải lại trang: hàng đợi trống. Người tạo (manager, không phải admin): không có biểu mẫu đối chiếu. Ảnh: `phase-e-evidence/reconcile-ui-*.png`. Sau lần chạy đầu, viền radio quá nhạt → thêm token viền cho hai radio của biểu mẫu (không sửa component dùng chung) và chạy lại.

### 3.4 Reorder (đo trực tiếp `/analytics/reorder-suggestions`, `manager01`, `limit=100`)

| Ngân sách | HEAD: dòng/bản/chi | Phase E: dòng/bản/chi | Phase E: `unreliable_lines` | `data_consistency` |
|---:|---|---|---:|---|
| 0 | 0 / 0 / 0 | 0 / 0 / 0 | 98 | MISMATCH, thừa 576 phiếu mở |
| 500.000 | 1 / 2 / 440.000 | 0 / 0 / 0 | 98 | MISMATCH |
| 5.000.000 | 1 / 4 / 880.000 | 0 / 0 / 0 | 98 | MISMATCH |
| 50.000.000 | 1 / 4 / 880.000 | 0 / 0 / 0 | 98 | MISMATCH |

Mọi trường hợp `funded_cost ≤ budget` và bằng tổng các dòng. Trên dữ liệu demo, borrow_db có 578 khoản vay mở còn inventory_db ghi 2 bản đang cho mượn, nên gần như mọi dòng bị giữ lại kèm cảnh báo (ảnh `reorder-budget-mismatch-warning.png`). Đây là hành vi có chủ đích (không đề xuất mua trên dữ liệu lệch), không phải số liệu được làm đẹp.

## 4. Security tests

Invalid session → 401 (test có sẵn `get_user_context`); auth không trả lời → 503 (có sẵn); **revocation chưa xác minh → 503 trên cả 8 endpoint action** (mới); thiếu permission → 403 (`test_action_permissions.py`, `ReservationRouteTest.test_refusals`); sai phạm vi kho → 403 (`test_warehouse_scope.py`, `action_guard` — có sẵn, pass); người khác đọc/xác nhận action → 403, kể cả action đã EXECUTED (mới); customer/librarian không đọc/đối chiếu được action của người khác (E2E 3.2). `test_copilot_security.py`, `test_permission_matrix.py`, `test_assistant_conversation_access.py` pass trong lượt chạy toàn bộ.

## 5. RAG evaluation

### 5.1 Retrieval — `eval_rag.py` (226 câu, embedding `qwen/qwen3-embedding-8b@768` từ cache, catalog live 135 sách)

Báo cáo: `eval/reports/rag_20261113_032136_phase-e-before-head.md` (code `assistant_tools.py` của HEAD) và `rag_20261113_032143_phase-e-after.md`; số liệu máy đọc: `rag_metrics_*.json`.

| Chỉ số | HEAD | Phase E |
|---|---:|---:|
| BOOK_METADATA R@5 (mọi case, như báo cáo cũ) | 0,2082 | 0,2092 |
| INTERNAL_DOC R@5 (mọi case) | 0,6387 | 0,6387 |
| Overall No-answer acc / FPR | 0,7935 / 0,2065 | 0,7935 / 0,2065 |

Theo loại truy vấn (R@5 / MRR trên case **còn tìm được**; P@5 trên case có đáp án; no-answer acc / FPR):

| Loại | Có đáp án | Unreachable | HEAD R@5 · MRR · P@5 | Phase E R@5 · MRR · P@5 | No-answer acc · FPR |
|---|---:|---:|---|---|---|
| ISBN | 11 | 5 | 1,00 · 1,00 · 0,11 | 1,00 · 1,00 · 0,11 | — |
| TITLE | 5 | 1 | 1,00 · 1,00 · 0,16 | 1,00 · 1,00 · 0,16 | 1,00 · 0,00 |
| AUTHOR | 6 | 2 | 0,569 · 0,792 · 0,48 | **0,597** · 0,792 · **0,52** | — |
| CATEGORY | 5 | 5 | — | — | 1,00 · 0,00 |
| DESCRIPTION | 28 | 17 | 0,909 · 0,921 · 0,08 | 0,909 · 0,921 · 0,08 | 0,857 · 0,143 |
| INTERNAL_DOC | 79 | 0 | 0,962 · 0,943 · 0,50 | 0,962 · 0,943 · 0,50 | 0,70 · 0,30 |

Diễn giải: R@5 thấp của báo cáo cũ chủ yếu do (a) 52/107 và 40/119 case không có đáp án (recall = 0 theo định nghĩa) và (b) **30/55** case sách có đáp án trỏ tới sách không còn trong catalog (ground truth từ snapshot 2026-10-08). R@5 của AUTHOR bị chặn trên vì k = 5 nhỏ hơn số sách của tác giả (Nguyễn Nhật Ánh: 8–9 sách) — P@5 phản ánh tốt hơn. `bm-038` (Tô Hoài) là drift dữ liệu: snapshot ghi "Project Hail Mary" là của Tô Hoài. Ground truth **không** bị sửa; các case drift được báo cáo riêng.

### 5.2 Calibration — `calibrate_rag.py` (`calibration_20261113_032221.md`)
BOOK_METADATA: `NO_VALID_CANDIDATE` → giữ threshold. INTERNAL_DOC: ứng viên `tau_confident=0.5, tau_evidence=0.4`; trên nửa test giữ lại: answerable R@5 1,0, no-answer acc 0,64, FPR 0,36. `tau_evidence` trùng production (0,4) nên **không đổi threshold**. Không có tuyên bố hiệu quả trên test set dựa trên dữ liệu calibration.

### 5.3 Câu trả lời cuối — `eval_chat_answers.py` (live qua gateway, OpenRouter, dataset v2-2026-11-13, 33 câu)

Cùng bộ chấm cuối cùng; câu trả lời và truth động là của từng lượt chạy (rescore dùng `truth_observed` lưu trong báo cáo):

| Lượt | Code | Báo cáo | PASS | FAIL | UNVERIFIABLE |
|---|---|---|---:|---:|---:|
| Baseline 2026-11-12 (v1 scorer báo 28/32) | HEAD trước | `chat_answers_rescore_20261112_231216` (từ `chat_answers_20261112_192035`) | 24 | 4 | 4 (4 case động: truth lúc đó không lưu) |
| Before | HEAD (`7f8a111`) | `chat_answers_rescore_20261112_231219` (từ `…_210353`) | 26 | 6 | 1 |
| After | Phase E (trước 3 sửa cuối) | `chat_answers_rescore_20261112_231221` (từ `…_211409`) | 27 | 4 | 2 |
| Final | Phase E (image cuối) | `chat_answers_20261113_032827` (chạy trực tiếp với scorer cuối) | 30 | 2 | 1 |

Theo nhóm (Before → After): dynamic_data **3/5 → 5/5** (dyn-03 "0 phiếu quá hạn" → "436"; dyn-04 "47 task đang chờ" → 12 việc mở); partial_evidence 1/4 → 1/4; near_miss 3/4 → 3/4; multi_source 4/4 → 3/4 (+1 UNVERIFIABLE: "41 ngày" = 21 + 10 + 10, số suy ra mà luật không kiểm được). Citation (After): precision 0,633 · relevance 0,619 · recall 0,875 · completeness 0,80 · numeric claim support 0,903. Abstention accuracy 0,875, false refusal 0,0.

Mỗi cấu hình chạy **một lần** với LLM (nhiễu giữa các lần là thật: `ans-part-01` đạt ở lần chạy đầu, trượt ở lần sau trên cùng code). Chỉ cải thiện dynamic_data có nguyên nhân gốc rõ ràng (formatter); các chênh lệch ±1 khác không nên coi là có ý nghĩa thống kê.

Lượt `chat_answers_20261112_205236` chạy với scorer còn lỗi chuẩn hóa `10.000đ` — giữ nguyên file, **không dùng** để so sánh.

### 5.4 Final run (image ai-service cuối cùng)

`chat_answers_20261113_032827`: **30 PASS / 2 FAIL / 1 UNVERIFIABLE**, answer accuracy (trên case kiểm chứng được) 0,938. Theo nhóm: full 4/4, partial 3/4, no-evidence 4/4, false-premise 4/4, contradicts 3/4 (+1 UNVERIFIABLE), dynamic 5/5 (truth: 0 phiếu đang mượn, 0 khoản phạt, 436 quá hạn, 12 việc mở; dyn-05 bạn đọc không nhận được con số 436), multi-source 4/4, near-miss 3/4. Còn trượt: `ans-part-04` (không nói rõ trả góp chưa được mô tả), `ans-near-02` (tự khẳng định về SMS). Citation: precision 0,633 · relevance 0,619 · recall 0,875 · completeness 0,80 · numeric support 0,957. Abstention 0,875, false refusal 0,0, throttled 0.

So với lượt "After" (cùng nhóm code, trước 3 sửa cuối không liên quan tới tài liệu): partial 1/4 → 3/4 — **không** có thay đổi nào trong Phase E nhắm vào nhóm này (prompt/generation không đổi), nên chênh lệch này được coi là dao động của LLM giữa các lượt, không phải cải thiện.

## 6. Kiểm tra khác

| Mục | Kết quả |
|---|---|
| Migration | Không có thay đổi `schema.prisma`, thư mục `migrations/`, `db_models.py`. `prisma migrate deploy` trên DB trống `borrow_phase_e_test` chạy đủ 6 migration (cần `CREATE EXTENSION citext` trước — hạn chế có sẵn). |
| Docker build | Build thành công: borrow-service, analytics-service, api-gateway (`docker compose build`), ai-service (context từ file git-tracked). Các container healthy sau khi thay. |
| API compatibility | Chỉ thêm trường/tham số tùy chọn: `evidence_reference`, `type/created_by/created_from/created_to`, `total`, `error_message`, `code: IDEMPOTENCY_KEY_REUSED`, `unreliable_*`, `data_consistency`, sự kiện `ai_action:reconciled`. Thay đổi hành vi có chủ đích: EXECUTED cần `evidence_reference`; ghi chú ≥ 10 ký tự; mọi endpoint action trả 503 khi revocation chưa xác minh; dòng reorder lệch dữ liệu không được cấp ngân sách. |
| UI/UX | Chỉ bổ sung trong Action Center (chip lọc, dòng người tạo/lý do, biểu mẫu đối chiếu cho admin, nhãn audit), một dòng cảnh báo ở Kế hoạch ngân sách, một key i18n. Không đổi route, menu, bố cục, màu, typography. |
| git diff | 31 file sửa (+2031/−325) + file mới liệt kê trong implementation report; không đụng thay đổi chưa commit có sẵn của người dùng. |

## 7. Chưa chạy được / hạn chế

- Không có CI chạy E2E Playwright cho các luồng này; script E2E chạy tay trên stack cục bộ, cần Docker và tài khoản demo.
- E2E reconciliation dùng việc dừng inventory-service để tạo kết quả không xác định; chưa mô phỏng timeout ở giữa phản hồi (request đã ghi nhưng phản hồi mất) ở tầng mạng — trường hợp đó được kiểm ở test PostgreSQL của borrow-service (retry sau khi phản hồi mất).
- Không đo production, không deploy.
- Đánh giá chat: n = 1 lượt/cấu hình; phụ thuộc OpenRouter.
