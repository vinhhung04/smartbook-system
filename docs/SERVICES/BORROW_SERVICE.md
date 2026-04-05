# Borrow Service

## Mục tiêu

Borrow Service quản lý toàn bộ nghiệp vụ lưu thông và cổng tự phục vụ cho bạn đọc.

- Runtime: Node.js + Express + Prisma
- Cổng nội bộ/host: 3005
- Cơ sở dữ liệu: borrow_db
- Vai trò chính: mượn/trả, đặt chỗ, gia hạn, phí phạt, thông báo

## Nhóm API chính

| Nhóm API | Route base | Mô tả |
|---|---|---|
| Hồ sơ bạn đọc | /borrow/customers | Hồ sơ, membership, quản trị khách hàng |
| Cổng tự phục vụ | /borrow/my | Reservation, loans, account, fines, notifications |
| Đặt chỗ | /borrow/reservations | Tạo/hủy/chuyển đổi reservation |
| Mượn trả | /borrow/loans | Tạo phiếu mượn, trả sách, duyệt gia hạn |
| Phí phạt | /borrow/fines | Liệt kê phí, thanh toán, miễn giảm |
| Đánh giá | /borrow/reviews | Đánh giá sách và thống kê rating |
| Nhật ký | /borrow/audit-logs | Audit nghiệp vụ lưu thông |
| Membership plan | /borrow/membership-plans | Quản lý gói thành viên |
| Notification admin | /borrow/notifications | Gửi thông báo tập trung |

## Endpoint trọng yếu

| Method | Endpoint | Mục đích |
|---|---|---|
| GET | /borrow/loans | Danh sách phiếu mượn |
| POST | /borrow/loans/direct | Tạo mượn trực tiếp |
| POST | /borrow/loans/:id/return | Trả sách |
| GET | /borrow/reservations | Danh sách giữ chỗ |
| POST | /borrow/reservations | Tạo giữ chỗ |
| POST | /borrow/fines/:id/payments | Ghi nhận thanh toán phí |
| GET | /borrow/my/loans | Bạn đọc xem lịch sử mượn |
| POST | /borrow/my/fines/payments | Bạn đọc tự thanh toán phí |

## Biến môi trường đặc thù

| Biến | Ý nghĩa |
|---|---|
| PORT | Cổng service, mặc định 3005 |
| DATABASE_URL | Kết nối borrow_db |
| INVENTORY_SERVICE_URL | URL nội bộ để kiểm tra tồn |
| JWT_SECRET | Xác thực JWT |
| GATEWAY_URL | URL gateway cho callback nội bộ |
| INTERNAL_SERVICE_KEY | Khóa gọi nội bộ giữa service |
| SMTP_HOST/PORT/USER/PASS/FROM | Cấu hình gửi email thông báo |

## Chạy nhanh local

```bash
cd services/borrow-service
npm install
npm run dev
```

## Tài liệu liên quan

- README root: ../../README.md
- Docker runbook: ../RUN_WITH_DOCKER.md
- Kiến trúc tổng quan: ../PROJECT_OVERVIEW.md
