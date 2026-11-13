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
| Webhook VNPay | /webhooks/vnpay | `return` / `ipn` — xác minh chữ ký HMAC-SHA512; một merchant phục vụ cả trả phạt và nạp ví (phân biệt theo `vnp_TxnRef`) |
| Nội bộ (không qua Gateway) | /internal/customers, /internal/recommendation | Provision/resolve customer cho Auth; feed tương tác ẩn danh cho AI (`x-internal-service-key`) |

## Endpoint trọng yếu

| Method | Endpoint | Mục đích |
|---|---|---|
| GET | /borrow/loans | Danh sách phiếu mượn |
| POST | /borrow/loans/direct | Tạo mượn trực tiếp |
| POST | /borrow/loans/from-reservation/:id | Tạo loan từ reservation |
| POST | /borrow/loans/:id/return | Trả sách; quyết toán tiền cọc của từng cuốn (`settlement_reason` bắt buộc khi sách hư hỏng/mất và có cọc) |
| GET | /borrow/loans/:id/return-preview | Xem trước tiền phạt, tiền cọc khấu trừ/hoàn và số còn phải thu, không ghi gì |
| GET | /borrow/customers/:id/account | Ví khách: số dư khả dụng, đang giữ, cọc đang giữ, đối soát ledger |
| POST | /borrow/customers/:id/account/topups | Ghi nhận nạp tiền tại quầy (`Idempotency-Key` bắt buộc). Chỉ nhận 5 mức: 10.000, 20.000, 50.000, 100.000, 200.000 VND; mức khác trả 400 `INVALID_TOPUP_AMOUNT` |
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
| POST | /borrow/my/account/topups/vnpay/create | Bạn đọc tạo link VNPay nạp ví; `amount` chỉ nhận 5 mức 10.000, 20.000, 50.000, 100.000, 200.000 VND (cùng quy tắc với nạp tại quầy). Ví chỉ được cộng khi callback VNPay có chữ ký xác nhận |
| GET | /borrow/my/account/topups/vnpay/status/:txnRef | Trạng thái giao dịch nạp ví |
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
| VNPAY_TMN_CODE, VNPAY_HASH_SECRET, VNPAY_PAYMENT_URL, VNPAY_RETURN_URL | Trả phạt và nạp ví online qua VNPay; thiếu cấu hình thì endpoint VNPay trả 503. Sandbox: đăng ký merchant thử nghiệm tại https://pay.vnpaytest.vn/dev-registration (miễn phí, không cần hợp đồng; liên kết từ tài liệu https://sandbox.vnpayment.vn/apis/docs/thanh-toan-pay/pay.html). VNPay gửi mã TMN và hash secret về email đăng ký; thanh toán bằng thẻ test công bố tại https://sandbox.vnpayment.vn/apis/vnpay-demo/. IPN cần URL public (tunnel hoặc VPS); khi chạy cục bộ không có IPN, trang return vẫn ghi nhận giao dịch. Production chỉ đổi cấu hình (cần hợp đồng với VNPay). |
| DEFAULT_MEMBERSHIP_PLAN_CODE | Mã gói dự phòng khi chưa gói nào có `is_default = true` |
| DEFAULT_FINE_PER_DAY, LOST_ITEM_BASE_FEE, DAMAGED_ITEM_FEE, BORROW_FEE_PER_ITEM | Mức phí mặc định |
| `*_INTERVAL_MS`, `*_BATCH_SIZE` | Chu kỳ/kích thước lô của từng job nền |

## Chạy nhanh local

```bash
cd services/borrow-service
npm install
npm run dev
```

## Thanh toán VNPay khi chưa có sandbox: trình giả lập

`scripts/vnpay-simulator.mjs` đứng thay **trang thanh toán** của VNPay để chạy trọn luồng trên máy:
1. Kiểm `vnp_SecureHash` của link thanh toán theo quy tắc VNPay (HMAC-SHA512).
2. Khi bấm "Thanh toán" hoặc "Hủy", ký kết quả theo cùng quy tắc, gọi IPN, rồi chuyển trình duyệt về return URL.

Toàn bộ code thanh toán của SmartBook chạy y như với VNPay thật. Trang giả lập ghi rõ là thử nghiệm và **không phải cổng VNPay, không trừ tiền thật**.

1. Trong `.env`, đặt `VNPAY_TMN_CODE` và `VNPAY_HASH_SECRET` là một cặp giá trị bất kỳ (trình giả lập và borrow-service cùng đọc từ đây), và `VNPAY_PAYMENT_URL=http://localhost:8099/paymentv2/vpcpay.html`. Giữ `VNPAY_RETURN_URL=http://localhost:3000/webhooks/vnpay/return`.
2. Áp cấu hình: `docker compose up -d borrow-service`.
3. Chạy trình giả lập: `pnpm vnpay:simulator`.
4. Kiểm thử tự động: từ `apps/web`, chạy `VNPAY_SIMULATOR=1 npx playwright test e2e/vnpay-payment.spec.ts`. Spec dùng bạn đọc demo `customer01` và cộng tiền vào ví của tài khoản này.

**Chuyển sang VNPay sandbox thật:** thay 4 biến `VNPAY_*` bằng mã TMN và hash secret sandbox, và `VNPAY_PAYMENT_URL=https://sandbox.vnpayment.vn/paymentv2/vpcpay.html`, rồi `docker compose up -d borrow-service`. Không phải sửa code.

## Tài liệu liên quan

- Tiền cọc theo từng cuốn và quyết toán khi trả sách: ./BOOK_DEPOSIT.md
- README root (mục Borrow, Customer Portal, VNPay, "Báo khi có sách"): ../../README.md
- Docker runbook: ../RUN_WITH_DOCKER.md
- Kiến trúc tổng quan: ../ARCHITECTURE/PROJECT_OVERVIEW.md
