# Inventory Service

## Muc tieu

Inventory Service quan ly danh muc sach va van hanh kho trong SmartBook.

- Runtime: Node.js + Express + Prisma
- Entrypoint: services/inventory-service/src/index.js
- Database: inventory_db (PostgreSQL)
- Vai tro: catalog, barcode, kho, vi tri, inbound/outbound, movement, supplier

## Nhom API chinh

| Nhom API | Route base | Mo ta |
|---|---|---|
| Catalog | /api/books | Quan ly sach, barcode, ISBN, cap nhat thong tin |
| Warehouse | /api/warehouses | Quan ly kho, zone/bin, locations |
| Goods Receipt | /api/goods-receipts | Quy trinh nhap kho |
| Putaway | /api/putaway | Dieu phoi dua hang vao vi tri |
| Outbound | /api/outbound | Xuat kho theo task |
| Order Request | /api/order-requests | Tao/duyet yeu cau xuat/chuyen |
| Picking | /api/picking | Quy trinh lay hang, repick |
| Shelf | /api/shelf | Tong quan/su kien ke |
| Stock Movement | /api/stock-movements | Lich su bien dong ton |
| Borrow Integration | /api/borrow-integration | Endpoint phuc vu borrow-service |
| Supplier | /api/suppliers | CRUD nha cung cap |

## Permission map (tom tat)

- inventory.catalog.read / inventory.catalog.write
- inventory.stock.read / inventory.stock.write
- borrow.read / borrow.write (cho integration endpoint)

Ghi chu:
- Phan lon route duoc bao ve bang middleware authorizeAnyPermission.
- Service nay la xuong song cho nghiep vu Staff (van hanh kho vat ly), khac voi Librarian (nghiep vu luan chuyen).

## Chay nhanh

Trong services/inventory-service:

```bash
npm install
npm run dev
```

Hoac tu root bang Docker Compose:

```bash
docker compose up -d --build inventory-service
docker compose --profile dev run --rm inventory-db-push
```

## Bien moi truong quan trong

| Bien | Muc dich |
|---|---|
| PORT | Cong service (container mac dinh 3001) |
| DATABASE_URL | Chuoi ket noi den inventory_db |
| JWT_SECRET | Xac minh token |
| JSON_BODY_LIMIT | Gioi han payload |

## Tai lieu lien quan

- Root overview: README.md
- Docker runbook: docs/RUN_WITH_DOCKER.md
- Architecture: docs/PROJECT_OVERVIEW.md
