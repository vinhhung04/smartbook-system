# Phase E — Implementation report

Nhánh `hungg`, trên HEAD `7f8a111`. Chưa commit, chưa push, chưa deploy production. Các image Docker **cục bộ** đã build lại để đo (image cũ được gắn tag `pre-phase-e` để rollback). Kết quả kiểm thử: [PHASE_E_TEST_REPORT.md](PHASE_E_TEST_REPORT.md). Kiểm tra trước khi sửa: [PHASE_E_PRE_FLIGHT_AUDIT.md](PHASE_E_PRE_FLIGHT_AUDIT.md).

**Migration: không có.** Không thay đổi schema Prisma hay SQLAlchemy ở service nào. (Lúc khởi động image borrow-service mới, hai migration *đã commit từ trước* — `20261111090000_add_loan_item_deposits`, `20261112090000_add_wallet_topup_intents` — được áp vào `borrow_db` cục bộ vì container cũ chạy image 2 tuần tuổi; không phải migration của Phase E.)

## E.2 Reservation idempotency (borrow-service)

**Root cause.** `createReservation` kiểm tra khách/phạt/membership/giới hạn trước khi tra reservation theo key → retry của reservation đã tạo (đặc biệt reservation chạm giới hạn) bị 409. Khi hai request cùng key chạy đồng thời, request thua ném 409 trong transaction và khối `catch` gọi `releaseReservation` cho **cùng `reservation_id`** — nhả stock hold của request thắng. Key không gắn với người gọi.

**Giải pháp** (`services/borrow-service/src/controllers/reservation.controller.js`):

1. Kiểm tra đầu vào (chỉ để tính fingerprint) → **tra idempotency** → quy tắc nghiệp vụ (`reservationRefusal`) → inventory → transaction.
2. Bản ghi idempotency chính là dòng `loan_reservations`; khóa chính `id = uuid(reservation:<actor user id>:<key>)` là ràng buộc unique chống trùng. Fingerprint = customer, variant, warehouse, quantity; khác payload → `409 IDEMPOTENCY_KEY_REUSED`; cùng payload → `200 {data, idempotent: true}` (chỉ dữ liệu đã commit).
3. Scope theo user: người khác dùng cùng key nằm ở không gian id khác — không replay được reservation của nhau, cũng không va chạm. Id kiểu cũ `uuid(reservation:<key>)` vẫn được nhận **chỉ cho chính người tạo** (`created_by_user_id`) để retry đang dở lúc nâng cấp không tạo bản trùng.
4. Đồng thời: trong transaction (đã khóa advisory theo khách) tra lại id → replay, **không nhả stock**; lỗi `P2002` trên id → đọc bản thắng, replay, không nhả; một 409 nghiệp vụ hoặc lỗi inventory xảy ra *sau* khi request cùng key khác đã commit → replay.
5. Key gửi inventory: `reserve:<reservation_id>` / `rollback:<reservation_id>` (trước là key thô — hai user trùng key sẽ va chạm `stock_movements.idempotency_key`). Inventory vốn dedup theo `reservation_id`.
6. **Thời hạn:** key gắn với reservation suốt đời dòng đó; replay sau khi reservation bị hủy/hết hạn trả reservation đó với trạng thái hiện tại, không bao giờ tạo bản thứ hai. Client tạo key mới cho mỗi lần đặt (web, mobile, AI đều đã làm vậy).

**API/compat:** request/response không đổi; thêm `code: IDEMPOTENCY_KEY_REUSED` trong body 409; reservation mới có id khác công thức cũ (không client nào suy id từ key).

## E.2 Action state machine (ai-service)

| Thay đổi | File |
|---|---|
| `_finish_execution` chuyển trạng thái bằng `UPDATE … WHERE status = <trạng thái vừa đọc>` và kiểm `rowcount`, ngoài row lock — hai lần kết thúc đồng thời (hai admin, hoặc lần chạy muộn vs. đối chiếu) chỉ một thắng, kể cả backend không có `FOR UPDATE`. | `agent_store.py` |
| `GET /assistant/actions` quét `release_stale_confirmed_actions()` — action CONFIRMED mồ côi không phải chờ lần restart/confirm kế tiếp. | `routes_actions.py` |
| Đối chiếu giữ lại kết quả lần chạy (`execution_result`) thay vì ghi đè. | `agent_store.py` |

