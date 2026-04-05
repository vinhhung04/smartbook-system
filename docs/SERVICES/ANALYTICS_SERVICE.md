# Analytics Service

## Mục tiêu

Analytics Service là domain tổng hợp báo cáo vận hành và cung cấp góc nhìn quản trị cho Manager/Admin.

- Trạng thái: Service chính ở mức kiến trúc, module thực thi đang được chuẩn hóa
- Thư mục hiện có: services/analytics-service
- Vai trò nghiệp vụ: tổng hợp KPI mượn trả, tồn kho, luồng xử lý, cảnh báo vận hành

## Phạm vi chức năng định hướng

| Nhóm chức năng | Mô tả |
|---|---|
| KPI vận hành | Tổng hợp mượn/trả, tỷ lệ quá hạn, vòng quay đầu sách |
| KPI kho | Tồn theo kho/vị trí, chênh lệch kiểm kê, tốc độ luân chuyển |
| Supplier analytics | Hiệu quả nhà cung cấp, lead time, tỷ lệ sai lệch nhập hàng |
| Dashboard quản trị | Dữ liệu tổng hợp cho Manager/Admin |

## Trạng thái tích hợp

- Chưa được khai báo trong docker-compose stack chính tại thời điểm hiện tại.
- Được xác định là service chính trong roadmap và tài liệu kiến trúc.
- Khuyến nghị triển khai theo chuẩn API-first để đồng bộ cùng Gateway.

## Tài liệu liên quan

- README root: ../../README.md
- Kiến trúc tổng quan: ../PROJECT_OVERVIEW.md
- Kế hoạch dọn tài liệu: ../DOCUMENTATION_AUDIT.md
