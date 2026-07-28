# Prisma Migrations

## Tổng quan

`auth-service`, `borrow-service`, `inventory-service` dùng Prisma migrations có version (`prisma/migrations/`) thay vì `prisma db push`. `analytics-service` không dùng Prisma (chỉ đọc `inventory_db`/`borrow_db` qua `pg` Pool trực tiếp) nên không cần migration.

Mỗi service có đúng 1 migration `init` gộp toàn bộ schema hiện tại (baseline), vì trước đây các service này được đồng bộ bằng `db push` — không có lịch sử migration gia tăng đáng tin cậy để giữ lại.

## Khi thay đổi schema

Trong từng service (`services/<tên-service>`):

```bash
npx prisma migrate dev --name <mo-ta-thay-doi>
```

Lệnh này tạo migration mới trong `prisma/migrations/`, áp dụng lên DB dev local, và cần được commit vào git cùng với thay đổi ở `schema.prisma`.

Không sửa tay SQL trong `db-init/` hay `data/*.sql` cho thay đổi schema — hai thư mục đó chỉ dùng cho việc tạo database/extension ban đầu và seed data mẫu.

## Khi chạy container (docker-compose)

`docker-compose.yml` chạy `npx prisma migrate deploy` khi container khởi động — lệnh này an toàn để chạy lại nhiều lần (chỉ áp dụng migration chưa chạy), phù hợp cho cả máy dev mới (DB rỗng) lẫn máy đã có dữ liệu.

## Baseline một DB đã có dữ liệu (trường hợp hiếm)

Nếu sau này cần baseline lại (vd. gộp migration mới), thực hiện trên từng service:

```bash
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/<timestamp>_init/migration.sql
npx prisma migrate resolve --applied <timestamp>_init
```

`migrate resolve --applied` chỉ đánh dấu migration là đã chạy trong bảng `_prisma_migrations`, không thực thi lại SQL — an toàn cho DB đã có dữ liệu.

**Lưu ý:** không dùng `2>&1` khi redirect output của `prisma migrate diff` ra file — banner cảnh báo update version của Prisma có thể lẫn vào cuối file `migration.sql` và làm hỏng SQL.
