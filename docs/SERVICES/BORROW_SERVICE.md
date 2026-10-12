# Borrow Service

## Mục tiêu

Borrow Service quản lý toàn bộ nghiệp vụ lưu thông và cổng tự phục vụ cho bạn đọc.

- Runtime: Node.js + Express + Prisma
- Entrypoint: services/borrow-service/src/index.js
- Cổng: 3005 (chỉ trong mạng Docker nội bộ, không publish ra host — đi qua API Gateway `:3000`)
- Cơ sở dữ liệu: borrow_db
- Vai trò chính: mượn/trả, đặt chỗ, gia hạn, phí phạt (kể cả thanh toán VNPay), membership, thông báo, wishlist/review, "Báo khi có sách"

## Nhóm API chính

| Nhóm API | Route base | Mô tả |
|---|---|---|
| Hồ sơ bạn đọc | /borrow/customers | Hồ sơ, membership, quản trị khách hàng |
| Cổng tự phục vụ | /borrow/my (gateway còn map `/my` → `/borrow/my`) | Reservation, loan, account/ledger, fine + VNPay, notification, preference, review, wishlist, availability alert |
| Đặt chỗ | /borrow/reservations | Tạo/xác nhận/hủy reservation, convert sang loan bằng pickup code |
| Mượn trả | /borrow/loans | Mượn trực tiếp, mượn từ reservation, trả sách, duyệt gia hạn |
| Phí phạt | /borrow/fines | Liệt kê phí, ghi nhận thanh toán, miễn giảm |
| Đánh giá | /borrow/reviews | Đánh giá sách và thống kê rating (staff) |
| Nhật ký | /borrow/audit-logs | Audit nghiệp vụ lưu thông |
| Membership plan | /borrow/membership-plans | Quản lý gói thành viên |
| Notification admin | /borrow/notifications | Gửi thông báo tập trung |
| Công khai (không cần đăng nhập) | /public/reviews, /public/membership | Review `VISIBLE` theo sách, danh sách gói thẻ |
| Webhook VNPay | /webhooks/vnpay | `return` / `ipn` — xác minh chữ ký HMAC-SHA512 |
| Nội bộ (không qua Gateway) | /internal/customers, /internal/recommendation | Provision/resolve customer cho Auth; feed tương tác ẩn danh cho AI (`x-internal-service-key`) |

## Endpoint trọng yếu

| Method | Endpoint | Mục đích |
|---|---|---|
| GET | /borrow/loans | Danh sách phiếu mượn |
| POST | /borrow/loans/direct | Tạo mượn trực tiếp |
| POST | /borrow/loans/from-reservation/:id | Tạo loan từ reservation |
| POST | /borrow/loans/:id/return | Trả sách |
| GET | /borrow/loans/renewal-requests | Hàng chờ yêu cầu gia hạn |
| POST | /borrow/loans/:id/renewals/review | Duyệt/từ chối gia hạn |
| GET | /borrow/reservations | Danh sách giữ chỗ |
| POST | /borrow/reservations | Tạo giữ chỗ |
| PATCH | /borrow/reservations/:id/confirm | Staff xác nhận reservation |
| POST | /borrow/reservations/pickup/convert-to-loan | Convert reservation `READY_FOR_PICKUP` bằng pickup code/QR |
| POST | /borrow/fines/:id/payments | Ghi nhận thanh toán phí tại quầy |
| PATCH | /borrow/fines/:id/waive | Miễn/giảm phí |
| POST | /borrow/customers/:id/membership/renew | Đổi/gia hạn gói thẻ (tại quầy) |
| POST/PATCH | /borrow/membership-plans, /borrow/membership-plans/:id | Tạo/sửa gói thẻ (số và cờ boolean được kiểm tra chặt, sai trả 400) |
| GET | /borrow/my/loans | Bạn đọc xem lịch sử mượn |
| POST | /borrow/my/loans/:id/renew-request | Bạn đọc gửi yêu cầu gia hạn |
| POST | /borrow/my/fines/payments/vnpay/create | Bạn đọc tạo payment intent VNPay để trả phạt |
| GET | /borrow/my/fines/payments/vnpay/status/:txnRef | Trạng thái giao dịch VNPay |
| GET | /borrow/my/notifications, /borrow/my/notifications/unread-count | Trung tâm thông báo |
| PATCH | /borrow/my/notifications/:id/read, /borrow/my/notifications/read-all | Đánh dấu đã đọc |
| POST/DELETE | /borrow/my/availability-alerts, /borrow/my/availability-alerts/:bookId | Đăng ký/huỷ "Báo khi có sách" |
| POST | /borrow/my/reviews | Viết review (chỉ khi đã mượn và trả sách) |

## Job nền và consumer

| Thành phần | Bật/tắt | Mô tả |
|---|---|---|
| Reservation expiry | `ENABLE_RESERVATION_EXPIRY_JOB` | Hết hạn reservation và nhả tồn kho |
| Reservation reconciliation | `ENABLE_RESERVATION_RECONCILIATION_JOB` | Retry hành động bù trừ (saga) như nhả reservation |
| Overdue sweep | `ENABLE_OVERDUE_SWEEP_JOB` | Đánh dấu quá hạn, sinh fine |
| Due-soon reminder | `ENABLE_DUE_SOON_REMINDER_JOB` | Nhắc sắp đến hạn trả |
| Availability alert consumer | `ENABLE_AVAILABILITY_ALERT_CONSUMER` | Consume `inventory.stock.changed` / `inventory.reservation.released` từ RabbitMQ để gửi thông báo "có sách" |

## Biến môi trường đặc thù

| Biến | Ý nghĩa |
|---|---|
| PORT | Cổng service, mặc định 3005 |
| DATABASE_URL | Kết nối borrow_db |
| INVENTORY_SERVICE_URL | URL nội bộ Inventory (giữ/nhả/tiêu tồn, kiểm tra tồn công khai) |
| ANALYTICS_SERVICE_URL | URL nội bộ Analytics (rủi ro trả trễ cho job nhắc hạn) |
| JWT_SECRET | Xác thực JWT |
| GATEWAY_URL | URL gateway để đẩy sự kiện realtime (`/internal/push-event`) |
| INTERNAL_SERVICE_KEY | Khóa gọi nội bộ giữa service |
| RABBITMQ_URL | Event bus (consumer "Báo khi có sách") |
| FRONTEND_URL | URL web dùng trong email/redirect |
| SMTP_HOST/PORT/USER/PASS/FROM | Cấu hình gửi email thông báo |
| VNPAY_TMN_CODE, VNPAY_HASH_SECRET, VNPAY_PAYMENT_URL, VNPAY_RETURN_URL | Thanh toán phạt online qua VNPay; thiếu cấu hình thì endpoint VNPay trả 503 |
| DEFAULT_MEMBERSHIP_PLAN_CODE | Mã gói dự phòng khi chưa gói nào có `is_default = true` |
| DEFAULT_FINE_PER_DAY, LOST_ITEM_BASE_FEE, DAMAGED_ITEM_FEE, BORROW_FEE_PER_ITEM | Mức phí mặc định |
| `*_INTERVAL_MS`, `*_BATCH_SIZE` | Chu kỳ/kích thước lô của từng job nền |

## Chạy nhanh local

```bash
cd services/borrow-service
npm install
npm run dev
```

## Tài liệu liên quan

- README root (mục Borrow, Customer Portal, VNPay, "Báo khi có sách"): ../../README.md
- Docker runbook: ../RUN_WITH_DOCKER.md
- Kiến trúc tổng quan: ../ARCHITECTURE/PROJECT_OVERVIEW.md
