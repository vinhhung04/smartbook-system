# Thay đổi demo6 → demo7 (06/11/2026)

Mục tiêu: **đồng bộ cách vẽ mọi sơ đồ trong báo cáo**. demo6 còn 46 hình ở dạng ảnh PlantUML/Mermaid (nền xám, font Times, đường chéo); demo7 thay toàn bộ bằng bản vẽ lại theo profile Diagram Design `smartbook` (màu navy/slate, Arial + Consolas, lưới 4px, đường vuông góc bo góc, cầu vượt tại điểm giao). Văn bản báo cáo và **số hình giữ nguyên**.

- Tệp: `NHD82_KLTN_2026_HeThongQuanLyKhoSachThongMinhTichHopAI_demo7.docx` (gốc repo), PDF: `thesis/report-update/…_demo7.pdf` (310 trang; demo6: 292 trang).
- Dựng lại: `python thesis/report-update/tools/build7.py <demo6.docx> <demo7.docx> thesis/report-update/pages7.json` (hai lượt: lượt 1 lấy số trang qua `topdf.py` + `pages.py`, lượt 2 ghi số trang vào mục lục và danh mục hình).
- Hình nguồn: `docs/diagrams/designed/` → `docs/diagrams/exports/{svg,png}/`; bảng ánh xạ và đối chiếu: `docs/diagrams/designed/README.md`, mục "Đợt 2".

## Hình được thay

| Hình | Nội dung | Ghi chú |
|---|---|---|
| 1.1 | Tổng quan phân hệ và nhóm người dùng | Mũi tên chéo thay bằng đường trục vuông góc |
| 2.1–2.6 | Microservices, Transactional Outbox, DSS, vòng lặp gọi công cụ, truy xuất lai, hợp nhất bằng chứng | 2.5 rộng 12,4 cm, 2.6 rộng 10,9 cm (hình dọc) |
| 3.1–3.4 | Sơ đồ hoạt động có làn bơi | Ký pháp UML (nút đầu/cuối, quyết định, hợp nhất) |
| 3.5–3.12 | Sơ đồ use case | Ký pháp UML (tác nhân, ranh giới, «include»/«extend», gói, khái quát hóa) |
| 4.3, 4.4 | Mô hình miền | Tách (a)(b)(c) và (a)(b) |
| 4.7 | Đặt giữ sách | Tách (a) bước 1–5, (b) bước 6–13 |
| 4.8, 4.9, 4.12, 4.13, 4.17, 4.20, 4.21, 4.22 | Các sơ đồ tuần tự còn lại | Một hình mỗi sơ đồ |
| 4.11 | Lập, duyệt, gửi đơn đặt hàng | Tách (a) bước 1–11, (b) 12–15, (c) 16–18 |
| 4.14 | Đóng gói có bằng chứng hình ảnh | Tách (a) bước 1–12, (b) 13–16 |
| 4.15 | Biên mục sách với AI | Tách (a) bước 1–10, (b) 11–17 |
| 4.24, 4.26, 4.28, 4.32–4.36 | ERD | Một hình mỗi sơ đồ, đọc trực tiếp từ schema hiện tại |
| 4.25, 4.27, 4.29, 4.31 | ERD | Tách (a)(b) |
| 4.30 | ERD hóa đơn, nhận hàng, thiếu hàng | Tách (a)(b)(c) |

Hình tách: mỗi phần có nhãn (a)/(b)/(c) dưới ảnh và chú thích được nối thêm danh sách các phần (ví dụ "Hình 4.11 …: (a) bước 1–11: …; (b) …"). Các hình đã là Diagram Design từ demo6 (4.1, 4.2, 4.5, 4.6, 4.10, 4.16, 4.18, 4.19, 4.23, 5.1, 6.1) và ảnh chụp màn hình (4.37–4.58) giữ nguyên.

## Kiểm tra đã chạy

- 81 tệp HTML (toàn bộ `docs/diagrams/designed/`) qua `build.sh`: `self_check.py --offline`, `verify-geometry.py`, `check-text-fit.py`, xuất SVG và PNG ×3 → 81/81 đạt.
- Xem trực tiếp PNG của từng hình mới và các trang PDF chứa hình 1.1, 2.5, 3.2, 3.5, 4.3, 4.11, 4.30.
- `validate.py` (skill docx) so với demo6: đạt; số đoạn 7279 → 7318 (+39 = ảnh phần mới và nhãn (a)/(b)/(c) của 11 hình tách).
- Đánh số hình không đổi (`post.renumber` không đổi số nào); mục lục và danh mục hình: 420 mục, 0 mục lệch số trang so với PDF cuối.

## Chưa làm

- Chưa xem từng trang trong 310 trang PDF; mới xem các trang mẫu nêu trên.
- Chưa đối chiếu lại nội dung các sơ đồ use case và sơ đồ hoạt động với mã nguồn; chúng được chép nguyên văn từ hình gốc của báo cáo. Riêng nhãn "chỉ đọc" ở hình 1.1 đã kiểm tra với `services/analytics-service/src/lib/db.js`.
- Chưa commit.
