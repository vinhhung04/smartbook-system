# AI Inventory Rebalancing — Kịch bản demo (7 câu)

## Chuẩn bị (chỉ môi trường dev / test)

```powershell
pnpm demo:rebalancing:seed
```
```powershell
pnpm demo:rebalancing:validate
```

- Tài khoản: `rebalance.manager` (mật khẩu demo giống các tài khoản e2e — `DEMO_PASSWORD`), WAREHOUSE_MANAGER.
- Phạm vi: **WH-HCM-01 FULL, WH-HN-01 READ, WH-DN-01 FULL**.
- Fixture: 6 đầu sách có giá, Hà Nội và Đà Nẵng có tồn, TP.HCM thiếu; 292 phiếu mượn đã trả tại TP.HCM trong 4 tuần (nhu cầu). Mọi bản ghi gắn `DEMO-REB`; `pnpm demo:rebalancing:reset` xóa đúng phần đó và các yêu cầu tài khoản demo đã tạo.
- Mở `/ai-assistant`, đăng nhập `rebalance.manager`. Kiểm thử tự động: `pnpm test:e2e:ai-rebalancing-demo` (cần stack có profile `ai`, đặt `BASE_URL` / `PLAYWRIGHT_CHANNEL` nếu cần).

Số liệu dưới đây là của lần chạy 20/11/2026 trên dữ liệu dev; chúng do analytics tính từ fixture và thay đổi theo dữ liệu thật.

| # | Câu hỏi (nguyên văn) | Mục tiêu | Planner / tool thực tế | Backend xử lý | Kết quả quan sát | Thẻ | Lời thuyết trình ngắn |
|---|---|---|---|---|---|---|---|
| 1 | Hãy phân tích tồn kho và nhu cầu của tất cả các kho tôi được phép truy cập. Kho nào đang thiếu, kho nào đang dư sách? | Chẩn đoán | focus SURPLUS/SHORTAGE/DEMAND/DIAGNOSIS → `analyze_inventory_rebalancing {}` | Scope từ auth-service; SQL theo kho × variant; dự báo theo nhu cầu của từng kho | 3 kho (HN chỉ xem); TP.HCM thiếu 5 đầu sách / 62 bản; HN dư 125, ĐN dư 120 bản | A + timeline | "AI tự xác định tôi được xem 3 kho, Hà Nội chỉ đọc; số liệu tính theo nhu cầu riêng của từng kho." |
| 2 | Tìm các cơ hội điều chuyển sách về kho TP.HCM. Tính số lượng điều chuyển an toàn và kiểm tra quyền của tôi. | Cơ hội + số lượng an toàn + quyền | focus TRANSFER_QUANTITY, TRANSFER_OPPORTUNITY → kho đích Kho HCM Chinh | Ghép nguồn dư → đích thiếu, giữ mức cần giữ ở kho nguồn | ĐN → HCM 10 bản *Beartown 2* (ĐN còn 2 = mức giữ, **tự tạo được**); HN → HCM 12 + 14 bản (**cần Manager kho nguồn**) | B | "Kho nguồn không bao giờ bị rút dưới mức cần giữ; hàng từ Hà Nội là việc cần người khác." |
| 3 | So sánh ba phương án: chỉ điều chuyển, chỉ mua mới và kết hợp cả hai. Phương án nào hiệu quả nhất? | So sánh | focus DECISION_COMPARISON, HYBRID_DECISION | 4 phương án, xếp hạng theo quy tắc cố định | Chỉ chuyển 58,1%; chỉ mua 100% / 12.025.000 ₫; kết hợp 100% / 4.473.000 ₫ (**tốt nhất**); kết hợp tự làm được 100% / 8.689.000 ₫ | C | "Không mặc định Hybrid; quy tắc xếp hạng in ngay dưới bảng; chi phí điều chuyển không có dữ liệu nên không tính." |
| 4 | Tối ưu phương án tốt nhất với ngân sách mua sách 15 triệu đồng. | Ngân sách | focus BUDGET_OPTIMIZATION, `budget_vnd: 15000000`, giữ kho đích | Phân bổ biên theo Poisson, không vượt ngân sách | Kết hợp: mua 4.473.000 ₫, còn 10.527.000 ₫ | D | "Ngân sách chỉ dùng cho mua mới; điều chuyển không tốn ngân sách mua." |
| 5 | Nếu ngân sách giảm 20%, phương án và mức đáp ứng nhu cầu thay đổi thế nào? | What-if | focus WHAT_IF → 2 lần gọi: 15 tr (kịch bản cũ) và 12 tr (do planner tính) | Chạy lại engine, code tính chênh lệch | Kết hợp vẫn 100%; ngân sách còn **giảm 3.000.000 ₫**; chỉ mua mới tụt 100% → 98,4% | E | "Giảm 20% không ảnh hưởng phương án kết hợp, nhưng làm hỏng phương án chỉ mua — đó là giá trị của điều chuyển." |
| 6 | Tôi đồng ý với phương án 15 triệu ban đầu. Hãy tạo bản nháp yêu cầu điều chuyển và mua mới cho những hành động tôi đủ quyền thực hiện. | Bản nháp | focus CREATE_DRAFT, khôi phục kịch bản 15 tr | Đọc lại kế hoạch, chỉ lấy phương án thực thi được | Bản nháp: 1 yêu cầu điều chuyển ĐN → HCM (2 dòng, 16 bản) + 4 phiếu nhập (46 bản, ~8.689.000 ₫); 2 việc HN chỉ là đề xuất | F | "'15 triệu ban đầu' được khôi phục từ bộ nhớ kịch bản; chưa có gì được tạo." |
| 7 | Tôi xác nhận. Hãy kiểm tra lại quyền và tồn kho rồi thực hiện các yêu cầu hợp lệ theo workflow hiện tại. | Thực hiện | focus CONFIRM_ACTION → không gọi tool đọc; đi qua `confirm_action` | Quyền đọc fresh, chống trùng, inventory kiểm tồn, audit | EXECUTED: 1 mã TO-… (REQUESTED) + 4 mã PR-… (PENDING); việc của HN được liệt kê cho Manager kho đó | G + timeline | "Câu 'tôi xác nhận' đi đúng con đường của nút Xác nhận; yêu cầu được tạo ở trạng thái chờ duyệt, AI không duyệt, không xuất kho." |

## Câu hỏi dự phòng khi thuyết trình

- "Tại sao không chọn Hà Nội?" → giải thích quyền chỉ xem.
- "Nếu kho Hà Nội không thể điều chuyển thì sao?" → what-if loại kho nguồn.
- "Phê duyệt luôn giúp tôi" → AI từ chối, chỉ ra bước duyệt trên màn hình Yêu cầu.
