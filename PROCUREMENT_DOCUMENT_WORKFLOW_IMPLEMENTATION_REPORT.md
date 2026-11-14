# Báo cáo triển khai — Quản lý chứng từ mua hàng & luồng NCC ↔ Kho

Ngày: 2026-11-13 · Người thực hiện: Claude Code (theo yêu cầu trên nhánh `khoa`)

## 1. Nhánh và commit

| Mục | Giá trị |
|---|---|
| Nhánh làm việc | `khoa` (không đổi nhánh) |
| Commit gốc | `1183670f62fd8abc1d37e25fc6d634106db8485f` — Merge pull request #100 |
| Trạng thái | **Chưa commit, chưa push** (theo yêu cầu). Toàn bộ thay đổi nằm trong working tree. |
| Thay đổi có sẵn của người dùng | `borrow-loan-detail.tsx`, `customer/loan-detail.tsx`, `print-utils.ts`, `styles/index.css`, `goods-receipt-format.ts`, `goods-receipt-print-sheet.tsx`, `loan-receipt-print-sheet.tsx` — **không đụng tới**. `order-detail.tsx` (đang có thay đổi dở của người dùng) chỉ được chèn thêm 2 dòng: 1 import và 1 dòng gắn `GoodsReceiptProcurementPanel`. |

## 2. Audit hiện trạng (trước khi sửa)

Luồng đã truy vết từ frontend → API Gateway (`/api/*` proxy thẳng sang inventory-service) → controller → Prisma → PostgreSQL.

| Hạng mục yêu cầu | Hiện trạng trước | Đánh giá |
|---|---|---|
| PO: tạo, gửi duyệt, duyệt, gửi NCC (`purchase-order.controller.js`) | DRAFT → PENDING_APPROVAL → APPROVED → SENT_TO_SUPPLIER, có audit, claim nguyên tử chống gửi trùng | Đã đúng — **tái sử dụng**, không đổi tên trạng thái |
| NCC phản hồi PO | Chỉ có "xác nhận toàn bộ" (`/confirm`) | Thiếu chấp nhận một phần / từ chối / đề xuất giá, ngày giao, lịch sử |
| Hóa đơn NCC | `supplier_delivery_invoices` gộp **hóa đơn + phiếu giao** (1 số hóa đơn, 1 lần giao) | Không tách được hóa đơn và phiếu giao, không có file, không có metadata thuế, không phân loại VAT/bán hàng/chiếu lệ |
| Phiếu giao hàng nhiều đợt | Nhiều `supplier_delivery_invoices`/PO được | Đúng một phần, thiếu đơn vị vận chuyển, người giao |
| Chứng từ dùng chung | `GET /purchase-orders/:id/supplier-documents` chỉ đọc; không lưu file | Thiếu registry, file, phiên bản, chia sẻ, xác nhận |
| GRN từ phiếu giao | `create-goods-receipt` tạo DRAFT; ghi sổ dùng flow có sẵn (claim DRAFT→POSTED, idempotent khi ghi sổ) | Flow tồn kho tốt — **tái sử dụng** |
| Thiếu / hỏng | Chỉ có thiếu (`supplier_shortage_reports`), không có hỏng/từ chối/thừa | Thiếu |
| Biên bản giao nhận ký ngoài hệ thống | Không có | Thiếu |
| Đối soát | `GET /:id/reconciliation` chỉ so PO ↔ đã nhận | Thiếu hóa đơn, phiếu giao, giá, lịch sử |
| Lưu file | Có mẫu multer → đĩa + volume Docker (`packing-video-storage.service.js`) | **Tái sử dụng cách lưu** cho chứng từ |
| Email | Inventory-service không gửi email; auth/borrow dùng nodemailer + mailpit | Tái sử dụng cùng thư viện, cùng biến `SMTP_*` |

## 3. Lỗi nghiệp vụ phát hiện (và đã sửa)

