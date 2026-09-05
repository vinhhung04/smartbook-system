# SmartBook — Lộ trình sửa lỗi sau Tier 0 (Roadmap, không phải plan thực thi)

**Đây là tài liệu điều hướng, không phải một plan để chạy trực tiếp.** 50 phát hiện còn lại của báo cáo audit (sau khi trừ 6 lỗi Tier 0 đã có plan chi tiết ở `2026-09-04-smartbook-critical-fixes.md`) trải khắp nhiều subsystem độc lập — viết chúng thành một plan TDD chi tiết duy nhất sẽ vượt quá kích thước dùng được. Tài liệu này ánh xạ toàn bộ 50 lỗi vào 7 sub-plan, mỗi sub-plan tự đứng độc lập, sản xuất phần mềm chạy được và kiểm chứng được riêng nó — đúng tinh thần "Scope Check" của quy trình viết plan.

Khi bắt đầu một sub-plan, gọi lại `superpowers:writing-plans` với đúng phạm vi của sub-plan đó để sinh ra một plan chi tiết theo đúng khuôn Task/Step như plan Tier 0.

## Cách đọc bảng

- **Mã lỗi**: khớp với mã trong báo cáo audit gốc (`smartbook-audit.html`).
- **Effort**: S (một buổi), M (1-2 ngày), L (nhiều ngày / cần thiết kế thêm).
- **Ghi chú phạm vi**: ranh giới rõ để tránh việc một sub-plan phình ra ngoài kiểm soát.

---

## Sub-plan 1: Điều hướng & kiến trúc thông tin (IA-01 → IA-07)

**Mục tiêu:** Làm cho 40 màn hình dễ tìm, đúng quyền, và dùng được trên di động.

| Mã | Effort | Nội dung |
|---|---|---|
| IA-01 | M | Thêm ô tìm kiếm toàn cục / Ctrl+K — điều hướng theo `navGroups` đã lọc quyền + tìm thực thể (sách, PO, phiếu mượn) |
| IA-02 | M | Tách "Danh mục sách"/"Gợi ý sách" khỏi nhóm "Mua hàng & NCC"; thêm phân nhóm con cho 14 mục "Vận hành kho" |
| IA-03 | S | Ẩn nút quét mã trên topbar khi user không có quyền `staffTaskProgress` (đồng bộ với logic sidebar đã đúng) |
| IA-04 | S | Thêm loader RBAC cho route `/`; sửa trang 404 để không đẩy mọi vai trò về cùng một chỗ bế tắc |
| IA-05 | S | Đồng bộ điều kiện quyền giữa `nav-groups.ts` và `routes.ts` cho `/picking`, `/outbound` |
| IA-06 | L | Thêm breakpoint mobile cho `layout.tsx` — sidebar chuyển thành drawer dưới `md:` (xem cách `customer/layout.tsx` đã làm để tái dùng pattern) |
| IA-07 | M | Mở rộng breadcrumb hỗ trợ nhiều cấp và nhãn đúng cho route con; sửa breadcrumb hiện trên trang 404 |

**Phụ thuộc:** Không phụ thuộc sub-plan nào khác. Nên làm sau Tier 0 vì Task 4/6 của Tier 0 đã sửa `nav-groups.ts` — tránh xung đột merge.

**File trọng tâm:** `apps/web/src/lib/nav-groups.ts`, `apps/web/src/app/routes.ts`, `apps/web/src/components/layout.tsx`, `apps/web/src/components/sidebar.tsx`, `apps/web/src/components/topbar.tsx`, `apps/web/src/components/pages/not-found.tsx`.

---

## Sub-plan 2: Thị giác & design system (VIS-01 → VIS-08)

**Mục tiêu:** Dark mode nhất quán toàn hệ thống, mã màu trạng thái không bị loãng bởi màu trang trí.

| Mã | Effort | Nội dung |
|---|---|---|
| VIS-01 | M | Thêm biến thể `dark:` cho `textColor`/`iconBg` của từng mục trong `nav-groups.ts` (hiện hardcode kiểu `text-emerald-700`) |
| VIS-02 | S | Sửa 4 biến thể `success/danger/warning/info-outline` trong `ui/button.tsx` thêm token `dark:` |
| VIS-03 | L | Đưa `components/pages/supplier/*` về dùng chung token/component với khu nội bộ thay vì tự chế `StatCard`/`Tabs` riêng |
| VIS-04 | M | Xóa `customer-tokens.ts` chết hoặc hợp nhất nó vào `theme.css`; ngừng fork design system riêng cho customer portal |
| VIS-05 | M | Định nghĩa thang typography chuẩn thay cho cỡ chữ pixel tùy biến; loại bỏ `font-weight: 550/650` không render được |
| VIS-06 | M | Giảm số sắc màu trang trí trong sidebar; tách rõ "amber" (trang trí) khỏi "warning" (mã trạng thái) |
| VIS-07 | S | Thay hex hardcode trong biểu đồ (`recharts`) bằng token `--chart-1..5` đã định nghĩa sẵn cho cả 2 theme |
| VIS-08 | M | Hợp nhất về một kiểu bảng dùng `ui/data-table.tsx`, một kiểu loading state dùng `ui/loading-state.tsx` |

