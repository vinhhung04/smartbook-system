# Bàn giao cập nhật báo cáo: demo4 → demo5 (06/11/2026)

## 1. Sản phẩm

| # | Sản phẩm | Đường dẫn |
|---|---|---|
| 1 | DOCX đã cập nhật (277 trang khi xuất PDF) | `NHD82_KLTN_2026_HeThongQuanLyKhoSachThongMinhTichHopAI_demo5.docx` (thư mục gốc repo) |
| 2 | PDF xuất bằng Microsoft Word | `thesis/report-update/NHD82_KLTN_2026_HeThongQuanLyKhoSachThongMinhTichHopAI_demo5.pdf` |
| 3 | Bảng audit trước/sau | `thesis/report-update/AUDIT.md` |
| 4 | Bản sao lưu nguyên trạng demo4 | `thesis/report-update/backup/` |
| 5 | Ảnh giao diện mới (28 web + 7 mobile + 2 ảnh ghép) | `thesis/report-update/screenshots/` |
| 6 | Mã nguồn sơ đồ và bản xuất | `docs/diagrams/source/**.mmd`, `docs/diagrams/drawio/*.drawio`, `docs/diagrams/exports/{svg,png}/` |
| 7 | Công cụ dựng lại DOCX (Python + Word) | `thesis/report-update/tools/` (`build.py` → `topdf.py` → `pages.py` → `build.py` với số trang) |
| 8 | Ảnh thử nghiệm OCR tự tạo | `thesis/report-update/test-images/` |

File gốc demo4 không bị ghi đè. Không sửa mã ứng dụng, database, migration, cấu hình Docker/VPS/CI. Không commit, không push.

Định dạng được giữ: khổ A4, lề, font Times New Roman, cỡ chữ, giãn dòng, heading, header/footer, đánh số trang theo section. Mọi đoạn, bảng, hình mới được nhân bản từ phần tử có sẵn của tài liệu. Mục lục, danh mục hình, danh mục bảng được **dựng lại từ nội dung thật**, số trang lấy từ bản PDF do Word xuất (chạy hai vòng, số trang ổn định). Validator OOXML của skill docx: PASSED.

Thay đổi định dạng duy nhất có chủ ý: bật "keep with next" cho 226 heading và chú thích bảng để heading không nằm trơ ở cuối trang (bản Google Docs export đặt `keepNext=0`).

## 2. Các mục đã sửa theo chương

- **Bìa – Abstract – Tóm tắt:** viết lại đoạn 2–4 (kiến trúc + VPS/CI-CD, OTP, phạm vi kho; Copilot 20 công cụ, OCR nhiều ảnh, phân bổ ngân sách cận biên; số liệu đánh giá mới). Giữ trong 1 trang mỗi bản. Danh mục viết tắt: thêm CI/CD, EAS, GHCR, HMAC, OTP, VPS, XAI.
- **Chương 1:** mục tiêu cụ thể (OCR, biểu đồ, OTP, CI/CD); phạm vi (Auth, AI, hạ tầng); giới hạn (bỏ câu sai về tracing, thêm giới hạn quan sát, mobile, OCR, cờ tắt); kết quả về sản phẩm và định lượng.
- **Chương 2:** đoạn khả năng quan sát (nói rõ chỉ còn metric); mục mới 2.3.2 *Mã dùng một lần qua email và refresh token*; đoạn mới về Explainable AI và kiểm chứng; công nghệ (Caddy, GitHub Actions, GHCR, EAS; Prometheus/Grafana tùy chọn); Bảng 2.2.
- **Chương 3:** Bảng 3.2 (FR-01, FR-02, thêm FR-54, FR-55), Bảng 3.5 (FR-56), Bảng 3.6 (FR-44, FR-47, FR-48, FR-57), NFR bảo mật OTP và vận hành, Bảng 3.7 (NFR-AI-07 cờ tính năng), Bảng 3.8 (UC63–UC66), đặc tả UC02 (luồng OTP), UC57 (Grafana tùy chọn).
- **Chương 4:** kiến trúc tổng thể (Hình 4.1 mới), điểm tích hợp (Bảng 4.2 +2 dòng), kiến trúc triển khai viết lại theo production (Hình 4.2 mới), xác thực (OTP đăng ký, OTP hai lớp đang tắt, refresh token), phân quyền (65 quyền; phạm vi kho fail-closed thay cho hạn chế cũ), quyền của AI (20 công cụ chỉ đọc); sơ đồ tuần tự: Hình 4.5 thay mới, **Hình 4.6 mới** (đăng ký OTP), mục VNPay được điền, **Hình 4.15 mới** (OCR nhiều ảnh), Hình 4.17 và 4.18 thay mới; CSDL (auth_db 13 bảng, ERD Hình 4.22 thay mới); giao diện: thay 16 ảnh, thêm mục *Đăng nhập, đăng ký và OTP* (2 ảnh), ảnh việc kho và giao việc, mục *Ứng dụng di động* (2 ảnh ghép).
- **Chương 5:** phân bổ ngân sách cận biên (vị thế tồn, Kaplan–Meier, Poisson, cấp từng bản; ứng viên không ngân sách không được đưa vào); Copilot (20 công cụ, **Bảng 5.4 mới**, **Hình 5.1 mới**, mục mới *Kiểm chứng câu trả lời*, *Trực quan hóa dữ liệu trong hội thoại*); mục mới *Nhập sách bằng OCR nhiều ảnh*; gợi ý sách (V1 → V2 mặc định).
- **Chương 6:** Bảng 6.1, 6.2, 6.3; ứng dụng di động (Expo SDK 58); bảo mật (OTP, refresh token, bí mật production); khả năng quan sát viết lại; mục VNPay được điền; CI + CD (**Hình 6.1 mới**); mục mới 6.10 *Triển khai production và phát hành ứng dụng di động* (hạ tầng, triển khai và quay lui, sao lưu – khôi phục – giám sát, phát hành mobile).
- **Chương 7:** giới thiệu hai đợt đánh giá; **Bảng 7.1 thay bằng kết quả chạy lại 06/11/2026**; ghi rõ ngày cho tích hợp/E2E/k6; bảng trợ lý cũ được ghi là mốc trước Copilot; mục mới *Kiểm chứng câu trả lời của Copilot* (Bảng 7.7, 7.8), *Hiểu ngôn ngữ tự nhiên của bộ lập kế hoạch* (Bảng 7.9), *Trực quan hóa* (Bảng 7.10), *OCR nhiều ảnh* (không công bố độ chính xác); dự báo (Bảng 7.15 theo pipeline tái lập, 7 mô hình); mục mới *Chính sách nhập hàng và phân bổ ngân sách* (Bảng 7.16); gợi ý V2 (Bảng 7.17); mục VNPay được điền; thảo luận: ưu điểm, hạn chế, trạng thái từng vấn đề (chỉ mục ngữ nghĩa: đã sửa; PrismaClient: còn; phạm vi kho: đã sửa).
- **Chương 8:** kết quả đạt được, hạn chế viết lại; **8.3 Hướng phát triển viết mới** (mục này trống ở demo4).
- **Phụ lục:** A.9 Triển khai production, A.10 Phát hành mobile; B: thay `/auth/verify-email` không còn tồn tại, thêm API OTP, refresh, phạm vi kho, OCR, VNPay.

