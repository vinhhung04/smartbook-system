# Báo cáo — Rà soát và xử lý P0 luồng Procurement (PO → NCC → Hóa đơn → Giao hàng → Nhập kho)

Ngày: 2026-11-14 · Nhánh: `khoa` (không đổi nhánh, không commit/push)

## 1. Nhánh và commit ban đầu

| Mục | Giá trị |
|---|---|
| Nhánh | `khoa`, không đổi |
| Commit gốc tại thời điểm audit | `4cb7bee` (fix(print): render receipt print sheets via portal…) |
| Working tree trước khi bắt đầu | Đã có một khối lượng lớn thay đổi **chưa commit** từ phiên trước (2026-11-13): tính năng "Procurement Document Workflow" — xem `PROCUREMENT_DOCUMENT_WORKFLOW_IMPLEMENTATION_REPORT.md` (đã có sẵn ở repo root) |
| Thay đổi của phiên này | Chỉ 2 file: `services/inventory-service/src/controllers/goods-receipt.controller.js` (sửa) và `scripts/concurrent-goods-receipt-posting-integration.mjs` (mới) + chính báo cáo này |

## 2. Audit hiện trạng — không giả định, đã đọc code thật

Trước khi viết bất kỳ dòng code nào, đã đọc trực tiếp:
`services/inventory-service/prisma/schema.prisma`, `purchase-order.controller.js`, `supplier-portal.controller.js`, `supplier-delivery.controller.js`, `goods-receipt.controller.js`, `goods-receipt-posting.service.js`, `procurement-receipt.service.js`, các route liên quan, và `PROCUREMENT_DOCUMENT_WORKFLOW_IMPLEMENTATION_REPORT.md`.

**Phát hiện quan trọng nhất của audit**: 5 vấn đề P0 trong yêu cầu **phần lớn đã được giải quyết** bởi công việc chưa commit từ phiên trước (2026-11-13, "Procurement Document Workflow"). Thay vì viết lại từ đầu (sẽ phá vỡ 271+59+22+13 test đã PASS và tạo xung đột dữ liệu), báo cáo này **đối chiếu từng mục P0 với code thật**, xác nhận cái gì đã đúng, và chỉ sửa đúng phần còn thiếu — đúng tinh thần "không refactor module không liên quan" của yêu cầu.

| P0 | Mô tả | Hiện trạng trước phiên này | Đánh giá |
|---|---|---|---|
| P0.1 | Tách Invoice ↔ Delivery Note | `procurement_documents` (+ `_lines`, `_files`) = hóa đơn GTGT/bán hàng/chiếu lệ do **chỉ NCC** phát hành, có loại chứng từ, MST, thuế, file, state machine riêng. `supplier_delivery_invoices` (tên bảng cũ, giữ nguyên để không đổi API) = **phiếu giao hàng theo đợt**, không phải hóa đơn — tự đăng ký vào `procurement_documents` loại `DELIVERY_NOTE`. Hai thực thể, hai bảng, hai vòng đời. | **Đã đạt**, xác nhận lại bằng code + E2E (mục 5) |
| P0.2 | GRN không bắt buộc Invoice | `grep procurement_document\|VAT_INVOICE\|invoice.*required` trên `supplier-delivery.controller.js` (nơi tạo GRN từ phiếu giao) → **0 kết quả**. GRN chỉ cần `supplier_delivery_invoices` (phiếu giao), không bao giờ kiểm tra `procurement_documents`. | **Đã đạt**, xác nhận lại bằng E2E thực tế chưa từng tạo hóa đơn GTGT (mục 5) |
| P0.3 | 1 PO nhiều Delivery + nhiều GRN | Không có ràng buộc 1 PO = 1 phiếu giao; mỗi phiếu giao chỉ bị giới hạn 1 GRN còn hiệu lực (chống trùng), không giới hạn số phiếu giao/PO. | **Đã đạt**, xác nhận bằng E2E (PO 100+8, 3 đợt giao, 2 GRN, mục 5) |
| P0.4 | State machine riêng Invoice/Delivery/GRN | `procurement_documents.status`: DRAFT→ISSUED→(SENT/DELIVERED/ACKNOWLEDGED qua bảng share riêng)→CANCELLED/SUPERSEDED. `supplier_delivery_invoices.status` riêng (SUBMITTED→RECEIVED/PARTIALLY_RECEIVED). `goods_receipts.status`: DRAFT→POSTED→CANCELLED. Ba cột trạng thái trên ba bảng khác nhau — không dùng chung field. | **Đã đạt** |
| P0.5 | POST GRN an toàn: transaction, idempotency, concurrency | Idempotency (trùng request/double-click) **đã có**: `claimDraftReceiptForPosting()` — UPDATE có điều kiện `WHERE status='DRAFT'`, bảo vệ đúng Tình huống A/D. **Nhưng**: `applyPurchaseOrderReceipt()` đọc `purchase_order_items.received_qty` bằng `findMany` thường (không khóa), rồi mới kiểm tra "vượt số lượng" và tăng — đây là lỗ hổng TOCTOU cho **Tình huống B** (hai GRN khác nhau, cùng PO, POST đồng thời). | **Có lỗ hổng thật — đã sửa, xem mục 3–4** |

