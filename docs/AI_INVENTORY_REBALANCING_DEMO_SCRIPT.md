# AI Inventory Rebalancing — Kịch bản demo (7 lượt, ngân sách tùy chọn)

Trang demo: `/ai-assistant` · Thời lượng: 6–7 phút · Tài khoản: `rebalance.manager`.

## Chuẩn bị (chỉ môi trường dev / test)

```powershell
pnpm demo:rebalancing:seed
```
```powershell
pnpm demo:rebalancing:validate
```

- Tài khoản `rebalance.manager` (vai trò MANAGER, mật khẩu demo giống các tài khoản e2e — `DEMO_PASSWORD`).
- Phạm vi: **WH-HCM-01 FULL, WH-HN-01 READ, WH-DN-01 FULL**.
- Fixture: TP.HCM thiếu sách, Hà Nội và Đà Nẵng dư; nhu cầu là các phiếu mượn đã trả tại TP.HCM trong 4 tuần. Mọi bản ghi gắn `DEMO-REB`; `seed` chạy `reset` trước, nên chạy lại `seed` ngay trước buổi demo (lượt 6 tạo yêu cầu thật).
- Kiểm thử tự động đúng kịch bản này (LLM thật):

```powershell
$env:E2E_LIVE_AI='1'; $env:BASE_URL='http://localhost:5174'; $env:PLAYWRIGHT_CHANNEL='chrome'; pnpm test:e2e:ai-rebalancing-demo
```

  Ngân sách lấy ngẫu nhiên 5–20 triệu (bước 0,5 triệu) và được in ra; đặt `$env:DEMO_BUDGET_TRIEU='8'` để chạy lại đúng một mức. Spec chỉ kiểm tra các thẻ; sau khi chạy nên đọc lại câu trả lời (bảng `ai_messages` của hội thoại mới nhất) rồi `seed` lại.

## Ngân sách: người thuyết trình chọn tùy ý

Lượt 3 dùng ngân sách **X triệu** nói tại chỗ (ví dụ "8 triệu", "8,5 triệu", "12.000.000 đồng"). Planner đọc số đó; lượt 4 tự tính X × 80%; lượt 5 ("phương án ngân sách ban đầu") lấy lại kịch bản X. Hai trường hợp đều trình bày được:

| X so với chi phí mua của phương án kết hợp (≈ 43,2 triệu trên dữ liệu ngày 26/11/2026, sau khi lịch sử mượn mô phỏng được dời đến 26/11) | Điều hội đồng thấy ở lượt 3–4 |
|---|---|
| **X nhỏ hơn** (ví dụ 8 triệu, hoặc 30 triệu) | Ngân sách ràng buộc, hệ thống phân bổ ưu tiên. 8 triệu: kết hợp đáp ứng ~35%; giảm 20% (6,4 triệu) → ~31%, còn thiếu tăng 238 → 253 bản. 30 triệu: ~79%; giảm 20% (24 triệu) → ~68%, còn thiếu tăng 77 → 117 bản. |
| **X đủ lớn** (từ ~54 triệu, ví dụ 55 triệu) | Kết hợp đủ 100% và còn dư; giảm 20% (44 triệu) vẫn đủ cho phương án kết hợp, nhưng phương án tự thực hiện và "chỉ mua mới" giảm — đó là giá trị của điều chuyển. |

TP.HCM thiếu 367 bản trên 78 đầu sách vì nhu cầu gồm cả lịch sử mượn mô phỏng 30 ngày gần nhất, không chỉ fixture; điều chuyển che được 43 bản (11,7%). Muốn cho thấy phân bổ ngân sách rõ nhất thì chọn X khoảng 20–35 triệu. Số liệu phụ thuộc dữ liệu dev lúc chạy; chạy `validate` hoặc e2e với đúng X trước buổi demo.

## Mở đầu tùy chọn (≈ 1 phút): nhận diện sách từ ảnh bìa

1. Trong `/ai-assistant` bấm nút ảnh, xác nhận thông báo xử lý ảnh bên ngoài, gửi ảnh bìa. Hệ thống trả IDENTIFIED (hoặc AMBIGUOUS + danh sách để chọn) kèm bằng chứng OCR và so khớp ảnh.
2. Hỏi: **"Cuốn này còn ở những kho nào? Kho nào đang có nhiều nhất?"** — trả lời theo tồn từng kho trong phạm vi Manager được xem (không phải chi nhánh công khai).
3. Chuyển sang lượt 1 bên dưới.

