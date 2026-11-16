# Báo cáo — P1.1 Borrow Warehouse Scope · P1.2 Inter-Warehouse Transfer · P1.3 Transfer Receiving

Ngày: 2026-11-16 · Nhánh: `khoa` · Commit baseline đầu phiên: `68c0192` (merge `origin/hungg`, đã push)

## A. Verification Report

| Vấn đề | Trạng thái ban đầu | Bằng chứng | Quyết định |
|---|---|---|---|
| **P1.1** | **VERIFIED** | `services/borrow-service/src/middlewares/auth.middleware.js`: `authorizeBorrowAdminRead/Write` chỉ kiểm role+permission, không có bất kỳ tham chiếu nào tới `warehouse`/`scope`. `loan.controller.js: listLoans` — `where` không có `warehouse_id`. `getLoanById`, `returnLoan`, `reviewLoanRenewal`, `convertReservationToLoan`, `previewLoanReturn` đều fetch bằng `id` rồi trả thẳng, không kiểm tra `loan.warehouse_id`/`reservation.warehouse_id` so với người gọi. Trong khi đó `user_warehouse_scopes` (auth_db) đã hỗ trợ sẵn vai trò `LIBRARIAN` (`INTERNAL_ROLES` trong `warehouse-assignment.js`), và `cs01` (LIBRARIAN) đã có scope row từ trước — hạ tầng tồn tại nhưng borrow-service không dùng. | **Đã sửa** |
| **P1.2** | Giả thuyết: sai chiều `from_warehouse_id`/`to_warehouse_id` | Đọc `order-request.controller.js` (tạo + duyệt), `warehouse-scope.middleware.js` (comment: *"a transfer's destination only needs read: the source warehouse acts"*), frontend `order-requests.tsx` (dòng 484-485: kho của người dùng = `from_warehouse_id`, kho chọn = `to_warehouse_id`). Mapping nhất quán **trong toàn bộ luồng**: tạo + duyệt đều cần WRITE tại `from_warehouse_id` (kho nguồn — kho đang chủ động đẩy hàng đi), nhận hàng cần WRITE tại `to_warehouse_id` (`transfer-receiving.routes.js`). Đây là mô hình "kho nguồn chủ động đẩy hàng" (push), không phải "kho thiếu hàng chủ động yêu cầu" (pull) như giả thuyết trong prompt mô tả — nhưng không có chỗ nào đảo ngược hay mâu thuẫn với chính mô hình đó. | **NOT APPLICABLE** (không sửa — xem mục A.1) |
| **P1.2 — concurrency phụ** | Nghi vấn trừ tồn trùng/vượt tồn khi 2 yêu cầu đồng thời | `outbound.controller.js`/`picking.controller.js` đã dùng `SELECT ... FOR UPDATE` + `{isolationLevel: "Serializable"}` + `toSerializableError` → 409 cho đúng lớp bài toán này (xác nhận lại bằng code, không phải suy đoán). | **ALREADY FIXED** |
| **P1.3** | **VERIFIED** | `transfer-receiving.controller.js: confirmTransferReceiving` — `req.body` không hề được đọc; mọi nhánh tạo `goods_receipt_items` đều dùng `quantity: Number(line.shipped_qty \|\| 0)`. `grep received_qty` trên file này: **0 kết quả** — cột `transfer_order_items.received_qty` có trong schema nhưng chưa từng được ghi. Frontend `transfer-receiving.tsx`: nút "Đã nhận hàng" gọi thẳng `confirmReceiving(item.id)`, không có input số lượng nào. | **Đã sửa** |

### A.1. Vì sao P1.2 không sửa

Nguyên tắc 0.2 của yêu cầu: chỉ sửa khi có bằng chứng, không tự suy diễn nghiệp vụ. Đã đọc toàn bộ luồng (controller tạo/duyệt, middleware phân quyền theo kho, màn hình tạo yêu cầu) và xác nhận: kho đang đăng nhập luôn là `from_warehouse_id` (kho nguồn, cần WRITE để tạo **và** duyệt), kho được chọn là `to_warehouse_id` (kho đích, chỉ cần READ để chọn, rồi cần WRITE riêng ở bước nhận hàng tại `/transfer-receiving`). Đây là thiết kế "kho nguồn chủ động đẩy hàng" nhất quán xuyên suốt tạo → duyệt → xuất → nhận, không có đoạn code nào dùng ngược hai trường này. Nghiệp vụ "kho thiếu hàng tự gửi yêu cầu" mà prompt mô tả là một **mô hình khác** (pull thay vì push) — hệ thống hiện tại không hỗ trợ mô hình đó, nhưng đây là khoảng trống tính năng, không phải lỗi đảo trường. Sửa thành pull-model sẽ là tạo nghiệp vụ mới ngoài phạm vi "sửa lỗi đã xác minh", nên không thực hiện.

