# Báo cáo — Fix P1.3 (Transfer Receiving), P1.4 (Loan Renewal Concurrency), P1.5 (Fine Payment/Waiver Concurrency)

Ngày: 2026-11-16 · Nhánh: `khoa`

## A. Executive Summary

| Vấn đề | Trạng thái | Ghi chú |
|---|---|---|
| P1.3.A — Duplicate `transfer_order_item_id` bị cộng dồn | **CONFIRMED BUG — ĐÃ SỬA** | |
| P1.3.B — `items: []` bị hiểu là nhận đủ | **CONFIRMED BUG — ĐÃ SỬA** | |
| P1.3.C — `transfer_order_items.received_qty` không đồng bộ | **CONFIRMED BUG — ĐÃ SỬA** | |
| P1.4.A — Hai quản lý duyệt cùng 1 yêu cầu gia hạn | **CONFIRMED BUG — ĐÃ SỬA** | |
| P1.4.B — Hai yêu cầu gia hạn tạo đồng thời | **CONFIRMED BUG — ĐÃ SỬA** | |
| P1.5 — Thanh toán và miễn giảm đua nhau trên cùng khoản phạt | **CONFIRMED BUG — ĐÃ SỬA** | |

**Quan trọng — tránh trùng lặp với phiên khác**: trước khi sửa, phát hiện commit `054cfa5` (`feat(borrow,inventory): warehouse-scope loans/reservations + count transfer receipts`, báo cáo `SMARTBOOK_BORROW_TRANSFER_P1_REPORT.md`) đã có mặt trên `khoa`, do một phiên khác thực hiện trước phiên này. Commit đó đã xây dựng hạ tầng đếm hàng cho P1.3 (`computeTransferLineOutcome`, `items` tùy chọn trong payload) nhưng **tự xác nhận chưa xử lý** 3 điểm: trùng dòng, `items: []`, và đồng bộ `received_qty` — đúng 3 điểm P1.3.A/B/C ở trên. Phiên này chỉ sửa đúng 3 khoảng trống còn lại, không viết lại hay trùng lặp phần đã có. Không có công việc tương tự đã tồn tại cho P1.4/P1.5.

Không có lỗi nào bị đánh giá "NOT REPRODUCED" — cả 6 vấn đề đều tái hiện được trên code tại thời điểm bắt đầu (P1.3 bằng đọc mã + test sống; P1.4/P1.5 đã xác nhận ở lượt kiểm tra ngay trước phiên này và xác nhận lại không đổi).

## B. Chi tiết từng vấn đề

### P1.3.A — Duplicate `transfer_order_item_id`

- **Nguyên nhân gốc**: vòng lặp gom `outcomeByVariant` theo `variant_id`, cộng dồn (`prev.accepted + outcome.accepted`) mà không có tập hợp kiểm tra dòng đã xử lý. `computeTransferLineOutcome` kiểm tra "vượt số lượng đã xuất" độc lập theo từng dòng raw (so với `line.shippedQty` cố định), nên 2 dòng raw trùng `transfer_order_item_id` đều qua được kiểm tra riêng lẻ rồi cộng dồn thành gấp đôi.
- **File/Function**: `services/inventory-service/src/controllers/transfer-receiving.controller.js: confirmTransferReceiving`.
- **Cách sửa**: thêm `seenLineIds` (Set), từ chối (400) ngay khi gặp `transfer_order_item_id` lặp lại, trước khi tính outcome.
- **Lý do chọn giải pháp**: tối thiểu, không đổi cấu trúc `outcomeByVariant` (vẫn cần cho việc ghi `goods_receipt_items` theo variant), chỉ thêm một bước kiểm tra độc lập.
- **Ảnh hưởng nghiệp vụ**: không đổi hành vi của payload hợp lệ; chỉ chặn payload lỗi (trùng dòng) mà trước đây bị âm thầm chấp nhận sai.

### P1.3.B — `items: []` bị hiểu là nhận đủ

- **Nguyên nhân gốc**: điều kiện cũ `Array.isArray(items) && items.length > 0` chỉ có nhánh "có dữ liệu đếm", không có nhánh riêng cho "có gửi `items` nhưng rỗng" — mảng rỗng rơi vào cùng nhánh mặc định với "không gửi `items`".
- **Cách sửa**: tách 3 trường hợp rõ ràng — không gửi `items` (giữ nguyên: nhận đủ, hành vi tương thích ngược), gửi `items` không phải mảng (từ chối 400), gửi `items: []` (từ chối 400, không rơi vào nhận đủ).
- **Lý do chọn giải pháp**: giữ đúng API contract cũ cho client không gửi `items`; chỉ thêm validation cho 2 trường hợp dữ liệu sai hình dạng.
- **Ảnh hưởng nghiệp vụ**: không ảnh hưởng client cũ (không gửi `items`); chặn một lớp lỗi client (mảng rỗng do bug) đáng lẽ phải báo lỗi thay vì âm thầm nhận đủ.

