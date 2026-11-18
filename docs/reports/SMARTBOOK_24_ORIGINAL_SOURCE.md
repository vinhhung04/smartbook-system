Source recovered from connected Codex/ChatGPT chat **Rà soát lỗi nghiệp vụ**, chat ID `6afb4f80-d8fc-83ee-b292-0ab6caf3c4dd`, assistant message `10ee8c14-0311-4d98-89ae-1d7d169259bf`. Original static audit baseline `khoa` / `908bc956`. Retrieved 2026-11-17. The following is source evidence, not verified current behavior. Only the complete first fifteen descriptions are preserved here; SB16–24 are supplied by the current user request.

# Báo cáo rà soát lỗi nghiệp vụ SmartBook – Nhánh `khoa`

Tôi sẽ đánh giá theo hướng **kiểm toán nghiệp vụ (Business Logic Audit)**, tập trung vào lỗi có thể gây sai dữ liệu, sai tồn kho, thất thoát tài chính, thao tác vượt quyền hoặc làm gián đoạn quy trình vận hành.

Đã xác định đúng nhánh cần kiểm tra

| Thông tin | Giá trị |
|--------|--------|
| Repository | `vinhhung04/smartbook-system` |
| Branch | `khoa` |
| Commit hiện tại | `908bc956` |
| Thời điểm commit | 16/11/2026 |
| Phạm vi | Backend, database, API, phân quyền, Web, Mobile và kiểm thử |

Tôi cũng đã đối chiếu hai báo cáo P1 trước đây trong repository để tránh liệt kê lại những lỗi đã được sửa như thể chúng vẫn còn tồn tại.

Một điểm đáng chú ý: commit mới nhất đã xử lý lỗi cộng tồn kho gấp đôi khi một phiếu điều chuyển có nhiều dòng cùng `variant_id`\. Đây là lỗi dữ liệu tồn kho thực sự, không đơn thuần là vấn đề giao diện.

## 1\. Các lỗi nghiệp vụ nghiêm trọng đã xác định

**P1 – Ưu tiên xử lý cao**

### SB-01. Kiểm tra giới hạn mượn không tính sách đang đặt trước

**File\:** `services/borrow-service/src/controllers/loan.controller.js`

- **Mô tả\:** Luồng mượn trực tiếp chỉ gọi `countActiveBorrowedItems()`, không cộng `countActiveReservedItems()`\.
- **Input\:** Gói thành viên giới hạn 5 cuốn; đang mượn 3 cuốn, có 2 cuốn đặt trước, tiếp tục mượn trực tiếp 1 cuốn.
- **Output mong muốn\:** Từ chối vì tổng số sách đang mượn và đặt trước đã đạt 5.
- **Output thực tế\:** Cho phép mượn vì chỉ tính 3 + 1 = 4.

**Hậu quả\:** Người dùng có thể vượt giới hạn sách được phép mượn theo gói thành viên.

### SB-02. Tài khoản thành viên tương lai được áp dụng quyền lợi trước ngày bắt đầu

**File\:** `services/borrow-service/src/services/membership.service.js`

- **Mô tả\:** `resolveActiveMembership()` lọc `status = ACTIVE` và ngày hết hạn nhưng không kiểm tra `start_date <= today`\.
- **Input\:** Thành viên hiện tại hết hạn ngày 30/11; thành viên gia hạn bắt đầu ngày 01/12, có gói quyền lợi cao hơn.
- **Output mong muốn\:** Tiếp tục áp dụng gói hiện tại đến hết ngày 30/11.
- **Output thực tế\:** Có thể chọn bản ghi gia hạn tương lai vì nó có `start_date` mới hơn.

**Hậu quả\:** Quyền lợi, hạn mức mượn, tiền cọc và phí phạt có thể được áp dụng sai thời điểm.

### SB-03. Đã thanh toán tiền phạt quá hạn nhưng vẫn tiếp tục mượn mà không phát sinh phạt mới

**File\:** `services/borrow-service/src/services/fine.service.js`