## 3. Sơ đồ

| Hình (demo5) | Quyết định | Công cụ | Nguồn |
|---|---|---|---|
| 1.1, 2.1–2.6, 3.1–3.12 | Giữ (vẫn đúng với code) | – | – |
| 4.1 Kiến trúc tổng thể | Thay | Draw.io | `drawio/architecture-system-overview.drawio` |
| 4.2 Triển khai production | Thay (bản cũ có Tempo/Loki/Promtail, cổng cục bộ) | Draw.io | `drawio/deployment-production.drawio` |
| 4.5 Đăng nhập + OTP hai lớp | Thay | Mermaid | `source/sequence/auth-login-email-otp.mmd` (đã có từ trước) |
| 4.6 Đăng ký + OTP | Mới | Mermaid | `source/sequence/auth-register-email-otp.mmd` |
| 4.15 OCR nhiều ảnh | Mới | Mermaid | `source/sequence/ai-book-ocr-multi-image.mmd` |
| 4.17 Đề xuất nhập hàng + ngân sách | Thay | Mermaid | `source/sequence/analytics-reorder-budget.mmd` |
| 4.18 Copilot | Thay | Mermaid | `source/sequence/ai-copilot-query-verification.mmd` |
| 4.22 ERD auth_db | Thay | Mermaid | `source/erd/auth-service-iam.mmd` (đã có từ trước) |
| 5.1 Pipeline Copilot | Mới | Mermaid | `source/architecture/ai-copilot-pipeline.mmd` |
| 6.1 CI/CD | Mới | Mermaid | `source/architecture/deploy-ci-cd-pipeline.mmd` |
| Các sơ đồ tuần tự, ERD còn lại của chương 4 | Giữ | – | Chưa được vẽ lại; nội dung khớp code theo audit |

Mỗi tệp `.mmd` có dòng `%% Nguồn đối chiếu` ghi file code đã kiểm tra. Lưu ý: lệnh render đã xuất lại `exports/{png,svg}/erd/auth-service-iam.*` từ cùng nguồn (nội dung không đổi, bytes khác).

## 4. Kết quả thực nghiệm được cập nhật

