# Báo cáo triển khai — Phase 2: Complete Business Workflow (P1.1–P1.4)

Phạm vi: bốn nghiệp vụ còn lại trong kế hoạch "Business Logic Integrity & Complete Business
Workflow" cho domain Procurement/Inventory — **P1.1 Purchase Order Revision**, **P1.2 Close
Remaining Quantity**, **P1.3 Supplier Return (Return to Supplier)**, **P1.4 Three-Way Matching**.
Phase 1 (Business Logic Integrity) đã hoàn tất và commit trước đó; báo cáo này chỉ nói về Phase 2.

## 1. Nhánh và commit nền

- Nhánh làm việc: `khoa`.
- Commit nền (điểm rollback an toàn nếu cần): `64b619b` — *feat(procurement): supplier document
  workflow + business-logic integrity fixes*.
- Toàn bộ thay đổi của báo cáo này **chưa được commit** (theo đúng yêu cầu: chỉ commit/push khi
  được explicit cho phép trong phiên làm việc).
- Mỗi workflow bắt đầu bằng một audit đọc-mã-nguồn riêng (không giả định), truy vết UI → API →
  controller → service → Prisma → DB, trước khi thiết kế bất kỳ bảng/endpoint mới nào — đúng yêu
  cầu "Audit before coding" của prompt gốc.

## 2. P1.1 — Purchase Order Revision

### 2.1. Audit & phát hiện quan trọng

- `purchase_orders.status` và các status tương tự trong toàn bộ schema là `VarChar` tự do, không
  có Prisma `enum` — quy ước đã có từ trước, không phá vỡ.
- Cơ chế gần nhất hiện có là `purchase_order_supplier_responses` (NCC đề xuất giảm số lượng khi
  PO ở `SENT_TO_SUPPLIER`) — nhưng cơ chế này: chỉ cho giảm (không tăng), chỉ một response "sống"
  tại một thời điểm (không có lịch sử nhiều revision), và **khóa cứng khi `received_qty > 0`** —
  không dùng được cho P1.1 vì P1.1 phải hoạt động được cả khi đang nhận hàng một phần.
  (`services/purchase-order-response.service.js`, `procurement-workflow.controller.js`).
- `purchase_order_items` được tham chiếu trực tiếp bằng `id` từ hóa đơn
  (`supplier_delivery_invoice_items.purchase_order_item_id`) và báo cáo thiếu hàng; GRN thì tham
  chiếu qua `variant_id`. Vì vậy: sửa `ordered_qty` tại chỗ (in-place) sẽ làm thay đổi ý nghĩa của
  mọi hóa đơn/GRN đã tồn tại trước đó — đây là rủi ro chính cần tránh.
- Tiền lệ "giữ lịch sử, không ghi đè" đã có sẵn trong `procurement_documents.supersedes_document_id`
  (chuỗi version) và `procurement_reconciliations.snapshot` (Json chụp toàn bộ trạng thái tại thời
  điểm hoàn tất) — chọn theo tiền lệ này.

### 2.2. Thiết kế

Thay vì tạo một dòng `purchase_order_items` mới cho mỗi revision (sẽ phải sửa logic khóa GRN theo
`variant_id`), **giữ nguyên dòng sống hiện tại**, chỉ cho phép ghi vào nó qua một bảng
`purchase_order_revisions` lưu snapshot trước/sau (Json), và **chỉ áp dụng (ghi vào
`purchase_order_items`) khi revision đạt trạng thái `EFFECTIVE`**. Nhờ vậy:

- GRN/hóa đơn tạo trong lúc revision đang `PENDING_*` vẫn đọc giá trị hiện hành không đổi — đây
  cũng chính là cách thỏa yêu cầu "không nhận được hàng theo một revision chưa hiệu lực" mà
  **không cần sửa một dòng code nào trong goods-receipt posting**.
- Trạng thái: `PENDING_APPROVAL → APPROVED | PENDING_SUPPLIER_RECONFIRMATION → EFFECTIVE`, hoặc
  `REJECTED / SUPPLIER_REJECTED / CANCELLED`. Chỉ một revision "sống" (chưa kết thúc) cho mỗi PO
  tại một thời điểm.