### P1.3.C — `transfer_order_items.received_qty` không đồng bộ

- **Nguyên nhân gốc**: không có bất kỳ `UPDATE`/`.update()` nào trên cột này trong toàn bộ `inventory-service` (xác nhận bằng grep, không suy đoán).
- **Ý nghĩa đã xác định**: đối chiếu với quy ước đã dùng cho `purchase_order_items.received_qty` (cùng tên, cùng vai trò "số đã nhận" trên bảng dòng chứng từ chị em) — đó là số lượng **đã được chấp nhận và đăng vào tồn kho** (`accepted = delivered − damaged − rejected`), không phải số lượng vật lý đến (`delivered`). Dùng đúng quy ước này để nhất quán trong cùng schema, không tự suy đoán ý nghĩa khác.
- **Cách sửa**: thêm map `receivedQtyByLineId` (theo từng dòng `transfer_order_item_id`, không gộp theo variant như `outcomeByVariant`), ghi 1 lần `UPDATE transfer_order_items SET received_qty = ...` cho mỗi dòng đã xuất, tại đúng điểm chung cho cả 3 nhánh xử lý (POSTED-idempotent, DRAFT→POSTED, fallback không có GRN) — ngay trước khi cập nhật `transfer_orders.status = RECEIVED`.
- **Vì sao ghi 1 lần (set), không cộng dồn**: một transfer order trong hệ thống hiện tại chỉ có đúng 1 lần xác nhận nhận hàng (khác PO có thể nhận nhiều đợt) — xác nhận bằng cách đọc toàn bộ đường đi của `order.status` (IN_TRANSIT → RECEIVED là chuyển trạng thái một chiều, không có vòng lặp nhận nhiều đợt cho transfer).
- **Ảnh hưởng nghiệp vụ**: không đổi API response; chỉ đồng bộ thêm dữ liệu nội bộ cho các báo cáo/API tương lai có thể cần đọc `received_qty`.

### P1.4.A — Hai quản lý duyệt cùng một yêu cầu gia hạn

- **Nguyên nhân gốc**: `pendingRequest` đọc trước `prisma.$transaction`; bên trong transaction không khóa gì trước khi đếm `loan_renewals`; cập nhật trạng thái yêu cầu thành `SENT` là `update()` vô điều kiện (không kiểm `status: 'PENDING'`).
- **File/Function**: `services/borrow-service/src/controllers/loan.controller.js: reviewLoanRenewal`.
- **Cách sửa**: ngay đầu `$transaction`, lấy `pg_advisory_xact_lock` theo khóa `loan-renewal:${loanId}`; đọc lại `pendingRequest` dưới khóa, nếu không còn `PENDING` thì trả 409; đổi `update` cuối thành `updateMany({where: {id, status: 'PENDING'}})` và kiểm `count === 1` (phòng vệ kép cùng với khóa).
- **Lý do chọn giải pháp**: dùng đúng khuôn mẫu `pg_advisory_xact_lock` + `$executeRaw` đã có sẵn trong `createDirectLoan`/`convertReservationToLoan` cùng file — nhất quán, không phát minh cơ chế mới. Khóa theo `loan_id` (không khóa bảng/dòng rộng hơn) để không ảnh hưởng khách hàng khác.
- **Ảnh hưởng nghiệp vụ**: không đổi cách tính số ngày gia hạn hay chính sách gia hạn; chỉ đảm bảo đúng 1 quyết định được ghi nhận khi có tranh chấp đồng thời.

### P1.4.B — Hai yêu cầu gia hạn tạo đồng thời

- **Nguyên nhân gốc**: `requestMyLoanRenewal` đọc `pendingRequest` và đếm `existingRequests` trước `prisma.$transaction`.
- **File/Function**: `services/borrow-service/src/controllers/my.controller.js: requestMyLoanRenewal`.
- **Cách sửa**: chuyển toàn bộ logic (đọc `pendingRequest`, đếm `existingRequests`, tạo thông báo + audit log) vào trong `$transaction`, lấy **cùng khóa** `loan-renewal:${loanId}` như P1.4.A trước khi đọc — đảm bảo thứ tự khóa nhất quán giữa tạo yêu cầu và duyệt yêu cầu (một khóa, một key family, không deadlock giữa 2 hàm).
- **Lý do chọn giải pháp**: tái cấu trúc tối thiểu để giữ nguyên toàn bộ nghiệp vụ (số ngày gia hạn, điều kiện giới hạn) — chỉ đổi *khi nào* các bước này chạy (trong transaction có khóa) chứ không đổi *những gì* chúng làm. Trả kết quả qua `{code, payload}` (khuôn mẫu đã dùng ở `reviewLoanRenewal`/`recordFinePayment` cùng codebase) thay vì `return res...` rải rác, để toàn bộ logic nằm gọn trong 1 transaction.
- **Ảnh hưởng nghiệp vụ**: không đổi API request/response; thông báo lỗi và mã lỗi (`RENEWAL_PENDING`) giữ nguyên.

