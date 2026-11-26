# Các đoạn sửa cho báo cáo demo26

Mỗi mục ghi: vị trí trong báo cáo, câu hiện tại (trích đúng), câu thay thế và căn cứ trong mã nguồn. Đối chiếu trên nhánh hungg sau commit b81a75f (27/11/2026).

---

## 1. Chương 7, Kết luận chương — sai số học

**Hiện tại:**
> Kết quả đối chiếu ở mục 7.9 cho thấy 40 trong 56 yêu cầu chức năng có minh chứng đạt (27 ở mức hệ thống, 14 ở mức kiểm thử đơn vị), …

**Thay bằng:**
> Kết quả đối chiếu ở mục 7.9 cho thấy 41 trong 56 yêu cầu chức năng có minh chứng đạt (27 ở mức hệ thống, 14 ở mức kiểm thử đơn vị), …

Căn cứ: Bảng 7.18 có 27 "Đạt", 14 "Đạt (đơn vị)", 12 "Một phần", 3 "Chưa đánh giá", tổng 56; câu tổng hợp cuối mục 7.9 đã ghi đúng.

---

## 2. Chương 3, Bảng 3.27 Đặc tả UC19 – Tiếp nhận trả sách

Căn cứ: `services/borrow-service/src/services/fine.service.js` (`computeReturnFineAmounts`), `src/controllers/loan.controller.js` (trả sách và `previewLoanReturn`).
- Phí hư hỏng là mức cố định của gói hội viên, mặc định `DAMAGED_ITEM_FEE` = 50.000 đồng, tính khi tình trạng trả là `DAMAGED` hoặc `POOR`; thủ thư không nhập số tiền.
- Mỗi cuốn trả (trừ cuốn mất) bắt buộc có kệ trả về (`returned_to_location_id`, kệ bất kỳ của chi nhánh); thiếu thì API trả 400 `RETURN_LOCATION_REQUIRED`.
- Trước khi xác nhận, giao diện gọi `return-preview` để hiện số phí sẽ thu; số xem trước và số thu thật dùng chung một hàm.
- Dùng tiền đặt cọc để trừ phí hư hỏng hoặc mất phải có lý do.

**Basic flow — thay các bước 3–6 bằng:**

| Actor | Hệ thống |
|---|---|
| 3. Chọn cuốn trả, ghi nhận tình trạng (tốt, hư hỏng, kém, mất) và chọn kệ cất lại sách (không cần với sách mất). | 4. Hiển thị phí dự kiến: phí quá hạn bằng số ngày trễ nhân phí mỗi ngày của gói; phí mất sách bằng mức phí cơ sở nhân hệ số của gói; phí hư hỏng là mức cố định của gói (mặc định 50.000 đồng) khi tình trạng là hư hỏng hoặc kém. |
| 5. Xác nhận trả sách. | 6. Đưa sách về đúng kệ đã chọn (trừ sách mất), ghi phí phạt, cập nhật trạng thái cuốn sách, đóng phiếu khi mọi cuốn đã xử lý và cập nhật dư nợ của bạn đọc. |
| | 7. Gửi thông báo và hiển thị biên nhận trả sách. |

**Exception flow — thêm:**
> 3.1 Chưa chọn kệ cho cuốn không bị đánh dấu mất: hệ thống từ chối và yêu cầu chọn kệ (mã RETURN_LOCATION_REQUIRED).
> 3.2 Dùng tiền đặt cọc để bù phí hư hỏng hoặc mất mà không ghi lý do: hệ thống từ chối.

**Hậu điều kiện (nếu thành công)** — sửa "sách được trả về kho" thành:
> sách được trả về đúng kệ thủ thư đã chọn (trừ trường hợp mất sách).

Mục sơ đồ tuần tự "Trả sách và tính phí phạt" (Hình 3.15) đã ghi đúng mức phí; nên thêm một câu: "Thủ thư chọn kệ cất lại cho từng cuốn; trước khi xác nhận, hệ thống hiển thị phí dự kiến bằng chính hàm tính phí dùng khi trả."

---

## 3. Chương 6, mục "Các service nghiệp vụ Node.js" — số endpoint

Xem `03-phu-luc-b-va-so-endpoint.md`, mục 1 (đoạn thay thế và quy ước đếm).