- Lúc áp dụng (`applyRevision`), khóa lại dòng `purchase_order_items` (`FOR UPDATE`) và **đọc lại
  `received_qty` cùng tổng đã lập hóa đơn (loại trừ giao bù) ngay tại thời điểm áp dụng**, không
  tin vào số liệu đã chụp lúc yêu cầu — để chặn trường hợp hàng đã về/đã lập hóa đơn thêm trong
  lúc revision còn chờ duyệt.
- "Original PO" = snapshot `before` của revision số 1; "Current Effective" = giá trị sống hiện tại
  của `purchase_order_items`; "Revision History" = toàn bộ các dòng `purchase_order_revisions`.

### 2.3. Database

- Migration: `services/inventory-service/prisma/migrations/20261114100000_add_purchase_order_revisions/migration.sql`.
- Chỉ **thêm** một bảng mới `purchase_order_revisions` (before/after snapshot Json, reason,
  requested/approved/supplier_decision/effective, timestamps) + 1 relation field trên
  `purchase_orders`. Không đổi/xóa cột, bảng, hay dữ liệu cũ nào.
- Rollback: `DROP TABLE "purchase_order_revisions";`.

### 2.4. API (gắn vào `purchase-order.routes.js`, dùng lại `canRead`/`canWrite`/`canApprove` có sẵn)

```
GET  /api/purchase-orders/:id/revisions
POST /api/purchase-orders/:id/revisions
POST /api/purchase-orders/:id/revisions/:revisionId/approve
POST /api/purchase-orders/:id/revisions/:revisionId/reject
POST /api/purchase-orders/:id/revisions/:revisionId/cancel
POST /api/purchase-orders/:id/revisions/:revisionId/supplier-confirm
POST /api/purchase-orders/:id/revisions/:revisionId/supplier-reject
```

Không thêm permission mới — dùng lại `inventory.purchase.write` (request/cancel/supplier-*) và
`inventory.purchase.approve` (approve/reject).

### 2.5. Test

- Unit: `test/purchase-order-revision.test.js` — 14 test (validate đề xuất, chặn giảm dưới
  `received_qty`, double-request bị chặn, `applyRevision` tự kiểm tra lại received/invoiced qty
  tươi, loại trừ giao bù khi tính tổng đã lập hóa đơn).
- Integration (qua gateway thật): `scripts/purchase-order-revision-integration.mjs` — **20/20
  PASS**, gồm cả đường áp dụng ngay, đường chờ NCC xác nhận lại, reject/cancel, chặn revision thứ
  hai khi còn một revision đang chờ, và **một race thật** (fired bằng `Promise.all`): NCC lập hóa
  đơn mới cạnh tranh với việc áp dụng revision trên cùng một dòng PO — xác nhận đúng một trong hai
  thắng, không bao giờ cả hai.

## 3. P1.2 — Close Remaining Quantity

### 3.1. Audit & phát hiện

Không có khái niệm "đóng phần còn lại" ở đâu trong hệ thống. Trạng thái dòng hàng hiện tại chỉ có
`reconciliation_status` tính động (`NOT_RECEIVED/MATCHED/OVER_RECEIVED/UNDER_RECEIVED`), không có
chỗ lưu "quản lý đã quyết định sẽ không nhận phần còn lại nữa, có lý do".

### 3.2. Thiết kế

Thêm các cột trực tiếp trên `purchase_order_items` (không cần bảng mới): `closure_status`
(`OPEN` | `CLOSED_WITH_REMAINING`) cùng `closed_reason/closed_evidence_reference/closed_by_user_id/
closed_at` và `reopened_reason/reopened_by_user_id/reopened_at`. **Không bao giờ sửa `ordered_qty`
hay `received_qty`** — hành động đóng chỉ gắn một cờ. Trạng thái hiển thị cho người dùng
(`fulfillment_status`) được tính từ `closure_status` + số lượng + trạng thái PO, tách biệt hẳn 4
nhóm: `FULLY_RECEIVED / CLOSED_WITH_REMAINING / CANCELLED / PARTIALLY_RECEIVED` (không gộp vào một
nhóm "RECEIVED" chung như trước). Mở lại (`reopen`) là một hành động riêng, gắn permission
`inventory.purchase.approve` (duyệt cao hơn `write`) để thỏa "reopening cần bước duyệt riêng".

