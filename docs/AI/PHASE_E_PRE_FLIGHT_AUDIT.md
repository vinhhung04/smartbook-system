# Phase E — Pre-flight audit

Ngày: 2026-11-13 · Nhánh `hungg` · HEAD `7f8a111` (trùng `origin/hungg` sau `git fetch`; remote chỉ có thay đổi ở nhánh `khoa`).

Working tree lúc bắt đầu có thay đổi chưa commit của người dùng (`.claude/`, `CLAUDE.md`, `docs/diagrams/*`, `skills-lock.json`, các file `.docx`). Phase E **không đụng** vào các file đó.

Ký hiệu: **[CÒN]** finding tái hiện được trên HEAD · **[KHÔNG TÁI HIỆN]** · **[ĐIỀU CHỈNH]** cần sửa lại phạm vi so với mô tả ban đầu · **[MỚI]** phát hiện thêm trong lúc kiểm tra.

## 1. Action lifecycle & idempotency

| # | Finding | Kết quả kiểm tra | Bằng chứng (file:dòng trên HEAD) |
|---|---|---|---|
| A1 | Borrow-service kiểm tra điều kiện nghiệp vụ trước khi tra Idempotency-Key | **[CÒN]** — kiểm tra khách, phạt, membership, giới hạn (dòng 164–210) chạy trước khi tìm reservation theo key (dòng 212–227). Retry của reservation thứ 5 (đúng giới hạn) bị 409. Đã tái hiện bằng test PostgreSQL thật (§ Test report): 6/10 test fail trên controller cũ. | `services/borrow-service/src/controllers/reservation.controller.js` `createReservation` |
| A2 | Request đồng thời cùng key | **[CÒN] [MỚI]** — request thua bị 409 trong transaction (trùng sách) và khối `catch` **nhả stock hold** của request thắng (cùng `reservation_id`). | cùng file, khối `catch` gọi `releaseReservation` |
| A3 | Key không scope theo user | **[CÒN]** — id = `uuid(reservation:<key>)`; hai user dùng trùng key → user thứ hai nhận 409 "khác payload" thay vì reservation riêng; movement key gửi inventory cũng là key thô. | cùng file |
| A4 | AI coi `CREATE_RESERVATION_DRAFT` là retry-safe | **[ĐIỀU CHỈNH]** — đúng thiết kế nhưng chỉ an toàn khi A1–A3 được sửa. | `services/ai-service/agent_actions.py` `RETRY_SAFE_ACTIONS` |
| A5 | Không để action kẹt ở CONFIRMED | **[ĐIỀU CHỈNH]** — đã có `release_stale_confirmed_actions` lúc startup và lúc confirm; nhưng nếu không ai confirm gì thì action kẹt đến lần restart sau. | `agent_store.py`, `main.py` startup |
| A6 | Chuyển trạng thái kết thúc chỉ dựa vào `SELECT … FOR UPDATE` | **[MỚI]** — trên backend không có row lock (SQLite trong test) hai lần resolve đồng thời đều "thắng"; trên Postgres an toàn nhờ lock nhưng không có điều kiện trong câu UPDATE. | `agent_store._finish_execution` |
| A7 | Transition bất hợp lệ khác | **[KHÔNG TÁI HIỆN]** — cancel chỉ từ PENDING_CONFIRMATION; claim bằng UPDATE có điều kiện; EXECUTED không bị ghi đè; RECONCILE_REQUIRED không confirm lại được. | `agent_store.py` |

## 2. Security & session

| # | Finding | Kết quả | Bằng chứng |
|---|---|---|---|
| S1 | Chỉ `/actions/confirm` kiểm tra `revocation_verified` | **[CÒN]** — `/actions/cancel`, `GET /actions/pending/{id}`, `/actions/reconcile`, `/actions/stats`, `/assistant/actions` và `/assistant/actions/{id}` không kiểm tra. Cancel-qua-confirm (`confirm:false`) cũng bỏ qua. | `main.py`, `routes_actions.py` |
| S2 | Cờ `revocation_verified` có thể do client gửi? | **[KHÔNG TÁI HIỆN]** — chỉ lấy từ header `X-Token-Revocation-Check` mà auth-service đặt trên response `/auth/me` (`packages/shared/runtime/token-revocation.cjs` `revocationGuard`). Role/permission lấy từ `/auth/me` (DB), không từ JWT. | `agent_permissions.get_user_context` |
| S3 | `/actions/confirm` trả kết quả EXECUTED trước khi xác thực | **[MỚI]** — nhánh "already executed" trả `result` đã lưu **trước** khi gọi `get_user_context` và kiểm tra chủ sở hữu: bất kỳ header Authorization nào (kể cả không hợp lệ) + action_id đã thực thi → đọc được kết quả của người khác. | `main.py` `confirm_action` |
| S4 | Định tuyến đặt chỗ cho tài khoản đa role | **[CÒN]** — `if is_customer or "CUSTOMER" in user_roles` → LIBRARIAN/ADMIN có thêm CUSTOMER luôn đi `/my/reservations` (đặt cho chính mình). | `agent_executor._exec_reservation` |

