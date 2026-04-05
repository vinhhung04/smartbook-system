# Inventory Service

## Mục tiêu

Inventory Service quản lý toàn bộ vận hành kho và cấu trúc catalog cho SmartBook.

- Runtime: Node.js + Express + Prisma
- Entrypoint: services/inventory-service/src/index.js
- Cơ sở dữ liệu: inventory_db
- Vai trò chính: catalog, barcode, kho, vị trí, nhập/xuất, kiểm kê, nhà cung cấp

## Nhóm API chính

| Nhóm API | Route base | Mô tả |
|---|---|---|
| Catalog | /api/books | Quản lý sách, barcode, ISBN, metadata |
| Warehouse | /api/warehouses | Quản lý kho, zone/bin, locations |
| Goods Receipt | /api/goods-receipts | Nghiệp vụ nhập kho |
| Putaway | /api/putaway | Đưa hàng vào vị trí lưu trữ |
| Outbound | /api/outbound | Xử lý xuất kho theo task |
| Order Request | /api/order-requests | Tạo/duyệt yêu cầu xuất/chuyển |
| Picking | /api/picking | Lấy hàng, repick |
| Shelf | /api/shelf | Tổng quan tồn theo kệ |
| Stock Movement | /api/stock-movements | Lịch sử biến động tồn |
| Borrow Integration | /api/borrow-integration | Tích hợp tồn kho với Borrow |
| Supplier | /api/suppliers | Quản lý nhà cung cấp |

## Bản đồ quyền tóm tắt

- inventory.catalog.read và inventory.catalog.write
- inventory.stock.read và inventory.stock.write
- borrow.read và borrow.write cho các endpoint tích hợp liên service

Lưu ý:

- Phần lớn endpoint được bảo vệ bằng authorizeAnyPermission.
- Domain này là trọng tâm của Warehouse Staff và tách biệt với Librarian.

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
docker compose --profile dev run --rm inventory-db-push
```

## Biến môi trường đặc thù

| Biến | Ý nghĩa |
|---|---|
| PORT | Cổng service, mặc định 3001 |
| DATABASE_URL | Chuỗi kết nối inventory_db |
| JWT_SECRET | Xác minh token |
| JSON_BODY_LIMIT | Giới hạn payload JSON |

## Tài liệu liên quan

- README root: ../../README.md
- Docker runbook: ../RUN_WITH_DOCKER.md
- Kiến trúc tổng quan: ../PROJECT_OVERVIEW.md