Một dòng đã `CLOSED_WITH_REMAINING` bị chặn nhận thêm hàng (GRN) và lập thêm hóa đơn — chặn qua một
guard dùng chung `assertLineNotClosed`/kiểm tra `closure_status` tại **ba** điểm ghi:
`createSupplierInvoice` (purchase-order.controller.js), đường lập hóa đơn qua supplier-account/
portal (`createPortalInvoice` trong supplier-portal.controller.js), và `applyPurchaseOrderReceipt`
(goods-receipt.controller.js).

### 3.3. Database

- Migration: `.../migrations/20261114110000_add_po_line_close_remaining/migration.sql`.
- Chỉ **thêm cột** (8 cột mới, có default) trên `purchase_order_items`. Rollback: `ALTER TABLE
  "purchase_order_items" DROP COLUMN "closure_status", DROP COLUMN "closed_reason", ... ;` (đầy đủ
  trong migration.sql).

### 3.4. API

```
POST /api/purchase-orders/:id/items/:itemId/close-remaining   (canWrite)
POST /api/purchase-orders/:id/items/:itemId/reopen-remaining  (canApprove)
```

### 3.5. Test

- Unit: `test/purchase-order-line-closure.test.js` (13 test) + 2 test guard mới trong
  `test/procurement-receipt.test.js` (`assertLineNotClosed`).
- Integration: `scripts/purchase-order-close-remaining-integration.mjs` — **18/18 PASS**: đóng
  đúng còn lại, không đổi `ordered_qty`/`received_qty`, chặn đóng hai lần, chặn đóng khi hết số
  lượng/khi PO chưa gửi NCC, chặn NCC lập hóa đơn thêm trên dòng đã đóng, mở lại rồi **nhận đủ
  phần còn lại thật qua toàn bộ luồng hóa đơn + GRN** để xác nhận hệ thống hoạt động lại bình
  thường sau khi mở.

## 4. P1.3 — Supplier Return (Return to Supplier)

### 4.1. Audit & phát hiện quan trọng

- `goods_receipt_items` không có cột nào theo dõi "đã trả bao nhiêu" — phải thêm cơ chế đếm.
- `OutboundReferenceType` enum đã có sẵn `RETURN_TO_SUPPLIER`/`DAMAGED_RETURN`, nhưng luồng
  outbound-order chung (`order-request.controller.js`) không có FK tới `goods_receipt_items`/PO,
  không có lý do/evidence — không đủ để chặn "vượt số lượng đã nhận" hay "double-count".
- `stock_balances.available_qty` **đã loại trừ** `reserved_qty`/`borrowed_qty` theo thiết kế sẵn
  có (dùng cho giữ hàng mượn sách) — nghĩa là chỉ cần chặn theo `available_qty` tại đúng vị trí là
  tự động thỏa "không trả hàng đang được giữ cho một lượt mượn đang hoạt động", không cần đụng vào
  `borrow-service`.
- Khóa `FOR UPDATE` trên `stock_balances` rồi đọc lại trước khi trừ là mẫu đã dùng ở
  `picking.controller.js` (pick-to-ship) — tái dùng nguyên mẫu này, không phát minh cách khóa mới.
- `supplier_shortage_reports` là nghiệp vụ khác hẳn (thiếu hàng **trước khi** ghi vào kho, hàng
  không hề được post lên `stock_balances`) — không dùng lại được cho P1.3 (trả hàng **đã** post).

### 4.2. Thiết kế

Hai bảng mới `supplier_returns` + `supplier_return_items`, tham chiếu trực tiếp
`goods_receipt_items.id` (không phải `variant_id`) để truy vết chính xác dòng đã nhận nào đang bị
trả. Trạng thái: `PENDING_APPROVAL → APPROVED | PENDING_SUPPLIER_CONFIRMATION → APPROVED →
STOCK_RETURNED → COMPLETED`, hoặc `REJECTED/SUPPLIER_REJECTED/CANCELLED`.