## 3. Reconciliation

| # | Finding | Kết quả |
|---|---|---|
| R1 | Backend có `POST /actions/reconcile` nhưng frontend không có luồng | **[CÒN]** — `apps/web/src/services/ai.ts` không có hàm reconcile; Action Center không có bộ lọc/biểu mẫu cho RECONCILE_REQUIRED. |
| R2 | API danh sách/chi tiết | **[ĐIỀU CHỈNH]** — đã có `GET /assistant/actions` (lọc status, phân trang, admin xem mọi người) và `GET /assistant/actions/{id}` (kèm audit log). Thiếu: lọc theo loại/thời gian/người tạo, tổng số bản ghi, lý do trong danh sách. Không cần API mới. |
| R3 | Bằng chứng/ghi chú | **[CÒN]** — note chỉ cần không rỗng; không có mã tham chiếu bằng chứng; audit log không ghi role, note nằm lẫn trong `result_summary`. |

## 4. RAG evaluation & ground truth

| # | Finding | Kết quả |
|---|---|---|
| G1 | dynamic_data PASS khi chỉ cần có trả lời | **[CÒN]** — `score()` nhánh `dynamic`: `correct = not gave_up`. Báo cáo 2026-11-12: `ans-dyn-03` trả lời "0 phiếu quá hạn" trong khi `GET /borrow/loans?status=OVERDUE` trả `meta.total = 436` → vẫn PASS. `ans-dyn-04` "47 task đang chờ" (thực tế 12 việc chưa kết thúc, 0 việc tạo hôm nay) → PASS. |
| G2 | `citation_completeness` = có ≥1 tài liệu mong đợi | **[CÒN]** — `bool(cited & expected)`. |
| G3 | unsupported claims = dò cụm từ cấm | **[CÒN]** — chỉ `must_not_include`. |
| G4 | ans-part-03 | **[CÒN]** — `must_include: ["librarian"]` thỏa bằng mã role tiếng Anh, không cần nhiệm vụ nào. |
| G5 | ans-part-04 | **[CÒN]** — `fines-payment.md` cho phép thanh toán nhiều lần/một phần; không tài liệu nào mô tả kế hoạch trả góp. GT cũ không yêu cầu nêu "thanh toán nhiều lần" và không có `fines-payment` trong expected_docs. |
| G6 | ans-near-02 | **[CÒN]** — chỉ cấm khẳng định "có thể qua SMS"; câu trả lời 2026-11-12 tự khẳng định "không thể qua SMS" vẫn không bị bắt (vì case FAIL do thiếu từ chối, nhưng lý do sai). |
| G7 | ans-near-04 | **[CÒN]** — `book-care.md` chỉ nói để sách xa vật nuôi; câu trả lời suy ra "bị hạn chế". GT không cấm suy diễn này. |

## 5. Personal context

| # | Finding | Kết quả |
|---|---|---|
| P1 | Tải toàn bộ dữ liệu cá nhân cho mọi câu hỏi | **[CÒN]** — `build_user_personal_context` gọi mọi endpoint của role bất kể câu hỏi (`intent_info` không được dùng). |
| P2 | Formatter làm sai dữ liệu động | **[MỚI]** — `_fmt_loans` ghi "Sách đang mượn (20 quyển)" cho cả lịch sử (20 phiếu RETURNED); `_fmt_borrow_loans_all` đếm quá hạn trên một trang 20 phiếu (ra 0) thay vì `meta.status_counts` (436); `_fmt_warehouse_tasks` coi POSTED/CONVERTED/WITHDRAWN là đang chờ (ra 47). Đây là nguyên nhân gốc của G1 (dyn-03, dyn-04). |

