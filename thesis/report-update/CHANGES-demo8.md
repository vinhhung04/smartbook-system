# Thay đổi demo7 → demo8 (06/11/2026)

Yêu cầu: sơ đồ tuần tự vẽ trắng đen như các hình tuần tự PlantUML của demo6.

- Tệp: `NHD82_KLTN_2026_HeThongQuanLyKhoSachThongMinhTichHopAI_demo8.docx` (gốc repo), PDF `thesis/report-update/…_demo8.pdf` (310 trang).
- Dựng lại: `python thesis/report-update/tools/build8.py <demo7.docx> <demo8.docx> thesis/report-update/pages8.json`.

## Thay đổi

`scripts/diagrams/diagram-design/seqauto.py` có thêm skin `mono` và dùng nó làm mặc định (`SEQ_SKIN=color` cho lại bản màu). Skin này mô phỏng hình PlantUML của demo6:

- Chữ Times New Roman; nét và chữ đen, số bước in đậm; mã kỹ thuật vẫn dùng Consolas.
- Tác nhân vẽ hình người, CSDL/broker vẽ hình trụ, các service là hộp trắng viền xám.
- Lời gọi nét liền, phản hồi nét đứt.
- Khung `alt`/`opt`/`loop`/`break` nền xám nhạt, thẻ chữ thường đậm, điều kiện trong `[ ]` in đậm.
- Bỏ thanh kích hoạt và bỏ chú giải màu.

Áp dụng cho **toàn bộ 20 hình tuần tự (34 ảnh)**: 2.2, 2.4, 4.5–4.22. Chú thích, nhãn (a)/(b)/(c), số hình và nội dung từng thông điệp giữ nguyên. Các loại sơ đồ khác (use case, hoạt động, ERD, kiến trúc) giữ như demo7.

## Kiểm tra đã chạy

- 34/34 tệp HTML tuần tự: `self_check.py --offline`, `verify-geometry.py`, `check-text-fit.py`, xuất SVG và PNG đều đạt.
- `validate.py` (skill docx) so với demo7: đạt, số đoạn không đổi (7318).
- Mục lục và danh mục hình: 420 mục, 0 mục lệch số trang so với PDF cuối.
- Đã xem PNG của 2.2, 2.4, 4.5(b), 4.7(b) và các trang PDF chứa 2.2, 4.5, 4.7, 4.20.

Chưa commit.