- **Chặn vượt số lượng đã nhận & double-count**: `assertReturnQtyWithinAccepted` khóa dòng
  `goods_receipt_items` (`FOR UPDATE`), cộng tổng `return_qty` của mọi yêu cầu **còn hoạt động**
  (chưa bị `REJECTED/SUPPLIER_REJECTED/CANCELLED`) trên dòng đó, rồi so với `quantity` (số lượng
  đã nhận gốc, không đổi) — cùng khuôn với `assertInvoiceQtyWithinRemaining`.
- **Thực thi xuất kho** (`executeReturnStock`): khóa `stock_balances` theo `(variant_id,
  location_id)` của đúng vị trí GRN đã đưa hàng vào, đọc lại `on_hand_qty`/`available_qty`, chặn
  nếu không đủ, rồi trừ cả hai + ghi **một dòng `stock_movements` mới** `movement_type: "OUTBOUND"`,
  `reference_type: "SUPPLIER_RETURN"`. **Không bao giờ sửa/xóa** GRN gốc hay các `stock_movements`
  cũ — chỉ cộng thêm một bản ghi ngược hướng mới.
- Kết quả xử lý (`resolution_outcome`): `REFUND | REDELIVERY | EXCHANGE | CREDIT_NOTE | OTHER`,
  ghi cùng `resolution_note`, `resolved_by_user_id`, `resolved_at` khi hoàn tất.

### 4.3. Database

- Migration: `.../migrations/20261114120000_add_supplier_returns/migration.sql`.
- 2 bảng mới hoàn toàn, không đổi bảng cũ nào. Rollback: `DROP TABLE "supplier_return_items"; DROP
  TABLE "supplier_returns";`.

### 4.4. API

```
GET  /api/purchase-orders/:id/returns
POST /api/purchase-orders/:id/returns
POST /api/purchase-orders/:id/returns/:returnId/approve
POST /api/purchase-orders/:id/returns/:returnId/reject
POST /api/purchase-orders/:id/returns/:returnId/cancel
POST /api/purchase-orders/:id/returns/:returnId/supplier-confirm
POST /api/purchase-orders/:id/returns/:returnId/supplier-reject
POST /api/purchase-orders/:id/returns/:returnId/execute
POST /api/purchase-orders/:id/returns/:returnId/complete
```

### 4.5. Test

- Unit: `test/supplier-return.test.js` — 18 test, gồm cả stub cho `executeReturnStock` xác nhận:
  không bao giờ cho `on_hand_qty`/`available_qty` âm, không trả được hàng đang reserved/borrowed
  (mô phỏng bằng `available_qty` nhỏ hơn `on_hand_qty`), chặn dòng chưa có vị trí lưu kho.
- Integration: `scripts/supplier-return-integration.mjs` — **20/20 PASS**: toàn bộ chu trình
  request → approve → supplier-confirm → execute → complete, số lượng kho giảm đúng
  `return_qty`, reject/cancel/supplier-reject đều không đụng tới kho, chặn trả hàng trên GRN chưa
  `POSTED`, và **một race thật**: hai yêu cầu trả hàng (6 + 6, trên dòng chỉ còn 10) bắn đồng thời
  qua `Promise.all` — xác nhận không bao giờ cả hai cùng được chấp nhận.

## 5. P1.4 — Three-Way Matching

### 5.1. Phát hiện quan trọng nhất: đã có sẵn, không cần xây lại

Audit `services/procurement-reconciliation.service.js` +
`procurement-workflow.controller.js` (tính năng *Document Reconciliation* đi kèm Procurement
Document Workflow trước đó) cho thấy **đây chính là một matching engine ba/bốn chiều PO ↔ hóa đơn
↔ phiếu giao hàng ↔ GRN đã hoạt động đầy đủ**:

- Tính đúng `ordered_qty/invoiced_qty/accepted_qty/unit_price` theo từng dòng PO, cộng dồn đúng
  trên **nhiều hóa đơn và nhiều GRN** không double-count (đã có test "several invoices and several
  deliveries" từ trước).
- `completeDocumentReconciliation` **đã** chặn hoàn tất khi có discrepancy trừ khi
  `exception_approved=true` **và** người gọi có quyền `inventory.purchase.approve` **và** có
  `note` — đúng yêu cầu "never auto-approve a discrepancy". Khi hoàn tất, ghi một dòng
  `procurement_reconciliations` (snapshot Json đầy đủ + `completed_by_user_id` +
  `exception_approved` + `note`) và một `inventory_audit_logs` — đúng yêu cầu "record who ran it
  and who approved an exception" **và** "traceable Invoice → PO → GRN" (lần hoàn tất nào, ai duyệt,
  vì sao, dựa trên dữ liệu nào, đều có vết).

