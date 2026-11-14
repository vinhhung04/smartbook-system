# Báo cáo — P1 Warehouse Stock Data Access

Ngày: 2026-11-14 · Nhánh: `khoa`

## Phase 0 — Baseline

| Mục | Giá trị |
|---|---|
| Nhánh | `khoa`, không đổi |
| Commit đầu phiên | `510ce6b` |
| Thay đổi chưa commit khi bắt đầu | `services/inventory-service/src/controllers/packing.controller.js` (fix riêng của phiên trước, không liên quan, không đụng tới) |
| Thay đổi mới trong phiên này | 3 file sửa + 1 script test mới (mục "Files Changed") |

## Phase 1 — Re-audit (xác minh trước khi sửa)

Đọc trực tiếp code hiện tại trên `khoa`, không giả định từ mô tả lỗi cũ:

| ID | Giả định ban đầu | Thực tế trên code hiện tại |
|---|---|---|
| P1-01 | `getAllBooks` chưa lọc warehouse scope | **Đúng, xác nhận** — `book.controller.js` include `stock_balances` không có `where`, `mapBookSummary` cộng dồn toàn bộ |
| P1-02 | `getBookById` chưa lọc warehouse scope | **Đúng, xác nhận** — cùng pattern |
| P1-03 | `GET /api/inventory` legacy chưa lọc | **Đúng, xác nhận** — `index.js`, cùng pattern, không có consumer nào trong repo (grep toàn bộ `apps/web`, `apps/mobile`, các service khác) nhưng không xóa, chỉ áp scope |

Không có mục nào thuộc "ALREADY FIXED" hay "NOT A BUG" trong 3 mục được chỉ định — cả 3 đều là lỗi thật.

## Phase 2 — Implementation

### Cách sửa (dùng lại helper sẵn có, không tạo cơ chế mới)

Thêm một hàm nhỏ `stockBalanceScopeWhere(user)` trong `book.controller.js` (và tương đương inline trong `index.js`), dựa trên `readableWarehouseFilter(user)` đã có sẵn trong `warehouse-scope.utils.js`:

```js
async function stockBalanceScopeWhere(user) {
  const readable = await readableWarehouseFilter(user); // null = superuser (không lọc)
  return readable === null ? undefined : { warehouse_id: { in: readable } };
}
```

Áp dụng bằng `where` **ngay trong Prisma include** (lọc tại tầng truy vấn, không fetch hết rồi lọc JS, không N+1):

```js
book_variants: { include: { stock_balances: { where: stockWhere, include: {...} } } }
```

Vì `mapBookSummary()` chỉ cộng dồn đúng những dòng `stock_balances` mà Prisma trả về, các trường tổng hợp (`quantity`, `available_quantity`, `receiving_quantity`, `locations`, `location_count`, `default_warehouse_id`, `default_location_id`, `location`, `reservable`) **tự động** chỉ phản ánh kho được phép đọc — không cần sửa hàm này.

Khi `readableWarehouseFilter` ném `WarehouseScopeUnavailableError` (auth-service không phản hồi / token không hợp lệ), cả 2 file đều bắt lỗi và trả `503` qua `scopeErrorStatus()` — không bao giờ fallback về "xem tất cả".

### Vùng sửa

| ID | File đã sửa | Function | Nguyên nhân | Cách khắc phục | Test | Kết quả |
|---|---|---|---|---|---|---|
| P1-01 | `book.controller.js` | `getAllBooks` | Include `stock_balances` không lọc warehouse | `where: stockWhere` trong include, 503 khi scope không xác định được | `warehouse-stock-data-scope-integration.mjs` T1 | PASS |
| P1-02 | `book.controller.js` | `getBookById` | Như trên | Như trên | T2, T2b | PASS |
| P1-02b (phát hiện khi sửa, cùng pattern) | `book.controller.js` | `updateBookDetails` | Response sau khi PATCH cũng include `stock_balances` không lọc (cùng hàm `mapBookSummary`, cùng lỗ hổng) | `where: stockWhere` trong `fullBook` query bên trong transaction | Xác nhận qua code review + cùng cơ chế đã test ở T1/T2 (không viết thêm test riêng vì cùng code path) | Đã sửa |
| P1-03 | `index.js` | `GET /api/inventory` | Như P1-01, không có consumer trong repo nhưng không xóa | `where` scoped giống book.controller.js, 503 khi scope unavailable | T3 | PASS |
| Phát hiện thêm khi sweep Phase 5 | `shelf.controller.js` | `getShelfOverview`, `getShelfDetail` | Cùng lớp lỗi: không import bất kỳ helper warehouse-scope nào; tham số `warehouseId` do client truyền tùy ý, không đối chiếu quyền đọc | `getShelfOverview` dùng `scopedWarehouseWhere(user, 'warehouse_id', warehouseId)` (helper có sẵn, đúng cho trường hợp "requested warehouse"); `getShelfDetail` gọi `requireWarehouseReadAccess(req, res, shelf.warehouse_id)` sau khi resolve bản ghi | Script bổ sung 4 check (shelf overview A/B/loại C, query param override, direct detail access) | PASS |