- **Mô tả\:** `upsertFine()` giữ nguyên khoản phạt nếu trạng thái đã là `PAID` hoặc `WAIVED`\.
- **Input\:** Một cuốn sách quá hạn 10 ngày, khách thanh toán đủ tiền phạt, nhưng tiếp tục giữ sách thêm 10 ngày.
- **Output mong muốn\:** Hệ thống tiếp tục ghi nhận tiền phạt cho thời gian quá hạn phát sinh sau lần thanh toán.
- **Output thực tế\:** `runOverdueSweep()` tìm thấy khoản phạt cũ và không cập nhật hoặc tạo khoản phạt mới.

**Hậu quả\:** Có thể thất thu tiền phạt và sai số dư công nợ của bạn đọc.

### SB-04. Có thể trả lại cùng một cuốn sách nhiều lần

**File\:**

- `services/borrow-service/src/controllers/loan.controller.js`
- `services/inventory-service/src/controllers/borrow-integration.controller.js`

- **Mô tả\:** Khi truyền `loan_item_id`, `returnLoan()` chỉ kiểm tra cuốn sách có thuộc phiếu mượn hay không, không kiểm tra trạng thái phải là `BORROWED` hoặc `OVERDUE`\.
- **Input\:** Phiếu có 2 cuốn cùng ISBN. Cuốn thứ nhất đã trả, cuốn thứ hai vẫn đang mượn. Gửi lại yêu cầu trả cuốn thứ nhất bằng một Idempotency-Key mới.
- **Output mong muốn\:** Từ chối vì cuốn sách đã được trả.
- **Output thực tế\:** Có thể tiếp tục gọi `returnBorrowedLoan()`\. Inventory Service chỉ kiểm tra `borrowed_qty` tổng hợp theo variant, không xác thực cuốn sách đã trả trước đó.

**Hậu quả\:** Tồn kho khả dụng có thể tăng sai, trong khi số lượng sách đang mượn bị giảm sai.

### SB-05. Lỗi thanh toán tiền cọc sau khi xuất kho không được bù trừ tồn kho

**File\:** `services/borrow-service/src/controllers/loan.controller.js`

- **Mô tả\:** Luồng `createDirectLoan()` và `convertReservationToLoan()` thực hiện `consumeReservation()` trước khi tạo giao dịch mượn và giữ tiền cọc.
- **Input\:** Khách đủ tiền tại bước kiểm tra ban đầu, nhưng một giao dịch khác sử dụng tiền trong ví trước khi giao dịch tạo phiếu mượn thực hiện `holdLoanItemDeposits()`\.
- **Output mong muốn\:** Nếu không thể giữ tiền cọc hoặc trừ phí, phải hoàn nguyên tồn kho đã chuyển sang trạng thái đang cho mượn hoặc đưa vào quy trình đối soát.
- **Output thực tế\:** `AccountError` được bắt riêng và trả HTTP 409, không thực hiện bù trừ tồn kho, cũng không đưa vào hàng đợi reconciliation.

**Hậu quả\:** Inventory Service đã ghi nhận sách đang được mượn nhưng Borrow Service không có phiếu mượn tương ứng. Riêng luồng chuyển đặt trước còn có thể khiến trạng thái đặt trước và trạng thái giữ hàng trong kho không đồng nhất.

---

### SB-06. Chuyển đặt trước thành phiếu mượn có thể tạo hai phiếu mượn cho một đặt trước

**File\:** `services/borrow-service/src/controllers/loan.controller.js`

- **Mô tả\:** `convertReservationToLoan()` kiểm tra trạng thái đặt trước trước khi gọi Inventory Service, nhưng không khóa bản ghi đặt trước hoặc kiểm tra lại trạng thái trong transaction tạo phiếu mượn. `loan_transactions.source_reservation_id` cũng không có unique constraint.
- **Input\:** Hai request đồng thời cùng chuyển một reservation sang loan, sử dụng cùng Idempotency-Key.
- **Output mong muốn\:** Chỉ tạo một phiếu mượn; request còn lại nhận kết quả của phiếu đã tạo.
- **Output thực tế\:** Inventory Service có thể trả kết quả idempotent cho cả hai request, nhưng Borrow Service tạo hai `loan_transactions` với hai `loanId` khác nhau.

