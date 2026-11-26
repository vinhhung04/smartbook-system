# Tư liệu cho báo cáo: Đánh giá phân bổ ngân sách nhập sách (AI Decision Support)

Ngày: 2026-11-26 · Nhánh `hungg` · Commit triển khai `a13df1f` (CI đạt 10/10 job).

> **Dành cho người soạn báo cáo (hoặc Claude hỗ trợ soạn):** file này gom mọi số liệu, phương pháp và giới hạn cần để viết mục
> "Đánh giá phân bổ ngân sách" trong chương kết quả. Mọi số liệu dưới đây lấy từ file kết quả do script sinh ra (cột "Nguồn"),
> không chép tay. Khi đưa vào báo cáo: giữ nguyên số, giữ nguyên giới hạn ở mục 7, và **không** dùng các số cũ ở mục 8.

## 1. Tóm tắt một đoạn (có thể dùng gần nguyên văn)

Khi ngân sách không đủ cho toàn bộ đề xuất nhập sách, SmartBook phân bổ tiền theo từng bản sách: mỗi bản được cấp cho đầu sách
mà bản đó làm tăng nhiều nhất xác suất đáp ứng nhu cầu trên mỗi đồng (mô hình Poisson). Phương án này được so sánh với tám cách
chi ngân sách mà thư viện thường dùng khi không có hệ thống hỗ trợ, trên cùng nhu cầu, cùng tồn ban đầu, cùng thời gian giao và
cùng ngân sách. Đánh giá phát hiện phiên bản ban đầu thua cách đơn giản "mỗi đầu sách thêm một bản"; nguyên nhân là bản sách được
định giá theo nhu cầu trong thời gian giao hàng, trong khi nó phải phục vụ đến khi đơn nhập kế tiếp có thể về. Sau khi sửa, phiên
bản cải tiến — được chọn trên bộ dữ liệu phát triển và kiểm định một lần trên tám bộ dữ liệu mới — có mức đáp ứng cao hơn cách chi
tốt nhất ở 24/24 lần chạy, giảm 12–23% số lượt bạn đọc không mượn được; trên dữ liệu mượn thật của một thư viện công cộng, mức
giảm là 28–54%.

## 2. Bài toán và chỉ số

- **Bài toán:** mỗi kỳ xem xét (7 ngày), hệ thống đề xuất số bản cần nhập cho từng đầu sách; khi tổng chi phí vượt ngân sách của kỳ,
  phải chọn bản nào được mua.
- **Fill rate (mức đáp ứng):** tỷ lệ lượt mượn được phục vụ ngay = lượt được phục vụ / tổng lượt có nhu cầu.
- **Lượt không được phục vụ (unmet demand):** lượt bạn đọc muốn mượn nhưng kệ hết sách. Chỉ số dễ hiểu nhất cho hội đồng.
- **Ngày hết sách (stockout days):** tổng số ngày × đầu sách mà kệ trống.
- **Chi phí:** tổng tiền mua trong kỳ chấm điểm.

## 3. Phương pháp đánh giá

### 3.1. Mô phỏng tồn kho
- Bộ mô phỏng tồn kho ảo (`services/analytics-service/eval/inventory-simulator.js`): mỗi chính sách có kho riêng, cùng phát lại một
  chuỗi yêu cầu mượn; bản sách được trả về đúng ngày trả; đơn mua về sau thời gian giao. Chính sách chỉ thấy dữ liệu của các ngày
  trước (không rò rỉ tương lai).
- 114 đầu sách, khởi động 395 ngày, chấm điểm khoảng 335 ngày, xem xét mỗi 7 ngày.
- Ngân sách mỗi kỳ = chi phí của baseline rẻ hơn (min/max hoặc MA30) khi không giới hạn ÷ số kỳ (gọi là mức × 1); quét thêm
  × 0,5 / 0,75 / 1,25 / 1,5.
- Ba kịch bản: **Bình thường** (giao 14 ngày), **Giao chậm** (14–28 ngày), **Tồn đầu một nửa**.

### 3.2. Dữ liệu
- **Dữ liệu tổng hợp** (`docs/SYNTHETIC_BEHAVIOR_DATASET.md`): 600 bạn đọc, 8 persona, 24 tháng; nhu cầu là toàn bộ yêu cầu mượn
  trước khi bị cắt bởi hết sách. Mỗi seed là một quần thể bạn đọc khác nhau.
- **Dữ liệu thật** (Mendeley, doi:10.17632/6rd45bvxjy.1, CC BY 4.0): lượt mượn của hai thư viện Indonesia.

| | Thư viện công cộng | Thư viện ĐH Binus (Jakarta) |
|---|---|---|
| Lượt mượn dùng / tổng | 267.930 / 404.118 (đầu sách ≥ 10 lượt) | 52.389 / 52.389 |
| Đầu sách | 12.079 | 7.563 |
| Số ngày | 939 | 2.655 |

