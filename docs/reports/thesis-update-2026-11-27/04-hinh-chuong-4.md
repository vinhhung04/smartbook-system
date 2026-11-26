# Hình bổ sung cho Chương 4 (mục Thiết kế giao diện)

Chụp ngày 27/11/2026 bằng Playwright (Chrome, 1440×900, tỷ lệ điểm ảnh 2, giao diện sáng, tiếng Việt) trên Vite dev `:5174` nối với stack Docker cục bộ, mã nguồn nhánh hungg sau commit b81a75f. Chỉ đọc: mọi yêu cầu ghi tới gateway bị chặn trong lúc chụp, trừ đăng nhập và `POST /ai/reading-stats` (endpoint chỉ tính toán, không ghi). Ảnh nằm trong thư mục `hinh/`.

| Tệp | Đặt ở | Chú thích đề xuất | Tài khoản |
|---|---|---|---|
| `4-28-dashboard-quan-ly.png` | thay ảnh Hình 4.28 | Hình 4.28 Bảng điều khiển tổng quan: việc cần xử lý theo mức khẩn cấp, tình hình thư viện, khối AI dự báo rủi ro và hoạt động trực tiếp; lọc theo kho ở góc trên | hung (ADMIN) |
| `4-x-bao-cao-thong-ke.png` | mục Giao diện kho vận và mua hàng (hoặc Giao diện các chức năng AI) | Hình 4.x Trang báo cáo và thống kê theo kỳ, có bộ lọc theo kho | hung |
| `4-x-giam-sat-trung-tam-su-co.png` | mục Giao diện quản trị, cạnh Hình 4.38 | Hình 4.x Trang giám sát hệ thống: trạng thái chung, hoạt động cảnh báo gần đây, các thẻ Sự cố, Cài đặt thông báo, Thống kê | hung |
| `4-x-chi-tiet-su-co.png` | mục Giao diện quản trị | Hình 4.x Chi tiết sự cố: mô tả, dòng thời gian, tiếp nhận, đánh dấu đã xử lý và lịch sử gửi thông báo | hung |
| `4-x-tro-ly-can-bang-ton-a-hoi-dap.png` | mục Giao diện các chức năng AI | Hình 4.x(a) Trợ lý AI: hỏi tồn kho của một cuốn sách và phương án bổ sung cho kho TP.HCM | rebalance.manager |
| `4-x-tro-ly-can-bang-ton-b-so-sanh-phuong-an.png` | như trên | Hình 4.x(b) Thẻ so sánh phương án: chỉ mua mới, kết hợp điều chuyển và mua mới, nhãn "tốt nhất về nghiệp vụ" và "bạn tự thực hiện được", quy tắc xếp hạng | rebalance.manager |
| `4-x-tro-ly-can-bang-ton-c-ngan-sach-kich-ban.png` | như trên | Hình 4.x(c) Thẻ phân bổ ngân sách mua mới và so sánh kịch bản trước và sau khi giảm ngân sách 20% | rebalance.manager |
| `4-x-tro-ly-can-bang-ton-d-ban-nhap.png` | như trên | Hình 4.x(d) Bản nháp điều chuyển và mua mới đã được người dùng xác nhận và thực hiện | rebalance.manager |
| `4-x-thong-ke-doc-sach.png` | mục Website công khai và cổng bạn đọc | Hình 4.x Thống kê đọc sách của bạn đọc: số sách đã mượn, sách mượn theo tháng, thành tựu, tác giả và thể loại hay đọc | customer01 |
| `4-x-cong-nha-cung-cap.png` | mục Giao diện kho vận và mua hàng | Hình 4.x Cổng nhà cung cấp: danh sách đơn, phản hồi đơn, lập phiếu giao, báo thiếu, các đợt giao và chứng từ | supplier-ibd |

Hội thoại cân bằng tồn là lượt chạy demo thật lúc 00:22 ngày 27/11/2026 (phiên bản có phạm vi một cuốn sách), mở lại từ lịch sử nên ảnh bìa ở câu hỏi đầu không hiển thị. Các khung cuộn khác của hội thoại không được giữ lại.

## Cần bạn xem trước khi chèn

- Bốn ảnh của tài khoản ADMIN hiện tên và email cá nhân ở góc dưới thanh bên trái. Nếu không muốn đưa email vào báo cáo, cắt bỏ phần đó hoặc chụp lại bằng tài khoản thử nghiệm.
- Trang giám sát hiện dòng "Chưa có số liệu tài nguyên: Prometheus không phản hồi" vì trên máy dev Prometheus và Grafana (profile monitoring) không chạy. Nếu cần khối tài nguyên có số liệu, phải bật profile monitoring rồi chụp lại.
- Trang báo cáo có cảnh báo "Chỉ tải được 2.000 phiếu mượn mới nhất", cột lượt mượn ngày 26/11 cao bất thường (292) và biểu đồ luồng kho có một cột xuất 499 cuốn: đây là dữ liệu dev đã dịch lịch sử mượn mô phỏng ngày 26/11, không phải lỗi giao diện; nếu dùng ảnh này nên ghi "dữ liệu mô phỏng".
- Trang thống kê đọc sách ghi "0.5 ngày" (dấu chấm thập phân), khác chỗ khác trong ứng dụng dùng dấu phẩy. Đây là lỗi định dạng nhỏ của ứng dụng, chưa sửa.
- Chưa chụp chế độ tối, màn hình điện thoại hay dashboard Grafana.