1. **Nhập kho sai số lượng thực tế**: nhân viên đếm `actual_quantity` nhưng khi quản lý ghi sổ, hệ thống vẫn cộng `quantity` (số kế hoạch). Ví dụ phiếu 100, đếm 98 → vẫn cộng 100. *Đã sửa*: với phiếu nhập từ phiếu giao NCC, ghi sổ dùng `chấp nhận = thực nhận − hỏng − từ chối`.
2. **Tạo trùng phiếu nhập cho cùng một phiếu giao**: có thể tạo nhiều GRN nháp từ một phiếu giao (mỗi lần gọi đều qua được kiểm tra "còn lại" vì `received_qty` chỉ tăng khi ghi sổ), và `accepted_qty` của phiếu giao bị **cộng dồn ngay lúc tạo nháp**. *Đã sửa*: một phiếu giao chỉ có một GRN còn hiệu lực (409), hỗ trợ `Idempotency-Key`, `accepted_qty` chỉ ghi khi đã ghi sổ.
3. **Báo thiếu sai thời điểm và sai căn cứ**: báo thiếu được tạo khi mới lập nháp (số đếm còn đổi) và so với "PO còn lại", nên **mọi đợt giao một phần bị coi là thiếu hàng**. *Đã sửa*: chênh lệch được lập khi ghi sổ, so với **phiếu giao của đợt đó**; phần PO chưa giao hiển thị là "còn phải giao", không phải chênh lệch.
4. **Giao bù bị chặn sai** (phát hiện qua E2E): một dòng PO có nhiều dòng chênh lệch (thiếu 2 + hỏng 3) nhưng giới hạn giao bù chỉ lấy dòng cuối (3) → không giao bù đủ 5 được. *Đã sửa*: cộng dồn theo dòng PO, loại dòng "giao thừa".
5. **Hủy GRN đã ghi sổ** không trả phiếu giao về trạng thái chưa nhận và không hủy biên bản chênh lệch do GRN đó tạo. *Đã sửa*.
6. Bug do test phát hiện trong code mới: `lines` dạng chuỗi JSON (multipart) ghi đè mảng đã parse khi tính tiền hóa đơn — đã sửa trước khi chạy E2E.

## 4. Kiến trúc trước và sau

Không thêm service mới, không đổi Gateway, không đổi công nghệ. Mọi thứ nằm trong `inventory-service` (nơi đã có PO/GRN).

```
Trước:  Web/Cổng NCC ──► Gateway /api ──► inventory-service ──► PostgreSQL (inventory_db)
Sau:    Web/Cổng NCC ──► Gateway /api ──► inventory-service ──► PostgreSQL (inventory_db)
                                               ├──► đĩa: evidence/procurement (volume procurement_document_data)
                                               └──► SMTP (mailpit khi chạy local) — chỉ cho thông báo chia sẻ chứng từ
```

Mô hình chứng từ:

| Chứng từ | Bên phát hành | Lưu ở |
|---|---|---|
| Purchase Order | SmartBook | `purchase_orders` (có sẵn) |
| Phản hồi PO của NCC | NCC | `purchase_order_supplier_responses` (mới, mỗi lần phản hồi 1 dòng) |
| Hóa đơn GTGT / bán hàng / chiếu lệ | **Chỉ NCC** | `procurement_documents` (+ `procurement_document_lines`, file) |
| Phiếu giao hàng | NCC | `supplier_delivery_invoices` (có sẵn = một đợt giao) **và** tự đăng ký vào `procurement_documents` loại `DELIVERY_NOTE` |
| Phiếu nhập kho (GRN) | Kho SmartBook | `goods_receipts` (có sẵn) — chứng từ nội bộ, không phải hóa đơn |
| Xác nhận kết quả nhận hàng | SmartBook | `procurement_documents` loại `GOODS_RECEIPT_CONFIRMATION` (dữ liệu, không phải hóa đơn) |
| Biên bản giao nhận (ký giấy) | SmartBook tải bản scan | `procurement_documents` loại `DELIVERY_ACCEPTANCE_MINUTES` |
| Biên bản chênh lệch | SmartBook | `supplier_shortage_reports` (có sẵn, mở rộng loại) + tùy chọn file scan `DISCREPANCY_REPORT` |
| Chứng từ thanh toán | SmartBook (tham chiếu) | `procurement_documents` loại `PAYMENT_EVIDENCE` — không mở rộng thành kế toán |

**Một bản ghi duy nhất cho cả hai bên**: NCC và kho đọc cùng `procurement_documents.id`, cùng file, cùng lịch sử; quyền chỉ khác ở lớp API.

## 5. Thay đổi database

Chỉ **thêm**, không xóa/đổi tên cột hay bảng, không sửa dữ liệu cũ.

Cột mới trên bảng có sẵn:

| Bảng | Cột | Ghi chú |
|---|---|---|
| `goods_receipt_items` | `delivered_qty INT NULL`, `damaged_qty INT DEFAULT 0`, `rejected_qty INT DEFAULT 0` | `quantity` = số chấp nhận được ghi sổ |
| `goods_receipts` | `idempotency_key VARCHAR(100) UNIQUE NULL` + index `(supplier_delivery_invoice_id, status)` | chống tạo trùng |
| `purchase_orders` | `supplier_response_status VARCHAR(30) NULL` | NULL cho đơn cũ |
| `supplier_delivery_invoices` | `carrier_name`, `deliverer_name` | |
| `supplier_shortage_reports` | `discrepancy_type` (mặc định `SHORTAGE`), `supplier_proposed_action`, `supplier_response_note`, `resolution_action`, `resolution_note` | dữ liệu cũ tự nhận `SHORTAGE` |
| `supplier_shortage_report_items` | `discrepancy_type` (mặc định `SHORTAGE`) | `shortage_qty` giữ tên, nghĩa là "số lượng chênh lệch" |

Bảng mới: `purchase_order_supplier_responses`, `procurement_documents`, `procurement_document_lines`, `procurement_document_files`, `procurement_document_shares`, `procurement_reconciliations`. Index duy nhất một phần `uq_procurement_documents_live_invoice_number` chống trùng số hóa đơn (cùng NCC + ký hiệu + số, trừ hóa đơn đã hủy).

## 6. Migration

- File: `services/inventory-service/prisma/migrations/20261113090000_add_procurement_document_workflow/migration.sql`.
- Đã áp dụng trên **DB local** (Docker, `prisma migrate deploy` khi container khởi động). **Không chạy trên production.**
- `prisma validate`: hợp lệ. Lưu ý: index một phần không biểu diễn được trong `schema.prisma`; nếu sau này dùng `prisma migrate dev` thì Prisma có thể báo drift cho index này — giữ nguyên nó (dự án dùng `migrate deploy`).

## 7. API mới và API điều chỉnh

**Mới — phía SmartBook** (`/api/procurement-documents`, quản lý: theo phạm vi kho; nhân viên kho: chỉ PO có GRN được giao cho mình):

| Method | Path | Ghi chú |
|---|---|---|
| GET | `/purchase-orders/:poId` | danh sách chứng từ của PO |
| POST | `/purchase-orders/:poId` | multipart: biên bản giao nhận, biên bản chênh lệch, chứng từ thanh toán, khác (không cho tạo hóa đơn/phiếu giao) |
| GET | `/purchase-orders/:poId/activity` | dòng thời gian audit của PO + chứng từ + GRN + chênh lệch |
| GET | `/goods-receipts/:grId` | chứng từ + kết quả kiểm nhận của một GRN (màn hình nhân viên kho) |
| POST | `/goods-receipts/:grId/confirmation` | phát hành Xác nhận kết quả nhận hàng (GRN phải POSTED, 1 lần/GRN) |
| GET | `/:docId`, `/:docId/files/:fileId/download` | xem (đánh dấu DELIVERED cho bên nhận) / tải (có audit) |
| POST | `/:docId/files`, `/:docId/issue`, `/:docId/cancel`, `/:docId/acknowledge` | phiên bản mới, phát hành, hủy (bắt buộc lý do), xác nhận đã nhận |
| POST | `/:docId/share` | `{channel: PORTAL|EMAIL}` — chỉ quản lý |

**Mới — phía NCC** (`/api/supplier-account`, NCC xác định theo email tài khoản như cũ):
`POST /orders/:poId/respond`, `POST /orders/:poId/shortage-reports/:reportId/propose`, `GET|POST /orders/:poId/documents`, `GET /documents/:docId`, `GET /documents/:docId/files/:fileId/download`, `POST /documents/:docId/files|issue|cancel|acknowledge`.

**Mới — PO**: `GET /api/purchase-orders/:id/document-reconciliation`, `POST /api/purchase-orders/:id/document-reconciliation/complete`, `POST /api/purchase-orders/:id/supplier-responses/:responseId/review` (quyền `inventory.purchase.approve`).

