# Inventory Service

## Mục tiêu

Inventory Service quản lý toàn bộ vận hành kho, mua hàng và cấu trúc catalog cho SmartBook.

- Runtime: Node.js + Express + Prisma
- Entrypoint: services/inventory-service/src/index.js
- Cổng: 3001 (chỉ trong mạng Docker nội bộ, không publish ra host — đi qua API Gateway `:3000`)
- Cơ sở dữ liệu: inventory_db (+ Redis cache)
- Vai trò chính: catalog, barcode, kho/vị trí, mua hàng & nhà cung cấp, nhập/xếp kệ, picking/packing/xuất kho, kiểm kê, tích hợp tồn kho cho Borrow, catalog công khai

## Nhóm API chính

Toàn bộ `/api/*` (trừ `/api/supplier-portal`) yêu cầu JWT. Có 34 route file trong `src/routes/`.

| Nhóm | Route base |
|---|---|
| Catalog & metadata | /api/books, /api/metadata-reconciliations, /api/duplicate-intelligence |
| Kho & tồn | /api/warehouses, /api/locations, /api/shelves, /api/stock-balances, /api/stock-movements, /api/stock-alerts |
| Mua hàng | /api/purchase-requests, /api/purchase-orders, /api/suppliers, /api/supplier-account, /api/supplier-deliveries |
| Nhập kho | /api/goods-receipts, /api/receiving-smart, /api/receiving-putaway, /api/putaway, /api/transfer-receiving |
| Xuất kho | /api/order-requests, /api/picking, /api/packing, /api/outbound |
| Vận hành kho | /api/stock-audits, /api/exception-reports, /api/storage-suggestions, /api/reslotting-suggestions, /api/staff-tasks, /api/my-warehouse-tasks |
| Tích hợp Borrow | /api/borrow-integration |
| Supplier Portal (token công khai, không cần JWT) | /api/supplier-portal |
| Catalog công khai (không cần JWT) | /public/catalog — `home`, `categories`, `books`, `books/:id`, `branches`, `branches/:id` (xem `docs/public-discovery.md`) |
| Nội bộ (không qua Gateway) | /internal/authority, /internal/covers |

### Tích hợp Borrow (`/api/borrow-integration`)

| Method | Endpoint | Mục đích |
|---|---|---|
| GET | /variants/search, /variants/details | Tìm variant cho Borrow |
| GET | /variants/:variantId/public-availability, /books/:bookId/public-availability | Tồn công khai (chỉ kệ của kho `BRANCH`/`LIBRARY`) — dùng cho "Báo khi có sách" |
| GET | /books/:bookId/variant-ids | Danh sách variant của một đầu sách |
| GET | /warehouses, /availability | Kho và tồn khả dụng |
| POST | /reservations/reserve | Giữ tồn khi đặt sách |
| POST | /reservations/release | Nhả tồn khi hủy/hết hạn — mọi response 200 có `idempotent` (`false` khi lần gọi này thật sự nhả tồn, `true` khi replay cùng idempotency key hoặc không còn reservation `ACTIVE`) |
| POST | /reservations/consume | Trừ tồn khi phát sách |
| POST | /loans/return | Trả lại tồn khi hoàn sách |

Schema hợp đồng của các endpoint này nằm ở `packages/shared/contracts/borrow-inventory/`, được khoá bằng contract test (`npm --prefix services/inventory-service run test:contract`).

## Bản đồ quyền tóm tắt

- `inventory.catalog.read` / `inventory.catalog.write`
- `inventory.stock.read` / `inventory.stock.write` / `inventory.stock.audit`
- `inventory.warehouse.read` / `inventory.warehouse.write`
- `inventory.purchase.request` / `inventory.purchase.read` / `inventory.purchase.write` / `inventory.purchase.approve`
- `inventory.supplier.read` / `inventory.supplier.write`, `inventory.receiving.read`
- `inventory.task.read` / `inventory.task.progress`, `inventory.operation.decide`, `inventory.exception.report`
- `borrow.read` / `borrow.write` cho các endpoint tích hợp liên service

Lưu ý:

- Phần lớn endpoint được bảo vệ bằng `authorizeAnyPermission`.
- Domain này là trọng tâm của Warehouse Staff/Manager và tách biệt với Librarian.
- `warehouse-scope.utils.js` đọc bảng `user_warehouse_scopes` qua Prisma client của inventory, nhưng model này chỉ có trong `auth_db` — nên hiện tại nhánh dự phòng luôn được dùng và mọi user không phải superuser đều đọc/ghi được tất cả kho đang hoạt động.

## Job nền

| Job | Bật/tắt | Mô tả |
|---|---|---|
| Outbox publisher | `ENABLE_OUTBOX_PUBLISHER_JOB` | Publish sự kiện từ `integration_outbox` lên RabbitMQ (retry tối đa 10 lần) |
| Aging inventory | `ENABLE_AGING_INVENTORY_JOB` | Lấy `/analytics/aging-inventory` và tạo stock alert cho sách tồn lâu (`AGING_INVENTORY_DAYS_THRESHOLD`, mặc định 90 ngày) |

## Chạy nhanh

### Local

```bash
cd services/inventory-service
npm install
npm run dev
```

### Docker

```bash
docker compose up -d --build inventory-service
```

Container tự chạy `npx prisma migrate deploy` khi khởi động (xem `docs/MIGRATIONS.md`). Seed demo: `pnpm demo:seed` (hoặc `pnpm demo:upgrade` cho DB đã có dữ liệu cũ).

## Biến môi trường đặc thù

| Biến | Ý nghĩa |
|---|---|
| PORT | Cổng service, mặc định 3001 |
| DATABASE_URL | Chuỗi kết nối inventory_db |
| REDIS_URL | Redis cache |
| JWT_SECRET | Xác minh token |
| INTERNAL_SERVICE_KEY | Khóa gọi nội bộ giữa service |
| GATEWAY_URL | Đẩy sự kiện realtime qua gateway |
| RABBITMQ_URL | Event bus (outbox publisher) |
| AI_SERVICE_URL | Gọi AI giải thích gợi ý vị trí lưu kho và xác minh ảnh đóng gói |
| ANALYTICS_SERVICE_URL | Tín hiệu phổ biến/xu hướng cho catalog công khai (`/analytics/catalog-signals`) và job aging inventory |
| LOW_STOCK_THRESHOLD | Ngưỡng cảnh báo tồn thấp |
| PUBLIC_CATALOG_CACHE_TTL_MS, PUBLIC_CATALOG_SIGNALS_TTL_MS | Cache catalog công khai |
| PACKING_EVIDENCE_DIR | Thư mục lưu bằng chứng ảnh/video đóng gói |
| JSON_BODY_LIMIT | Giới hạn payload JSON |
| OUTBOX_PUBLISHER_INTERVAL_MS, OUTBOX_PUBLISHER_BATCH_SIZE, AGING_INVENTORY_INTERVAL_MS | Chu kỳ job nền |

## Tài liệu liên quan

- README root: ../../README.md
- Docker runbook: ../RUN_WITH_DOCKER.md
- Kiến trúc tổng quan: ../ARCHITECTURE/PROJECT_OVERVIEW.md
- Catalog công khai & trang chi nhánh: ../public-discovery.md
- Kiểm thử gợi ý vị trí lưu kho: ../STORAGE_SUGGESTION_TEST.md