## 6. Retrieval

| # | Finding | Kết quả |
|---|---|---|
| T1 | BOOK_METADATA Recall@5 ≈ 20,82%, INTERNAL_DOC ≈ 63,87% | **[ĐIỀU CHỈNH]** — hai con số tính trung bình **cả case không có đáp án** (recall = 0 theo định nghĩa: 52/107 và 40/119 case). Thêm nữa, **30/55** case BOOK_METADATA có đáp án trỏ tới sách **không còn trong catalog live** (135 sách; ground truth lấy từ snapshot 2026-10-08, 116 sách). Trên case còn tìm được: ISBN 1,00; TITLE 1,00; DESCRIPTION 0,91; AUTHOR 0,57; INTERNAL_DOC (có đáp án) 0,96. |
| T2 | Không có luồng riêng cho từng loại truy vấn | **[ĐIỀU CHỈNH]** — đã có ISBN exact và title exact trước RRF (`assistant_tools._score_and_rank_books_with_confidence`); thiếu route tác giả. |
| T3 | No-answer / false positive | **[CÒN]** — FPR INTERNAL_DOC 0,30; BOOK 0,13. |

## 7. Reorder budget

| # | Finding (`docs/ANALYSIS/REORDER_BUDGET_AUDIT.md`) | Kết quả |
|---|---|---|
| O1 | B1–B7 | **[KHÔNG TÁI HIỆN]** — đã sửa trong commit `67a7153` (test `reorder-budget-endpoint.test.js` pass). |
| O2 | Lệch borrow_db (578 khoản vay mở) vs inventory_db (`borrowed_qty` tổng = 2) | **[CÒN]** — đo lại 2026-11-13: 578 vs 2. Bản sửa B2 chỉ kẹp `expectedReturns ≤ borrowed_qty` **âm thầm**: không cảnh báo, vẫn đề xuất mua trên dòng có dữ liệu lệch. |
| O3 | Phạm vi kho nhận hàng | **[ĐIỀU CHỈNH]** — phân bổ dùng tồn toàn hệ thống; `priorityWarehouseId` chỉ Copilot dùng. Không đổi (thay đổi nghiệp vụ lớn) — ghi là hạn chế. |
| O4 | `expected_service_pct = null` | **[ĐIỀU CHỈNH]** — đúng thiết kế khi kế hoạch không có nhu cầu trong thời gian chờ hàng; UI đã hiện "—". |

## 8. Môi trường / hạ tầng phát hiện thêm

- **[MỚI]** Migration `20260728150154_init` của borrow-service dùng kiểu `CITEXT` nhưng không tạo extension: database mới phải `CREATE EXTENSION citext` trước (`docker` init script làm việc này cho `borrow_db`). Không sửa (ngoài phạm vi), ghi nhận.
- **[MỚI]** Container borrow-service cục bộ chạy image 2 tuần tuổi, `borrow_db` thiếu 2 migration đã commit (`20261111…deposits`, `20261112…wallet_topup`); được áp khi khởi động image mới.
- Các key i18n `topbar.event.ai_action_*` không có trong file dịch (toast hiện key thô) — có từ trước, không sửa.

## 9. Test liên quan đã xác định

borrow-service `node --test test/*.test.js` (156) · ai-service `pytest` (toàn bộ, `test_agent_store_pg.py` cần `TEST_PG_DSN`) · analytics-service `node --test` (152) · web `tsc`, `eslint` · `eval/eval_rag.py`, `eval/calibrate_rag.py`, `eval/eval_chat_answers.py` (live qua gateway).

## 10. Rủi ro regression

- Đổi thứ tự idempotency/validation trong `createReservation` (đường dùng chung của web, mobile, quầy, AI).
- Scope key theo user: retry đang dở qua thời điểm nâng cấp → giữ đường tra id cũ cho chính người tạo.
- `require_verified_session` trên mọi endpoint action: khi Redis của auth-service sập, Action Center trả 503 thay vì dữ liệu (fail-closed, có chủ đích).
- Chọn personal context theo mục đích: câu hỏi cá nhân không khớp từ khóa sẽ không có dữ liệu cá nhân (chatbot nói không có dữ liệu thay vì đoán).
- Reorder: dòng có dữ liệu lệch không được cấp ngân sách → trên dữ liệu demo hiện tại gần như mọi dòng bị giữ lại.
