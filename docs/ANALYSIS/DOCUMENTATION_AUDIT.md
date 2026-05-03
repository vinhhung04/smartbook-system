# Documentation Audit - SmartBook System

## Mục tiêu

Chuẩn hóa tài liệu theo nguyên tắc root gọn, docs chuyên sâu theo domain, giảm trùng lặp README con.

## Trạng thái triển khai

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| Viết lại README root | ✅ Hoàn thành | Bổ sung kiến trúc, role matrix, service catalog, deployment flow, Mermaid |
| Dọn README frontend | ✅ Hoàn thành | Đã loại phần boilerplate mặc định Vite |
| Gộp tài liệu Inventory | ✅ Hoàn thành | Nội dung chuyển sang docs/SERVICES/INVENTORY_SERVICE.md |
| Chuẩn hóa AI README | ✅ Hoàn thành | README service tối giản, domain detail tại docs/SERVICES/AI_SERVICE.md |
| Bổ sung docs domain Auth/Borrow/Analytics | ✅ Hoàn thành | Đã tạo 3 tài liệu mới trong docs/SERVICES |
| Gom test guide vào thư mục riêng | ✅ Hoàn thành | Đã chuyển sang docs/TEST_GUIDES |

## Phân loại README hiện tại

| File | Vai trò | Hành động |
|---|---|---|
| README.md | Cổng vào chính cho contributor | Giữ làm nguồn định hướng duy nhất |
| apps/web/README.md | Setup frontend chuyên biệt | Giữ, chỉ chứa nội dung SmartBook |
| services/ai-service/README.md | Quick entry cho AI service | Giữ ở mức tối giản và điều hướng |

## Danh sách gộp/xóa đã thực hiện

| File cũ | Hành động | Điểm đến |
|---|---|---|
| services/inventory-service/README.md | Đã xóa | docs/SERVICES/INVENTORY_SERVICE.md |
| Nội dung AI service trùng lặp | Đã gộp | docs/SERVICES/AI_SERVICE.md |
| Boilerplate Vite trong apps/web/README.md | Đã xóa | Không giữ |

## Cấu trúc tài liệu mục tiêu

```text
smartbook-system/
|- README.md
|- docs/
|  |- PROJECT_OVERVIEW.md
|  |- RUN_WITH_DOCKER.md
|  |- DOCUMENTATION_AUDIT.md
|  |- SERVICES/
|  |  |- AUTH_SERVICE.md
|  |  |- INVENTORY_SERVICE.md
|  |  |- BORROW_SERVICE.md
|  |  |- AI_SERVICE.md
|  |  \- ANALYTICS_SERVICE.md
|  \- TEST_GUIDES/
|     |- CUSTOMER_PORTAL_PHASE1_TEST_GUIDE.md
|     |- CUSTOMER_PORTAL_PHASE34_TEST_GUIDE.md
|     \- BORROW_PHASE1_HARDEN_TEST_GUIDE.md
|- apps/
|  \- web/README.md
\- services/
   \- ai-service/README.md
```

## Quy tắc quản trị tài liệu

- Root README chỉ chứa thông tin tổng quan, kiến trúc, hướng chạy nhanh.
- docs/SERVICES chứa chi tiết kỹ thuật theo domain service.
- README service chỉ giữ quickstart + endpoint cốt lõi + env đặc thù.
- Mọi hướng dẫn test theo phase đặt trong docs/TEST_GUIDES.