| Kết quả | Nguồn | Ngày | Loại dữ liệu |
|---|---|---|---|
| Kiểm thử đơn vị (Bảng 7.1) | chạy lại trong đợt này | 06/11/2026 | – |
| Copilot 3.3 (Bảng 7.7, 7.8) | `docs/ANALYSIS/AI_COPILOT_3_3_EVALUATION.md`, `services/ai-service/eval/copilot33_*` | 17–19/10/2026 | dữ liệu dev mô phỏng |
| Bộ lập kế hoạch (Bảng 7.9) | `docs/ANALYSIS/AI_COPILOT_SEMANTIC_UNDERSTANDING.md` | 26/10/2026 | dữ liệu dev mô phỏng |
| Trực quan hóa (Bảng 7.10) | `docs/ANALYSIS/AI_COPILOT_3_0_VISUALIZATION.md` | 15/10/2026 | dev + LLM thật |
| OCR nhiều ảnh (văn bản, không có bảng) | `docs/ANALYSIS/BOOK_OCR_EVALUATION.md` | 23/10/2026 | smoke 3 ảnh, 27 lần quét |
| Dự báo (Bảng 7.15) | `thesis/tables/forecast_model_results.csv` | sinh tự động | tổng hợp |
| Chính sách nhập hàng (Bảng 7.16) | `docs/ANALYSIS/REORDER_OPTIMIZATION_EVALUATION.md` (phần AUTO) | 17–18/10/2026 | tổng hợp |
| Gợi ý V2 (Bảng 7.17) | `services/ai-service/eval/reports/recommendation_v2_report.md` | 30/09/2026 | tổng hợp |
| Giữ nguyên, ghi rõ ngày | tích hợp, E2E, k6, chọn công cụ (trước Copilot), RAG, ISBN, rủi ro | 05/10/2026 | – |

Không chạy lại benchmark có gọi LLM và không sửa số liệu sinh tự động.

## 5. Hạn chế chưa khắc phục (đã ghi vào báo cáo)

1. Mô hình rủi ro, dự báo, gợi ý, phân bổ ngân sách chỉ kiểm định trên dữ liệu tổng hợp.
2. OCR nhiều ảnh chưa có benchmark ≥ 50 cuốn; tập đánh giá Copilot nhỏ, một người gán nhãn.
3. Semantic Planner, Semantic Claims, truy xuất ISBN theo trường: cờ tắt.
4. OTP hai lớp cho nhân viên: hiện thực nhưng `STAFF_EMAIL_OTP_MODE=off` ở production.
5. Inventory Service có 40 lần `new PrismaClient()`; rate limiter gateway trong bộ nhớ.
6. VPS đơn, chưa xác nhận sao lưu ra ngoài VPS, không có tracing/log tập trung/Prometheus ở production.
7. Mobile: chưa thử trên thiết bị thật, chưa build iOS, chưa phát hành store.
8. Tích hợp, E2E, k6 chưa chạy lại trên phiên bản hiện tại.

## 6. Cần bạn xác nhận

1. **Nhánh nguồn:** bạn chỉ định `hungg`, nhưng nhánh `hungg` cục bộ chậm 6 commit. Audit dùng HEAD hiện tại, có mã ứng dụng trùng `origin/hungg` (`d6221e8`). Hãy xác nhận đây là phiên bản cần mô tả.
2. **Ảnh OTP (Hình 4.37)** chụp với phản hồi API đăng ký được giả lập trong trình duyệt, vì `.env` dev đang trỏ tới SMTP thật. Caption và đoạn dẫn đã ghi rõ điều này. Nếu muốn ảnh từ luồng thật, cần chạy với mailpit.
3. **Ảnh AI Import (Hình 4.51)** dùng hai ảnh do nhóm tự tạo (sách Norwegian Wood có trong dữ liệu mẫu) được xử lý thật qua OpenRouter.
4. **Ảnh mobile** chụp từ bản web của Expo (390 px), không phải từ điện thoại; caption đã ghi rõ.
5. **Production:** audit không SSH vào VPS. Các mô tả triển khai lấy từ `compose.prod.yml`, `deploy/`, workflow và `docs/DEPLOYMENT.md` (ghi "live từ 29/10/2026"). Cần xác nhận cấu hình VPS (6 vCPU, ~12 GB) và việc sao lưu ra ngoài VPS.
6. **Số quyền:** seed khai báo 65 quyền, CSDL dev có 64 quyền. Báo cáo ghi 65 và nêu chênh lệch.
7. **Số endpoint ở mục 6.3.2** (Inventory 195, Borrow 69, Auth 18) chưa được cập nhật. Đếm `router.*(` hiện cho Inventory 199, Borrow 75, Auth 26 (con số này gồm cả tuyến nội bộ). Nếu muốn đưa vào báo cáo cần quy ước đếm thống nhất.
8. **Trang trống ở section Phụ lục:** footer phụ lục không in số trang (giữ như bản gốc). Danh mục ghi số trang tiếp nối của phần thân.
9. Phụ lục C (nhật ký làm việc) và thông tin bìa: giữ nguyên.

## 7. Phát hiện ngoài phạm vi báo cáo (không sửa code)

- Ứng dụng mobile (dev, Expo web) phát cảnh báo React "Received `false` for a non-boolean attribute" ở màn hình chủ.
- `.env` dev dùng SMTP thật thay vì mailpit.
- Seed quyền và CSDL dev lệch nhau (65/64).