Bảng trạng thái (không đổi, nay có test bao phủ): PENDING_CONFIRMATION → CONFIRMED (claim nguyên tử) | CANCELLED | EXPIRED; CONFIRMED → EXECUTED | FAILED (đích từ chối, có thể confirm lại) | RECONCILE_REQUIRED (không rõ kết quả; loại retry-safe → FAILED); RECONCILE_REQUIRED → EXECUTED | FAILED (chỉ admin, hoặc lần chạy muộn báo về); EXECUTED, CANCELLED, EXPIRED là trạng thái cuối.

## E.3 Session verification & multi-role

- `agent_permissions.require_verified_session(user_ctx)` (re-export qua `ai_core.policy`): 401 khi không xác định được user, **503** khi auth-service trả lời nhưng không kiểm được revocation. `get_user_context` giữ: 401 token sai/thu hồi/khóa, 503 khi auth không trả lời hoặc 5xx/429 (phân biệt *token không hợp lệ* với *dịch vụ xác thực không sẵn sàng*). Cờ chỉ đến từ header của auth-service.
- Áp dụng cho **mọi** endpoint action: `/actions/confirm` (kể cả hủy qua `confirm:false`), `/actions/cancel`, `GET /actions/pending/{id}`, `/actions/reconcile`, `/actions/stats`, `GET /assistant/actions`, `GET /assistant/actions/{id}`.
- **Sửa lỗ hổng [MỚI]:** `confirm_action` giờ xác thực + kiểm chủ sở hữu **trước** khi trả kết quả EXECUTED đã lưu.
- `is_admin()` dùng chung (role từ auth-service DB, không từ JWT).
- `agent_executor.reservation_route()` — định tuyến theo *tài khoản là gì*: tài khoản có bất kỳ role nhân viên nào (hoặc superuser) làm việc nhân viên: có `customer_id` → `/borrow/reservations` nếu thỏa nhánh nhân viên của policy (LIBRARIAN/ADMIN **và** quyền `borrow.write`/…), không có khách → chỉ là bản nháp; tài khoản chỉ là bạn đọc → `/my/reservations` (customer_id trong payload bị bỏ qua, danh tính từ token); còn lại 403. Role phụ CUSTOMER không biến việc nhân viên thành đặt cho chính mình; borrow-service vẫn kiểm quyền độc lập.

### AI reservation flow (phát hiện khi chạy E2E)

- **[MỚI] Bản nháp đặt chỗ từ chat không bao giờ có variant.** `_build_reservation_draft` chỉ lấy sách từ `retrieval.raw["Catalog Books"]`, mà retrieval chỉ điền catalog cho `BOOK_SEARCH_QUERY`; "Đặt giúp tôi cuốn X" là `RESERVATION_QUERY` (lấy funnel analytics) → mọi bản nháp là "draft only", không thành reservation thật — với cả bạn đọc lẫn nhân viên. Sửa (`agent_planner._lookup_reservable_books`): khi retrieval không có catalog và NLU trích được `book_title`, gọi `GET /api/books?search=` bằng token của chính user, giữ dòng `reservable`, tên khớp, ưu tiên khớp chính xác.
- **[MỚI] Kho nhận sách.** Dùng `default_warehouse_id` làm inventory từ chối ("Selected warehouse is not a valid pickup location"). Planner chọn như dialog đặt chỗ của cổng bạn đọc (`reserve-modal.tsx`): chi nhánh trong `/public/catalog/branches` còn nhiều bản khả dụng nhất (bỏ vị trí đang nhận hàng); không có chi nhánh nào còn sách → không chọn kho, bản nháp vẫn chỉ là nháp.

## E.4 Admin reconciliation

**Backend** (`main.py`, `routes_actions.py`, `agent_store.py`):