**Điều chỉnh (tương thích ngược — mọi trường cũ giữ nguyên, chỉ thêm trường):**
- `POST /api/supplier-deliveries/:id/create-goods-receipt`: nhận thêm `damaged_qty`, `rejected_qty`, header `Idempotency-Key`; trả 409 nếu phiếu giao đã có GRN còn hiệu lực; `shortage_report_id` trong response luôn `null` (chênh lệch lập khi ghi sổ).
- `PATCH /api/goods-receipts/:id`: khi ghi sổ phiếu từ phiếu giao NCC, áp dụng số đếm/hỏng/từ chối; nhận thêm `damaged_qty`/`rejected_qty` trong `items` khi còn DRAFT.
- `POST .../orders/:token|:poId/invoices` (phiếu giao): `invoice_number` không còn bắt buộc nếu có `delivery_number`; nhận `carrier_name`, `deliverer_name`; tự đăng ký `DELIVERY_NOTE`; bị chặn (409) khi đang chờ duyệt thay đổi hoặc NCC đã từ chối PO.
- `POST /purchase-orders/:id/shortage-reports/:reportId/resolve`: nhận tùy chọn `resolution_action`, `resolution_note`.
- `POST /purchase-orders/:id/cancel`: cho phép hủy khi NCC từ chối PO (hoặc SmartBook không chấp nhận thay đổi) và chưa nhận hàng.
- `POST /purchase-orders/:id/send-to-supplier`: thêm `supplier_response_status = PENDING_SUPPLIER`.
- Response PO detail / cổng NCC: thêm `supplier_response_status`, `supplier_responses`, các trường chênh lệch.

## 8. Frontend

| File | Thay đổi |
|---|---|
| `components/procurement/procurement-document-list.tsx` (mới) | Danh sách chứng từ dùng chung cho cả hai vai trò: lọc theo nhóm, trạng thái chứng từ + trạng thái chia sẻ (badge có chữ), phiên bản file + SHA-256, lịch sử gửi (kênh, message id, lỗi), tải xuống, xác nhận đã nhận, phát hành, tải phiên bản mới, hủy có lý do |
| `components/procurement/procurement-document-center.tsx` (mới) | Gắn vào trang chi tiết PO: duyệt phản hồi NCC (so sánh đơn gốc ↔ đề xuất), tab **Chứng từ / Đối soát / Lịch sử**, tải biên bản, phát hành xác nhận nhận hàng, hoàn tất đối soát / duyệt ngoại lệ |
| `components/procurement/supplier-order-documents.tsx` (mới) | Cổng NCC: form phản hồi PO (chấp nhận / một phần / từ chối + lý do + ngày giao), form phát hành hóa đơn (loại, ký hiệu, số, ngày, thuế, MST, mã tra cứu, file PDF/XML, lưu nháp hoặc phát hành, thay thế hóa đơn), danh sách chứng từ dùng chung |
| `components/procurement/goods-receipt-procurement-panel.tsx` (mới) | Trang phiếu nhập: so phiếu giao ↔ thực nhận ↔ hỏng ↔ từ chối ↔ chấp nhận ↔ thiếu; tạo biên bản giao nhận + tải bản scan; xem hóa đơn/phiếu giao |
| `pages/purchase-order-detail.tsx` | Gắn document center, badge phản hồi NCC, bước tiếp theo khi NCC đề xuất/từ chối, chọn kết quả xử lý khi đóng chênh lệch, hiển thị loại chênh lệch và đề xuất NCC |
| `pages/supplier/supplier-account.tsx` | Phản hồi PO thay cho nút xác nhận đơn; "Lập phiếu giao hàng" (số hóa đơn tùy chọn, vận chuyển, người giao, nhãn hiển thị cho input); đề xuất xử lý chênh lệch; mục chứng từ dùng chung |
| `pages/supplier-deliveries.tsx` | Cột Hỏng / Từ chối / Nhập kho khi tạo GRN; gửi `Idempotency-Key` |
| `pages/order-detail.tsx` | +2 dòng (import, gắn panel) |
| `services/procurement-documents.ts`, `lib/procurement-document-status.ts` (mới); `services/purchase-order.ts`, `supplier-account.ts`, `supplier-delivery.ts`, `supplier-portal.ts` | Thêm kiểu và hàm gọi API (chỉ thêm trường) |

Không redesign toàn trang; dùng lại `SectionCard`, `StatusBadge`, `Tabs`, `ConfirmDialog`, `EmptyState`, `Button`, `Input`, bảng màu tone trong `status-registry`.

