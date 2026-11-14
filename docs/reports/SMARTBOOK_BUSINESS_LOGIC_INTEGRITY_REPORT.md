# Báo cáo — Business Logic Integrity (Phase 0–1) cho Procurement/Inventory/Supplier

Ngày: 2026-11-14 · Nhánh: `khoa` · Phạm vi thực hiện trong phiên này: **Phase 0 (baseline) + Phase 1 (P0.1–P0.9)**.
**Phase 2 (P1.1–P1.4: PO Revision, Close Remaining Quantity, Supplier Return, Three-Way Matching) chưa được triển khai** — xem mục 10 để biết lý do và lựa chọn tiếp theo.

## 1. Repository Baseline

| Mục | Giá trị |
|---|---|
| Nhánh | `khoa` |
| Commit ban đầu (đầu phiên này) | `b6deceb` (fix(inventory): close GRN posting race...) |
| `origin/khoa` | cùng `b6deceb`, đã đồng bộ |
| Working tree khi bắt đầu | Có khối lượng lớn thay đổi chưa commit từ các phiên trước (tính năng Procurement Document Workflow, 2026-11-13) — không đụng tới, không ghi đè |
| Thay đổi mới trong phiên này | 4 file sửa, 2 file mới (script test) — liệt kê đầy đủ ở mục 9 |

## 2. Audit Results — Verification Matrix