**Phụ thuộc:** Không phụ thuộc sub-plan khác, nhưng nên làm **sau** Sub-plan 3 (accessibility) vì cả hai đều sửa `theme.css`/`button.tsx` — gộp lại một lượt sửa token tránh xung đột hai lần.

**File trọng tâm:** `apps/web/src/styles/theme.css`, `apps/web/src/lib/nav-groups.ts`, `apps/web/src/components/ui/button.tsx`, `apps/web/src/components/pages/supplier/*`, `apps/web/src/components/pages/customer/_shared/customer-tokens.ts`.

---

## Sub-plan 3: Khả năng tiếp cận (A11Y-01 → A11Y-08 + phát hiện bổ sung)

**Mục tiêu:** Đạt WCAG 2.1 AA cho tương phản màu, kích thước vùng chạm, và điều hướng bàn phím.

| Mã | Effort | Nội dung |
|---|---|---|
| **Mới** | S | Sửa `--warning-foreground`/`--success-foreground`/`--info-foreground` trong `theme.css` (hiện 2,15–2,54:1, cần đổi sang tông tối như cách `.dark` đã làm) |
| A11Y-03 | S | Đậm `--muted-foreground` để đạt 4.5:1 trên cả nền `--background` và `--muted`, không chỉ trên `--card` |
| A11Y-06 | S | Đậm `--border` từ `#e2e4ed` lên tối thiểu 3:1 với nền trắng |
| A11Y-01 | M | Sửa `useDialogA11y.ts` để không cướp focus khi gõ phím trong input bên trong modal |
| A11Y-02 | M | Thay `<th>`/`<div>`/`<span onClick>` bằng `<button>` thật ở các điều khiển tương tác |
| A11Y-04 | L | Gắn lỗi validate form vào từng input qua `aria-invalid`/`aria-describedby` thay vì chỉ toast — nhân bản pattern đã có ở `login.tsx` |
| A11Y-05 | M | Thêm `htmlFor`/`id` cho nhãn form ở các trang kho |
| A11Y-07 | M | Thêm skip-link, giữ nhãn khi sidebar thu gọn (dùng `aria-label` thay vì ẩn text), thêm `aria-live` cho toast realtime |
| A11Y-08 | S | Thêm size `touch` (44px) cho `ui/button.tsx`, áp dụng cho các nút hành động trong picking/packing/putaway/kiểm kê |

**Phụ thuộc:** Làm **trước** Sub-plan 2 (Thị giác) vì cả hai cùng sửa `theme.css` — bảng màu đúng chuẩn AA nên là nền, sau đó Sub-plan 2 mới lo phần nhất quán dark mode dựa trên nền đó.

**File trọng tâm:** `apps/web/src/styles/theme.css`, `apps/web/src/hooks/useDialogA11y.ts`, `apps/web/src/components/ui/button.tsx`, các form trong `components/pages/*.tsx`.

---

## Sub-plan 4: Trải nghiệm cổng độc giả (CUST-03 → CUST-08)

**Mục tiêu:** Cổng độc giả dùng được thật trên di động, không còn ngõ cụt khi sách hết.

| Mã | Effort | Nội dung |
|---|---|---|
| CUST-05 | M | Thêm phân trang/sắp xếp cho danh mục khách hàng; debounce ô tìm kiếm (hiện gọi API sau mỗi ký tự gõ) |
| CUST-06 | M | Mở rộng luồng đặt sách: hiện hạn phải tới nhận, địa chỉ điểm nhận, màn hình xác nhận trước khi gửi |
| CUST-07 | M | Thêm biến thể `dark:` cho 33 file trong `components/pages/customer/*` (đang hardcode `bg-white`/`text-slate-900`) |
| CUST-04 | L | Xây hàng đợi giữ chỗ khi sách hết + bắn thông báo khi có hàng trở lại (phụ thuộc Sub-plan 6, Task "Kích hoạt gửi email") |
| CUST-08 | M | Nối hai biểu đồ "Thể loại yêu thích"/"Tác giả hay đọc" trong `reading-analytics.tsx` với dữ liệu thật từ lịch sử mượn |
| CUST-03 | S | Thêm job nhắc trả sách trước hạn (chi tiết chung với LIB-04 ở Sub-plan 6 — làm cùng lúc) |