## B. Implementation Report

### P1.1 — Borrow Warehouse Scope

- **Nguyên nhân gốc**: `services/borrow-service` chưa bao giờ tích hợp `@smartbook/shared/warehouse-scope` dù package đã là dependency sẵn có.
- **Nghiệp vụ cũ**: LIBRARIAN có `borrow.loans.read/write` thấy và sửa được phiếu mượn/đặt trước của **mọi** chi nhánh.
- **Nghiệp vụ sau khi sửa**: LIBRARIAN chỉ thấy/sửa được phiếu thuộc chi nhánh có `user_warehouse_scopes` (READ cho xem, WRITE cho tạo/trả/duyệt gia hạn/chuyển đặt trước thành phiếu mượn). Không tin `warehouse_id` từ client — luôn đọc từ bản ghi database rồi kiểm tra quyền thực tế của người gọi.
- **Backend đã sửa**:
  - `services/borrow-service/src/utils/warehouse-scope.utils.js` (**mới**) — bản sao rút gọn của `inventory-service`'s util, dùng chung resolver `@smartbook/shared/warehouse-scope`.
  - `loan.controller.js`: `listLoans` (lọc `where`), `getLoanById` (READ), `createDirectLoan` (WRITE), `listRenewalRequests` (lọc), `reviewLoanRenewal` (WRITE), `previewLoanReturn` (READ), `convertReservationToLoan` (WRITE), `returnLoan` (WRITE).
  - `reservation.controller.js`: `listReservations` (lọc), `getReservationById` (READ), `createReservation` (WRITE — **có bỏ qua khi là khách tự đặt**, xem dưới), `cancelReservation` (WRITE, bỏ qua khi khách tự hủy), `confirmReservation` (WRITE).
- **Bảo toàn self-service của khách**: `createReservation`/`cancelReservation` được `my.controller.js` tái sử dụng cho khách tự đặt/hủy. Đã phát hiện khi đọc code (không phải đoán): `my.controller.js` đặt `req.reservationChannel = 'CUSTOMER'` và không set gì khi gọi `cancelReservation`; thêm hàm `isCustomerCaller(req)` dùng đúng điều kiện `roles.includes('CUSTOMER')` mà `authorizeCustomerSelf` đã dùng, bỏ qua kiểm tra kho khi đúng là khách tự thao tác trên phiếu của chính họ.
- **Database**: thêm 1 dòng seed (`librarian01` → `BR-HCM-01`, OPERATOR) trong `services/auth-service/prisma/seed.js` — không phải migration, chỉ là dữ liệu demo (không có dòng này thì tài khoản demo LIBRARIAN bị khóa hoàn toàn sau khi sửa).
- **Middleware/permission**: không thêm permission mới, không đổi role; chỉ bổ sung một lớp kiểm tra kho **sau** lớp role/permission hiện có.
- **Giữ nguyên**: ADMIN (role) và superuser không bị ảnh hưởng (resolver trả `ALL_ACCESS` cho superuser; ADMIN vẫn qua được `authorizeBorrowAdminRead/Write` như cũ — không đổi gì ở lớp đó). Không đổi API contract, không đổi response shape.

### P1.2 — Inter-Warehouse Transfer

- Không có thay đổi code. Xem mục A.1.

### P1.3 — Transfer Receiving Actual Quantity