---

## 4. Chương 7 và Chương 8 — kiểm thử tích hợp "chưa chạy lại"

Mục 7.3 ghi các kịch bản ở Bảng 7.2 "chưa được chạy lại trên phiên bản hiện tại (job kiểm thử tích hợp của CI chạy một bộ kịch bản riêng)". **Câu này không còn đúng.** Log job "Integration flows (Docker)" của lượt CI 45849116018 tại commit a798b7d (26/11/2026) ghi "35/35 integration flows passed" (danh sách ở `scripts/testing/integration-flows.json`), trong đó có 10 trong 14 kịch bản của Bảng 7.2:

| Kịch bản ở Bảng 7.2 | Luồng trên CI ngày 26/11/2026 | Kết quả |
|---|---|---|
| Phân quyền backend | rbac-role-access-integration.mjs | PASS |
| Quản trị người dùng | admin-user-management-integration.mjs | PASS |
| Mua hàng – nhận hàng | purchase-supplier-receiving-integration.mjs | PASS |
| Cổng nhà cung cấp | supplier-portal-integration.mjs | PASS |
| Lưu thông giai đoạn 2 | borrow-phase2-integration.mjs | PASS |
| Đặt giữ – nhận – mượn – trả | reservation-pickup-loan-return-integration.mjs | PASS |
| Tranh chấp đồng thời | reservation-concurrency-race-integration.mjs | PASS |
| Độ bền outbox | outbox-durability-integration.mjs | PASS |
| Độ bền consumer gateway | gateway-consumer-durability-integration.mjs | PASS |
| Phân tích | analytics-integration.mjs | PASS |
| RabbitMQ smoke, Phân quyền giao diện, Trợ lý AI, Tìm bằng ảnh bìa | không có luồng cùng tên (bước `smoke` của CI chạy `scripts/demo-smoke.mjs`; phân quyền giao diện thuộc bộ Playwright) | chưa đối chiếu |

Ngoài ra CI còn chạy 25 luồng mới hơn đợt 05/10 (phạm vi kho, chuyển kho, chứng từ mua hàng, sửa đổi đơn, trả hàng nhà cung cấp, đối chiếu ba bên, hóa đơn trước, OTP email, phân loại ISBN/EAN, …).

**Mục 7.3, thay câu cuối đoạn mở đầu bằng:**
> Kết quả được trình bày ở Bảng 7.2. Trên phiên bản ngày 26/11/2026, job kiểm thử tích hợp của CI chạy 35 luồng tích hợp trên Docker và cả 35 đều đạt; mười trong mười bốn kịch bản của Bảng 7.2 nằm trong số này (phân quyền backend, quản trị người dùng, mua hàng – nhận hàng, cổng nhà cung cấp, lưu thông giai đoạn 2, đặt giữ – nhận – mượn – trả, tranh chấp đồng thời, độ bền outbox, độ bền consumer gateway, phân tích). Bốn kịch bản còn lại (RabbitMQ smoke, phân quyền giao diện, trợ lý AI, tìm bằng ảnh bìa) chưa được chạy lại dưới cùng dạng.

**Mục "Hạn chế của kết quả" (Chương 7), hiện tại:**
> Bộ kịch bản tích hợp, giao diện và tải của ngày 05/10/2026 chưa được chạy lại trên phiên bản hiện tại.

**Thay bằng:**
> Mười trong mười bốn kịch bản tích hợp của đợt 05/10/2026 đã được chạy lại và đạt trên CI ngày 26/11/2026; bộ kiểm thử giao diện và kiểm thử tải của đợt đó chưa được chạy lại trên phiên bản hiện tại.

Sửa tương tự câu ở Kết luận Chương 7 ("bộ kịch bản tích hợp, giao diện, tải ngày 05/10/2026 chưa chạy lại") và câu tương ứng ở Chương 8 (nếu có): bỏ chữ "tích hợp", chỉ còn "bộ kiểm thử giao diện và tải ngày 05/10/2026 chưa chạy lại".

---

## 5. Chương 7, mục "Chính sách nhập hàng và phân bổ ngân sách"