### 3.3. Tám mốc so sánh (cách chi ngân sách thực tế)
Quy tắc số lượng {min/max 5/10 (`REORDER_POINT`), trung bình 30 ngày + tồn an toàn (`MA30_FIXED_LT`)} × quy tắc chi tiền khi thiếu
ngân sách:

| Quy tắc chi tiền | Cách làm | Tương ứng thực tế |
|---|---|---|
| Mượn nhiều trước | Sách có nhiều lượt mượn 30 ngày gần nhất được mua trước | Cảm nhận của thủ thư |
| Đặt trước trước | Sách có nhiều đặt trước đang chờ được mua trước | Mua theo yêu cầu bạn đọc |
| Chia theo thể loại | Chia ngân sách theo tỷ lệ lượt mượn của thể loại | Công thức phân bổ kinh phí bổ sung |
| Mỗi đầu sách một bản | Mỗi đầu sách thiếu được 1 bản mỗi vòng đến khi hết tiền | Chia đều |

SmartBook phải thắng **mốc tốt nhất** trong 8 mốc, chọn sau khi đã thấy kết quả (cách chọn có lợi cho các mốc).

### 3.4. Giao thức chống "chọn số đẹp"
1. Giao thức và tiêu chí thắng được ghi trong đầu script **trước khi chạy** (`eval/budget-realistic.js`, `eval/budget-improvement.js`).
2. Bước 1 — đánh giá phiên bản đang chạy trên 8 seed mới 20261301–08.
3. Bước 2 — năm ứng viên cải tiến được thử trên chính 8 seed đó (seed phát triển), chọn theo quy tắc ghi trước (fill rate trung bình
   cao nhất ở ngân sách × 1), rồi **đóng băng**.
4. Bước 3 — ứng viên được chọn chạy **một lần** trên 8 seed hoàn toàn mới 20261401–08 (seed kiểm định).
5. Báo cáo chênh lệch ghép cặp (cùng seed, cùng kịch bản) với khoảng tin cậy 95% (phân phối t, 8 seed).

## 4. Kết quả

### 4.1. Phiên bản ban đầu thua cách chi đơn giản nhất (phát hiện quan trọng)
Seed 20261301–08, ngân sách × 1. Mốc tốt nhất ở cả ba kịch bản là **min/max + mỗi đầu sách một bản**.

| Kịch bản | SmartBook ban đầu | Mốc tốt nhất | Chênh lệch (điểm %, KTC 95%) |
|---|---|---|---|
| Bình thường | 96,65% | 97,27% | −0,61 [−0,92; −0,31] |
| Giao chậm | 94,99% | 96,95% | −1,96 [−2,32; −1,60] |
| Tồn đầu một nửa | 88,45% | 89,28% | −0,83 [−1,27; −0,38] |

Phiên bản ban đầu vẫn thắng 7/8 mốc ở kịch bản bình thường và tồn đầu một nửa; ở kịch bản giao chậm còn thua thêm min/max + chia theo thể loại (95,27%). Mốc tốt nhất còn chi ít tiền hơn (ví dụ một seed: 127,5 so với 144,4 triệu).

**Nguyên nhân:** bản sách tiếp theo được định giá theo P(nhu cầu trong **thời gian giao** > số bản hiện có), nhưng một bản mua hôm nay
phải phục vụ đến khi đơn **kế tiếp** có thể về = thời gian giao + chu kỳ xem xét. Thiếu 1/3 khoảng bảo vệ làm sách mượn nhiều bị mua
thiếu. Số lượng tối thiểu theo mức ưu tiên gần như không ảnh hưởng (≤ 0,01 điểm %).

### 4.2. Chọn ứng viên cải tiến (seed phát triển, ngân sách × 1, trung bình 3 kịch bản)

| Ứng viên | Thay đổi | Fill rate TB |
|---|---|---|
| SmartBook ban đầu | — | 93,36% |
| Min/max + mỗi đầu sách một bản (mốc tốt nhất) | — | 94,50% |
| SB_SPREAD | chi tiền kiểu "mỗi đầu sách một bản" | 94,82% |
| SB_NOFLOOR | bỏ số lượng tối thiểu theo ưu tiên | 93,36% |
| SB_PROTECT | nhu cầu trong thời gian giao + 7 ngày | 95,43% |
| **SB_NOFLOOR_PROTECT** (được chọn) | cả hai thay đổi trên | **95,43%** |
| SB_NOFLOOR_SPREAD | bỏ tối thiểu + chi kiểu một bản | 94,82% |

### 4.3. Kết quả kiểm định (8 seed mới 20261401–08) — kết quả chính
Giả thuyết ghi trước: bản cải tiến có fill rate cao hơn mốc tốt nhất ở **mọi** seed × kịch bản (ngân sách × 1) → **ĐƯỢC XÁC NHẬN, 24/24**.