**Hậu quả\:** Một lần giữ hàng có thể tạo ra hai phiếu mượn, hai bộ chi tiết mượn và hai lần giữ tiền cọc. Đây là lỗi đồng bộ nghiêm trọng giữa hai service.

### SB-07. Kiểm kê có thể làm sai tồn kho khi phát sinh giao dịch trong thời gian kiểm kê

**File\:** `services/inventory-service/src/controllers/stock-audit.controller.js`

- **Mô tả\:** `createStockAudit()` lấy tồn kho tại thời điểm tạo phiếu. Khi duyệt, `approveStockAudit()` tính lại `liveDelta = counted_qty - currentOnHand` thay vì xử lý các biến động phát sinh sau thời điểm kiểm đếm. Đồng thời, đoạn đọc `stock_balances` không thực hiện khóa `FOR UPDATE`, mặc dù comment trong code nói có khóa.
- **Input\:** Tồn kho lúc kiểm đếm là 10, nhân viên đếm được 8. Sau đó phát sinh giao dịch xuất thêm 2 cuốn trước khi quản lý duyệt.
- **Output mong muốn\:** Tồn cuối cùng là 6, vì số thiếu 2 và số xuất thêm 2 đều phải được phản ánh.
- **Output thực tế\:** Hệ thống đọc tồn hiện tại là 8, tính `liveDelta = 0`, không điều chỉnh gì.

**Hậu quả\:** Tồn kho có thể bị sai sau khi duyệt kiểm kê. Giao dịch phát sinh đồng thời trong lúc duyệt còn có nguy cơ làm mất tính chính xác của phép điều chỉnh.

### SB-08. Một phiếu giao hàng có thể tạo nhiều GRN đồng thời

**File\:** `services/inventory-service/src/controllers/supplier-delivery.controller.js`

- **Mô tả\:** `createGoodsReceiptFromInvoice()` kiểm tra đã tồn tại GRN hay chưa bằng `findFirst()`, nhưng không khóa bản ghi delivery note. Database cũng chỉ có index trên `supplier_delivery_invoice_id`, không có unique constraint bảo đảm một delivery note chỉ có một GRN chưa hủy.
- **Input\:** PO có 10 cuốn; một delivery note khai báo giao 5 cuốn. Hai người đồng thời tạo GRN cho cùng delivery note, mỗi người nhận 5 cuốn.
- **Output mong muốn\:** Chỉ một GRN được tạo.
- **Output thực tế\:** Hai transaction có thể cùng vượt qua kiểm tra tồn tại và tạo hai GRN. Khi ghi sổ, cả hai vẫn có thể qua kiểm tra số lượng PO vì tổng số nhận là 10, chưa vượt 10.

**Hậu quả\:** Một lần giao hàng thực tế 5 cuốn có thể được ghi nhận thành 10 cuốn, làm tăng tồn kho sai và tăng số lượng đã nhận trên PO.

### SB-09. Thiếu kiểm soát tổng số lượng trên nhiều phiếu giao hàng

**File\:** `services/inventory-service/src/controllers/supplier-delivery.controller.js`

- **Mô tả\:** `createSupplierDelivery()` chỉ tính `ordered_qty - received_qty`, không gọi `assertInvoiceQtyWithinRemaining()` để tính cả các delivery note đã khai báo nhưng chưa nhận.
- **Input\:** PO đặt 100 cuốn, chưa nhận cuốn nào. Tạo hai phiếu giao hàng, mỗi phiếu 80 cuốn.
- **Output mong muốn\:** Phiếu thứ hai chỉ được khai báo tối đa 20 cuốn.
- **Output thực tế\:** Cả hai phiếu đều có thể được tạo với số lượng 80 vì `received_qty` vẫn bằng 0.

