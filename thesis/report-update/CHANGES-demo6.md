# Bàn giao demo5 → demo6 (06/11/2026): thay sơ đồ bằng bản Diagram Design

## Sản phẩm

| Sản phẩm | Đường dẫn |
|---|---|
| DOCX | `NHD82_KLTN_2026_HeThongQuanLyKhoSachThongMinhTichHopAI_demo6.docx` (thư mục gốc repo) |
| PDF xuất bằng Microsoft Word (292 trang) | `thesis/report-update/NHD82_KLTN_2026_HeThongQuanLyKhoSachThongMinhTichHopAI_demo6.pdf` |
| Công cụ dựng lại | `thesis/report-update/tools/build6.py` (dùng `sbdoc.py`, `post.py`, `topdf.py`, `pages.py` có sẵn) |

demo5 không bị sửa. Chỉ thay ảnh, thêm nhãn con, chú thích và một đoạn dẫn cho hình mới; không đổi nội dung khác.

## Thay đổi

| Hình | Thay đổi |
|---|---|
| 4.1, 4.2, 5.1, 6.1 | Thay ảnh bằng bản Diagram Design |
| 4.5 | 3 phần: (a) kiểm tra mật khẩu, (b) gửi và nhập mã OTP, (c) cấp phiên |
| 4.6 | 3 phần: (a) đăng ký và gửi mã, (b) gửi lại mã, (c) xác minh mã |
| 4.16 (trước là 4.15) OCR nhiều ảnh | 2 phần |
| 4.18 (trước là 4.17) Đề xuất nhập hàng | 2 phần |
| 4.19 (trước là 4.18) Trợ lý AI | 3 phần |
| 4.23 (trước là 4.22) ERD auth_db | 2 phần: (a) tài khoản, vai trò, quyền, phạm vi kho; (b) token và mã OTP |
| **4.10 mới** – mục "Thanh toán phí phạt qua VNPay" | Thêm đoạn dẫn + sơ đồ tuần tự 2 phần |

Các hình nhiều phần giữ **một số hình và một chú thích**, mỗi phần có nhãn con "(a) …" in nghiêng căn giữa. Do thêm Hình 4.10, các hình 4.10–4.57 cũ dời thành 4.11–4.58; mọi tham chiếu "Hình x.y" trong văn bản được cập nhật tự động. Danh mục hình, danh mục bảng và mục lục được dựng lại với số trang lấy từ PDF do Word xuất (hai lượt, lượt kiểm tra 0 khác biệt trên 420 mục).

## Kiểm tra

- Validator OOXML của skill docx (`--original demo5`): PASSED.
- Xem trực quan các trang hình đổi (trang 127–129, 137–138) và danh mục hình.
- Nguồn hình, kiểm tra từng hình và bảng đối chiếu nội dung: `docs/diagrams/designed/README.md`.

## Lưu ý còn lại

- Hình 4.24 (trước là 4.23) "ERD auth_db – token và nhật ký" vẫn giữ nguyên; ba bảng token của nó cũng xuất hiện ở Hình 4.23(b). Có thể bỏ bớt nếu muốn tránh lặp (khi đó chỉ cần vẽ riêng `auth_audit_logs`).
- Các hình nhiều phần bị thu nhỏ còn khoảng 14 cm chiều rộng để vừa trang (giới hạn cao 21 cm của công cụ dựng).