### P1.5 — Thanh toán và miễn giảm đua nhau

- **Nguyên nhân gốc**: `recordFinePayment` có `SELECT ... FOR UPDATE` khóa dòng `fines`; `waiveFine` đọc `fines.findUnique` không khóa gì.
- **File/Function**: `services/borrow-service/src/controllers/fine.controller.js: waiveFine`.
- **Cách sửa**: thêm đúng 1 dòng `SELECT id FROM fines WHERE id = $1 FOR UPDATE` ở đầu transaction của `waiveFine`, y hệt `recordFinePayment`.
- **Lý do chọn giải pháp**: đơn giản nhất có thể — không viết lại công thức tính `remaining`, không đổi cấu trúc trả về; chỉ thêm khóa còn thiếu để 2 luồng dùng chung 1 cơ chế như yêu cầu.
- **Số tiền còn phải xử lý**: xác nhận công thức hiện có đúng theo cấu trúc dữ liệu thực tế (`fine.amount − fine.waived_amount − Σfine_payments.amount`) — giữ nguyên, không đổi công thức.
- **Ảnh hưởng nghiệp vụ**: không đổi điều kiện nghiệp vụ (vẫn chặn miễn giảm/thanh toán vượt số dư như cũ); chỉ đảm bảo số dư đọc được là số dư **mới nhất** khi có tranh chấp đồng thời.

## C. Database Changes

**Không có migration nào.** Cả 3 nhóm vấn đề đều sửa trong logic ứng dụng:
- P1.3.C dùng lại cột `transfer_order_items.received_qty` đã có sẵn trong schema (chỉ thêm `UPDATE`, không đổi kiểu/ràng buộc).
- P1.4, P1.5 chỉ thêm khóa (`pg_advisory_xact_lock`, `SELECT ... FOR UPDATE`) và cập nhật có điều kiện (`updateMany` thay `update`) — không đổi bảng, không đổi cột, không đổi index.

Không cần đánh giá dữ liệu cũ vì không có migration.

## D. Test Results

| Test | Trạng thái | Kết quả |
|---|---|---|
| P1.3 duplicate receiving (`transfer-receiving-counting-integration.mjs`) | **PASS** | Payload trùng dòng bị từ chối 400, đơn hàng vẫn IN_TRANSIT |
| P1.3 empty payload (`items: []`) | **PASS** | Bị từ chối 400, không rơi vào "nhận đủ" |
| P1.3 omitted items (baseline không đổi) | **PASS** | Vẫn nhận đủ theo `shipped_qty` như cũ |
| P1.3 received_qty sync (2 dòng cùng variant, kiểm đếm riêng: 6/1 hỏng và 4/0 hỏng) | **PASS** | Dòng A `received_qty=5`, dòng B `received_qty=4` — tính đúng theo từng dòng, không gộp sai |
| P1.4 concurrent renewal approval (2 manager duyệt đồng thời cùng 1 yêu cầu) | **PASS** | Đúng 1/2 request trả 200, request còn lại trả 409 sạch (không phải 500); đúng 1 dòng `loan_renewals` được tạo |
| P1.4 duplicate renewal request (2 yêu cầu tạo đồng thời cùng 1 phiếu mượn) | **PASS** | Đúng 1/2 request trả 201; đúng 1 dòng `PENDING` tồn tại trong `customer_notifications` |
| P1.5 payment vs waiver (đồng thời: thanh toán 80k + miễn giảm 50k trên khoản phạt 100k) | **PASS** | Không cả hai cùng thành công (80k+50k=130k > 100k); tổng đã xử lý thực tế ≤ 100k |
| P1.5 balance reconciliation | **PASS** | `Σfine_payments + fines.waived_amount ≤ fines.amount` đúng sau khi đua |
| Regression — Unit inventory-service (`pnpm --filter inventory-service test`) | **PASS** | 333/333 |
| Regression — Unit borrow-service (`pnpm --filter borrow-service test`) | **PASS** | 156/156 (phải sửa 1 fixture test thiếu `$executeRaw` trong fake prisma — xem mục E) |
| Regression — `rbac-role-access-integration.mjs` | **PASS** | 98/98 |
| Regression — `borrow-warehouse-scope-integration.mjs` | **PASS** | 16/16 |
| Regression — `purchase-supplier-receiving-integration.mjs` | **PASS** | 13/13 |

