# Auth Service

## Mục tiêu

Auth Service chịu trách nhiệm định danh, xác thực và phân quyền cho toàn hệ thống SmartBook.

- Runtime: Node.js + Express + Prisma
- Entrypoint: services/auth-service/src/index.js
- Cổng: 3002 (chỉ trong mạng Docker nội bộ, không publish ra host — đi qua API Gateway `:3000`)
- Cơ sở dữ liệu: auth_db (+ Redis cache)
- Vai trò chính: phát hành JWT, quản trị IAM, kiểm soát RBAC/PBAC, warehouse scope theo user

## Nhóm API chính

| Nhóm API | Route base | Mô tả |
|---|---|---|
| Authentication | /auth | Đăng ký, đăng nhập, đăng xuất, hồ sơ, mật khẩu, xác minh email |
| Identity and Access | /iam | Quản lý user, role, permission |

## Endpoint

| Method | Endpoint | Mục đích |
|---|---|---|
| POST | /auth/register | Tạo tài khoản mới |
| POST | /auth/login | Đăng nhập, nhận token |
| POST | /auth/logout | Thu hồi phiên hiện tại |
| GET | /auth/me | Lấy hồ sơ user đăng nhập (kèm roles/permissions) |
| PATCH | /auth/me | Cập nhật thông tin cá nhân |
| GET | /auth/warehouse-staff | Danh sách nhân viên kho (để giao việc) |
| POST | /auth/change-password | Đổi mật khẩu |
| POST | /auth/password-reset/request | Gửi email đặt lại mật khẩu |
| POST | /auth/password-reset/confirm | Đặt lại mật khẩu bằng token |
| POST | /auth/verify-email | Xác minh email |
| POST | /auth/resend-verification | Gửi lại email xác minh |
| GET | /iam/users | Danh sách người dùng |
| POST | /iam/users | Tạo người dùng nội bộ |
| PATCH | /iam/users/:id | Cập nhật user (role, trạng thái khoá...) |
| GET | /iam/roles | Danh sách vai trò |
| POST | /iam/roles | Tạo vai trò |
| PUT | /iam/roles/:id/permissions | Gán quyền cho vai trò |
| GET | /iam/permissions | Danh sách permission |

## Biến môi trường đặc thù

| Biến | Ý nghĩa |
|---|---|
| PORT | Cổng service, mặc định 3002 |
| DATABASE_URL | Kết nối auth_db |
| REDIS_URL | Redis cache |
| JWT_SECRET, JWT_EXPIRES_IN | Khóa ký và thời hạn token JWT |
| INTERNAL_SERVICE_KEY | Khóa gọi nội bộ giữa service |
| BORROW_SERVICE_INTERNAL_URL / BORROW_SERVICE_URL | Khi đăng ký tài khoản khách, gọi `POST /internal/customers/provision` của Borrow Service để tạo hồ sơ bạn đọc (mặc định `http://borrow-service:3005`) |
| ALLOWED_ORIGINS | CORS |
| FRONTEND_URL | URL web dùng trong link email (đặt lại mật khẩu, xác minh) |
| SMTP_HOST/PORT/USER/PASS/FROM | Gửi email |
| AUTH_LOGIN_RATE_LIMIT_MAX, MAX_FAILED_LOGIN_ATTEMPTS | Giới hạn đăng nhập / khoá tài khoản khi sai nhiều lần |

## Chạy nhanh local

```bash
cd services/auth-service
npm install
npm run dev
```

## Tài liệu liên quan

- README root: ../../README.md
- Docker runbook: ../RUN_WITH_DOCKER.md
- Kiến trúc tổng quan: ../ARCHITECTURE/PROJECT_OVERVIEW.md