**Hậu quả\:** Tổng lượng hàng nhà cung cấp cam kết giao có thể vượt số lượng PO. Khi lập GRN, hệ thống mới phát hiện giới hạn, gây kẹt chứng từ và khó đối soát.

---

## 2\. Lỗi trong điều chuyển kho và nhận hàng

**P1 – Ưu tiên xử lý cao**

### SB-10. Số lượng hàng bù (Repick) bị cộng lặp khi có nhiều dòng cùng variant

**File\:** `services/inventory-service/src/controllers/outbound.controller.js`

- **Mô tả\:** `confirmOutbound()` tổng hợp số lượng repick theo `variant_id`, sau đó cộng tổng số lượng này vào từng dòng điều chuyển có cùng variant.
- **Input\:** Hai dòng cùng variant, lần lượt đã xuất 2 và 3 cuốn; repick bổ sung tổng cộng 2 cuốn.
- **Output mong muốn\:** Tổng xuất kho là 7 cuốn.
- **Output thực tế\:** Mỗi dòng đều được cộng thêm 2 cuốn, dẫn đến tổng xuất thành 9 cuốn.

**Hậu quả\:** Có thể xuất vượt số lượng thực tế được picking, thậm chí lấy nhầm tồn kho đang dành cho nghiệp vụ khác.

### SB-11. Luồng nhận hàng không tính số lượng Repick

**File\:** `services/inventory-service/src/controllers/transfer-receiving.controller.js`

- **Mô tả\:** `getTransferReceivingLines()` và `confirmTransferReceiving()` lấy số lượng từ `transfer_order_items.shipped_qty` của đơn gốc, không cộng số lượng từ các đơn repick.
- **Input\:** Đơn gốc xuất 5 cuốn, đơn repick bổ sung 2 cuốn, tổng hàng thực tế đang vận chuyển là 7.
- **Output mong muốn\:** Kho nhận hiển thị và đối soát 7 cuốn.
- **Output thực tế\:** Màn hình nhận hàng chỉ nhận diện 5 cuốn. Nếu nhập thực nhận 7, hệ thống có thể xem 2 cuốn bổ sung là hàng giao thừa.

**Hậu quả\:** Dữ liệu xuất và nhận giữa hai kho không đồng nhất. Nếu bỏ qua phần kiểm đếm, tồn kho có thể đúng nhưng `received_qty` trên phiếu điều chuyển lại sai.

### SB-12. Hàng thiếu, hỏng hoặc bị từ chối trong điều chuyển không có quy trình xử lý chênh lệch đầy đủ

**File\:**

- `services/inventory-service/src/controllers/transfer-receiving.controller.js`
- `services/inventory-service/src/controllers/outbound.controller.js`

- **Mô tả\:** Khi xác nhận nhận hàng, hệ thống có thể ghi nhận `delivered_qty`, `damaged_qty`, `rejected_qty`, nhưng `postTransferReceiptToReceiving()` chỉ cộng `quantity` được chấp nhận vào tồn kho.
- **Input\:** Kho A xuất 100 cuốn; kho B nhận 90 cuốn, trong đó 5 cuốn hỏng và 5 cuốn thiếu.
- **Output mong muốn\:** 90 cuốn được ghi nhận thực nhận; 5 cuốn hỏng được quản lý trong tồn hỏng; 5 cuốn thiếu được tạo hồ sơ chênh lệch để điều tra.
- **Output thực tế\:** Chỉ 85 cuốn được nhập vào tồn kho khả dụng/đang chờ cất. Phiếu điều chuyển vẫn được chuyển sang `RECEIVED`; không có luồng tự động lập báo cáo chênh lệch điều chuyển và xử lý hàng hỏng, hàng bị từ chối.

**Hậu quả\:** 15 cuốn chênh lệch giữa xuất và nhập không được xử lý thành một quy trình kiểm soát hoàn chỉnh. Dữ liệu GRN có giữ một phần thông tin, nhưng chưa đủ để quản lý trách nhiệm và quyết định xử lý.

---

## 3\. Lỗi trong nhập kho, trả hàng nhà cung cấp và hủy GRN