- `POST /actions/reconcile` (giữ nguyên route, thêm trường tùy chọn `evidence_reference`): chỉ ADMIN/superuser; ghi chú ≥ 10 ký tự; **EXECUTED bắt buộc mã tham chiếu nghiệp vụ**; chỉ từ RECONCILE_REQUIRED; xử lý đồng thời → đúng một thành công, còn lại 409; chọn FAILED **không** chạy lại action; phát sự kiện `ai_action:reconciled` cho admin và người tạo.
- Audit `RECONCILED`: người thực hiện, role, thời điểm, action id, trạng thái trước/sau, ghi chú, mã bằng chứng (`event_metadata`).
- `GET /assistant/actions` thêm `type`, `created_by`, `created_from`, `created_to` (ISO 8601, sai định dạng → 400), `total`, và `error_message` (lý do) trong từng dòng. Người không phải admin vẫn chỉ thấy action của mình bất kể bộ lọc.

**Frontend** (chỉ bổ sung trong Action Center hiện có, không đổi bố cục/màu/route):

| File | Thay đổi |
|---|---|
| `apps/web/src/components/ai-action-center.tsx` | Chip lọc "Chờ đối chiếu"; dòng danh sách RECONCILE_REQUIRED hiện người tạo + lý do; chi tiết hiện "Người tạo", nhãn "Lý do cần đối chiếu"; biểu mẫu `ReconcilePanel` (chỉ admin): chọn Đã thực hiện / Chưa thực hiện, mã tham chiếu (bắt buộc khi Đã thực hiện), ghi chú bắt buộc, trạng thái loading/lỗi/thành công; người khác thấy dòng thông báo chờ admin; timeline audit hiện ghi chú + bằng chứng. |
| `apps/web/src/services/ai.ts` | `reconcileAction()`, tham số lọc mới của `listActions`, `error_message`/`total`. |
| `apps/web/src/lib/ai-action-labels.ts` | Nhãn audit `RECONCILE_REQUIRED`, `STALE_EXECUTION`, `RECONCILED`. |
| `apps/web/src/hooks/useAIActionRealtime.ts`, `components/topbar.tsx`, `apps/api-gateway/src/index.js` | Sự kiện realtime `ai_action:reconciled` (allowlist gateway + cấu hình topbar giống các sự kiện ai_action khác). |

## E.5 RAG evaluation & ground truth

`services/ai-service/eval/eval_chat_answers.py` viết lại phần chấm:

- Kết quả mỗi case: **PASS / FAIL / UNVERIFIABLE**. UNVERIFIABLE không bao giờ tính là PASS; `answer_accuracy` chỉ tính trên case kiểm chứng được.
- **Dynamic data:** expected facts đọc *lúc chạy* từ service có thẩm quyền, bằng token của chính user (`TRUTH_SOURCES`: `/borrow/my/loans`, `/borrow/my/fines`, `/borrow/loans?status=OVERDUE meta.total`, `/api/my-warehouse-tasks`). Kiểm: numeric (số đếm / câu "không có" khi 0 / số tiền), entity (mã bản ghi không thuộc user → bịa), temporal ("hôm nay" không được trình bày mọi việc mọi trạng thái), scope/authorization (case mới `ans-dyn-05`: bạn đọc hỏi số phiếu quá hạn toàn thư viện — con số chỉ thủ thư thấy không được xuất hiện). Không đọc được truth → UNVERIFIABLE.
- **Citation**, tách riêng: precision (trong `expected_docs`), relevance (trong `expected_docs ∪ acceptable_docs`), recall, completeness (= recall 1), numeric claim support (mọi con số trong câu trả lời có trong tài liệu được trích; hoặc là fact mong đợi đã kiểm tay — ví dụ 6.000 = 2.000 × 3).
- **Unsupported claims** phân loại: CONTRADICTION (cụm từ mâu thuẫn được tuyển chọn theo case), INSUFFICIENT_EVIDENCE (con số không có trong bất kỳ tài liệu nào → case FAIL), UNCITED (có trong corpus nhưng không trong tài liệu được trích). Ghi rõ: *rule-based, không phải kiểm chứng ngữ nghĩa*.
- Sửa chuẩn hóa số: `10.000đ` trước đây giữ dấu chấm (vì `đ→d` làm mất `\b`); mã/tên đăng nhập (`customer01`, `act_1a2b`) không bị đọc thành số; `x1.5` vẫn là 1.5.
- Số không có trong tài liệu nào → case **UNVERIFIABLE** (không phải FAIL, càng không PASS): luật không phân biệt được số bịa với số suy ra đúng (21 + 10 + 10 = 41 ngày).
- Cụm từ cấm chỉ tính khi được *khẳng định*: một vế của lựa chọn ("cho phép **hay** cấm mang thú cưng") không tính. Phủ định khác vẫn không được hiểu (ghi rõ trong docstring).
- `--rescore <report>`: chấm lại câu trả lời đã lưu bằng scorer + ground truth hiện tại (case động thành UNVERIFIABLE).
- Report có `meta` (dataset version, thời điểm, gateway) và `truth_observed` cho từng case động.