Vì vậy **P1.4 không cần migration mới**. Phần còn thiếu, đã bổ sung đúng những gì thật sự thiếu so
với yêu cầu gốc:

1. Kết quả theo đúng 5 tên mà prompt yêu cầu (`MATCHED/PARTIALLY_MATCHED/DISCREPANCY/
   PENDING/REQUIRES_APPROVAL`) — thêm field `three_way_match_status` (header + từng dòng) **map
   từ** `status` hiện có (`PENDING_DOCUMENT→PENDING`, `NEEDS_REVIEW→REQUIRES_APPROVAL`, 3 tên còn
   lại giữ nguyên) — **không đổi tên `status` cũ** để UI/API hiện tại không vỡ.
2. "amount" theo từng dòng (prompt yêu cầu rõ: ordered_qty, invoiced_qty, accepted_qty, unit_price,
   **amount**, tax nếu schema đã hỗ trợ) — thêm `po_amount`, `invoiced_amount` (ưu tiên dùng lại
   `line_amount` đã lưu sẵn trên `procurement_document_lines`, không tính lại để giữ đúng số đã
   chốt lúc phát hành), `accepted_amount`, cộng dồn ở `totals`. Thuế: đã có sẵn ở mức header
   (`tax_rate/tax_amount`, kiểm bằng `checkInvoiceHeader`) — schema không có thuế theo từng dòng
   nên không thêm (đúng điều kiện "if the schema already supports it").
3. Truy vết Invoice → PO → GRN **ở từng dòng**: thêm `invoice_ids`/`goods_receipt_ids` (danh sách
   id các chứng từ/GRN thật sự góp vào số lượng của dòng đó), không chỉ tổng số như trước.

Toàn bộ thay đổi nằm trong `procurement-reconciliation.service.js`, hàm thuần không I/O, **thêm
field, không đổi hành vi/field cũ nào**.

### 5.2. Database

Không có migration cho P1.4 — không cần cột/bảng mới.

### 5.3. API

Không có endpoint mới — field mới tự động xuất hiện trong response có sẵn của:
```
GET  /api/purchase-orders/:id/document-reconciliation
POST /api/purchase-orders/:id/document-reconciliation/complete
```

### 5.4. Test

- Unit: thêm 5 test vào `test/procurement-reconciliation.test.js` (map vocabulary, amount dùng
  `line_amount` có sẵn, amount fallback khi không có `line_amount`, truy vết nhiều hóa đơn/nhiều
  GRN, GRN draft không được tính). 13 test cũ vẫn giữ nguyên, **toàn bộ pass** — xác nhận thay đổi
  không ảnh hưởng hành vi cũ.
- Integration: `scripts/three-way-matching-integration.mjs` — **14/14 PASS**. Điểm quan trọng
  phát hiện trong lúc viết test: `supplier_delivery_invoices` (phiếu giao hàng tạo qua
  supplier-account) **không** được engine tính là "đã lập hóa đơn" — chỉ một `procurement_documents`
  loại `VAT_INVOICE`/`SALES_INVOICE` ở trạng thái `ISSUED` mới tính. Vì vậy test phải tạo/đính kèm
  file/phát hành một hóa đơn VAT thật (qua `/api/supplier-account/orders/:id/documents` +
  `/documents/:docId/files` + `/documents/:docId/issue`) để lên được trạng thái MATCHED — đây là
  hành vi đúng của engine hiện tại (không phải lỗi), nhưng là điểm dễ hiểu lầm nên ghi rõ trong
  phần "Giới hạn" dưới đây.
- Không có test concurrency riêng cho P1.4: hành động viết duy nhất
  (`completeDocumentReconciliation`) chỉ *thêm* một dòng log/snapshot, không tranh chấp một giá
  trị chung nào (khác P1.1–P1.3, nơi một số lượng dùng chung có thể bị vượt nếu đua) — hai lần
  hoàn tất song song chỉ tạo hai dòng lịch sử độc lập, không có bất biến nào bị phá.