### SB-13. Không thể trả hàng nhà cung cấp đúng cách sau khi đã Putaway

(P1)

**File\:**

- `services/inventory-service/src/controllers/receiving-putaway.controller.js`
- `services/inventory-service/src/services/supplier-return.service.js`

- **Mô tả\:** `executeReturnStock()` lấy vị trí xuất hàng từ `goods_receipt_items.location_id`\. Tuy nhiên, khi GRN không chỉ định vị trí, hàng được đưa vào RECEIVING\_HOLD rồi chuyển lên kệ bằng `transferReceivingToShelf()`\. Luồng Putaway không cập nhật hoặc lưu liên kết phân bổ vị trí mới cho từng dòng GRN.
- **Input\:** Nhập 10 cuốn không chỉ định vị trí, sau đó Putaway toàn bộ 10 cuốn lên kệ.
- **Output mong muốn\:** Có thể lập phiếu trả nhà cung cấp và xuất 10 cuốn từ vị trí thực tế hiện tại.
- **Output thực tế\:** Dòng GRN vẫn có `location_id = null`; `executeReturnStock()` từ chối vì không tìm thấy vị trí lưu kho. Nếu GRN có vị trí ban đầu nhưng hàng đã được chuyển sang vị trí khác, hệ thống lại kiểm tra tồn ở vị trí cũ.

**Hậu quả\:** Quy trình trả hàng nhà cung cấp có thể bị kẹt dù hàng vẫn tồn tại trong kho.

### SB-14. Hủy GRN sau khi Putaway không hoàn nguyên đầy đủ các biến động kho

(P1)

**File\:** `services/inventory-service/src/controllers/goods-receipt.controller.js`

- **Mô tả\:** `cancelStockMovements()` chỉ tìm movement có `reference_type = GOODS_RECEIPT`\. Các movement Putaway có `reference_type = RECEIVING_SHELF_PUTAWAY` không được hoàn nguyên.
- **Input\:** GRN nhập 10 cuốn vào RECEIVING\_HOLD; sau đó chuyển 10 cuốn lên kệ; quản lý hủy GRN.
- **Output mong muốn\:** Hoàn nguyên các movement Putaway trước, sau đó hoàn nguyên movement nhập ban đầu; tồn kho cuối cùng trở về trạng thái trước GRN.
- **Output thực tế\:** Hệ thống cố giảm 10 cuốn ở vị trí RECEIVING ban đầu nhưng không hoàn nguyên 10 cuốn đã chuyển lên kệ. Tùy trạng thái tồn và ràng buộc database, thao tác có thể thất bại hoặc làm sai số dư.

**Hậu quả\:** Không thể hủy GRN an toàn sau khi hàng đã được Putaway.

### SB-15. Đóng phần số lượng PO còn lại không kiểm tra chứng từ đang giao dở

**File\:** `services/inventory-service/src/controllers/purchase-order-line-closure.controller.js`

- **Mô tả\:** `closeRemainingLine()` chỉ khóa và kiểm tra dòng PO, số lượng đã nhận, trạng thái và lý do đóng. Không kiểm tra các delivery note hoặc hóa đơn đã khai báo nhưng chưa có GRN.
- **Input\:** PO đặt 100 cuốn, đã nhận 50; nhà cung cấp đã lập delivery note cho 50 cuốn còn lại nhưng hàng chưa được nhập kho. Quản lý đóng phần còn lại 50 cuốn.
- **Output mong muốn\:** Không cho đóng khi còn chứng từ giao hàng đang chờ xử lý, hoặc yêu cầu xử lý chứng từ đó trước.
- **Output thực tế\:** Có thể đóng dòng PO. Khi GRN được ghi sổ, `applyPurchaseOrderReceipt()` phát hiện dòng đã đóng và từ chối nhận hàng.

**Hậu quả\:** Hàng đã được nhà cung cấp khai báo giao có thể bị mắc kẹt trong trạng thái chứng từ không thể ghi sổ.

---

## 4\. Các lỗi nghiệp vụ bổ sung – P2