| Kịch bản | Bản cải tiến | SmartBook ban đầu | Mốc tốt nhất | Δ so với mốc (điểm %) | Giảm lượt không phục vụ so với mốc | Δ so với bản ban đầu (điểm %) |
|---|---|---|---|---|---|---|
| Bình thường | 98,06% | 96,80% | 97,46% | +0,59 [0,50; 0,69] | 23,4% [19,9; 27,0] | +1,26 [1,05; 1,47] |
| Giao chậm | 97,53% | 94,96% | 97,19% | +0,34 [0,21; 0,46] | 12,1% [7,6; 16,6] | +2,57 [2,22; 2,92] |
| Tồn đầu một nửa | 91,84% | 88,16% | 89,49% | +2,35 [1,91; 2,79] | 22,3% [18,4; 26,2] | +3,69 [3,10; 4,27] |

- Thắng mốc tốt nhất ở **118/120** lần chạy trên mọi mức ngân sách đã quét (5 mức × 3 kịch bản × 8 seed); thắng bản ban đầu 120/120.
- **Ngân sách chặt (× 0,5)** là so sánh sạch nhất vì mọi chính sách đều tiêu gần hết tiền (chi phí ≈ 100% mốc): +2,05 (bình thường),
  +1,15 (giao chậm), +4,47 (tồn đầu một nửa) điểm %; giảm 31,5% / 16,9% / 19,3% lượt không được phục vụ; ít hơn 212 / 131 / 561
  ngày hết sách.
- Ở × 1 trở lên mốc tốt nhất không tiêu hết ngân sách, bản cải tiến tiêu nhiều hơn 1–11% (× 1): một phần lợi thế ở các mức này đến từ
  việc dùng hết tiền được cấp. Cần nói rõ điều này nếu trình bày kết quả × 1.

Bảng đầy đủ mọi mức ngân sách: `docs/ANALYSIS/BUDGET_REALISTIC_BASELINES.md` (phần sinh tự động `budget-improvement`).

### 4.4. Dữ liệu mượn thật (mô tả, mỗi ô một lần chạy, không có khoảng tin cậy)

| Thư viện | Kịch bản | Ngân sách | Bản cải tiến | Bản ban đầu | Mốc tốt nhất | Δ so với mốc | Giảm lượt không phục vụ |
|---|---|---|---|---|---|---|---|
| Công cộng | Một nửa số bản thật | × 0,5 | 97,62% | 94,62% | 94,79% | +2,83 | 54,3% |
| Công cộng | Một nửa số bản thật | × 1 | 98,48% | 96,61% | 97,16% | +1,32 | 46,6% |
| Công cộng | 1 bản mỗi đầu sách | × 0,5 | 91,78% | 85,40% | 86,06% | +5,72 | 41,1% |
| Công cộng | 1 bản mỗi đầu sách | × 1 | 95,32% | 91,32% | 92,36% | +2,96 | 38,7% |
| ĐH | Một nửa số bản thật | × 1 | 91,66% | 88,97% | 91,38% | +0,28 | 3,2% |
| ĐH | 1 bản mỗi đầu sách | × 1 | 90,96% | 88,07% | 90,57% | +0,39 | 4,1% |

Mốc tốt nhất trên dữ liệu thật là MA30 + mỗi đầu sách một bản. Bản cải tiến thắng ở cả 12 ô (gồm cả × 1,5). Lợi thế lớn ở thư viện
công cộng (lưu lượng cao), nhỏ ở thư viện ĐH (lưu lượng thấp, nhiều đầu sách chỉ 1 bản).

## 5. Triển khai vào hệ thống
- `GET /analytics/reorder-suggestions?budgetVnd=` (chế độ ngân sách): `lambda = protectionDemand(avg_daily_demand, lead_time_days)`
  với `REVIEW_PERIOD_DAYS = 7` (`services/analytics-service/src/utils/budget-allocation.js`), bỏ số lượng tối thiểu theo ưu tiên.
- Backtest gọi đúng hàm production (có test); chạy lại một seed cho kết quả trùng khớp.
- Không đổi: chế độ không ngân sách, thứ tự ưu tiên kho, tính năng điều phối tồn kho (đã so code cũ/mới trên dữ liệu dev: giống hệt).
- Test: analytics 229/229, ai-service 1.786 đạt; CI GitHub Actions 10/10 job.
- Decision Card/trợ lý AI ghi mức đáp ứng là "nhu cầu đến lần nhập kế tiếp (thời gian chờ hàng + 7 ngày)".

## 6. Ví dụ minh họa trên môi trường demo (dữ liệu dev ngày 26/11/2026)

