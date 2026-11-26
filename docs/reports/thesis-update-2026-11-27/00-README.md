# Cập nhật báo cáo demo26 – ngày 27/11/2026

Đối chiếu báo cáo `NHD82_KLTN_2026_..._demo26.docx` với mã nguồn nhánh hungg (sau commit b81a75f) và đưa các sửa đổi vào file Word mới `..._demo27.docx` (cạnh file gốc trong thư mục Downloads). File Word là bản chính; các tệp trong thư mục này là tư liệu nguồn.

| Tệp | Nội dung |
|---|---|
| `01-danh-gia-can-bang-ton.md` | Bản nháp mục 7.6.10 (số liệu đợt 20/11). Bản trong Word đã cập nhật bằng lượt chạy thật ngày 27/11 |
| `02-doan-sua-loi.md` | Các đoạn sửa lỗi đã đưa vào Word |
| `03-phu-luc-b-va-so-endpoint.md` | Số endpoint và 42 dòng bổ sung Phụ lục B (kèm mô tả) |
| `04-hinh-chuong-4.md` + `hinh/` | Ảnh màn hình bổ sung Chương 4 |
| `../BUDGET_ALLOCATION_TABLES_FIGURES.md` | Bảng và hình đánh giá phân bổ ngân sách ngày 26/11 |

## Đã đưa vào file Word

- Chương 1: bỏ vế so sánh phân bổ ngân sách phiên bản cũ với phiên bản mới.
- Chương 3: UC19 trả sách (phí hư hỏng cố định, chọn kệ cất lại, xem trước phí, 2 luồng ngoại lệ mới); ghi chú sơ đồ tuần tự trả sách; đổi tên nhóm use case bổ sung; đánh số lại FR-41…FR-57 thành FR-40…FR-56 ở mọi nơi.
- Chương 4: thay ảnh Hình 4.28; thêm 9 hình (báo cáo có lọc kho, cổng nhà cung cấp, thống kê đọc sách, 3 thẻ cân bằng tồn của trợ lý, trang giám sát, chi tiết sự cố, Grafana) kèm đoạn mô tả. Ảnh của tài khoản quản trị đã ẩn email.
- Chương 4–6: thay mã commit bằng ngày; số endpoint đếm lại (251/78/25/21/17/37).
- Chương 7: bảng ký hiệu phiên bản P1–P5 thay cho mã commit; bảng chạy lại 14 kịch bản tích hợp; mục mới 7.6.10 Cân bằng tồn giữa các kho (lượt chạy 7 bước với mô hình thật ngày 27/11 đạt); mục phân bổ ngân sách thay bằng 4 bảng và 2 hình (SmartBook so với 8 cách chi thực tế, bỏ so sánh bản cũ); FR-44; hạn chế; kết luận chương (41 trong 56).
- Chương 8: kết quả kiểm chứng, hạn chế cân bằng tồn, hướng cập nhật kịch bản kiểm thử.
- Phụ lục B: 42 endpoint bổ sung.
- Đánh số lại bảng, hình Chương 4 và 7; dựng lại danh mục bảng, danh mục hình (đầy đủ mọi chú thích, số trang do Word tính); cập nhật mục lục.

## Đã chạy để có số liệu (27/11/2026)

- Kịch bản cân bằng tồn 7 bước với mô hình thật qua giao diện: đạt (1,2 phút); dữ liệu demo đã seed lại sau khi chạy.
- RabbitMQ smoke: đạt. Phân quyền giao diện: 85/86 (kiểm tra còn lại là kiểm tra cấu trúc mã đã lỗi thời).
- Trợ lý AI: dừng ở kiểm tra tên công cụ đã lỗi thời. Tìm bằng ảnh bìa (tài khoản quản trị): tạo chỉ mục và tìm đúng sách đạt; ca ảnh trống nay bị chặn sớm hơn.
- Số liệu đánh giá AI của Chương 7 đã đối chiếu với tệp nguồn: biểu đồ 60/61 và 1.002/1.002; Semantic Planner 0,855 → 0,957, 0,810; Copilot 13–17/44; gợi ý V2 NDCG@10 0,428 so với 0,352.
- Ảnh image AI Service được build lại từ mã hiện tại (bản cũ giữ tag `smartbook-system-ai-service:pre-thesis-run-2026-11-27`).

## Chưa làm, cần bạn quyết định

- Kiểm thử tải k6 và bộ giao diện 20 ca của đợt 05/10 chưa chạy lại (CI 26/11 đã chạy bộ đầu – cuối 110 ca: 93 đạt, 17 bỏ qua).
- Hai kịch bản `scripts/ai-assistant-integration.mjs` và `scripts/cover-search-integration.mjs` cần cập nhật theo bộ công cụ và quy tắc ảnh mới; một kiểm tra trong `scripts/frontend-rbac-smoke.mjs` đã lỗi thời. Chưa sửa vì nằm ngoài phạm vi báo cáo.
- Chưa có ảnh chế độ tối và ảnh điện thoại (báo cáo dùng giao diện sáng nên không bổ sung).
- Mã bookmark 420 bị trùng từ file gốc (Word vẫn mở bình thường).