- **Nguyên nhân gốc**: `confirmTransferReceiving` không đọc `req.body`, luôn coi `shipped_qty` là số lượng đã nhận; không có UI nào cho nhân viên kiểm đếm.
- **Nghiệp vụ cũ**: xác nhận 1 cú click, tồn kho tăng đúng bằng số đã xuất, bất kể thực tế nhận được bao nhiêu / có hỏng hay không.
- **Nghiệp vụ sau khi sửa**: endpoint xác nhận nhận nay chấp nhận `items: [{transfer_order_item_id, delivered_qty, damaged_qty, rejected_qty}]` (tùy chọn). Có → tính `accepted = delivered − damaged − rejected` (hàm thuần `computeTransferLineOutcome`, không có side effect, cùng công thức với `procurement-receipt.service.js` nhưng bỏ trần theo PO vì transfer không có PO), ghi `goods_receipt_items.quantity/delivered_qty/damaged_qty/rejected_qty` **trước khi** đăng tồn kho (`postTransferReceiptToReceiving` chỉ đọc `quantity` — đã đọc trực tiếp code để xác nhận, không suy đoán). Hàng thừa so với đã xuất bắt buộc phải ghi vào "từ chối" (cùng quy tắc với luồng nhà cung cấp). Không có `items` → giữ nguyên hành vi cũ (nhận đủ) để tương thích ngược — nhưng đây giờ là một **lựa chọn rõ ràng** của người dùng ("Nhận đủ, không có vấn đề gì"), không còn là mặc định ngầm duy nhất.
- **Backend đã sửa**: `transfer-receiving.controller.js` (hàm `computeTransferLineOutcome` mới, endpoint mới `GET /:id/lines`, sửa `confirmTransferReceiving`), `transfer-receiving.routes.js` (route mới).
- **Frontend đã sửa**: `transfer-receiving.tsx` (bấm "Đã nhận hàng" mở dialog kiểm đếm từng dòng, có nút tắt "Nhận đủ"), `services/transfer-receiving.ts` (kiểu dữ liệu + method mới). Không đổi trang/route nào khác, không đổi bố cục bảng hàng đợi hiện có.
- **Database**: không có migration — tái sử dụng đúng các cột `delivered_qty`/`damaged_qty`/`rejected_qty` đã có sẵn trên `goods_receipt_items` (thêm từ phiên Procurement Document Workflow 2026-11-13).
- **Giữ nguyên**: idempotency (`claimDraftReceiptForPosting`-tương đương qua `stock_movements.count` check trong `postTransferReceiptToReceiving`), khóa `FOR UPDATE` + Serializable sẵn có trên `confirmTransferReceiving`, 3 nhánh POSTED/DRAFT/fallback không đổi cấu trúc.

## C. Changed Files

| File | Loại | Lý do |
|---|---|---|
| `services/borrow-service/src/utils/warehouse-scope.utils.js` | Mới | P1.1 |
| `services/borrow-service/src/controllers/loan.controller.js` | Sửa | P1.1 |
| `services/borrow-service/src/controllers/reservation.controller.js` | Sửa | P1.1 |
| `services/auth-service/prisma/seed.js` | Sửa (data) | P1.1 — scope demo cho `librarian01` |
| `services/inventory-service/src/controllers/transfer-receiving.controller.js` | Sửa | P1.3 |
| `services/inventory-service/src/routes/transfer-receiving.routes.js` | Sửa | P1.3 |
| `apps/web/src/services/transfer-receiving.ts` | Sửa | P1.3 |
| `apps/web/src/components/pages/transfer-receiving.tsx` | Sửa | P1.3 |
| `services/inventory-service/test/transfer-receiving-counting.test.js` | Mới | P1.3 (test) |
| `scripts/borrow-warehouse-scope-integration.mjs` | Mới | P1.1 (test) |
| `apps/web/src/components/pages/not-found.tsx` | Sửa | Không liên quan — fix thiết kế (bỏ gradient) theo yêu cầu riêng trước đó trong phiên, không thuộc P1.1/P1.2/P1.3 |

Không sửa file nào thuộc borrow/inventory ngoài phạm vi trên. Không đổi API contract hiện có (chỉ thêm trường **tùy chọn** và 1 endpoint GET mới).

## D. Test Report

