# Mục mới cho Chương 7: Đánh giá chức năng cân bằng tồn giữa các kho

Vị trí đề xuất: trong mục 7.6 "Đánh giá thành phần AI", sau tiểu mục "Trực quan hóa dữ liệu trong trợ lý" (hoặc thành một tiểu mục riêng ngay trước mục "Đánh giá các mô hình hỗ trợ ra quyết định").

Nguồn số liệu (giữ nguyên số, không chép từ trí nhớ):
`docs/AI_INVENTORY_REBALANCING_CHATBOX_TEST_REPORT.md`, `docs/AI_INVENTORY_REBALANCING_SEMANTIC_TEST_REPORT.md`, `docs/AI_INVENTORY_REBALANCING_FINAL_REPORT.md` (đợt 20/11/2026); lần chạy lại kiểm thử đơn vị và bộ câu hỏi ngày 27/11/2026 trên mã nguồn hiện tại (nhánh hungg, sau commit b81a75f).

---

## Cân bằng tồn giữa các kho

Chức năng cân bằng tồn (mục 5.2) được đánh giá ở ba mức: bộ lập kế hoạch có hiểu đúng câu hỏi hay không, các con số của phương án có đúng quy tắc nghiệp vụ hay không, và toàn bộ luồng hội thoại có chạy được qua giao diện thật hay không. Dữ liệu là bộ dữ liệu trình diễn có kiểm soát gồm ba kho (TP.HCM, Hà Nội, Đà Nẵng), được tạo bằng kịch bản `pnpm demo:rebalancing:seed`; tài khoản thử nghiệm là một quản lý có quyền thực hiện ở kho TP.HCM và Đà Nẵng nhưng chỉ có quyền xem ở kho Hà Nội, để kiểm tra việc tách việc tự làm được với việc cần quản lý khác phối hợp.

**Hiểu câu hỏi.** Bộ dữ liệu gồm 14 ý định nghiệp vụ (chẩn đoán tồn kho, phát hiện thiếu, phát hiện dư, phân tích nhu cầu, cơ hội điều chuyển, số lượng điều chuyển an toàn, so sánh phương án, phương án kết hợp, tối ưu mua mới, ngân sách, mô phỏng giả định, giải thích quyết định, tạo bản nháp, xác nhận), mỗi ý định có ít nhất năm cách diễn đạt: chuẩn, tự nhiên, ngắn, đồng nghĩa và viết không dấu hoặc sai chính tả. Mỗi câu được đưa qua bộ lập kế hoạch thật (phần dựa trên luật, không gọi mô hình ngôn ngữ) cùng trạng thái hội thoại của các lượt trước. Một câu đạt khi năng lực bộ lập kế hoạch đọc được chứa ý định dự kiến và công cụ được gọi phù hợp. Kết quả được trình bày ở Bảng 7.a.

Bảng 7.a Kết quả hiểu câu hỏi về cân bằng tồn của bộ lập kế hoạch

| Lần chạy | Bộ câu | Kết quả | Ghi chú |
|---|---|---|---|
| 1 (20/11) | 82 câu biến thể và 18 lượt trong 3 hội thoại | 85/100 | Câu chẩn đoán đi nhầm sang công cụ cũ làm các lượt sau mất ngữ cảnh; "giảm tiếp 20%", "chuyển hàng hay nhập" giữa hội thoại bị hiểu sai |
| 2 (20/11) | như trên, sau khi sửa từ vựng và ngữ cảnh | 100/100 | Sửa ở bộ lập kế hoạch, không viết riêng cho từng câu |
| 3 (20/11) | 12 câu kiểm tra viết sau, chưa dùng để chỉnh luật | **7/12** | Trượt: "san sẻ", "ôm nhiều sách", "cân đối hàng", "mua … hay chuyển", "nhu cầu tăng 20%" |
| 4 (20/11) | 12 câu kiểm tra, sau khi bổ sung từ vựng | 11/12 | "nhu cầu tăng 20%" cần thêm tham số mô phỏng nhu cầu |
| 5 (20/11) | toàn bộ, sau khi thêm tham số mô phỏng nhu cầu | 82/82; 18/18; 12/12 | |
| 6 (27/11) | toàn bộ, trên mã nguồn hiện tại | 82/82; 18/18; 12/12 | Chạy lại sau các thay đổi ngày 26/11 (phạm vi một cuốn, câu trả lời dựng từ dữ liệu phương án) |