Mỗi test tái hiện lỗi concurrency (P1.4.A, P1.4.B, P1.5) đều dùng `Promise.all` bắn 2 request thật cùng lúc qua Gateway thật vào Postgres thật — không mock, không giả lập race bằng code đơn luồng. Riêng P1.3, cả fixture (tạo `transfer_orders`/`transfer_order_items` bằng SQL trực tiếp) lẫn việc gọi `confirm` đều là dữ liệu/API thật; chỉ bỏ qua bước dựng lại toàn bộ pipeline đặt hàng chuyển kho → soạn hàng → xuất kho (không phải đối tượng cần kiểm chứng ở đây — xem lý do trong `transfer-receiving-counting-integration.mjs`).

Không có mục nào BLOCKED.

## E. Files Changed

| File | Thay đổi | Lý do |
|---|---|---|
| `services/inventory-service/src/controllers/transfer-receiving.controller.js` | Sửa | P1.3.A/B/C |
| `scripts/transfer-receiving-counting-integration.mjs` | Mới | Test P1.3 |
| `services/borrow-service/src/controllers/loan.controller.js` | Sửa | P1.4.A (`reviewLoanRenewal`) |
| `services/borrow-service/src/controllers/my.controller.js` | Sửa | P1.4.B (`requestMyLoanRenewal`) |
| `services/borrow-service/src/controllers/fine.controller.js` | Sửa | P1.5 (`waiveFine`) |
| `services/borrow-service/test/my-mobile-endpoints.test.js` | Sửa | Thêm `$executeRaw` no-op vào fake prisma (test có sẵn gọi `requestMyLoanRenewal`, nay cần mock khóa advisory mới) |
| `scripts/borrow-renewal-fine-concurrency-integration.mjs` | Mới | Test P1.4.A, P1.4.B, P1.5 |
| `scripts/borrow-limit-item-count-integration.mjs` | Mới (từ lượt trước trong phiên, không thuộc P1.3/1.4/1.5) | Giữ nguyên, không liên quan tới báo cáo này |

Không sửa file nào khác ngoài danh sách trên. Không đổi API contract (chỉ thêm validation chặt hơn ở P1.3.A/B, không đổi field nào trong request/response của P1.4/P1.5). Không đổi UI/UX. Không đổi `services/borrow-service/src/services/membership.service.js`, `reservation.controller.js`, `customer.controller.js` trong phiên này (các file này đã sửa ở lượt P1.1 trước đó trong cùng phiên làm việc, không thuộc phạm vi P1.3/1.4/1.5).

## F. Remaining Risks

- **P1.3**: chưa có kịch bản E2E đi hết "tạo yêu cầu chuyển kho → duyệt → soạn hàng → quét mã xuất kho → IN_TRANSIT" bằng API thật — vẫn là giới hạn đã ghi trong `SMARTBOOK_BORROW_TRANSFER_P1_REPORT.md` (mục D), phiên này không mở rộng thêm vì không thuộc phạm vi 3 lỗi được giao. Việc dùng fixture SQL trực tiếp cho `transfer_orders`/`transfer_order_items` đã đủ để kiểm chứng đúng hành vi của `confirmTransferReceiving` (đối tượng của P1.3) nhưng không chứng minh toàn bộ pipeline phía trước.
- **P1.4/P1.5**: không phát hiện giới hạn còn lại — cả 3 race condition đã đóng và kiểm chứng bằng request đồng thời thật.
- Không phát hiện deadlock giữa khóa `loan-renewal:*` (P1.4) và các khóa `membership-limit:*` đã có sẵn (từ P0/P1.1 trước) vì chúng dùng tiền tố khóa khác nhau và không có đường gọi chéo giữa `reviewLoanRenewal`/`requestMyLoanRenewal` với `createDirectLoan`/`convertReservationToLoan` trong cùng một transaction.

## G. Final Assessment

- **P1.3: FIXED.** 3/3 lỗi xác nhận đúng như mô tả, sửa đúng phạm vi (không viết lại hạ tầng đã có từ commit `054cfa5`), có bằng chứng code + test thật (9/9).
- **P1.4: FIXED.** Cả 2 lỗi (duyệt đồng thời, tạo yêu cầu đồng thời) xác nhận bằng request đồng thời thật, sửa bằng advisory lock + cập nhật có điều kiện theo đúng khuôn mẫu đã có trong codebase, kiểm chứng lại bằng race thật (5/5 PASS phần P1.4).
- **P1.5: FIXED.** Lỗi xác nhận bằng bất đối xứng khóa, sửa bằng cách thêm đúng khóa còn thiếu, kiểm chứng bằng race tài chính thật (2/2 PASS phần P1.5).

Toàn bộ regression (333 + 156 unit, 98 + 16 + 13 integration) đều PASS sau khi sửa. Chưa commit, chưa push.