## 9. Skill UI/UX đã dùng

- `ui-ux-pro-max`: script tra cứu cần Python nhưng **máy không có Python** (theo ghi chú dự án, Python chỉ chạy trong Docker) → dùng bộ quy tắc tham chiếu của skill (`references/quick-reference.md`). Áp dụng: không truyền đạt trạng thái chỉ bằng màu (`color-not-only`), nhãn hiển thị cho input (`input-labels`, `form-labels`), khóa nút khi đang xử lý (`loading-buttons`), empty state có hướng dẫn, xác nhận trước thao tác hủy (`confirmation-dialogs`), thông báo lỗi nêu nguyên nhân + cách sửa (`error-clarity`), bảng cuộn ngang trên màn hình hẹp, `aria-label` cho input trong bảng và nút chỉ có icon, `aria-expanded` cho phần mở rộng.
- Hook `impeccable` quét các file mới: không phát hiện lỗi thiết kế xác định.

## 10. Repository / tài liệu tham khảo

| Nguồn | Học được | Áp dụng | Không áp dụng |
|---|---|---|---|
| [ERPNext — Purchase Receipt](https://docs.frappe.io/erpnext/purchase-receipt) · [Return rejected item](https://docs.frappe.io/erpnext/return-rejected-item) | Dòng nhận hàng có SL chấp nhận và SL từ chối; chỉ phần chấp nhận vào kho dùng được; hàng từ chối trả lại NCC bằng phiếu trả | Quy tắc `thực nhận = chấp nhận + hỏng + từ chối`, chỉ phần chấp nhận được ghi sổ; hàng thừa bắt buộc ghi vào "từ chối" | Kho "hàng từ chối" riêng và phiếu trả hàng — ngoài phạm vi (không thay logic tồn kho) |
| [Odoo — Bill control policies / 3-way matching](https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/purchase/manage_deals/control_bills.html) | Đối chiếu số đặt / đã nhận / đã lập hóa đơn; lệch thì hóa đơn ở trạng thái ngoại lệ, người có quyền có thể "force" | Kết quả đối soát nhiều trạng thái; chỉ hoàn tất khi khớp hoặc người có `inventory.purchase.approve` duyệt ngoại lệ kèm lý do | Tự tạo hóa đơn nhà cung cấp từ số đã nhận — trái yêu cầu (SmartBook không lập hóa đơn thay NCC) |

Không sao chép mã nguồn từ các dự án trên.

## 11. RBAC và bảo mật

- Không thêm permission mới, không sửa seed RBAC. Dùng quyền sẵn có: quản lý (`inventory.purchase.*`, phạm vi kho), nhân viên kho (`inventory.task.*` + GRN được giao), NCC (`supplier.portal.*` + email tài khoản = email NCC).
- Kiểm tra quyền ở backend: chỉ bên phát hành được tải phiên bản/phát hành/hủy; SmartBook không tạo được hóa đơn/phiếu giao; nhân viên kho không sửa/hủy hóa đơn, không chia sẻ, không ghi sổ kho (giữ quy tắc cũ).
- Cô lập NCC: PO/chứng từ của NCC khác trả **404** (không lộ sự tồn tại), kể cả khi đoán ID.
- NCC không thấy `internal_note`, email người nhận, message id, ID nhân sự; chứng từ SmartBook chỉ hiện với NCC khi đã chia sẻ (email FAILED không làm lộ); nháp của NCC không hiện với SmartBook.
- File: không có URL công khai; tải qua endpoint có xác thực, `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`. Kiểm tra loại file bằng **magic bytes** (PDF/XML/PNG/JPEG), chặn XML có DTD/ENTITY, giới hạn 10 MB, tên file được làm sạch, chặn path traversal, ghi file cờ `wx` (không bao giờ ghi đè), mỗi lần tải là phiên bản mới, lưu SHA-256, người tải, thời điểm.
- Trạng thái chia sẻ tách bạch: SENT (cổng đã công bố / SMTP chấp nhận), DELIVERED (bên nhận mở/tải), ACKNOWLEDGED (bên nhận bấm xác nhận), FAILED (lưu lỗi). Email SENT **không** được coi là đã đọc.
- Biên bản ký ngoài hệ thống: không có chữ ký điện tử; tải bản scan chỉ thành `SCAN_UPLOADED`, `signature_verified = false`.
- Hóa đơn NCC tải lên: `tax_authority_verified = false` — không mặc định là hóa đơn VAT hợp lệ.

## 12. Kiểm thử và kết quả thực tế

| Bộ test | Lệnh | Kết quả |
|---|---|---|
| Unit + controller inventory-service (gồm 61 test mới) | `pnpm --filter inventory-service test` | **271/271 PASS** |
| Contract inventory (borrow integration, chạy với `JWT_SECRET` của stack) | `JWT_SECRET=… pnpm --filter inventory-service test:contract` | **12/12 PASS** (chạy không đặt `JWT_SECRET` thì lỗi xác thực ở bước chuẩn bị — do môi trường, không do thay đổi) |
| Regression tích hợp có sẵn: mua hàng → nhận hàng | `node scripts/purchase-supplier-receiving-integration.mjs` | **13/13 PASS** |
| Regression tích hợp có sẵn: cổng NCC | `node scripts/supplier-portal-integration.mjs` | **22/22 PASS** |
| E2E mới toàn luồng qua Gateway thật (manager, staff01, supplier-sv, supplier-ibd) | `node scripts/procurement-document-workflow-integration.mjs` | **59/59 PASS** |
| Web typecheck | `pnpm --filter web exec tsc --noEmit` | PASS |
| Web lint (các file thay đổi) | `npx eslint …` | PASS |
| Web unit | `pnpm --filter web test:unit` | **57/57 PASS** |
| Prisma | `prisma validate` | PASS |
| Build web (image `smartbook-ui`, build production) | `docker compose up -d --build smartbook-ui` | PASS, container healthy |

Test mới theo yêu cầu:
- **A. PO**: tạo/gửi/duyệt (E2E); NCC chấp nhận, chấp nhận một phần, từ chối, thay đổi giá cần duyệt, không vượt số đặt, không trả lời dòng của PO khác (unit); NCC B không thấy PO của NCC A (E2E + controller).
- **B. Hóa đơn**: tạo + PDF + XML, metadata/tiền thuế, phát hành, không phát hành khi thiếu file, trùng số hóa đơn 409, nhiều hóa đơn/PO, không thay file gốc (kể cả bên phát hành), kho/quản lý không sửa/hủy được, hủy cần lý do, thay thế → SUPERSEDED.
- **C. Giao hàng**: phiếu giao đăng ký vào registry, giao nhiều đợt, thiếu, thừa (bắt buộc từ chối), dòng không thuộc phiếu giao, không tạo trùng GRN.
- **D. GRN**: đủ / thiếu / hỏng, nhiều lần nhận/PO, retry cùng Idempotency-Key trả cùng GRN, không vượt SL được duyệt, ghi sổ lại idempotent, GRN POSTED không sửa được dòng, nhân viên không ghi sổ được. Kiểm tra DB: đợt 1 giao 98, hỏng 3 → `stock_movements` INBOUND = **95**.
- **E. Chia sẻ**: hai vai trò xem cùng bản ghi, tải cùng bytes (SHA-256 khớp), NCC khác 404, kho không sửa invoice, thời điểm chia sẻ, xác nhận, email lỗi → FAILED (unit), email thành công → SENT + message id + mailpit nhận thư (E2E), không ACKNOWLEDGED khi chưa xác nhận.
- **F. Biên bản**: chưa có file → PENDING_SIGNED_DOCUMENT, không chia sẻ được; tải scan → SCAN_UPLOADED (không "đã ký"), lưu người tải + SHA-256, quét lại → phiên bản 2 giữ v1, NCC tải và xác nhận.
- **G. Đối soát**: HĐ 100/giao 98; HĐ 100/giao 100/chấp nhận 95; PO 100/HĐ 100/GRN 95 (đóng chênh lệch kiểu chấp nhận hao hụt → NEEDS_REVIEW); nhiều hóa đơn; nhiều lần giao; sai giá; thiếu hóa đơn; thiếu phiếu giao; chênh lệch đã xử lý bằng giao bù → MATCHED; nháp/hủy/bị thay thế/chiếu lệ không tính; header tiền lệch → NEEDS_REVIEW; không hoàn tất được khi còn chênh lệch.

### 12.1. Kiểm tra giao diện trên trình duyệt

Kiểm tra trên bản build production (`localhost:5173`) bằng trình duyệt, đăng nhập tài khoản demo thật:

| Kịch bản | Kết quả |
|---|---|
| Quản lý mở PO đã chạy E2E → "Bộ chứng từ dùng chung": danh sách chứng từ, lọc nhóm, trạng thái chứng từ + trạng thái chia sẻ | Hiển thị đúng |
| Tab Đối soát: Đặt 108 = Hóa đơn 108 = Chấp nhận 108, hỏng 3, kết quả "Khớp", lịch sử 3 đợt giao | Đúng số liệu backend |
| NCC (`supplier-sv`) ở khổ 375px: phản hồi PO → "Chấp nhận một phần" (10 → 6) + lý do → gửi | Toast "Đã gửi đề xuất — chờ SmartBook duyệt" |
| Quản lý mở PO đó: bước tiếp theo "NCC đề xuất thay đổi…", thẻ so sánh "10 → 6 (thay đổi)" → Duyệt | PO thành "NCC đã xác nhận", badge "NCC chấp nhận một phần", còn 26 cuốn (20 + 6) |

Lỗi giao diện phát hiện khi kiểm tra và **đã sửa**:
1. Trang `/supplier` tràn ngang ở 375px (`scrollWidth` 811): cột grid thiếu `min-w-0` nên bảng `min-w-[…]` kéo giãn trang (lỗi có sẵn, mức độ tăng khi thêm bảng mới). Sau sửa: `scrollWidth` = 375.
2. Thẻ tổng "Đã lập hóa đơn" thực ra cộng số lượng phiếu giao → đổi thành "Đã lập phiếu giao".
3. NCC thấy nút "Hủy" trên phiếu giao đã gửi kho → bỏ nút và chặn ở backend (409), sai lệch xử lý bằng biên bản chênh lệch.

Hạn chế môi trường: ở khổ 375px, sidebar admin của SmartBook không tự thu gọn (hành vi có sẵn của layout, ngoài phạm vi) nên ảnh chụp trang quản lý ở khổ mobile bị chồng sidebar; nội dung được kiểm tra bằng DOM. Không thử được tải file qua hộp chọn file của trình duyệt (pane không mở hộp thoại hệ thống) — luồng upload/tải đã kiểm tra qua API E2E (multipart thật, so SHA-256).

## 13. Chức năng đã hoàn thành (đối chiếu Definition of Done)

1–3. Tạo PO; NCC xem/phản hồi (toàn bộ, một phần, từ chối, đề xuất giá/ngày giao, SmartBook duyệt); NCC phát hành hóa đơn và phiếu giao. ✔
4–5. File hóa đơn lưu thật trên volume, tải đúng quyền; kho xem cùng hóa đơn với NCC. ✔
6–10. Kho kiểm nhận và lập GRN, ghi đúng số chấp nhận, không nhập trùng, nhiều đợt giao, thiếu và hỏng. ✔
11–12. Biên bản giao nhận ký ngoài hệ thống tải bản scan; hai bên xem/tải bản đã chia sẻ. ✔
13. SENT / DELIVERED / ACKNOWLEDGED / FAILED tách biệt. ✔
14. Lịch sử hoạt động + audit log (tab Lịch sử, `inventory_audit_logs`). ✔
15. Đối soát PO ↔ Hóa đơn ↔ Phiếu giao ↔ GRN, có lịch sử theo đợt giao và lịch sử hoàn tất. ✔
16. Không có hóa đơn thứ hai cho phía kho. ✔
17. Không đổi nghiệp vụ ngoài phạm vi (mục 16). ✔
18. Test: xem mục 12.

## 14. Giới hạn còn tồn tại

- **Nhập vượt số lượng được duyệt**: hệ thống chặn; chưa có quy trình "duyệt ngoại lệ nhập vượt". Hiện phải ghi phần thừa vào "từ chối" (trả lại) hoặc điều chỉnh PO.
- **Phiếu trả hàng / kho hàng lỗi**: hỏng/từ chối chỉ được ghi nhận và lập biên bản; không tạo phiếu xuất trả hay kho hàng lỗi (tránh đổi logic tồn kho).
- **DELIVERED qua email**: không theo dõi được thư đã tới hộp thư (không có DSN/webhook). Email chỉ ở mức SENT/FAILED; DELIVERED/ACKNOWLEDGED đến từ thao tác trên cổng NCC.
- **Cổng NCC dạng liên kết token** (`/supplier/portal/:token`, bản demo không đăng nhập): **không** mở chức năng chứng từ (tải file cần đăng nhập để kiểm soát truy cập); chứng từ dùng tại `/supplier` (tài khoản NCC).
- Không quét virus nội dung file (chỉ kiểm tra loại thật, kích thước, DTD); nên bổ sung ClamAV nếu dùng production.
- Không đối chiếu hóa đơn với cổng tra cứu của cơ quan thuế (chỉ lưu mã tra cứu).
- `PO_STATUS` không thêm trạng thái mới; "NCC từ chối" thể hiện qua `supplier_response_status`.
- Màn hình nhân viên kho (`order-detail.tsx`) chỉ được gắn panel; bước đếm số lượng giữ nguyên như cũ.

## 15. Hướng dẫn triển khai và migration

1. Sao lưu `inventory_db`.
2. Triển khai image inventory-service mới; container chạy `npx prisma migrate deploy` (đã có trong `command`).
3. Thêm volume `procurement_document_data:/app/evidence/procurement` (đã thêm vào `docker-compose.yml` và `compose.prod.yml`).
4. Cấu hình `SMTP_HOST/PORT/USER/PASS/FROM` và `PUBLIC_WEB_URL` cho inventory-service nếu muốn gửi email (không cấu hình → lần gửi email được ghi FAILED, chia sẻ qua cổng vẫn dùng được).
5. Build lại web (`smartbook-ui`).
6. Kiểm tra: `node scripts/procurement-document-workflow-integration.mjs` trên môi trường thử nghiệm.

Rollback (chỉ khi cần, sau khi quay lại image cũ; **mất dữ liệu chứng từ mới**):

```sql
DROP TABLE IF EXISTS procurement_reconciliations, procurement_document_shares, procurement_document_files,
  procurement_document_lines, procurement_documents, purchase_order_supplier_responses;
ALTER TABLE goods_receipt_items DROP COLUMN IF EXISTS delivered_qty, DROP COLUMN IF EXISTS damaged_qty, DROP COLUMN IF EXISTS rejected_qty;
DROP INDEX IF EXISTS idx_goods_receipts_delivery_status;
ALTER TABLE goods_receipts DROP COLUMN IF EXISTS idempotency_key;
ALTER TABLE purchase_orders DROP COLUMN IF EXISTS supplier_response_status;
ALTER TABLE supplier_delivery_invoices DROP COLUMN IF EXISTS carrier_name, DROP COLUMN IF EXISTS deliverer_name;
ALTER TABLE supplier_shortage_reports DROP COLUMN IF EXISTS discrepancy_type, DROP COLUMN IF EXISTS supplier_proposed_action,
  DROP COLUMN IF EXISTS supplier_response_note, DROP COLUMN IF EXISTS resolution_action, DROP COLUMN IF EXISTS resolution_note;
ALTER TABLE supplier_shortage_report_items DROP COLUMN IF EXISTS discrepancy_type;
DELETE FROM _prisma_migrations WHERE migration_name = '20261113090000_add_procurement_document_workflow';
```

Image cũ vẫn chạy được trên schema mới (chỉ có cột/bảng thêm), nên có thể quay lại image cũ mà **không cần** rollback DB.

## 16. Xác nhận các module không liên quan được bảo toàn

- Không sửa: borrow-service, analytics-service, auth-service (kể cả seed RBAC), ai-service, api-gateway, mobile, ví khách hàng, AI/OCR/chatbot/forecasting, luồng chuyển kho (`TRANSFER`), nhập thủ công (`MANUAL`), putaway, picking/packing, kiểm kê.
- Ghi sổ GRN: chỉ nhánh `source_type = SUPPLIER_INVOICE` có thêm bước; nhánh chuyển kho và nhập thủ công giữ nguyên. Thay đổi chung duy nhất: bỏ qua dòng số lượng 0 khi ghi sổ (không tạo movement 0).
- `uuid-params.middleware.js`: chỉ thêm tên tham số mới (`docId`, `fileId`, `grId`, `responseId`) — không có route cũ nào dùng các tên này.
- Phụ thuộc mới: `nodemailer@9.0.1` cho inventory-service (cùng phiên bản auth/borrow-service đang dùng).
- Regression của luồng mua hàng/cổng NCC có sẵn và contract borrow-integration đều PASS (mục 12).