Kết quả lần 3 là số đo trung thực nhất về khả năng tổng quát: với cách nói hoàn toàn mới, bộ lập kế hoạch dựa trên luật chỉ nhận đúng 7/12 câu. Kết quả 12/12 ở các lần sau đạt được sau khi đã thấy chính các câu đó, nên không còn là tập kiểm tra độc lập. Lớp lập kế hoạch ngữ nghĩa dùng mô hình ngôn ngữ là lớp bù cho trường hợp này nhưng chưa có bộ đo riêng cho chức năng cân bằng tồn.

**Tính đúng của phương án.** Bộ máy tính phương án ở Analytics Service có 24 ca kiểm thử đơn vị và kiểm thử endpoint, gồm: kho nguồn không bị kéo xuống dưới mức bảo vệ của chính nó, không tính trùng một bản cho hai kho đích, bản đã dành cho phiếu chuyển khác không được điều chuyển, ngân sách chỉ áp dụng cho phần mua mới, mô phỏng giả định chỉ làm thay đổi đúng tham số được đổi, cùng các mã lỗi 400, 401, 403, 409 và 503 và giới hạn theo phạm vi kho của người hỏi. Ở AI Service, 41 ca kiểm thử (kèm 100 ca con) kiểm tra bộ lập kế hoạch, hành động `CREATE_REBALANCE_DRAFT` (kiểm tra lại quyền khi xác nhận, chống tạo trùng, không cho dùng mã của kho ngoài phạm vi) và bước kiểm tra từng dòng điều chuyển, tổng theo kho nguồn và số liệu theo đúng phương án trong câu trả lời. Tất cả đều đạt khi chạy lại ngày 27/11/2026.

Bảng 7.b trình bày các phương án hệ thống lập cho kho TP.HCM trên dữ liệu trình diễn với ngân sách mua mới 15 triệu đồng (đợt 20/11/2026).

Bảng 7.b Các phương án cân bằng tồn cho kho TP.HCM, ngân sách 15 triệu đồng (dữ liệu trình diễn)

| Phương án | Mức đáp ứng | Số bản điều chuyển / mua mới | Chi phí mua | Dòng cần quản lý khác phối hợp |
|---|---|---|---|---|
| Chỉ điều chuyển (TRANSFER_ONLY) | 58,1% | 36 / 0 | 0 đồng | 2 |
| Chỉ mua mới (PROCUREMENT_ONLY) | 100% | 0 / 62 | 12.025.000 đồng | 0 |
| Kết hợp (HYBRID), tốt nhất về nghiệp vụ | 100% | 36 / 26 | 4.473.000 đồng | 2 |
| Kết hợp chỉ gồm việc người hỏi tự làm được (HYBRID_EXECUTABLE) | 100% | 16 / 46 | 8.689.000 đồng | 0 |

Phương án kết hợp đáp ứng đủ số thiếu với chi phí mua bằng 37% phương án chỉ mua mới, nhưng có 2 dòng điều chuyển lấy từ kho Hà Nội, nơi người hỏi chỉ có quyền xem; phương án người hỏi tự thực hiện được vẫn đạt 100% nhưng tốn gần gấp đôi. Khi ngân sách giảm còn 12 triệu đồng, phương án chỉ mua mới giảm còn 98,4%, hai phương án kết hợp không đổi. Mức đáp ứng ở đây là tỷ lệ số thiếu được bù (mục 5.2), không phải tỷ lệ nhu cầu dự báo.

**Luồng hội thoại đầu – cuối.** Kịch bản trình diễn gồm 7 câu hỏi liên tiếp: chẩn đoán tồn kho, tìm nguồn điều chuyển cho TP.HCM, so sánh với mua mới, tối ưu với ngân sách 15 triệu, mô phỏng giảm ngân sách 20%, tạo bản nháp cho phần người hỏi đủ quyền, và xác nhận. Kịch bản chạy qua giao diện thật bằng Playwright, không giả lập API: câu hỏi đi qua API Gateway tới AI Service, Analytics Service và Inventory Service, mô hình ngôn ngữ là mô hình thật theo cấu hình. Kết quả ở Bảng 7.c.

Bảng 7.c Kết quả chạy kịch bản cân bằng tồn 7 bước (đợt 20/11/2026)