`GET /analytics/reorder-suggestions` với chế độ ngân sách (tài khoản admin, toàn bộ kho):

| Kịch bản | Kết quả |
|---|---|
| Ngân sách 15 triệu | 34 đầu sách, 116 bản, đáp ứng dự kiến 99,9% |
| Giảm 20% còn 12 triệu | 31 đầu sách, 92 bản, 98,6% |
| 15 triệu, nhà cung cấp giao chậm 7 ngày | 84,2% |
| Ngân sách để đạt 95% | 9,7 triệu (bình thường); 20,5 triệu (giao chậm 7 ngày) |

Đây là ví dụ minh họa trên dữ liệu demo, không phải kết quả đánh giá; số thay đổi theo dữ liệu dev lúc chạy.

## 7. Giới hạn (bắt buộc ghi trong báo cáo)
1. Kết quả chính dùng **dữ liệu tổng hợp** do nhóm mô phỏng, không phải người dùng thật.
2. Dữ liệu thật ở **Indonesia**, chỉ có lượt mượn đã được phục vụ → nhu cầu bị đánh giá thấp (không biết lượt bạn đọc muốn mượn mà
   hết sách). Số bản ban đầu là kịch bản giảm bớt; **đơn giá là hằng số giả định** (100.000 đ/bản); thư viện công cộng chỉ dùng đầu sách
   ≥ 10 lượt mượn (66,3% lượt mượn) vì thời gian chạy.
3. Chu kỳ xem xét 7 ngày là giả định; thư viện xem xét thưa hơn thì khoảng bảo vệ dài hơn.
4. Ở ngân sách × 1 trở lên một phần lợi thế đến từ việc dùng hết ngân sách (mục 4.3).
5. Mức đáp ứng trong Decision Card là ước lượng theo mô hình Poisson, không phải cam kết.
6. Seed phát triển 20261301–08 đã được xem nhiều lần; chỉ kết quả trên seed 20261401–08 là kiểm định.

## 8. Không dùng (số cũ, đã lỗi thời)
- "24/24 tổ hợp cao hơn baseline", "+2,9 đến +8,1 điểm %" (slide cũ): baseline ở đó là **SmartBook bản cũ**, không phải cách chi thực tế.
- "15 triệu → 34 đầu sách, 166 bản, 91,9%", "giao chậm 7 ngày → 80,2%", "mốc 95% cần 17,1 triệu": thuật toán và dữ liệu cũ.
- Mô tả "mỗi bản được cấp theo nhu cầu trong thời gian chờ hàng": đã đổi thành "đến khi đơn nhập kế tiếp có thể về".

## 9. Gợi ý trình bày
- **Hình 1:** biểu đồ dumbbell theo kịch bản (mốc tốt nhất ○ — bản ban đầu ◇ — bản cải tiến ●), trục fill rate, ngân sách × 1, số liệu bảng 4.3.
- **Hình 2:** đường fill rate theo mức ngân sách (× 0,5 → × 1,5) cho bản cải tiến và mốc tốt nhất, kịch bản bình thường.
- **Bảng:** 4.3 (kết quả chính) và 4.4 (dữ liệu thật).
- Câu chốt gợi ý: "Cùng ngân sách, SmartBook giảm 12–23% số lượt bạn đọc không mượn được so với cách chi tốt nhất trong tám cách
  thư viện thường dùng (24/24 lần chạy kiểm định)."
- Có thể kể quá trình như một vòng nghiên cứu: phát hiện thua → tìm nguyên nhân → sửa → kiểm định trên dữ liệu mới. Hội đồng đánh giá cao
  tính trung thực này hơn một con số đẹp không có đối chứng.

## 10. Nguồn và tái lập
| Nội dung | File |
|---|---|
| Báo cáo kỹ thuật đầy đủ (bảng tự sinh + diễn giải) | `docs/ANALYSIS/BUDGET_REALISTIC_BASELINES.md` |
| Kết quả thô | `thesis/data/budget_realistic_results.json`, `thesis/data/budget_improvement_results.json`, `thesis/data/budget_improvement_real_*.json` |
| Mốc so sánh | `services/analytics-service/eval/budget-baselines.js` (+ `test/budget-baselines.test.js`) |
| Script đánh giá | `eval/budget-realistic.js`, `eval/budget-improvement.js` (giao thức ở đầu file) |
| Đánh giá trước đó (so với bản cũ) | `docs/ANALYSIS/REORDER_OPTIMIZATION_EVALUATION.md` |
| Dữ liệu thật | `docs/ANALYSIS/REAL_LIBRARY_DATA_VALIDATION.md` |

Tái lập (từ `services/analytics-service`):
```powershell
node eval/budget-realistic.js --synthetic-only
```
```powershell
node eval/budget-improvement.js --test SB_NOFLOOR_PROTECT
```