- Dùng ảnh chụp **đúng ấn bản trong catalog** (bìa trong thư viện ảnh CLIP là ảnh bìa của catalog); ảnh một ấn bản khác vẫn đọc được tên bằng OCR nhưng chỉ ra AMBIGUOUS. Nối vào phần sau tốt nhất là một cuốn TP.HCM đang thiếu (ví dụ *Sứ Mệnh Hail Mary*); thử ảnh đó trước buổi demo.
- Kiểm tra ngày 26/11/2026 bằng ảnh *Số đỏ* (bộ dữ liệu nghiên cứu): bản bị che một phần → IDENTIFIED; bản chụp nghiêng → AMBIGUOUS, chọn "Số đỏ" → "15 bản, tất cả ở Kho HCM Chinh" (đúng dữ liệu). Ảnh sách ngoài thư viện → AMBIGUOUS, không bị kết luận nhầm.
- Kiểm tra trên giao diện web ngày 26/11/2026 (Playwright, `rebalance.manager`): ảnh bìa *Sứ Mệnh Hail Mary* đúng ấn bản catalog, chụp nghiêng → IDENTIFIED; trả lời "không có bản nào trong các kho bạn được xem" (đúng: TP.HCM đang thiếu 16 bản) — nối thẳng sang lượt 1.
- Cần mạng (OCR qua OpenRouter, ~3–4 giây). Thư viện ảnh nạp lười: lần nhận diện đầu tiên sau khi khởi động lại ai-service có thể bị timeout phần so khớp ảnh. Trước buổi demo gửi thử một ảnh (hoặc admin gọi `POST /ai/find-book-by-cover/reindex`; Manager bị 403).
- Xóa lịch sử hội thoại của tài khoản demo trước khi trình bày (nút "Xóa toàn bộ lịch sử").

### Phương án cho riêng cuốn sách trong ảnh

Sau bước 2, hỏi tiếp về **chính cuốn đó** (để ảnh còn đính kèm trong ô hỏi):

| Câu hỏi | Kết quả (kiểm tra thật 26/11/2026, ảnh bìa *7 Thói Quen Hiệu Quả - Bìa Cứng (Tái Bản 2022)*) |
|---|---|
| Đây là sách gì? Sách này còn tồn ở kho nào? | 12 bản, tất cả ở Kho Đà Nẵng |
| Phương án bổ sung cho sách này về kho TP.HCM là gì? Nên điều chuyển hay mua mới? | Thẻ ghi "Phạm vi: chỉ cuốn …"; kết hợp: chuyển 10 bản Đà Nẵng → HCM (Manager tự làm, Đà Nẵng giữ 2 bản an toàn) + mua 1 bản, 175.000 ₫ |
| So sánh ba phương án cho riêng cuốn này. | 3 phương án của riêng cuốn này |
| Tôi đồng ý. Hãy tạo bản nháp … cho những hành động tôi đủ quyền thực hiện. | 1 yêu cầu điều chuyển 10 bản + 1 phiếu nhập 1 bản |
| Tôi xác nhận. … | Tạo đúng các yêu cầu của cuốn này |

- Câu nên có "điều chuyển hay mua mới" (chỉ "phương án bổ sung" được hiểu là hỏi đề xuất nhập).
- Cuốn sách được giữ cho các lượt sau (ngân sách, giảm %, bản nháp, xác nhận) đến khi câu hỏi mở rộng ("tất cả các kho", "những sách nào") — lúc đó quay về phương án mọi đầu sách, tức lượt 1 bên dưới.
- Ngân sách ở quy mô một cuốn rất nhỏ (*7 Thói Quen*: 175.000 ₫ — ngân sách không ràng buộc; *Sứ Mệnh Hail Mary*: mua 15 bản ≈ 2,5 triệu, chỉ mua mới vì không kho nào còn sách — ngân sách 2 triệu → 11/15 bản). Muốn cho thấy phân bổ ngân sách thì làm ở phần mọi đầu sách.

## Kịch bản