| Bước | Câu hỏi | Thẻ hiển thị được kiểm tra | Thời gian trả lời (lần 2, qua API) | Kiểm chứng số liệu |
|---|---|---|---|---|
| 1 | Chẩn đoán tồn kho các kho | Chẩn đoán; kho Hà Nội gắn nhãn "Chỉ xem" | 17,1 giây | Đạt |
| 2 | Tìm nguồn điều chuyển cho TP.HCM | Cơ hội điều chuyển, có dòng cần quản lý kho nguồn | 9,6 giây | Đạt |
| 3 | So sánh với mua mới | So sánh phương án, nêu phương án tốt nhất về nghiệp vụ | 16,5 giây | Đạt |
| 4 | Ngân sách 15 triệu | Ngân sách 15.000.000 đồng | 13,0 giây | Đạt |
| 5 | Giảm ngân sách 20% | So sánh kịch bản 15 triệu và 12 triệu | 13,4 giây | Đạt |
| 6 | Tạo bản nháp phần tự làm được | Bản nháp điều chuyển và mua mới, phần của Hà Nội chỉ là đề xuất | 4,4 giây | Đạt |
| 7 | Xác nhận | Kết quả: đã thực hiện, 1 yêu cầu điều chuyển và 4 yêu cầu mua | 2,3 giây | Không áp dụng |

Kịch bản đạt ở cả hai lần chạy liên tiếp (1,3 và 1,4 phút). Lần chạy đầu tiên qua API, trước khi sửa, phát hiện bốn lỗi: bước 2 lặp lại câu trả lời của bước 1, bước 5 mô hình viết sai chiều thay đổi ("tăng" thay vì "giảm"), bước 6 mô hình mô tả số liệu của phương án kết hợp thay vì của bản nháp, và bước 1 truyền cả ba kho làm kho đích. Các lỗi được sửa bằng cách để mã nguồn tính sẵn chênh lệch và chiều thay đổi, dựng câu trả lời bản nháp từ chính bản nháp, và không coi "tất cả các kho" là danh sách kho đích. Các bộ kiểm thử đầu – cuối liên quan (trò chuyện dạng luồng, thẻ quyết định, biểu đồ của trợ lý, thanh trượt ngân sách; 16 ca) vẫn đạt sau thay đổi.

Hành động ở bước 7 chỉ tạo yêu cầu điều chuyển ở trạng thái chờ duyệt và yêu cầu mua; không bước nào duyệt, xuất hay nhập kho, đúng nguyên tắc ở mục 5.1.

**Giới hạn.** Kết quả trên có các giới hạn sau:
- Luồng 7 bước và Bảng 7.b, 7.c thuộc phiên bản ngày 20/11/2026. Các thay đổi ngày 26/11/2026 (phạm vi một cuốn sách, câu trả lời chẩn đoán và so sánh dựng từ dữ liệu phương án, kiểm tra từng dòng điều chuyển) mới được kiểm tra bằng kiểm thử đơn vị và bộ câu hỏi; kịch bản 7 bước chạy với mô hình thật cần biến `E2E_LIVE_AI=1` nên không chạy trên CI (là một trong 17 ca bỏ qua ở mục 7.4).
- Kịch bản đầu – cuối chỉ kiểm tra thẻ hiển thị và trạng thái thực hiện; câu chữ do mô hình viết được đọc lại thủ công.
- Dữ liệu trình diễn có kiểm soát, không phải dữ liệu vận hành; chi phí và thời gian điều chuyển không có dữ liệu nên hệ thống ghi là chưa biết.
- Vòng đời phiếu chuyển sau khi gửi yêu cầu (duyệt, lấy hàng, nhận hàng) không thuộc kịch bản vì là bước của người duyệt; thẻ cân bằng tồn mới có ở trang Trợ lý AI, chưa có ở khung chat nổi và ứng dụng di động.

---

## Cập nhật kèm theo

- **Bảng 7.18, FR-44** (cân bằng tồn nằm trong FR-44 cùng thời gian chờ hàng và phân bổ ngân sách, hiện ghi "Một phần"): bổ sung vào cột minh chứng "cân bằng tồn: kịch bản đầu – cuối 7 bước qua giao diện thật và bộ 82 câu, 18 lượt, 12 câu kiểm tra (mục 7.6.x)". Kết quả vẫn giữ "Một phần" vì thời gian chờ hàng chưa kiểm định do thiếu dữ liệu; vì vậy không phải đổi các con số tổng hợp ở mục 7.9.
- **Chương 8, Hạn chế:** thêm một ý: "Chức năng cân bằng tồn mới được kiểm chứng đầu – cuối trên dữ liệu trình diễn ở phiên bản ngày 20/11/2026; với cách diễn đạt chưa gặp, bộ lập kế hoạch dựa trên luật chỉ nhận đúng 7/12 câu ở lần kiểm tra đầu tiên; chi phí và thời gian điều chuyển chưa có dữ liệu."
