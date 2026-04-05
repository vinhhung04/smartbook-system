# Auth Service

## Mục tiêu

Auth Service chịu trách nhiệm định danh, xác thực và phân quyền cho toàn hệ thống SmartBook.

- Runtime: Node.js + Express + Prisma
- Cổng nội bộ: 3002 (publish ra host 3004 qua Docker Compose)
- Cơ sở dữ liệu: auth_db
- Vai trò chính: phát hành JWT, quản trị IAM, kiểm soát RBAC/PBAC

## Nhóm API chính

| Nhóm API | Route base | Mô tả |
|---|---|---|
| Authentication | /auth | Đăng ký, đăng nhập, đăng xuất, hồ sơ người dùng |
| Identity and Access | /iam | Quản lý user, role, permission |

## Endpoint quan trọng

| Method | Endpoint | Mục đích |
|---|---|---|
| POST | /auth/register | Tạo tài khoản mới |
| POST | /auth/login | Đăng nhập, nhận token |
| POST | /auth/logout | Thu hồi phiên hiện tại |
| GET | /auth/me | Lấy hồ sơ user đăng nhập |
| PATCH | /auth/me | Cập nhật thông tin cá nhân |
| POST | /auth/change-password | Đổi mật khẩu |
| GET | /iam/users | Danh sách người dùng |
| POST | /iam/users | Tạo người dùng nội bộ |
| GET | /iam/roles | Danh sách vai trò |
| POST | /iam/roles | Tạo vai trò |
| PUT | /iam/roles/:id/permissions | Gán quyền cho vai trò |

## Biến môi trường đặc thù

| Biến | Ý nghĩa |
|---|---|
| PORT | Cổng service, mặc định 3002 |
| DATABASE_URL | Kết nối auth_db |
| JWT_SECRET | Khóa ký token JWT |

## Chạy nhanh local

```bash
cd services/auth-service
npm install
npm run dev
```

## Tài liệu liên quan

- README root: ../../README.md
- Docker runbook: ../RUN_WITH_DOCKER.md
- Kiến trúc tổng quan: ../PROJECT_OVERVIEW.md