**Dataset:** `chat_answer_dataset_v1.json` = bản cũ nguyên vẹn (32 case); `chat_answer_dataset.json` = **v2-2026-11-13** (33 case) có `version`, `verified_by`. Thay đổi từng case (cũ → mới → lý do → tài liệu nguồn) trong `eval/chat_answer_dataset_CHANGELOG.md`: ans-part-03, ans-part-04, ans-near-02, ans-near-04 (chặt hơn), ans-dyn-01..04 (thêm truth), ans-dyn-05 (mới). Không case nào được nới để tăng điểm.

## E.6 Personal context (data minimization)

`services/ai-service/user_personal_context.py`, `intent.py`, `main.py`:

- `select_personal_topics(message, intent)` → {loans, reservations, fines, membership, wallet, tasks, analytics, stock} theo intent NLU và cụm từ trong câu hỏi (khớp nguyên từ trên văn bản đã bỏ dấu — "phát hành" không còn khớp "phạt"). Chỉ endpoint thuộc topic được chọn mới được gọi. Câu hỏi công khai ("Thư viện mở cửa lúc nào?") → **không gọi endpoint nào, prompt không có mục dữ liệu cá nhân**. "tôi" đơn thuần không đủ. Câu hỏi chính sách không nói về bản thân ("Phí phạt trễ hạn tính thế nào?") → chỉ tài liệu. Yêu cầu rõ "tài khoản của tôi" → mọi endpoint *của role*.
- Ví (`/borrow/my/account`) chỉ tải khi được hỏi.
- Không đọc được dữ liệu → summary ghi rõ "không được suy đoán số liệu".
- Sửa formatter (nguyên nhân gốc của các câu trả lời động sai): `_fmt_loans` tách phiếu đang mượn (BORROWED/OVERDUE) khỏi lịch sử; `_fmt_borrow_loans_all` dùng `meta.status_counts` (tổng toàn hệ thống) thay vì đếm trên một trang, ghi rõ khi chỉ có mẫu; `_fmt_warehouse_tasks` coi POSTED/CONVERTED/WITHDRAWN/REJECTED/RESOLVED là đã xong; `_fmt_reservations` chỉ coi PENDING/CONFIRMED/READY_FOR_PICKUP (tập active của borrow-service) là "đang chờ" — trước đó mọi trạng thái ngoài một danh sách ngắn (kể cả CONVERTED_TO_LOAN, NO_SHOW) bị tính là đang chờ ("18 yêu cầu đặt đang chờ xử lý").
- `intent.refers_to_self()` tách từ `asks_about_own_data()` (không đổi hành vi hàm cũ).

## E.7 Retrieval

- `eval/scoring.py`: `classify_book_query` (ISBN / AUTHOR / TITLE / CATEGORY / DESCRIPTION, tất định), `precision_at_k`, `by_query_type` (R@1/R@5/MRR/P@5/no-answer accuracy/FPR theo loại; tách **UNREACHABLE** = case có đáp án nhưng sách không còn trong catalog đang đánh giá).
- `eval/eval_rag.py`: bảng theo loại truy vấn, danh sách case unreachable, file `rag_metrics_<ts>.json` (dataset, số sách, embedding, cấu hình).
- `assistant_tools.py`: **route tác giả** — câu hỏi chứa đầy đủ tên một tác giả (≥ 2 từ, khớp nguyên từ) đưa sách của tác giả đó lên đầu, `hard_match = AUTHOR_EXACT`. ISBN exact / title exact đã có, giữ nguyên. Không thêm vector DB hay thư viện mới; không đổi threshold (calibration không có ứng viên hợp lệ cho BOOK, ứng viên INTERNAL_DOC trùng `tau_evidence` hiện tại).

## E.8 Reorder budget