## 6. Lỗi concurrency thật phát hiện và đã sửa trong lúc test P1.1

Khi viết test race cho P1.1 (lập hóa đơn mới đua với việc áp dụng revision trên cùng một dòng PO),
phát hiện **`assertInvoiceQtyWithinRemaining`** (`procurement-receipt.service.js`) khóa đúng dòng
`purchase_order_items` (`FOR UPDATE`) nhưng **tính "còn lại" bằng `poItem.ordered_qty` lấy từ object
đã fetch *trước* khi khóa**, không đọc lại sau khi có khóa. Trước P1.1, lỗi này vô hại vì không có
luồng nào khác từng sửa `ordered_qty` đồng thời với việc lập hóa đơn. P1.1 thêm `applyRevision` —
luồng **thứ hai** có thể sửa `ordered_qty` trên cùng dòng — khiến lỗi trở thành khai thác được: nếu
revision áp dụng xong (hạ `ordered_qty`) ngay trong lúc một lệnh lập hóa đơn đang chờ khóa, lệnh đó
sẽ dùng `ordered_qty` **cũ** để tính "còn lại", cho phép lập hóa đơn vượt số lượng mới. Test race
bắt được đúng tình huống này (`invoiced=9 > ordered=8` xảy ra thật). Đã sửa: đọc lại `ordered_qty`
từ DB ngay sau khi có khóa, trước khi tính "còn lại" (xem comment tại chỗ sửa). Sau khi sửa, race
test chạy nhiều lần đều cho đúng một trong hai thắng, không bao giờ cả hai — và toàn bộ regression
suite cũ (goods-receipt/invoice concurrency) vẫn pass không đổi.

## 7. Database Changes — tổng hợp

| Migration | Thay đổi | Loại |
|---|---|---|
| `20261114100000_add_purchase_order_revisions` | +1 bảng `purchase_order_revisions` | Additive |
| `20261114110000_add_po_line_close_remaining` | +8 cột trên `purchase_order_items` | Additive |
| `20261114120000_add_supplier_returns` | +2 bảng `supplier_returns`, `supplier_return_items` | Additive |
| (P1.4) | Không có | — |

Không có migration nào xóa/đổi tên cột, bảng, hay dữ liệu cũ. Cả 3 migration đã áp dụng thành công
vào Postgres thật trong container `smartbook-system-inventory-service-1` (rebuild + `prisma migrate
deploy` tự động theo `command` có sẵn trong `docker-compose.yml`), xác nhận bằng log container.

## 8. Kết quả kiểm thử tổng hợp

### 8.1. Unit test (`pnpm --filter inventory-service test` / `node --test test/*.test.js`)

**322/322 PASS** (0 fail), chạy sau khi toàn bộ 4 workflow đã vào, gồm:
- 14 test mới — `purchase-order-revision.test.js`
- 13 test mới — `purchase-order-line-closure.test.js` + 2 test mới trong `procurement-receipt.test.js`
- 18 test mới — `supplier-return.test.js`
- 5 test mới — thêm vào `procurement-reconciliation.test.js` (18 tổng, 13 cũ + 5 mới)
- Toàn bộ test cũ của inventory-service (warehouse scope, picking, putaway, stock audit, storage
  suggestion, v.v.) không bị ảnh hưởng.

### 8.2. Integration test qua gateway thật (Docker, Postgres thật, HTTP thật)

| Script | Kết quả |
|---|---|
| `scripts/concurrent-goods-receipt-posting-integration.mjs` (regression cũ) | 5/5 PASS |
| `scripts/concurrent-invoice-over-po-integration.mjs` (regression cũ) | 4/4 PASS |
| `scripts/purchase-supplier-receiving-integration.mjs` (regression cũ) | 13/13 PASS |
| `scripts/purchase-order-revision-integration.mjs` (P1.1, mới) | 20/20 PASS |
| `scripts/purchase-order-close-remaining-integration.mjs` (P1.2, mới) | 18/18 PASS |
| `scripts/supplier-return-integration.mjs` (P1.3, mới) | 20/20 PASS |
| `scripts/three-way-matching-integration.mjs` (P1.4, mới) | 14/14 PASS |