## 3. Vấn đề P0.5 tìm thấy và cách sửa

### 3.1. Lỗ hổng

`applyPurchaseOrderReceipt()` trong `goods-receipt.controller.js`:

```js
const poItems = await tx.purchase_order_items.findMany({ ... });   // đọc, KHÔNG khóa
for (const poItem of poItems) {
  const nextReceived = poItem.received_qty + receiptQty;
  if (nextReceived > poItem.ordered_qty) throw new Error("PO_RECEIPT_OVER_RECEIVED");
  await tx.purchase_order_items.update({ data: { received_qty: { increment: receiptQty } } });
}
```

`prisma.$transaction(...)` ở `updateGoodsReceipt()` không đặt `isolationLevel` (mặc định READ COMMITTED của Postgres) và không khóa dòng. Hai GRN khác nhau cùng PO, cùng sách, POST đồng thời: cả hai đọc `received_qty` **trước khi** bên kia commit → cả hai đều qua được kiểm tra "vượt số lượng" bằng dữ liệu cũ → cả hai `increment` đều thành công (phép cộng tại DB luôn đúng cộng dồn) → **PO nhận vượt số lượng đã duyệt**. Đây đúng là "Tình huống B" trong yêu cầu.

Đối chiếu: các luồng tồn kho khác trong **cùng repository** (`outbound.controller.js`, `picking.controller.js`, `transfer-receiving.controller.js`, `receiving-putaway.controller.js`) đã có sẵn khuôn mẫu chống đúng lớp lỗi này: `SELECT ... FOR UPDATE` (qua `tx.$queryRawUnsafe`) khóa dòng trước khi đọc, một số còn kèm `{ isolationLevel: "Serializable" }` + bắt lỗi `40001`/`P2034` trả 409. `goods-receipt.controller.js` là nơi **duy nhất** xử lý nhập kho từ PO lại thiếu khuôn mẫu này.

### 3.2. Cách sửa (surgical, đúng khuôn mẫu sẵn có của repo)

Thêm một câu lệnh khóa dòng ngay trước khi đọc `received_qty`, trong cả hai hàm có cùng mẫu đọc-rồi-ghi (`applyPurchaseOrderReceipt` — POST, và `reversePurchaseOrderReceipt` — hủy):

```js
if (variantIds.length > 0) {
  await tx.$queryRawUnsafe(
    "SELECT id FROM purchase_order_items WHERE purchase_order_id = $1::uuid AND variant_id = ANY($2::uuid[]) FOR UPDATE",
    goodsReceipt.purchase_order_id,
    variantIds,
  );
}
```

Vì sao đủ (không cần đổi `isolationLevel` của cả transaction `updateGoodsReceipt`, vốn còn xử lý cả nhánh sửa DRAFT/hủy — tránh đổi hành vi những nhánh không liên quan): `FOR UPDATE` khóa đúng các dòng `purchase_order_items` mà GRN này sẽ cộng vào. Giao dịch thứ hai cố khóa CÙNG dòng sẽ bị chặn (block) cho tới khi giao dịch thứ nhất commit; khi được giải phóng, nó đọc lại giá trị `received_qty` **đã cập nhật**, nên kiểm tra "vượt số lượng" dùng đúng dữ liệu mới nhất — đóng hoàn toàn lỗ hổng TOCTOU mà không cần nâng mức cô lập giao dịch.

File thay đổi: **chỉ** `services/inventory-service/src/controllers/goods-receipt.controller.js` (2 đoạn, ~20 dòng thêm, không xóa/đổi logic nào khác).

## 4. Kiểm thử — đúng kịch bản "hai nhân viên POST hai GRN đồng thời trên cùng một PO"

Không tin vào test tuần tự (test cũ gọi POST GRN-1 rồi mới POST GRN-2 — không bao giờ tạo ra tranh chấp thật). Đã viết **`scripts/concurrent-goods-receipt-posting-integration.mjs`** — script E2E chạy qua Gateway thật với tài khoản thật, không mock:

1. Tạo PO 100 cuốn 1 đầu sách, duyệt, gửi NCC, NCC xác nhận.
2. NCC tạo **2 phiếu giao** riêng biệt, mỗi phiếu 60 cuốn (tổng 120 > 100 đã duyệt) — **không tạo hóa đơn GTGT nào** (chứng minh luôn P0.2).
3. Kho tạo 2 GRN DRAFT (60 mỗi phiếu) từ 2 phiếu giao đó.
4. Bắn `Promise.all` **hai request PATCH POST cùng lúc** cho 2 GRN khác nhau.
5. Kiểm tra: không được cả hai cùng POST thành công trọn vẹn; `received_qty` cuối cùng của PO **không được vượt** `ordered_qty`.

**Kiểm chứng theo đúng quy trình "viết test tái hiện lỗi → sửa → test phải qua" của Mục 4 CLAUDE.md** — không chỉ chạy một lần với code đã sửa:

| Lần chạy | Trạng thái code | Kết quả |
|---|---|---|
| 1 (trước sửa — tạm bỏ 2 đoạn khóa, rebuild `inventory-service`, chạy thật) | Chưa có `FOR UPDATE` | **Lỗi tái hiện thật**: cả 2 POST trả `200`, `received_qty` cuối = **120** trên PO chỉ duyệt 100 — đúng kịch bản corrupt dữ liệu tồn kho mà yêu cầu cảnh báo |
| 2 (sau khi khôi phục bản vá, rebuild lại, chạy thật) | Có `FOR UPDATE` | **10/10 PASS**: một POST trả `200` (nhận đủ 60), POST còn lại trả `400 PO_RECEIPT_OVER_RECEIVED` (không phải lỗi 500 chung chung); `received_qty` cuối = **60**, không vượt, không mất mát, không đếm trùng |

Log đầy đủ của 2 lần chạy nằm trong phiên làm việc (không chép lại ở đây để báo cáo gọn); có thể tái chạy bất kỳ lúc nào bằng:

```bash
node scripts/concurrent-goods-receipt-posting-integration.mjs
```

### 4.1. Các bộ test khác đã chạy lại (không tin báo cáo cũ, chạy thật lại với code đã sửa)

| Bộ test | Lệnh | Kết quả |
|---|---|---|
| Unit inventory-service (271 test, gồm cả goods-receipt-posting, procurement-*, supplier-delivery-receipt) | `pnpm --filter inventory-service test` | **271/271 PASS** |
| Regression mua hàng → nhận hàng (có test "over receive blocked" tuần tự) | `node scripts/purchase-supplier-receiving-integration.mjs` | **13/13 PASS** |
| Regression cổng NCC | `node scripts/supplier-portal-integration.mjs` | **22/22 PASS** |
| E2E toàn luồng P0.1/P0.3/P0.4 (hóa đơn, phiếu giao nhiều đợt, đối soát, chia sẻ chứng từ…) | `node scripts/procurement-document-workflow-integration.mjs` | **59/59 PASS** |
| **Concurrency P0.5 (mới)** | `node scripts/concurrent-goods-receipt-posting-integration.mjs` | **10/10 PASS** |
| Web typecheck (không đổi frontend, kiểm tra không có drift) | `pnpm --filter web exec tsc --noEmit` | PASS, không lỗi |

Không chạy lại toàn bộ build Docker `smartbook-ui` vì **không có thay đổi frontend nào trong phiên này**; phiên trước đã xác nhận PASS trên đúng trạng thái frontend hiện tại.

## 5. Vì sao chọn test E2E thật thay vì unit test giả lập cho P0.5

`applyPurchaseOrderReceipt()` không được export riêng, và việc kiểm chứng một **race condition thật** (hai transaction tranh chấp khóa dòng ở Postgres) về bản chất **không thể** chứng minh bằng một `tx` giả lập trong bộ test Node đơn luồng hiện có của repo (các test unit ở đây dùng fake-db đơn luồng, không có khái niệm transaction/lock thật). Một unit test "giả lập" ở đây chỉ chứng minh được hàm *gọi đúng câu lệnh khóa*, không chứng minh được khóa đó *thực sự ngăn được race* — dễ tạo cảm giác an toàn giả. Script E2E thật (mục 4) là bằng chứng duy nhất đáng tin, nên được giữ lại trong repo như một regression test thường trực (giống các script `*-integration.mjs` khác của dự án).

## 6. Giới hạn còn tồn tại (không tự ý mở rộng để giải quyết)