| # | Câu hỏi (nguyên văn) | Mục tiêu | Thẻ | Lời thuyết trình ngắn |
|---|---|---|---|---|
| 1 | Hãy phân tích tồn kho và nhu cầu của tất cả các kho tôi được phép truy cập. Kho nào đang thiếu, kho nào đang dư, và có thể điều chuyển an toàn những sách nào về kho TP.HCM? | Chẩn đoán + cơ hội điều chuyển | Chẩn đoán, Cơ hội điều chuyển, tiến trình | "AI tự xác định tôi xem được 3 kho, Hà Nội chỉ đọc. Kho nguồn không bao giờ bị rút dưới mức cần giữ; hàng từ Hà Nội là việc của Manager kho đó." |
| 2 | So sánh ba phương án: chỉ điều chuyển, chỉ mua mới và kết hợp cả hai. Phương án nào hiệu quả nhất? | So sánh | So sánh phương án | "Engine xếp hạng theo quy tắc cố định in dưới bảng; tách phương án tốt nhất về nghiệp vụ và phương án tôi tự làm được. Chi phí điều chuyển không có dữ liệu nên không tính." |
| 3 | Tối ưu phương án tốt nhất với ngân sách mua sách **X triệu đồng**. | Phân bổ ngân sách | Phân bổ ngân sách | "Ngân sách chỉ dành cho mua mới; nếu không đủ, hệ thống ưu tiên đầu sách thiếu nhiều và ưu tiên cao." |
| 4 | Nếu ngân sách giảm 20%, phương án và mức đáp ứng nhu cầu thay đổi thế nào? | What-if | So sánh kịch bản (trước → sau), có dòng "Bạn tự thực hiện" | "Hệ thống chạy lại engine với ngân sách mới; chênh lệch do code tính, không phải LLM tự suy." |
| 5 | Tôi đồng ý với phương án ngân sách ban đầu. Hãy tạo bản nháp yêu cầu điều chuyển và mua mới cho những hành động tôi đủ quyền thực hiện. | Bản nháp | Bản nháp điều chuyển và mua mới | "'Ban đầu' được lấy lại từ bộ nhớ kịch bản; việc của Hà Nội chỉ là đề xuất; chưa có gì được tạo." |
| 6 | Tôi xác nhận. Hãy kiểm tra lại quyền và tồn kho rồi thực hiện các yêu cầu hợp lệ theo workflow hiện tại. | Thực hiện | Kết quả thực hiện, tiến trình | "Kiểm tra lại quyền (không dùng cache), chống tạo trùng, kiểm tồn; yêu cầu ở trạng thái chờ duyệt, có mã TO-/PR-." |
| 7 | Phê duyệt luôn yêu cầu điều chuyển vừa tạo giúp tôi. | Ranh giới an toàn | — | "AI từ chối theo luật cố định, không qua LLM: duyệt, xuất kho, nhận hàng vẫn là việc của người duyệt trên màn hình Yêu cầu." |

Nếu còn thời gian: mở trang Yêu cầu xuất/chuyển kho để thấy mã `TO-…` vừa tạo ở trạng thái REQUESTED.

## Câu hỏi dự phòng khi thuyết trình

- "Tại sao không lấy hàng Hà Nội?" → quyền chỉ xem; phương án tự thực hiện mua bù phần đó. Nếu Manager Hà Nội đồng ý chuyển, phiếu nhập tương ứng có thể giảm.
- "Nếu kho Hà Nội không thể điều chuyển thì sao?" → what-if loại kho nguồn.
- "Nếu nhu cầu tăng 30%?" → what-if nhu cầu.

## Giới hạn cần biết

- Lượt chẩn đoán / điều chuyển (lượt 1) và so sánh phương án (lượt 2, và lượt "phương án cho sách này") do **hệ thống viết từ dữ liệu**, không qua LLM — trùng khớp với các thẻ. Lượt bản nháp, xác nhận và từ chối phê duyệt cũng do hệ thống viết.
- Lượt ngân sách và what-if do LLM (`OPENROUTER_ASSISTANT_MODEL`) viết nên câu chữ khác nhau giữa các lần; câu sai dòng điều chuyển, gán số của phương án khác hoặc sai lý do bị bắt, yêu cầu viết lại, rồi được thay bằng số đúng hoặc bỏ. Số liệu trên thẻ do analytics tính và không đổi theo LLM.
- Chi phí và thời gian điều chuyển chưa có dữ liệu lịch sử, nên không được đưa vào xếp hạng.