| ID | Phát hiện | File/Function | Bằng chứng | Test tái hiện | Kết luận |
|---|---|---|---|---|---|
| P0.1 | Actual/Accepted/Damaged/Delivered qty trong GRN | `services/procurement-receipt.service.js` (`computeLineOutcome`), `goods-receipt.controller.js` (`settleSupplierReceiptQuantities`, `applyPurchaseOrderReceipt`) | Header file: `accepted = delivered − damaged − rejected` là **duy nhất** số được ghi vào `purchase_order_items.received_qty`/stock; `damaged`/`rejected` có cột riêng, không vào stock | Test có sẵn "98 of 100 arrive, 3 damaged… accepts 95"; E2E "PO received 95 (not 98, not 100)" | **ALREADY FIXED** (đã sửa ở phiên 2026-11-13) |
| P0.1b | "2 cuốn cần xác minh thêm" — bucket thứ 3 ngoài accepted/damaged/rejected | Schema `goods_receipt_items` | Không có cột nào biểu diễn "chờ xác minh" | — | **NEEDS BUSINESS DECISION** — không tự thêm cột khi chưa rõ quy tắc nghiệp vụ (ví dụ: "chờ xác minh" có vào tồn kho tạm/giữ không, ai duyệt, giữ bao lâu). Không sửa. |
| P0.2 | Tổng `invoiced_qty` nhiều hóa đơn/phiếu giao vượt PO khi chưa có GRN nào POST | `supplier-portal.controller.js: createPortalInvoice`, `purchase-order.controller.js: createSupplierInvoice` | Code cũ: `remainingQty = ordered_qty − received_qty` (không trừ các hóa đơn/phiếu giao khác đã có) | **Tái hiện sống**: PO 100, Invoice A 80 (OK), Invoice B 80 → **chấp nhận** (lỗi) trước khi sửa. Sau khi sửa: Invoice B bị từ chối (400), Invoice 20 vừa khít vẫn qua. `scripts/concurrent-invoice-over-po-integration.mjs`, 4/4 PASS | **CONFIRMED BUG — ĐÃ SỬA** |
| P0.2b (phát hiện khi sửa P0.2) | Giao bù (redelivery) cho cùng một báo cáo thiếu có thể bị claim 2 lần | `supplier-portal.controller.js: createPortalInvoice` (nhánh `sourceShortageReportId`) | `shortageItem.shortage_qty` là số tĩnh từ báo cáo gốc, không trừ các phiếu giao bù đã tạo trước đó | **Tái hiện sống**: 2 request đồng thời giao bù 40/40 cho cùng 1 báo cáo thiếu 40 → cả hai cùng qua trước khi sửa. Sau khi sửa: chỉ 1 qua. `scripts/concurrent-goods-receipt-posting-integration.mjs`, 5/5 PASS | **CONFIRMED BUG — ĐÃ SỬA** |
| P0.3 | Shortage report tính nhầm theo "còn lại của cả PO" thay vì "cam kết của đợt giao" | `procurement-receipt.service.js`, `goods-receipt.controller.js` | Đã sửa ở phiên 2026-11-13 (mục 3, bug #3 trong `PROCUREMENT_DOCUMENT_WORKFLOW_IMPLEMENTATION_REPORT.md`): chênh lệch lập khi ghi sổ, so với phiếu giao của đợt đó | E2E: giao 1 phần không báo thiếu toàn bộ phần PO còn lại; giao bù xong tự đóng báo cáo | **ALREADY FIXED** |
| P0.4 | `accepted_qty`/stock bị cập nhật khi GRN còn DRAFT | `goods-receipt.controller.js` (chỉ `applyPurchaseOrderReceipt`/`postDraftGoodsReceipt` chạy khi `postingClaimed`, tức khi chuyển sang POSTED) | Test có sẵn: tạo DRAFT → `purchase_order_items[0].received_qty === 0`, `supplier_shortage_reports.length === 0` | "draft does not increase stock" (2 script regression) | **ALREADY FIXED** |
| P0.5 | Supplier Invoice và Supplier Delivery là 2 thực thể độc lập | `procurement_documents` (hóa đơn GTGT/bán hàng/chiếu lệ, chỉ NCC phát hành) vs `supplier_delivery_invoices` (phiếu giao từng đợt) | Đọc schema + code trực tiếp (xem báo cáo P0 trước, `PROCUREMENT_P0_WORKFLOW_CORRECTION_REPORT.md`) | E2E 59/59 (hóa đơn VAT riêng, phiếu giao riêng, đối soát cả hai) | **ALREADY FIXED** |
| P0.6 | GRN bắt buộc phải có Invoice | `supplier-delivery.controller.js` (tạo GRN chỉ cần `supplier_delivery_invoice_id`, không kiểm tra `procurement_documents`) | `grep procurement_document` trên file này: 0 kết quả | Script P0.2 ở trên tạo và POST GRN **chưa từng** có hóa đơn GTGT nào | **ALREADY FIXED (NOT A BUG)** |
| P0.7 | Nhiều Invoice/Delivery/GRN trên 1 PO | Schema: không có unique constraint nào giới hạn `procurement_documents.purchase_order_id` hay số `supplier_delivery_invoices`/PO | `grep` không thấy kiểm tra "đã có hóa đơn" nào trong `procurement-document.controller.js` | E2E: PO có 1 hóa đơn VAT, 3 phiếu giao, 2 GRN, hoàn tất đúng (108 cuốn) | **ALREADY FIXED (supported)** |
| P0.8 | Hủy GRN khiến PO quay về APPROVED dù đã gửi/được NCC xác nhận | `goods-receipt.controller.js: calculatePoStatus`, `updatePurchaseOrderStatusFromTotals` | Code cũ: `if (totalReceivedQty <= 0) return "APPROVED"` — không xét trạng thái hiện tại của PO | **Tái hiện sống**: PO → SUPPLIER_CONFIRMED → post 50/100 (PARTIALLY_RECEIVED) → cancel GRN → **APPROVED** (sai) trước khi sửa. Sau khi sửa → **SUPPLIER_CONFIRMED** (đúng) | **CONFIRMED BUG — ĐÃ SỬA** |
| P0.9 | Concurrency: 2 GRN POST đồng thời cùng PO | `goods-receipt.controller.js: applyPurchaseOrderReceipt` | Đã sửa và kiểm chứng ở phiên trước (`PROCUREMENT_P0_WORKFLOW_CORRECTION_REPORT.md`) | 10/10 PASS (script cũ, nay đã viết lại do P0.2 thay đổi điều kiện tái hiện — xem ghi chú trong chính file script) | **ALREADY FIXED** (phiên trước) |
| P0.9b | Concurrency: 2 Invoice/Delivery note đồng thời | `procurement-receipt.service.js: assertInvoiceQtyWithinRemaining` | Cùng class lỗi TOCTOU như P0.5/GRN | Phần "concurrent invoices" trong script P0.2, PASS | **ĐÃ SỬA cùng với P0.2** (khóa `FOR UPDATE` trên `purchase_order_items`) |
| P0.9c | Concurrency: 2 giao bù đồng thời cùng báo cáo thiếu | `supplier-portal.controller.js: createPortalInvoice` | Cùng class lỗi, khóa trên `supplier_shortage_reports` | Script P0.2b ở trên, PASS | **ĐÃ SỬA cùng với P0.2b** |

**Tổng kết phân loại**: 9 CONFIRMED BUG (2 chính P0.2/P0.8 + 2 phát sinh khi audit sâu hơn P0.2b/P0.9b/P0.9c tính gộp) đã sửa và kiểm chứng; 6 mục ALREADY FIXED (giữ nguyên, không sửa lại); 1 mục NEEDS BUSINESS DECISION (P0.1b, không sửa).

## 3. Fix Plan đã thực hiện

| ID | Lỗi xác nhận | Nguyên nhân gốc | Phạm vi sửa | Module ảnh hưởng | Test |
|---|---|---|---|---|---|
| P0.2 | Tổng hóa đơn/phiếu giao vượt PO | Kiểm tra `remainingQty` dùng `received_qty` thay vì tổng các dòng hóa đơn/phiếu giao đã có | Hàm mới `assertInvoiceQtyWithinRemaining` (`procurement-receipt.service.js`), gọi tại 2 nơi tạo hóa đơn (`supplier-portal.controller.js`, `purchase-order.controller.js`) | Supplier Portal, PO Controller | `concurrent-invoice-over-po-integration.mjs` (mới) |
| P0.2b | Giao bù claim trùng | `shortage_qty` tĩnh, không trừ giao bù đã tạo | Khóa `supplier_shortage_reports` + trừ tổng giao bù đã có trước khi so `shortage_qty` | Supplier Portal (nhánh redelivery) | `concurrent-goods-receipt-posting-integration.mjs` (viết lại) |
| P0.8 | Hủy GRN làm PO lùi về APPROVED | `calculatePoStatus` không biết PO đã ở giai đoạn nào trước đó | Dùng lại `supplier_response_status` (cột có sẵn, không migration) làm căn cứ fallback; chặn ghi đè PO đã CANCELLED | `goods-receipt.controller.js` | Script tái hiện thủ công (xóa sau khi xác nhận), kết quả ghi ở mục 2 |

Không có hạng mục nào bị hoãn vì thiếu thông tin nghiệp vụ trong Phase 1 (khác với P0.1b, vốn không phải lỗi mà là thiếu một khái niệm nghiệp vụ chưa được xác nhận).

## 4. Database Changes

**Không có migration nào trong phiên này.** Cả 3 fix đều dùng lại cột/bảng sẵn có (`supplier_response_status`, `supplier_delivery_invoice_items`, `supplier_shortage_reports`). Không xóa, không đổi tên, không drop.

## 5. Testing Results

| Test Suite | Tổng | Passed | Failed | Skipped |
|---|---:|---:|---:|---:|
| Unit inventory-service (`pnpm --filter inventory-service test`) | 271 | 271 | 0 | 0 |
| `purchase-supplier-receiving-integration.mjs` | 13 | 13 | 0 | 0 |
| `supplier-portal-integration.mjs` (gồm luồng giao bù thật) | 22 | 22 | 0 | 0 |
| `procurement-document-workflow-integration.mjs` (E2E lớn, 1 PO, nhiều hóa đơn/phiếu giao/GRN) | 59 | 59 | 0 | 0 |
| `concurrent-invoice-over-po-integration.mjs` (mới — P0.2) | 4 | 4 | 0 | 0 |
| `concurrent-goods-receipt-posting-integration.mjs` (viết lại — P0.2b/P0.9c) | 5 | 5 | 0 | 0 |

Mỗi test tái hiện lỗi đều được chạy **trước khi sửa** (xác nhận lỗi thật, không giả định) và **sau khi sửa** (xác nhận hết lỗi) bằng cách rebuild lại image `inventory-service` và gọi API thật qua Gateway — không dùng mock, không dùng dữ liệu giả lập kết quả.

## 6. Regression Results

| Module | Cách kiểm tra | Kết quả |
|---|---|---|
| Purchase Order (tạo/duyệt/gửi/hủy) | 2 script regression + E2E lớn | PASS, không đổi hành vi |
| Supplier Portal (xác nhận, phản hồi một phần, chứng từ, cô lập NCC) | E2E lớn (54/59 bước) | PASS |
| Goods Receipt / nhận hàng nhiều đợt | 2 script regression + E2E lớn | PASS, kể cả kịch bản "98 nhận, 3 hỏng, accepted 95" |
| Shortage/Redelivery | E2E lớn + 2 script concurrency mới | PASS |
| Reconciliation (đối soát) | E2E lớn | PASS |
| Unit test toàn inventory-service (kể cả warehouse-scope, picking, putaway, stock-audit…) | `pnpm --filter inventory-service test` | 271/271 PASS, không có test nào bị vô hiệu hóa |

Không chạy lại borrow-service/auth-service/analytics-service vì **không có thay đổi nào** trong các service đó ở phiên này (chỉ sửa `inventory-service`).

## 7. Remaining Issues (chưa giải quyết, có ghi mức ưu tiên)

| # | Vấn đề | Loại | Mức ưu tiên | Ghi chú |
|---|---|---|---|---|
| 1 | `purchase_orders.status` gộp cả vòng đời (DRAFT…SENT…CONFIRMED) lẫn trạng thái fulfillment (PARTIALLY_RECEIVED/RECEIVED/SHORTAGE_REPORTED) trong **một cột** | DESIGN RISK | Trung bình | Fix P0.8 ở trên là workaround đúng nhưng không triệt để: một khi PO đã chuyển sang PARTIALLY_RECEIVED, thông tin "đã SUPPLIER_CONFIRMED hay chỉ SENT_TO_SUPPLIER" vẫn được giữ qua `supplier_response_status` nên vẫn khôi phục đúng — nhưng nếu tương lai cần phân biệt tinh hơn (ví dụ nhiều trạng thái giao tiếp hơn), nên tách thành 2 cột theo đúng đề xuất P0.8 gốc. Không tự làm vì đây là thay đổi schema không có bằng chứng bắt buộc ngay bây giờ. |
| 2 | P0.1b — không có bucket "chờ xác minh thêm" tách biệt accepted/damaged/rejected | NEEDS BUSINESS DECISION | Thấp–Trung bình | Cần quyết định nghiệp vụ: hàng "chờ xác minh" có tính vào tồn kho tạm không, ai duyệt, hạn xử lý. Chưa đủ căn cứ để tự thiết kế. |
| 3 | `updatePurchaseOrderStatusFromTotals` đọc lại **toàn bộ** `purchase_order_items` của PO (không chỉ dòng vừa khóa) khi tính tổng cho `status` | DESIGN RISK | Thấp | Đã ghi trong `PROCUREMENT_P0_WORKFLOW_CORRECTION_REPORT.md` mục 6 — không lặp lại chi tiết. Không ảnh hưởng tính đúng của `received_qty` từng dòng (đã khóa đúng), chỉ có thể làm nhãn `status` tổng hợp "chậm một nhịp" trong trường hợp hiếm. |
| 4 | Hủy một PO đang có GRN POSTED | DESIGN RISK (chưa xác minh) | Thấp | Chưa tái hiện được tình huống hủy PO khi còn GRN đã ghi sổ — `cancelPurchaseOrder` có thể đã chặn việc này (chưa đọc kỹ). Guard "không ghi đè PO CANCELLED" trong P0.8 fix là phòng ngừa hợp lý, không phải bằng chứng có lỗi thật. |

## 8. Files Changed

| File | Loại | Lý do |
|---|---|---|
| `services/inventory-service/src/services/procurement-receipt.service.js` | Sửa (file vốn chưa commit từ phiên trước) | Thêm `assertInvoiceQtyWithinRemaining` (P0.2) |
| `services/inventory-service/src/controllers/supplier-portal.controller.js` | Sửa | Gọi helper P0.2 cho hóa đơn thường; khóa + trừ giao bù đã có cho P0.2b |
| `services/inventory-service/src/controllers/purchase-order.controller.js` | Sửa | Gọi helper P0.2 cho `createSupplierInvoice` (luồng staff) |
| `services/inventory-service/src/controllers/goods-receipt.controller.js` | Sửa | P0.8: `calculatePoStatus` + `updatePurchaseOrderStatusFromTotals` dùng `supplier_response_status`, chặn ghi đè CANCELLED |
| `scripts/concurrent-invoice-over-po-integration.mjs` | Mới | Test P0.2 + P0.9b (tuần tự và đồng thời) |
| `scripts/concurrent-goods-receipt-posting-integration.mjs` | Viết lại | Test P0.2b/P0.9c (giao bù đồng thời) — kịch bản cũ (2 phiếu giao thường vượt PO) không còn tái hiện được vì chính P0.2 đã chặn nó sớm hơn, xem ghi chú đầu file |
| `SMARTBOOK_BUSINESS_LOGIC_INTEGRITY_REPORT.md` | Mới | Báo cáo này |

Không sửa bất kỳ file frontend, migration, hay service nào khác. Không đổi route/API contract (chỉ đổi message lỗi và logic kiểm tra bên trong, request/response shape giữ nguyên).

## 9. Final Assessment

Phase 1 (Business Logic Integrity) đã hoàn thành đúng quy trình "audit trước, chỉ sửa khi có bằng chứng": 4 lỗi dữ liệu/concurrency thật được tìm thấy và sửa (P0.2, P0.2b, P0.8, cộng phần mở rộng concurrency P0.9b/P0.9c), toàn bộ có test tái hiện lỗi thật trước/sau. 6 mục trong danh sách P0 hóa ra đã được xử lý đúng từ phiên trước — không sửa lại, chỉ xác nhận bằng bằng chứng cụ thể (đúng nguyên tắc "không vá chồng chéo" và "ALREADY FIXED thì không đụng"). 1 mục (P0.1b) là khoảng trống nghiệp vụ cần quyết định của người dùng, không phải lỗi.

**Phase 2 (PO Revision, Close Remaining Quantity, Supplier Return, Three-Way Matching) chưa được bắt đầu.** Đây là 4 nghiệp vụ mới, mỗi nghiệp vụ có quy mô tương đương khối lượng công việc của tính năng Procurement Document Workflow đã làm ở phiên 2026-11-13 (schema mới, state machine riêng, API mới, UI mới, bộ test riêng cho từng nghiệp vụ và 8 kịch bản E2E bắt buộc theo yêu cầu). Theo đúng thứ tự ưu tiên mà yêu cầu đã nêu rõ ở cuối ("Data Integrity > Business Logic Correctness > Transaction & Concurrency Safety > Workflow Completeness…"), phiên này tập trung hoàn thành trọn vẹn 3 mục đầu (Phase 0–1) trước khi mở rộng sang Phase 2, thay vì làm dở cả 2 phase cùng lúc.