Mỗi script chạy lại **sau khi** từng workflow tiếp theo vào, để đảm bảo workflow sau không phá
workflow trước — tất cả đều pass ở lần chạy cuối cùng, cùng một lúc.

### 8.3. Test concurrency thật (fired bằng `Promise.all`, không phải tuần tự)

- P1.1: lập hóa đơn mới **đua** với áp dụng revision trên cùng dòng PO — phát hiện và sửa lỗi ở
  mục 6.
- P1.3: hai yêu cầu trả hàng **đua** trên cùng dòng GRN (6+6 trên 10 còn lại) — đúng một thắng.
- P1.2, P1.4: không có cạnh tranh ghi trên một giá trị dùng chung (giải thích tại mục 3/5), nên
  không cần test race riêng — ghi rõ như một quyết định có lý do, không phải thiếu sót.

## 9. RBAC

Không thêm permission mới nào. Toàn bộ 4 workflow dùng lại đúng 3 permission đã có của domain này:
`inventory.purchase.read` (xem), `inventory.purchase.write` (yêu cầu/hủy/ghi nhận phản hồi NCC),
`inventory.purchase.approve` (duyệt/từ chối/mở lại dòng đã đóng) — qua các middleware có sẵn
`authorizeManagerRead`/`authorizePurchaseManager` (`auth.middleware.js`), cùng
`canWriteWarehouse`/`requireWarehouseReadAccess` để chặn theo phạm vi kho như toàn bộ domain.

## 10. Files Changed

```
services/inventory-service/prisma/schema.prisma                                  (sửa)
services/inventory-service/prisma/migrations/20261114100000_add_purchase_order_revisions/  (mới)
services/inventory-service/prisma/migrations/20261114110000_add_po_line_close_remaining/   (mới)
services/inventory-service/prisma/migrations/20261114120000_add_supplier_returns/          (mới)
services/inventory-service/src/services/purchase-order-revision.service.js        (mới)
services/inventory-service/src/controllers/purchase-order-revision.controller.js  (mới)
services/inventory-service/src/services/purchase-order-line-closure.service.js    (mới)
services/inventory-service/src/controllers/purchase-order-line-closure.controller.js (mới)
services/inventory-service/src/services/supplier-return.service.js                (mới)
services/inventory-service/src/controllers/supplier-return.controller.js          (mới)
services/inventory-service/src/routes/purchase-order.routes.js                    (sửa: +17 route)
services/inventory-service/src/controllers/purchase-order.controller.js           (sửa: items trả thêm closure_status/fulfillment_status)
services/inventory-service/src/controllers/goods-receipt.controller.js            (sửa: thêm guard assertLineNotClosed)
services/inventory-service/src/controllers/supplier-portal.controller.js          (sửa: thêm guard chặn hóa đơn trên dòng đã đóng)
services/inventory-service/src/services/procurement-receipt.service.js           (sửa: thêm assertLineNotClosed; SỬA LỖI race trong assertInvoiceQtyWithinRemaining)
services/inventory-service/src/services/procurement-reconciliation.service.js    (sửa: thêm amount/traceability/three_way_match_status, không đổi field cũ)
services/inventory-service/test/purchase-order-revision.test.js                   (mới)
services/inventory-service/test/purchase-order-line-closure.test.js               (mới)
services/inventory-service/test/supplier-return.test.js                           (mới)
services/inventory-service/test/procurement-receipt.test.js                       (sửa: +2 test)
services/inventory-service/test/procurement-reconciliation.test.js                (sửa: +5 test)
scripts/purchase-order-revision-integration.mjs                                   (mới)
scripts/purchase-order-close-remaining-integration.mjs                            (mới)
scripts/supplier-return-integration.mjs                                           (mới)
scripts/three-way-matching-integration.mjs                                        (mới)
```

Không đụng đến `borrow-service`, `auth-service`, `analytics-service`, `ai-service`, hay
`api-gateway` routing — đúng ràng buộc "don't touch modules outside this domain".

## 11. Giới hạn còn tồn tại (ghi rõ, chưa xử lý)