- `updatePurchaseOrderStatusFromTotals()` tính tổng và set `purchase_orders.status` bằng cách đọc lại **toàn bộ** `purchase_order_items` của PO (không chỉ các dòng vừa khóa). Nếu PO có nhiều đầu sách và hai GRN *khác* đầu sách được POST đúng cùng một khoảnh khắc, trường `status` (RECEIVED/PARTIALLY_RECEIVED…) có thể tạm thời phản ánh một ảnh chụp hơi cũ ở lần ghi cuối cùng — đây **không phải** lỗi đếm sai số lượng (received_qty từng dòng luôn đúng, nhờ khóa theo đúng dòng), chỉ là nhãn trạng thái tổng hợp có thể cần một lần ghi sổ nữa mới "bắt kịp". Không mở rộng khóa ra toàn bộ `purchase_order_items` của PO (sẽ làm giảm throughput không cần thiết cho trường hợp phổ biến — hai GRN khác đầu sách, không có tranh chấp) vì nằm ngoài phạm vi "ngăn vượt số lượng" mà P0.5 yêu cầu.
- Các giới hạn khác (nhập vượt cần duyệt ngoại lệ, phiếu trả hàng, DELIVERED qua email không có DSN, không quét virus file, không đối chiếu cơ quan thuế…) đã được ghi nhận đầy đủ ở mục 14 của `PROCUREMENT_DOCUMENT_WORKFLOW_IMPLEMENTATION_REPORT.md` từ phiên trước — không lặp lại, không có thay đổi.

## 7. File đã thay đổi trong phiên này và lý do

| File | Thay đổi | Lý do |
|---|---|---|
| `services/inventory-service/src/controllers/goods-receipt.controller.js` | +2 đoạn `SELECT ... FOR UPDATE` trong `applyPurchaseOrderReceipt()` và `reversePurchaseOrderReceipt()` | Đóng race condition P0.5 (mục 3) |
| `scripts/concurrent-goods-receipt-posting-integration.mjs` (mới) | Script E2E tái hiện + kiểm chứng kịch bản hai GRN POST đồng thời | Bằng chứng thật cho P0.5, giữ làm regression test |
| `PROCUREMENT_P0_WORKFLOW_CORRECTION_REPORT.md` (mới, file này) | Báo cáo | Theo yêu cầu |

## 8. Xác nhận các module không liên quan được bảo toàn

- Không sửa bất kỳ file nào khác ngoài 1 file controller nêu trên. Toàn bộ 19 file đã sửa/22 file mới còn lại trong working tree là di sản **chưa commit từ phiên trước** (tính năng Procurement Document Workflow) — không bị đụng tới, không bị refactor.
- Không đổi schema Prisma, không có migration mới.
- Không đổi API contract nào (không thêm/xóa endpoint, không đổi field request/response).
- Không đổi RBAC, không đổi borrow-service/auth-service/analytics-service/ai-service/api-gateway/mobile.
- Không đổi logic tồn kho ngoài đúng 2 đoạn khóa dòng nêu trên.

## 9. Kết luận theo checklist yêu cầu

| Hạng mục | Trạng thái |
|---|---|
| Invoice và Delivery Note là hai thực thể độc lập | ✔ (đã có từ trước, xác nhận lại) |
| NCC tạo Delivery mà chưa cần Invoice | ✔ (đã có, xác nhận lại bằng E2E mới — mục 4) |
| NCC phát hành Invoice sau đó | ✔ (đã có — phiên trước) |
| 1 PO nhiều Invoice / nhiều Delivery / nhiều GRN | ✔ (đã có, xác nhận lại bằng E2E 59/59) |
| GRN không bắt buộc Invoice | ✔ (đã có; E2E mới chứng minh — PO trong test chưa từng có hóa đơn GTGT) |
| Invoice / Delivery / GRN có state machine riêng | ✔ (đã có — 3 cột trạng thái, 3 bảng) |
| Tổng số lượng giao/nhận/đạt không đếm trùng | ✔ (đã có — test "98 nhận, 3 hỏng" vẫn PASS) |
| GRN DRAFT không tính vào tồn kho | ✔ (đã có, xác nhận) |
| GRN POSTED không nhập kho hai lần (idempotency) | ✔ (đã có — `claimDraftReceiptForPosting`) |
| Retry sau timeout không tạo duplicate | ✔ (đã có — Idempotency-Key trên tạo GRN + claim có điều kiện trên POST) |
| **Hai request đồng thời không vượt giới hạn PO do race condition** | **✔ — lỗ hổng thật tìm thấy và đã sửa trong phiên này (mục 3–4)** |
| Transaction rollback đúng khi lỗi | ✔ (lỗi `PO_RECEIPT_OVER_RECEIVED` rollback toàn bộ transaction, GRN giữ nguyên DRAFT) |
| Dữ liệu cũ được bảo toàn | ✔ (không có migration mới, không sửa dữ liệu) |
| Regression đầy đủ | ✔ — xem mục 4.1 |