**Phụ thuộc:** CUST-04 và CUST-03 phụ thuộc việc "email thực sự được gửi" ở Sub-plan 6 — làm Sub-plan 6 phần email trước, hoặc làm song song và merge cẩn thận vào `notifications.js`.

**File trọng tâm:** `apps/web/src/components/pages/customer/*`, `services/borrow-service/src/jobs/*`.

---

## Sub-plan 5: UX thực thi kho vận (WH-01 → WH-08)

**Mục tiêu:** Các màn hình picking/packing/putaway dùng được trên thiết bị cầm tay, có phản hồi khi quét, và thống nhất một mô hình tương tác.

| Mã | Effort | Nội dung |
|---|---|---|
| WH-02 | S | Thêm phản hồi âm thanh (Web Audio API beep ngắn) + `navigator.vibrate` khi quét thành công/thất bại |
| WH-06 | S | Áp size `touch` (từ Sub-plan 3) cho mọi nút trong picking/packing/putaway/kiểm kê |
| WH-04 | M | Thêm nút "Báo thiếu hàng"/"Báo hư hỏng" ngay trong luồng lấy hàng thay vì phải rời sang màn khác |
| WH-07 | M | Cho phép chọn "Lý do" từ danh sách có sẵn thay vì gõ tay; nới lỏng validate ISBN13 chấp nhận ISBN10 và mã nội bộ |
| WH-01 / IA-06 | L | Trùng với IA-06 ở Sub-plan 1 — làm chung một lượt breakpoint mobile cho `layout.tsx`, không tách hai task riêng |
| WH-03 | L | Đưa `picking.tsx` dùng chung bộ điều phối quét (`handleAnyScannedCode`) đã chứng minh hoạt động tốt ở `packing.tsx`; giữ camera sống suốt vòng đời trang thay vì mount lại sau mỗi lần quét |
| WH-05 | L | Rút một "khuôn tương tác kho" chung (thứ tự: quét vị trí → quét sản phẩm → nhập số lượng → xác nhận) áp dụng nhất quán cho picking/putaway/receiving-putaway/stock-audits |
| WH-08 | L | Thêm hàng đợi ghi tạm (localStorage) cho thao tác quét khi mất mạng, đồng bộ lại khi có mạng — cần thiết kế riêng trước khi viết plan chi tiết |

**Phụ thuộc:** WH-06 phụ thuộc Sub-plan 3 (size `touch` được định nghĩa ở đó). WH-01 gộp chung với IA-06 — làm ở Sub-plan 1, không lặp lại ở đây.

**File trọng tâm:** `apps/web/src/components/pages/picking.tsx`, `packing.tsx`, `putaway.tsx`, `receiving-putaway.tsx`, `stock-audits.tsx`, `apps/web/src/hooks/useHardwareScanner.ts`.

---

## Sub-plan 6: Thiếu hụt chức năng thư viện (LIB-03 → LIB-08)

**Mục tiêu:** Thông báo thật sự tới tay độc giả; nghiệp vụ trả sách chính xác tới từng cuốn thay vì cả phiếu.

| Mã | Effort | Nội dung |
|---|---|---|
| LIB-03 | S | Sửa `createNotificationRecord` trong `notifications.js` tự tra `customers.email` từ `customer_id` thay vì yêu cầu caller truyền — bật sống 19 mẫu email hiện có |
| LIB-04 | S | Thêm job nhắc trả sách trước hạn 3 ngày (nhân bản `overdue.job.js`), dùng mẫu `LOAN_DUE_REMINDER` đã có sẵn (chung với CUST-03) |
| LIB-06 | M | Thêm điểm quét mã QR thẻ thành viên (ở quầy thủ thư) và cho tìm kiếm khách theo `card_number` |
| LIB-07 | M | Sửa "Báo hư hỏng"/"Đánh dấu mất" hoạt động ở mức từng `loan_item` thay vì áp dụng cho toàn bộ phiếu mượn |
| LIB-05 | L | Xây hàng đợi giữ chỗ (hold queue) khi sách hết — nền tảng cho CUST-04 ở Sub-plan 4 |
| LIB-08 | S | Ghi doanh thu tiền phạt vào sổ cái ví khi nhân viên ghi nhận thanh toán qua `POST /fines/:id/payments` |