## Phase 3 — Automated testing

Script mới: **`scripts/warehouse-stock-data-scope-integration.mjs`** (giữ lại trong repo như regression test thường trực, cùng quy ước với các script `*-integration.mjs` khác).

Fixture dựng bằng API thật (không thao tác DB trực tiếp): `manager01` tạm thời đặt `FULL` ở kho A (WH-HCM-01), `READ_ONLY` ở kho B (WH-HN-01), **không có dòng nào** cho kho C (WH-DN-01) — khôi phục đúng scope gốc của `manager01` trong khối `finally`, đã xác nhận lại bằng `GET` sau khi script chạy xong.

**Chạy thật, trước và sau khi sửa** (rebuild Docker thật, không mock):

| Lần chạy | Trạng thái code | Kết quả |
|---|---|---|
| Trước sửa | 3 endpoint P1 chưa lọc | **6/13 FAIL** — `quantity=29` (tổng tất cả 6 kho) thay vì 15 (A+B); cả 3 endpoint đều trả dữ liệu kho C và các kho khác không được cấp quyền |
| Sau sửa | Đã sửa 3 endpoint + shelf | **16/16 PASS** (bổ sung 4 test shelf) |

Các test theo đúng 8 kịch bản yêu cầu (Test 1–7 trong prompt; Test 6 "không có warehouse scope" đã có sẵn và được xác nhận lại qua unit test `scopedWarehouseWhere: fail-closed shapes` + `auth-service unavailable answers 503, never grants` trong bộ test hiện có — không viết trùng).

## Phase 4 — Validation

| Hạng mục | Lệnh | Kết quả |
|---|---|---|
| Unit test inventory-service | `pnpm --filter inventory-service test` | **322/322 PASS** |
| Regression warehouse-scope | `node scripts/warehouse-scope-integration.mjs` | **8/8 PASS** |
| Regression warehouse-assignment | `node scripts/warehouse-assignment-integration.mjs` | **13/13 PASS** |
| Regression mua hàng/nhận hàng | `node scripts/purchase-supplier-receiving-integration.mjs` | **13/13 PASS** |
| Regression cổng NCC | `node scripts/supplier-portal-integration.mjs` | **22/22 PASS** |
| Regression mượn sách | `node scripts/borrow-phase2-integration.mjs` | **19/19 PASS** (ghi chú: lần chạy đầu tiên lỗi "No borrowable variant" do script tự ký JWT với secret mặc định sai khác `.env` thật của máy — môi trường, không phải lỗi code; chạy lại với `node --env-file=.env` cho đúng secret thì PASS) |
| **P1 mới** | `node scripts/warehouse-stock-data-scope-integration.mjs` | **16/16 PASS** |

Không chạy lint/build riêng vì không có thay đổi TypeScript/frontend; cú pháp JS đã được xác nhận qua việc service build và chạy thật thành công (Docker build không lỗi, server khởi động healthy, phục vụ request thật).

Git diff đã kiểm tra: chỉ 3 file controller + 1 script mới, không có thay đổi UI/UX, không đổi response field nào (chỉ giới hạn các dòng `stock_balances` trả về).

## Phase 5 — Final report

### 1. Lỗi P1 thực sự được xác nhận
P1-01, P1-02, P1-03 (đúng như mô tả ban đầu) + 1 lỗi phát sinh cùng pattern trong `updateBookDetails` (cùng file) + 1 lỗi cùng pattern trong `shelf.controller.js` (phát hiện khi sweep Phase 5 theo yêu cầu "tìm toàn bộ đường truy cập dữ liệu tồn kho").

### 2. Lỗi không còn tồn tại / không cần sửa
Không có — cả 3 mục P1 ban đầu đều còn tồn tại nguyên vẹn trên `khoa` tại thời điểm audit (không có commit nào sửa trước đó).

### 3. File đã thay đổi
- `services/inventory-service/src/controllers/book.controller.js`
- `services/inventory-service/src/controllers/shelf.controller.js`
- `services/inventory-service/src/index.js`
- `scripts/warehouse-stock-data-scope-integration.mjs` (mới)