Thay đoạn văn dài về đánh giá ngày 26/11/2026 bằng Bảng 1–4 và hai hình trong `docs/reports/BUDGET_ALLOCATION_TABLES_FIGURES.md` (giữ đoạn mô tả phương pháp và đoạn giới hạn). Nếu không muốn so phiên bản cũ với phiên bản mới, bỏ thêm:
- Bảng 7.16 và đoạn "+2,93 / +2,87 / +8,07 … 24/24" ngay sau bảng (so với cách phân bổ cũ của chính hệ thống; tư liệu nguồn ghi không dùng làm kết quả chính);
- vế "và cao hơn phương án trước ở 24/24 lần chạy (+1,26 đến +3,69 điểm phần trăm)";
- Chương 1, mục Kết quả định lượng: vế "và cao hơn phiên bản trước 1,26–3,69 điểm phần trăm".

Đoạn ngắn thay cho phần kết quả (dùng cùng các bảng mới):
> Đánh giá ngày 26/11/2026 so cách phân bổ ngân sách của SmartBook với tám cách chi ngân sách thư viện thường dùng, ghép hai quy tắc tính số lượng (điểm đặt hàng lại tối thiểu 5, tối đa 10; trung bình 30 ngày cộng tồn an toàn) với bốn quy tắc chi tiền khi thiếu ngân sách (mượn nhiều trước, đặt giữ trước, chia theo thể loại, mỗi đầu sách một bản). Trên 8 hạt giống kiểm định chưa dùng khi xây dựng thuật toán, SmartBook có mức đáp ứng cao nhất trong 9 cách ở cả ba kịch bản (Bảng 1) và cao hơn cách chi tốt nhất ở 24/24 lần chạy với ngân sách bằng mức tham chiếu, chênh +0,34 đến +2,35 điểm phần trăm và giảm 12–23% lượt nhu cầu không được phục vụ (Bảng 2); xét mọi mức ngân sách, SmartBook cao hơn ở 118/120 lần chạy (Bảng 3, Hình 7.y). Ở ngân sách bằng mức tham chiếu, SmartBook tiêu nhiều hơn cách chi tốt nhất 1–11% nên một phần lợi thế đến từ việc dùng hết ngân sách; ở ngân sách bằng một nửa, mọi cách đều tiêu gần hết tiền và chênh lệch là +1,15 đến +4,47 điểm phần trăm. Trên lượt mượn thật của hai thư viện Indonesia, SmartBook cao hơn cách chi tốt nhất 0,6–5,7 điểm phần trăm ở thư viện công cộng và 0,3–0,5 điểm phần trăm ở thư viện đại học (Bảng 4).

---

## 6. Các sửa nhỏ (trình bày)

| Vị trí | Hiện tại | Đề xuất |
|---|---|---|
| Chương 6, mục Các service nghiệp vụ / Phụ lục B | Chương 6 nói "Danh sách đầy đủ", Phụ lục B nói "endpoint chính" | Bổ sung 42 dòng (file 03) rồi giữ "đầy đủ", hoặc đổi Chương 6 thành "các endpoint chính" |
| Chương 3 và Bảng 7.18 | FR-39 nhảy sang FR-41 | Đánh số lại FR-41…FR-57 thành FR-40…FR-56 ở cả hai nơi (và mọi chỗ trích mã FR), hoặc thêm chú thích "FR-40 đã gộp vào FR-…" nếu đúng là đã gộp |
| Chương 3, tiêu đề mục 3.5.3.x | " Nhóm use case bổ sung theo phiên bản hiện tại" (thừa dấu cách đầu) | Bỏ dấu cách; đặt tên theo nghiệp vụ, ví dụ "Nhóm use case kiểm soát chất lượng dữ liệu và vận hành" (đặt tên theo nội dung thật của nhóm) |
| Chương 7, mục Các vấn đề phát hiện | "64 quyền trong khi dữ liệu khởi tạo khai báo 65 quyền" | Thêm "(ở đợt 06/11/2026; dữ liệu khởi tạo hiện khai báo 68 quyền, xem Chương 4)" hoặc bỏ câu |
| Toàn báo cáo | Mã commit trong văn bản (2c88012, 8abdc00, a798b7d, b8f11636, a13df1f) | Ghi theo ngày, ví dụ "phiên bản ngày 26/11/2026"; nếu cần truy vết thì gom mã commit vào một bảng ở phụ lục |