**Phụ thuộc:** Làm phần LIB-03 (sửa `notifications.js`) **trước tiên** trong sub-plan này — mọi mục còn lại (nhắc hạn, thông báo hold queue) phụ thuộc email thật sự gửi được.

**File trọng tâm:** `services/borrow-service/src/lib/notifications.js`, `src/jobs/*`, `src/controllers/loan.controller.js`, `src/controllers/fine.controller.js`.

---

## Sub-plan 7: Nền tảng, in ấn & kho vận nâng cao (PLAT-02, PLAT-03, PLAT-04, PLAT-07, PLAT-08)

**Mục tiêu:** Đồng bộ ngôn ngữ hiển thị, cho phép in phiếu kho, và khai thác dữ liệu kho đã có sẵn nhưng chưa dùng tới.

| Mã | Effort | Nội dung |
|---|---|---|
| PLAT-02 | S | Dịch `book-detail.tsx` và `purchase-order-detail.tsx` sang tiếng Việt, khớp giọng văn các trang còn lại |
| PLAT-07 | S hoặc L | **Quyết định trước khi làm**: (A) gỡ nút VI/EN khỏi topbar + customer-header nếu đa ngôn ngữ không phải trọng tâm — rẻ nhất; hoặc (B) dịch triệt để trọn cổng độc giả và giới hạn nút đổi ngôn ngữ chỉ ở đó |
| PLAT-05 (phần font PDF) | M | Nhúng font Unicode (`.ttf` base64, ví dụ Noto Sans) vào `jsPDF` trong `export-utils.ts`/`print-utils.ts` — phần nút chết đã sửa ở Tier 0, đây là phần "PDF mất dấu tiếng Việt" còn lại |
| PLAT-03 | M | Thêm API đọc `inventory_audit_logs` và nối vào trang "Nhật ký hệ thống" (hiện chỉ đọc `borrow_audit_logs`) |
| PLAT-04 | L | Thêm chức năng in picking list, packing slip, nhãn kệ, tem mã vạch — dùng `jsBarcode`/`bwip-js` sinh ảnh mã vạch, `addImage` vào jsPDF đã nhúng font Unicode |
| PLAT-08 (bản đồ kho) | M | Thêm tab "Sơ đồ kho" ở `warehouses/location-explorer.tsx` — lưới CSS nhóm theo `zone`/`aisle`, tô màu theo tỉ lệ lấp đầy; không cần đổi backend vì `locations` đã có đủ trường |
| PLAT-08 (đánh giá NCC) | M | Thêm `GET /suppliers/:id/performance` tính tỉ lệ giao đúng hạn/đủ số lượng từ dữ liệu `purchase_orders`/`goods_receipts`/`supplier_shortage_reports` đã có |
| PLAT-08 (đếm chu kỳ) | M | Thêm `audit_type`/`scope_zone` vào `stock_audits`, đọc cờ `enable_cycle_count` đang chết trong `warehouse_settings` |

**Phụ thuộc:** Làm PLAT-05 (nhúng font) **trước** PLAT-04 (in phiếu) vì in ấn phụ thuộc font đã sửa đúng. Ba mục con của PLAT-08 độc lập nhau — có thể chọn làm 1 hoặc cả 3 tùy thời gian còn lại; audit gốc khuyến nghị làm "Bản đồ kho" trước vì tỉ lệ công sức/hiệu quả tốt nhất.

**File trọng tâm:** `apps/web/src/lib/export-utils.ts`, `print-utils.ts`, `components/pages/warehouses/location-explorer.tsx`, `components/pages/audit-trail.tsx`, `services/inventory-service/src/routes/*`, `prisma/schema.prisma` (inventory-service).

---

## Thứ tự khuyến nghị

1. **Tier 0** (đã có plan chi tiết) — bắt buộc trước buổi bảo vệ.
2. **Sub-plan 3** (Accessibility) — sửa nền màu sắc trước khi Sub-plan 2 xây dark mode lên trên nó.
3. **Sub-plan 2** (Thị giác) — tận dụng luôn việc đang sửa `theme.css`.
4. **Sub-plan 1** (IA) — độc lập, có thể chen vào bất kỳ lúc nào sau Tier 0.
5. **Sub-plan 6** (Thư viện) → **Sub-plan 4** (Customer portal) — làm theo thứ tự này vì CUST-03/CUST-04 phụ thuộc email thật từ Sub-plan 6.
6. **Sub-plan 5** (Kho vận UX) — effort lớn nhất, dành cho giai đoạn còn nhiều thời gian.
7. **Sub-plan 7** (Nền tảng & in ấn) — làm sau cùng, ít rủi ro nhất khi bị cắt thời gian.