`services/analytics-service/src/controllers/analytics.controller.js`: theo từng variant, nếu số phiếu mượn đang mở ở borrow_db **lớn hơn** `borrowed_qty` ở inventory_db thì vị trí tồn không xác định: dòng được đánh dấu `budget_plan.data_issue = BORROW_INVENTORY_MISMATCH` (kèm hai con số), **không được cấp ngân sách**, tổng hợp ở `budget.unreliable_lines`, `unreliable_qty`, `data_consistency {status, check, mismatched_lines, excess_open_loans}` và một giả định bằng tiếng Việt. Không ghi đè/suy diễn số liệu của service nào. `budget-planner.tsx` hiện một dòng cảnh báo cùng kiểu với cảnh báo "chưa có đơn giá". API chỉ thêm trường.

Không làm (ghi là blocker/hạn chế): đối soát/seed lại dữ liệu demo cho nhất quán (thay đổi dữ liệu, cần người dùng quyết); chọn kho nhận hàng ở frontend (thay đổi nghiệp vụ).

## E.10 Observability

- Request ID: gateway gắn `x-request-id`, borrow-service chuyển tiếp sang inventory (`correlationHeader(requestId)`); ai-service log `action_id` ở mọi chuyển trạng thái (audit DB) và cảnh báo outcome-unknown. **[Sửa]** Executor của ai-service trước đây không chuyển `x-request-id` khi gọi borrow/inventory (chuỗi trace đứt ở AI → service đích); nay mọi client của `agent_executor` gửi kèm request id của request confirm (`_trace_headers`, có test). Không log token/OTP/mật khẩu trong các đường đã sửa; audit reservation ghi `idempotency_key` (không nhạy cảm).
- Cache: `response_cache` của chat đã gắn hash Authorization + intent vào key và bỏ qua câu hỏi cá nhân — không chia sẻ giữa user.
- Rate limit ai-service: `RateLimiter` **trong bộ nhớ một process** (`cache.py`). Không tuyên bố là distributed; chạy nhiều instance cần chuyển sang Redis có sẵn — chưa làm (ngoài phạm vi, ghi trong rủi ro).

## Test harness

`test_action_lifecycle.py::test_two_concurrent_confirms_execute_once` treo ngẫu nhiên (2/3 lần trên HEAD sạch): test chờ cố định 50 ms; nếu confirm thứ hai claim trước, nó chờ `gate` mà `gate` chỉ được mở sau khi confirm thứ hai trả về. Sửa: chờ đến khi action thật sự CONFIRMED. Assertion không đổi. Đây là lý do một lượt `pytest` toàn bộ trước đó không kết thúc trong 25 phút.

## File đã thay đổi / thêm

Sửa: `services/borrow-service/src/controllers/reservation.controller.js` · `services/ai-service/{agent_permissions.py, ai_core/policy.py, main.py, routes_actions.py, agent_store.py, agent_executor.py, agent_planner.py, user_personal_context.py, intent.py, assistant_tools.py}` · `services/ai-service/eval/{eval_chat_answers.py, eval_rag.py, scoring.py, chat_answer_dataset.json}` · `services/ai-service/{test_action_lifecycle.py, test_eval_chat_answers.py, test_book_index.py, test_agent_store_pg.py}` · `services/analytics-service/{src/controllers/analytics.controller.js, test/reorder-budget-endpoint.test.js}` · `apps/web/src/{components/ai-action-center.tsx, components/reorder-intelligence/budget-planner.tsx, components/topbar.tsx, hooks/useAIActionRealtime.ts, lib/ai-action-labels.ts, lib/i18n.tsx, services/ai.ts, services/analytics.ts}` · `apps/api-gateway/src/index.js`.

Thêm: `services/borrow-service/test/reservation-idempotency.db.test.js` · `services/ai-service/{test_phase_e_actions.py, test_phase_e_personal_context.py}` · `services/ai-service/eval/{chat_answer_dataset_v1.json, chat_answer_dataset_CHANGELOG.md}` · `scripts/phase-e/{reservation-idempotency-e2e.py, reconciliation-e2e.py, reconciliation-ui-check.mjs}` · `docs/AI/phase-e-evidence/` (log + ảnh) · `docs/AI/PHASE_E_*.md` · báo cáo đo trong `services/ai-service/eval/reports/` (có timestamp, không ghi đè báo cáo cũ).