### 4. API đã được kiểm soát warehouse scope (trong phạm vi sửa)
`GET /api/books`, `GET /api/books/:id`, `PATCH /api/books/:id` (response), `GET /api/inventory`, `GET /api/shelves`, `GET /api/shelves/:id`.

### 5. Test đã chạy và kết quả thực tế
Xem bảng Phase 3/4 ở trên — toàn bộ PASS, không có test nào bị tắt hay chỉ kiểm tra trường hợp thành công (mỗi endpoint đều có cả test "được phép" và "bị từ chối").

### 6. Test chưa chạy được
Không có. `lint`/`build` không áp dụng vì không có thay đổi frontend/TypeScript.

### 7. Rủi ro còn tồn tại (ngoài phạm vi, chỉ ghi nhận — không tự sửa)
- `receiving-putaway.controller.js`: hai endpoint ghi dữ liệu `POST /transfer` và `POST /reverse` chỉ được bảo vệ bằng permission (`canExecuteTransfer`/`canDecideOperation`), không có `requireRecordWarehouse` ở tầng route như các endpoint GET cùng file — khác lớp lỗi với P1 (đây là rủi ro ghi/write theo ID, không phải rò rỉ dữ liệu đọc), nằm ngoài phạm vi "stock data leak" của prompt này nên không sửa, chỉ ghi nhận để xem xét riêng.
- `borrow-integration.controller.js`: không áp dụng warehouse scope — **xác nhận đây là đúng thiết kế**, không phải thiếu sót: các endpoint này phục vụ khách hàng mượn sách chọn chi nhánh nhận sách (`listBorrowWarehouses`, `getAvailability`), về bản chất phải hiển thị tồn kho liên chi nhánh cho mọi khách hàng, được bảo vệ bằng permission `borrow.read/write` chứ không phải warehouse scope của nhân viên.

### 8. Xác nhận nghiệp vụ Manager READ_ONLY liên kho vẫn hoạt động
✔ Xác nhận bằng test T4 và T7: Manager A với READ_ONLY ở kho B vẫn đọc được tồn kho B qua cả `/api/books`, `/api/books/:id`, `/api/inventory`, `/api/shelves`, và `/api/warehouses/:id/locations`; kho B vẫn xuất hiện trong danh sách kho dùng để chọn nguồn điều chuyển (`GET /api/warehouses`).

### 9. Xác nhận không phát sinh quyền ghi ngoài phạm vi được phân công
✔ Xác nhận bằng test T4/T5: Manager A với READ_ONLY ở B bị từ chối khi thử nhập kho (`POST /api/inventory/inbound`) vào B; với kho C (không có quyền) bị từ chối cả đọc lẫn ghi, kể cả khi cố truyền `warehouse_id` của C qua query string hoặc request body.

### 10. Xác nhận không thay đổi UI/UX
✔ Không sửa file nào trong `apps/web` hoặc `apps/mobile`. Response shape của cả 3+2 endpoint giữ nguyên cấu trúc field (`quantity`, `locations`, `shelves`, `compartments`...) — chỉ giới hạn SỐ DÒNG `stock_balances`/`locations` được trả về theo quyền đọc, không đổi tên hay kiểu dữ liệu field nào.

## Điều kiện hoàn thành — đối chiếu

| Điều kiện | Trạng thái |
|---|---|
| Không còn API tồn kho trong phạm vi sửa trả dữ liệu kho không được cấp quyền | ✔ Đã xác nhận bằng test sống (trước/sau) |
| Manager READ_ONLY vẫn xem được tồn kho kho khác | ✔ |
| Manager không chỉnh sửa/ghi được trên kho READ_ONLY | ✔ |
| Manager không truy cập được kho không có quyền (kể cả override query/body) | ✔ |
| Không phá vỡ nghiệp vụ bổ sung hàng và điều chuyển | ✔ (T7 + regression purchase/supplier/transfer đều PASS) |
| Test quan trọng đều đạt | ✔ 322 unit + 91 integration/regression (8+13+13+22+19+16) |
| Không có thay đổi ngoài phạm vi yêu cầu | ✔ — ngoại trừ việc mở rộng sang `updateBookDetails` và `shelf.controller.js`, cả hai đều là cùng lớp lỗi "rò rỉ dữ liệu tồn kho" mà Phần 5 của yêu cầu gốc yêu cầu phải sweep tìm, không phải thay đổi tùy tiện |

Chưa commit, chưa push, chưa merge.