| Nhóm kiểm thử | Kết quả | Ghi chú |
|---|---|---|
| Borrow Authorization (unit, `pnpm --filter borrow-service test`) | **156/156 PASS** | Không có test nào bị tắt |
| Warehouse Scope E2E mới (`scripts/borrow-warehouse-scope-integration.mjs`) | **16/16 PASS** | Thật qua gateway, tài khoản `librarian01`/`hung`/`customer01` thật |
| Inventory unit (`pnpm --filter inventory-service test`) | **333/333 PASS** | +8 test mới cho P1.3 |
| RBAC regression (`scripts/rbac-role-access-integration.mjs`) | **98/98 PASS** | Gồm "LIBRARIAN borrow read ok" |
| Security Phase 5 regression (`scripts/security-phase5-integration.mjs`) | **9/11 PASS** | 2 FAIL là `/ai/*` trả 503 — **AI service không chạy trong phiên này (BLOCKED, không liên quan)**, không phải lỗi do thay đổi |
| Transfer Receiving GRN idempotency | **PASS (gián tiếp)** | Cơ chế không đổi (xem mục B); regression inventory 333/333 phủ các test idempotency hiện có |
| Frontend Type Check (`tsc --noEmit`) | **PASS** | Không lỗi |
| Frontend Build | **PASS** | `docker compose build` + container `smartbook-ui` healthy |
| **Transfer Receiving Counting E2E đầy đủ (REQUESTED → duyệt → soạn hàng → xuất IN_TRANSIT → xác nhận nhận có kiểm đếm)** | **BLOCKED — chưa chạy được** | Luồng soạn hàng/xuất (picking → scan mã → xuất) là một quy trình nhiều bước (claim, xác nhận từng dòng, quét mã) chưa có script E2E sẵn có để tái dùng; dựng lại từ đầu trong phạm vi phiên này sẽ vượt quá quy mô hợp lý. Đã xác minh thay bằng: (1) 8 unit test thuần cho đúng công thức `computeTransferLineOutcome` (accepted/damaged/rejected/missing/overage, chặn nhận thừa không đánh dấu từ chối, chặn số âm), (2) đọc trực tiếp mã `postTransferReceiptToReceiving` xác nhận nó ghi tồn kho theo `goods_receipt_items.quantity` (không phải `shipped_qty`), và kiểm tra bằng code rằng `confirmTransferReceiving` ghi đúng `quantity = accepted` vào đúng dòng trước khi gọi hàm đó, (3) kiểm tra sống (HTTP thật) endpoint `GET /transfer-receiving/:id/lines` mới trả đúng dữ liệu cho 1 transfer thật vừa tạo. **Chưa kiểm chứng được**: toàn bộ chuỗi thật từ xuất kho → IN_TRANSIT → xác nhận có kiểm đếm → tồn kho tăng đúng số accepted. Ghi rõ theo đúng yêu cầu — không tuyên bố đã test thành công phần này. |

## E. Business Acceptance Criteria

1. Librarian không thể thao tác vượt Warehouse Scope — ✔ (16/16, mục D).
2. Kho yêu cầu có thể chủ động yêu cầu kho cung cấp hàng — ✘ không áp dụng với mô hình hiện tại (push, không phải pull) — xem A.1, không tự ý đổi.
3. Kho cung cấp có quyền duyệt và xuất hàng — ✔ (đã có từ trước, xác nhận lại).
4. Kho nhận có quyền kiểm đếm và xác nhận hàng thực nhận — ✔ về **khả năng** (backend + UI đã có); ⚠ **chưa kiểm chứng end-to-end thật** (mục D).
5. Hàng thiếu, thừa, hỏng được xử lý minh bạch — ✔ về mặt dữ liệu dòng (lưu `delivered/damaged/rejected/missing`); không có báo cáo chênh lệch riêng như luồng nhà cung cấp (giới hạn đã ghi ở mục F).
6. Tồn kho được ghi nhận đúng số lượng — ✔ theo mã nguồn đã đọc trực tiếp; chưa có bằng chứng E2E thật (mục D).
7. Không xảy ra nhập kho hoặc xuất kho trùng — ✔ (cơ chế idempotency/lock sẵn có không bị đổi).
8. Không làm hỏng các nghiệp vụ khác — ✔ (xem mục D, toàn bộ regression PASS, trừ 2 lỗi AI-service không liên quan).

## F. Final Assessment

- **P1.1: Hoàn thành.** Lỗi thật, đã sửa, đã kiểm chứng end-to-end thật bằng tài khoản thật (16/16), không hồi quy (156+333+98 PASS).
- **P1.2: Không áp dụng — không sửa.** Mapping `from`/`to` nhất quán với mô hình "kho nguồn chủ động đẩy hàng" đang vận hành; phần lo ngại race-condition đã được xử lý từ trước (ALREADY FIXED). Khoảng trống về mô hình "pull request" là tính năng chưa có, không phải lỗi, nên không tự ý xây thêm.
- **P1.3: Hoàn thành về code, chưa hoàn thành về kiểm chứng E2E đầy đủ.** Lỗi dữ liệu thật đã sửa đúng (xác nhận bằng đọc mã nguồn cẩn thận + 8 unit test + kiểm tra sống 1 phần luồng), nhưng chưa dựng được kịch bản thật đi hết từ xuất kho đến nhận hàng có kiểm đếm do quy trình soạn hàng/xuất kho (picking) nhiều bước và chưa có sẵn script để tái dùng. Khuyến nghị: nếu cần mức tin cậy cao nhất trước khi coi là "Hoàn thành" đầy đủ, nên dành một phiên riêng để dựng E2E cho đúng chuỗi picking → ship → receive.