1. **Chưa có UI frontend cho cả 4 workflow.** Phase 2 này chỉ làm backend (schema, migration, API,
   RBAC, test) và đã audit pattern UI cần theo (xem `ProcurementDocumentCenter.tsx` làm mẫu cho
   revision/return, cùng `purchase-order.ts`/`procurement-documents.ts` cho API client) nhưng
   chưa viết component React nào. Người dùng hiện chỉ dùng được 4 workflow này qua API trực tiếp
   (đã kiểm chứng đầy đủ bằng script), chưa qua giao diện SmartBook. Đây là việc còn lại rõ ràng
   nhất, nên làm thành một lượt riêng (ước lượng tương đương khối lượng UI đã làm cho Procurement
   Document Workflow trước đó).
2. **P1.3 Supplier Return**: việc xuất kho trả hàng (`execute`) chỉ trừ được tại **đúng vị trí**
   (`location_id`) mà GRN gốc đã đưa hàng vào. Nếu hàng đã được chuyển sang vị trí khác hoặc kho
   khác sau khi nhận (transfer nội bộ), lệnh trả hàng sẽ báo lỗi "không đủ số lượng khả dụng" dù
   tổng số lượng toàn kho vẫn đủ — đây là giới hạn có chủ đích (chọn an toàn: không tự ý trừ ở một
   vị trí khác mà GRN không ghi nhận), người dùng cần tự điều chuyển về đúng vị trí (hoặc dùng
   nghiệp vụ transfer có sẵn) trước khi thực thi trả hàng.
3. **P1.3**: chỉ trừ kho tại một vị trí cho mỗi dòng trả hàng (1:1 với `goods_receipt_items`); chưa
   hỗ trợ trả một phần số lượng đã bị tách ra nhiều vị trí khác nhau sau GRN (vì GRN hiện tại cũng
   chỉ ghi một `location_id` mỗi dòng, nên giới hạn này kế thừa từ chính model GRN, không phải lỗi
   mới).
4. **P1.4**: chỉ `procurement_documents` loại `VAT_INVOICE`/`SALES_INVOICE` ở trạng thái `ISSUED`
   được tính là "đã lập hóa đơn" cho mục đích matching — một `supplier_delivery_invoices` (phiếu
   giao hàng qua supplier-account, tên bảng gây nhầm là "invoice" nhưng bản chất là delivery note)
   **không** tự động tính. Đây là hành vi đã có từ trước (không phải do P1.4 thêm), nhưng vì dễ
   gây nhầm lẫn tên bảng nên ghi rõ ở đây để người dùng/đội QA sau không hiểu sai khi thấy
   `invoiced_qty = 0` mặc dù "đã có invoice" (delivery note) trong hệ thống.
5. Không thêm field thuế theo từng dòng cho P1.4 vì `procurement_document_lines` không có cột thuế
   riêng (chỉ có ở header `procurement_documents.tax_rate/tax_amount`) — đúng điều kiện gốc "tax if
   the schema already supports it", không tự thêm cột mới ngoài phạm vi yêu cầu.

## 12. Kết luận

Cả 4 workflow P1.1–P1.4 đã được audit trước khi code, thiết kế tối thiểu dựa trên tiền lệ có sẵn
trong codebase (không phát minh cơ chế mới khi đã có mẫu tương đương), migration thuần additive có
rollback, RBAC dùng lại permission cũ, và kiểm thử bằng dữ liệu thật qua Docker + Postgres + HTTP
thật (không mock) — gồm cả test concurrency thật cho hai điểm có rủi ro đua thực sự (P1.1, P1.3).
P1.4 là phát hiện quan trọng nhất về mặt phạm vi: tính năng "ba chiều matching" mà prompt yêu cầu
**đã tồn tại** dưới tên "document reconciliation", nên công việc thực tế chỉ là bổ sung đúng phần
còn thiếu (amount, traceability theo dòng, tên trạng thái) — tránh xây lại một hệ thống đã có,
đúng nguyên tắc "Classify findings; only build what's actually missing" của brief gốc. Giới hạn
còn lại — rõ ràng nhất là UI — được ghi lại đầy đủ ở mục 11 để làm thành việc tiếp theo.
