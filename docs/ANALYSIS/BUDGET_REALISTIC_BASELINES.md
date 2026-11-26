# Phân bổ ngân sách: SmartBook so với cách thư viện chi tiền thực tế

Ngày: 2026-11-26 · Nhánh `hungg` · Script: `services/analytics-service/eval/budget-realistic.js`

## 1. Vì sao có nghiên cứu này

`REORDER_OPTIMIZATION_EVALUATION.md` so thứ tự cấp vốn mới của SmartBook với **bản cũ của chính nó** — câu hỏi kỹ thuật
"có thay code production không". Hai baseline đơn giản ở đó (`REORDER_POINT`, `MA30_FIXED_LT`) khi thiếu ngân sách được cấp
tiền **theo thứ tự danh mục**, không thủ thư nào làm vậy. Câu hỏi cho khóa luận là: **cùng một ngân sách, SmartBook tốt hơn
cách chi tiền thực tế của thư viện bao nhiêu?**

## 2. Mốc so sánh (`eval/budget-baselines.js`, có test `test/budget-baselines.test.js`)

Mỗi mốc = quy tắc số lượng (`REORDER_POINT` min/max 5/10, hoặc `MA30_FIXED_LT` trung bình 30 ngày + tồn an toàn) × quy tắc
chi tiền khi thiếu ngân sách (mua được bao nhiêu bản của một dòng thì mua, không vượt số lượng đề xuất):

| Quy tắc chi tiền | Cách làm | Tương ứng thực tế |
| --- | --- | --- |
| `POPULAR_FIRST` | Sách có nhiều lượt mượn 30 ngày gần nhất được mua trước | Cảm nhận của thủ thư |
| `HOLDS_FIRST` | Sách có nhiều đặt trước đang chờ được mua trước | Mua theo yêu cầu bạn đọc |
| `CATEGORY_SHARE` | Chia ngân sách theo tỷ lệ lượt mượn của thể loại; trong thể loại, sách mượn nhiều trước | Công thức phân bổ kinh phí bổ sung |
| `ONE_EACH` | Mỗi dòng thiếu được 1 bản mỗi vòng, đến khi hết tiền | Chia đều |

SmartBook = chế độ ngân sách của production (`IP_RETURNS+FLOOR+MARGINAL`). SmartBook phải thắng **mốc tốt nhất** trong 8 mốc,
chọn sau khi đã thấy kết quả (lợi cho các mốc).

## 3. Giao thức (cố định trong đầu script trước khi chạy)

- **Dữ liệu tổng hợp:** 8 seed mới 20261301–08 (chưa từng dùng để xây hay chọn SmartBook), 3 kịch bản (bình thường, giao chậm,
  tồn đầu một nửa), ngân sách × 0,5 / 0,75 / 1 / 1,25 / 1,5 mức tham chiếu.
- **Dữ liệu thật:** lượt mượn của hai thư viện Indonesia (Mendeley 10.17632/6rd45bvxjy.1, CC BY 4.0). Chỉ có lượt mượn đã phục
  vụ nên bắt đầu với một nửa số bản thật hoặc 1 bản/đầu sách; đơn giá giả định cố định; ngân sách × 0,5 / 1 / 1,5.
- **Giả thuyết chính** (dữ liệu tổng hợp, ngân sách × 1): fill rate SmartBook cao hơn mốc tốt nhất ở **mọi** seed × kịch bản.
  Phần còn lại là mô tả.
- **Sửa đổi công khai:** thư viện công cộng chỉ dùng đầu sách có ≥ 10 lượt mượn (12.079/54.564 đầu sách, 66,3% lượt mượn) vì
  toàn bộ danh mục chạy quá lâu; quyết định trước khi chạy tệp này. Một lần chạy thử đo thời gian (thư viện ĐH, 1 bản/đầu sách,
  ngân sách × 1) đã được xem trước; không thay đổi gì sau đó.

## 4. Kết quả

<!-- AUTO:budget-realistic:start -->
> Sinh bởi `services/analytics-service/eval/budget-realistic.js` — không sửa tay phần này. Giao thức cố định ở đầu script trước khi chạy.
> Dữ liệu `synthetic` là **dữ liệu TỔNG HỢP**; `public` và `univ` là **lượt mượn THẬT** (Mendeley 10.17632/6rd45bvxjy.1, CC BY 4.0),
> nhưng chỉ có lượt mượn đã phục vụ nên số bản ban đầu và đơn giá (100.000 đ/bản) là giả định.

**Kết luận chính (dữ liệu tổng hợp, ngân sách × 1, 8 seed mới × 3 kịch bản):** SmartBook có fill rate cao hơn mốc tốt nhất ở
**0/24** lần chạy → giả thuyết **KHÔNG được xác nhận**.

### Kết quả chính — ngân sách × 1
| Dữ liệu | Kịch bản | Ngân sách (× mốc) | SmartBook | Mốc tốt nhất | Mốc tốt nhất: fill | Δ fill (điểm %) | Giảm lượt không phục vụ (%) | Δ ngày hết sách | Chi phí SB / mốc (%) | Thắng mốc tốt nhất | Thắng cả 8 mốc |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| synthetic | Bình thường | 1 | 96.65% | REORDER_POINT/ONE_EACH | 97.27% | -0.61 [-0.92; -0.31] | -21.9 [-31.8; -11.9] | 61.1 [32.9; 89.3] | 112.1 [110.1; 114.2] | 0/8 | 0/8 |
| synthetic | Giao chậm 14–28 ngày | 1 | 94.99% | REORDER_POINT/ONE_EACH | 96.95% | -1.96 [-2.32; -1.60] | -64.0 [-71.6; -56.3] | 192.1 [150.3; 234.0] | 113.0 [110.7; 115.3] | 0/8 | 0/8 |
| synthetic | Tồn đầu bằng một nửa | 1 | 88.45% | REORDER_POINT/ONE_EACH | 89.28% | -0.83 [-1.27; -0.38] | -8.1 [-12.5; -3.7] | 34.5 [-6.5; 75.5] | 106.8 [104.8; 108.7] | 0/8 | 0/8 |

### Quét mức ngân sách và dữ liệu thật
| Dữ liệu | Kịch bản | Ngân sách (× mốc) | SmartBook | Mốc tốt nhất | Mốc tốt nhất: fill | Δ fill (điểm %) | Giảm lượt không phục vụ (%) | Δ ngày hết sách | Chi phí SB / mốc (%) | Thắng mốc tốt nhất | Thắng cả 8 mốc |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| synthetic | Bình thường | 0.5 | 93.35% | REORDER_POINT/ONE_EACH | 93.14% | 0.21 [-0.05; 0.47] | 3.0 [-0.8; 6.9] | -51.0 [-78.8; -23.2] | 99.5 [99.4; 99.7] | 6/8 | 6/8 |
| synthetic | Bình thường | 0.75 | 95.42% | REORDER_POINT/ONE_EACH | 95.97% | -0.55 [-0.82; -0.28] | -13.6 [-20.3; -7.0] | 43.3 [19.1; 67.4] | 100.0 [99.8; 100.1] | 0/8 | 0/8 |
| synthetic | Bình thường | 1.25 | 97.42% | REORDER_POINT/ONE_EACH | 97.97% | -0.55 [-0.84; -0.26] | -26.4 [-39.1; -13.7] | 57.5 [29.4; 85.6] | 121.3 [119.4; 123.2] | 0/8 | 0/8 |
| synthetic | Bình thường | 1.5 | 97.86% | REORDER_POINT/ONE_EACH | 98.32% | -0.46 [-0.73; -0.19] | -26.3 [-40.1; -12.5] | 48.4 [21.8; 75.0] | 127.9 [125.3; 130.6] | 0/8 | 0/8 |
| synthetic | Giao chậm 14–28 ngày | 0.5 | 91.62% | REORDER_POINT/ONE_EACH | 92.84% | -1.22 [-1.66; -0.78] | -17.1 [-23.3; -11.0] | 92.1 [43.7; 140.5] | 99.7 [99.5; 99.9] | 0/8 | 0/8 |
| synthetic | Giao chậm 14–28 ngày | 0.75 | 93.46% | REORDER_POINT/ONE_EACH | 95.64% | -2.18 [-2.59; -1.77] | -50.4 [-60.1; -40.8] | 201.9 [158.2; 245.5] | 100.2 [99.8; 100.5] | 0/8 | 0/8 |
| synthetic | Giao chậm 14–28 ngày | 1.25 | 96.09% | REORDER_POINT/ONE_EACH | 97.66% | -1.57 [-2.04; -1.10] | -66.8 [-84.9; -48.6] | 158.6 [109.7; 207.6] | 131.1 [128.4; 133.9] | 0/8 | 0/8 |
| synthetic | Giao chậm 14–28 ngày | 1.5 | 96.92% | REORDER_POINT/ONE_EACH | 98.02% | -1.09 [-1.51; -0.67] | -54.9 [-75.6; -34.2] | 113.0 [72.7; 153.3] | 151.4 [148.6; 154.2] | 0/8 | 0/8 |
| synthetic | Tồn đầu bằng một nửa | 0.5 | 77.04% | REORDER_POINT/ONE_EACH | 76.88% | 0.17 [-0.50; 0.84] | 0.5 [-2.2; 3.3] | -243.5 [-333.6; -153.4] | 99.6 [99.4; 99.7] | 4/8 | 4/8 |
| synthetic | Tồn đầu bằng một nửa | 0.75 | 84.23% | REORDER_POINT/ONE_EACH | 84.75% | -0.52 [-1.22; 0.17] | -3.9 [-8.3; 0.6] | -55.1 [-125.2; 14.9] | 99.8 [99.7; 99.8] | 2/8 | 2/8 |
| synthetic | Tồn đầu bằng một nửa | 1.25 | 90.93% | REORDER_POINT/ONE_EACH | 91.70% | -0.78 [-1.26; -0.30] | -9.9 [-16.0; -3.8] | 59.6 [16.2; 103.1] | 108.7 [105.6; 111.8] | 1/8 | 1/8 |
| synthetic | Tồn đầu bằng một nửa | 1.5 | 92.53% | MA30_FIXED_LT/ONE_EACH | 93.24% | -0.71 [-1.09; -0.33] | -11.0 [-17.2; -4.8] | 39.4 [1.2; 77.6] | 91.2 [89.1; 93.3] | 0/8 | 0/8 |
| public | Một nửa số bản thật | 0.5 | 94.62% | MA30_FIXED_LT/ONE_EACH | 94.79% | -0.17 | -3.3 | -34.0 | 100.0 | 0/1 | 0/1 |
| public | Một nửa số bản thật | 1 | 96.61% | MA30_FIXED_LT/ONE_EACH | 97.16% | -0.54 | -19.1 | 595.0 | 119.3 | 0/1 | 0/1 |
| public | Một nửa số bản thật | 1.5 | 97.73% | MA30_FIXED_LT/ONE_EACH | 98.17% | -0.44 | -24.2 | 517.0 | 161.2 | 0/1 | 0/1 |
| public | 1 bản mỗi đầu sách | 0.5 | 85.40% | MA30_FIXED_LT/ONE_EACH | 86.06% | -0.65 | -4.7 | 580.0 | 100.0 | 0/1 | 0/1 |
| public | 1 bản mỗi đầu sách | 1 | 91.32% | MA30_FIXED_LT/ONE_EACH | 92.36% | -1.05 | -13.7 | 1212.0 | 117.7 | 0/1 | 0/1 |
| public | 1 bản mỗi đầu sách | 1.5 | 94.25% | MA30_FIXED_LT/ONE_EACH | 94.91% | -0.66 | -13.0 | 773.0 | 157.6 | 0/1 | 0/1 |
| univ | Một nửa số bản thật | 0.5 | 85.82% | MA30_FIXED_LT/ONE_EACH | 88.45% | -2.62 | -22.7 | 501.0 | 109.6 | 0/1 | 0/1 |
| univ | Một nửa số bản thật | 1 | 88.97% | MA30_FIXED_LT/ONE_EACH | 91.38% | -2.41 | -28.0 | 526.0 | 121.8 | 0/1 | 0/1 |
| univ | Một nửa số bản thật | 1.5 | 90.76% | MA30_FIXED_LT/ONE_EACH | 92.70% | -1.94 | -26.6 | 457.0 | 136.2 | 0/1 | 0/1 |
| univ | 1 bản mỗi đầu sách | 0.5 | 84.45% | MA30_FIXED_LT/ONE_EACH | 87.33% | -2.87 | -22.7 | 553.0 | 109.7 | 0/1 | 0/1 |
| univ | 1 bản mỗi đầu sách | 1 | 88.07% | MA30_FIXED_LT/ONE_EACH | 90.57% | -2.50 | -26.5 | 517.0 | 121.7 | 0/1 | 0/1 |
| univ | 1 bản mỗi đầu sách | 1.5 | 90.08% | MA30_FIXED_LT/ONE_EACH | 92.05% | -1.97 | -24.8 | 445.0 | 136.0 | 0/1 | 0/1 |

### Ngân sách cần để đạt fill rate 95% (× mốc ngân sách, nội suy tuyến tính)
| Dữ liệu | Kịch bản | SmartBook | Mốc tốt nhất ở mức đó |
| --- | --- | --- | --- |
| synthetic | Bình thường | 0.70 | 0.66 (REORDER_POINT/ONE_EACH) |
| synthetic | Giao chậm 14–28 ngày | 1.00 | 0.69 (REORDER_POINT/ONE_EACH) |
| synthetic | Tồn đầu bằng một nửa | chưa đạt trong khoảng quét | chưa đạt trong khoảng quét |
| public | Một nửa số bản thật | 0.59 | 0.54 (MA30_FIXED_LT/ONE_EACH) |
| public | 1 bản mỗi đầu sách | chưa đạt trong khoảng quét | chưa đạt trong khoảng quét |
| univ | Một nửa số bản thật | chưa đạt trong khoảng quét | chưa đạt trong khoảng quét |
| univ | 1 bản mỗi đầu sách | chưa đạt trong khoảng quét | chưa đạt trong khoảng quét |

### Fill rate trung bình của mọi chính sách
| Dữ liệu | Kịch bản | Ngân sách (× mốc) | SMARTBOOK | REORDER_POINT/POPULAR_FIRST | REORDER_POINT/HOLDS_FIRST | REORDER_POINT/CATEGORY_SHARE | REORDER_POINT/ONE_EACH | MA30_FIXED_LT/POPULAR_FIRST | MA30_FIXED_LT/HOLDS_FIRST | MA30_FIXED_LT/CATEGORY_SHARE | MA30_FIXED_LT/ONE_EACH |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| synthetic | Bình thường | 0.5 | 93.35% | 90.20% | 91.46% | 92.05% | 93.14% | 87.11% | 89.59% | 89.45% | 89.20% |
| synthetic | Bình thường | 0.75 | 95.42% | 92.67% | 93.31% | 94.04% | 95.97% | 89.03% | 91.20% | 91.16% | 92.22% |
| synthetic | Bình thường | 1 | 96.65% | 94.70% | 94.93% | 95.57% | 97.27% | 91.37% | 92.69% | 92.87% | 95.04% |
| synthetic | Bình thường | 1.25 | 97.42% | 96.00% | 96.07% | 96.53% | 97.97% | 93.58% | 94.33% | 94.55% | 96.78% |
| synthetic | Bình thường | 1.5 | 97.86% | 96.79% | 96.74% | 97.19% | 98.32% | 95.20% | 95.62% | 95.83% | 97.72% |
| synthetic | Giao chậm 14–28 ngày | 0.5 | 91.62% | 90.01% | 91.29% | 91.87% | 92.84% | 87.07% | 89.45% | 89.31% | 89.03% |
| synthetic | Giao chậm 14–28 ngày | 0.75 | 93.46% | 92.35% | 93.03% | 93.78% | 95.64% | 88.84% | 90.94% | 90.91% | 91.97% |
| synthetic | Giao chậm 14–28 ngày | 1 | 94.99% | 94.40% | 94.58% | 95.27% | 96.95% | 91.10% | 92.49% | 92.61% | 94.76% |
| synthetic | Giao chậm 14–28 ngày | 1.25 | 96.09% | 95.69% | 95.83% | 96.23% | 97.66% | 93.35% | 94.02% | 94.34% | 96.50% |
| synthetic | Giao chậm 14–28 ngày | 1.5 | 96.92% | 96.48% | 96.46% | 96.88% | 98.02% | 94.95% | 95.35% | 95.54% | 97.42% |
| synthetic | Tồn đầu bằng một nửa | 0.5 | 77.04% | 71.36% | 73.74% | 74.78% | 76.88% | 64.25% | 70.44% | 69.16% | 71.52% |
| synthetic | Tồn đầu bằng một nửa | 0.75 | 84.23% | 78.57% | 79.25% | 80.87% | 84.75% | 71.28% | 75.32% | 75.50% | 80.18% |
| synthetic | Tồn đầu bằng một nửa | 1 | 88.45% | 84.06% | 84.31% | 85.65% | 89.28% | 78.38% | 80.28% | 81.16% | 87.21% |
| synthetic | Tồn đầu bằng một nửa | 1.25 | 90.93% | 87.78% | 87.62% | 88.80% | 91.70% | 83.81% | 84.90% | 85.72% | 91.29% |
| synthetic | Tồn đầu bằng một nửa | 1.5 | 92.53% | 89.98% | 89.79% | 90.81% | 93.11% | 87.50% | 88.11% | 88.76% | 93.24% |
| public | Một nửa số bản thật | 0.5 | 94.62% | 92.24% | 92.24% | 92.65% | 94.22% | 93.69% | 93.69% | 93.82% | 94.79% |
| public | Một nửa số bản thật | 1 | 96.61% | 93.56% | 93.56% | 93.78% | 96.14% | 96.32% | 96.32% | 96.34% | 97.16% |
| public | Một nửa số bản thật | 1.5 | 97.73% | 94.64% | 94.64% | 94.82% | 97.19% | 97.67% | 97.67% | 97.70% | 98.17% |
| public | 1 bản mỗi đầu sách | 0.5 | 85.40% | 78.89% | 78.89% | 79.51% | 84.01% | 83.65% | 83.65% | 83.86% | 86.06% |
| public | 1 bản mỗi đầu sách | 1 | 91.32% | 82.53% | 82.53% | 83.35% | 90.10% | 90.39% | 90.39% | 90.45% | 92.36% |
| public | 1 bản mỗi đầu sách | 1.5 | 94.25% | 85.86% | 85.86% | 86.53% | 93.12% | 93.74% | 93.74% | 93.77% | 94.91% |
| univ | Một nửa số bản thật | 0.5 | 85.82% | 85.11% | 85.11% | 85.72% | 88.29% | 86.39% | 86.39% | 87.01% | 88.45% |
| univ | Một nửa số bản thật | 1 | 88.97% | 88.30% | 88.30% | 88.73% | 91.08% | 90.33% | 90.33% | 90.25% | 91.38% |
| univ | Một nửa số bản thật | 1.5 | 90.76% | 90.41% | 90.41% | 90.60% | 92.24% | 92.48% | 92.48% | 92.18% | 92.70% |
| univ | 1 bản mỗi đầu sách | 0.5 | 84.45% | 83.86% | 83.86% | 84.66% | 87.09% | 85.47% | 85.47% | 85.72% | 87.33% |
| univ | 1 bản mỗi đầu sách | 1 | 88.07% | 87.18% | 87.18% | 87.79% | 90.24% | 89.67% | 89.67% | 89.53% | 90.57% |
| univ | 1 bản mỗi đầu sách | 1.5 | 90.08% | 89.07% | 89.07% | 89.38% | 91.58% | 91.67% | 91.67% | 91.54% | 92.05% |

### Dữ liệu thật đã dùng
| Nhãn | Thư viện | Đầu sách dùng | Lượt mượn dùng / tổng | Số ngày | Thiếu ngày trả |
| --- | --- | --- | --- | --- | --- |
| public | Indonesian public library system | 12079 (≥ 10 lượt) | 267930 / 404118 | 939 | 0 (gán 12 ngày) |
| univ | Binus University library (Jakarta) | 7563 (≥ 1 lượt) | 52389 / 52389 | 2655 | 216 (gán 8 ngày) |
<!-- AUTO:budget-realistic:end -->

<!-- AUTO:budget-improvement:start -->
> Sinh bởi `services/analytics-service/eval/budget-improvement.js` — không sửa tay phần này. Giao thức cố định ở đầu script.

### Chọn ứng viên trên seed phát triển (20261301–08, ngân sách × 1, trung bình 3 kịch bản)
| Ứng viên | Fill rate TB |
| --- | --- |
| SMARTBOOK | 93.36% |
| REORDER_POINT/ONE_EACH | 94.50% |
| SB_SPREAD | 94.82% |
| SB_NOFLOOR | 93.36% |
| SB_PROTECT | 95.43% |
| SB_NOFLOOR_PROTECT | 95.43% |
| SB_NOFLOOR_SPREAD | 94.82% |

Ứng viên được chọn và đóng băng: **SB_NOFLOOR_PROTECT**.

**Kiểm định trên 8 seed mới (20261401–08), ngân sách × 1:** SB_NOFLOOR_PROTECT có fill rate cao hơn mốc tốt nhất ở **24/24**
lần chạy → giả thuyết **ĐƯỢC XÁC NHẬN**.

### Seed kiểm định
| Dữ liệu | Kịch bản | Ngân sách (× mốc) | Bản cải tiến | Production hiện tại | Mốc tốt nhất | Δ fill vs mốc (điểm %) | Giảm lượt không phục vụ vs mốc (%) | Δ ngày hết sách vs mốc | Chi phí / mốc (%) | Thắng mốc | Δ fill vs production | Thắng production |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| synthetic | Bình thường | 0.5 | 95.56% | 93.28% | REORDER_POINT/ONE_EACH 93.51% | 2.05 [1.75; 2.35] | 31.5 [27.6; 35.5] | -211.6 [-247.2; -176.0] | 99.6 [99.5; 99.8] | 8/8 | 2.28 [1.87; 2.69] | 8/8 |
| synthetic | Bình thường | 0.75 | 97.34% | 95.44% | REORDER_POINT/ONE_EACH 96.27% | 1.07 [0.83; 1.31] | 28.5 [22.8; 34.3] | -98.9 [-126.1; -71.6] | 100.2 [99.6; 100.8] | 8/8 | 1.90 [1.62; 2.17] | 8/8 |
| synthetic | Bình thường | 1 | 98.06% | 96.80% | REORDER_POINT/ONE_EACH 97.46% | 0.59 [0.50; 0.69] | 23.4 [19.9; 27.0] | -49.0 [-60.3; -37.7] | 108.1 [105.8; 110.5] | 8/8 | 1.26 [1.05; 1.47] | 8/8 |
| synthetic | Bình thường | 1.25 | 98.43% | 97.56% | REORDER_POINT/ONE_EACH 98.03% | 0.40 [0.29; 0.52] | 20.2 [15.5; 25.0] | -28.4 [-40.8; -16.0] | 116.2 [113.9; 118.5] | 8/8 | 0.87 [0.70; 1.04] | 8/8 |
| synthetic | Bình thường | 1.5 | 98.65% | 98.00% | REORDER_POINT/ONE_EACH 98.38% | 0.27 [0.19; 0.36] | 16.5 [11.9; 21.0] | -14.4 [-20.6; -8.2] | 122.1 [117.9; 126.2] | 8/8 | 0.65 [0.50; 0.80] | 8/8 |
| synthetic | Giao chậm 14–28 ngày | 0.5 | 94.35% | 91.37% | REORDER_POINT/ONE_EACH 93.20% | 1.15 [0.89; 1.41] | 16.9 [13.3; 20.4] | -130.6 [-157.4; -103.9] | 99.9 [99.7; 100.0] | 8/8 | 2.98 [2.42; 3.53] | 8/8 |
| synthetic | Giao chậm 14–28 ngày | 0.75 | 96.49% | 93.44% | REORDER_POINT/ONE_EACH 95.98% | 0.51 [0.30; 0.72] | 12.9 [7.6; 18.2] | -39.8 [-60.3; -19.2] | 100.2 [99.7; 100.8] | 7/8 | 3.04 [2.61; 3.48] | 8/8 |
| synthetic | Giao chậm 14–28 ngày | 1 | 97.53% | 94.96% | REORDER_POINT/ONE_EACH 97.19% | 0.34 [0.21; 0.46] | 12.1 [7.6; 16.6] | -20.8 [-32.7; -8.8] | 110.8 [108.6; 112.9] | 8/8 | 2.57 [2.22; 2.92] | 8/8 |
| synthetic | Giao chậm 14–28 ngày | 1.25 | 98.02% | 96.19% | REORDER_POINT/ONE_EACH 97.77% | 0.26 [0.14; 0.37] | 11.4 [6.2; 16.6] | -12.3 [-21.5; -3.0] | 130.1 [128.2; 132.0] | 8/8 | 1.83 [1.55; 2.11] | 8/8 |
| synthetic | Giao chậm 14–28 ngày | 1.5 | 98.28% | 97.04% | REORDER_POINT/ONE_EACH 98.11% | 0.17 [0.06; 0.28] | 9.0 [3.1; 14.9] | -4.8 [-14.7; 5.2] | 148.7 [145.2; 152.3] | 7/8 | 1.25 [1.08; 1.41] | 8/8 |
| synthetic | Tồn đầu bằng một nửa | 0.5 | 81.52% | 76.50% | REORDER_POINT/ONE_EACH 77.05% | 4.47 [3.44; 5.50] | 19.3 [15.4; 23.2] | -560.5 [-637.9; -483.1] | 99.8 [99.7; 99.9] | 8/8 | 5.02 [4.55; 5.49] | 8/8 |
| synthetic | Tồn đầu bằng một nửa | 0.75 | 88.55% | 83.84% | REORDER_POINT/ONE_EACH 85.08% | 3.46 [2.58; 4.35] | 23.0 [17.9; 28.0] | -339.9 [-417.1; -262.7] | 99.8 [99.7; 99.9] | 8/8 | 4.70 [3.96; 5.45] | 8/8 |
| synthetic | Tồn đầu bằng một nửa | 1 | 91.84% | 88.16% | REORDER_POINT/ONE_EACH 89.49% | 2.35 [1.91; 2.79] | 22.3 [18.4; 26.2] | -189.5 [-224.3; -154.7] | 101.3 [100.1; 102.6] | 8/8 | 3.69 [3.10; 4.27] | 8/8 |
| synthetic | Tồn đầu bằng một nửa | 1.25 | 93.49% | 90.97% | REORDER_POINT/ONE_EACH 91.81% | 1.68 [1.25; 2.11] | 20.3 [15.7; 24.9] | -113.3 [-146.0; -80.5] | 102.4 [100.5; 104.3] | 8/8 | 2.51 [2.19; 2.84] | 8/8 |
| synthetic | Tồn đầu bằng một nửa | 1.5 | 94.40% | 92.56% | MA30_FIXED_LT/ONE_EACH 93.54% | 0.86 [0.47; 1.26] | 13.0 [7.5; 18.4] | -67.5 [-99.9; -35.1] | 87.6 [85.7; 89.4] | 8/8 | 1.84 [1.58; 2.10] | 8/8 |

### Dữ liệu thư viện thật (mô tả, một lần chạy mỗi ô, không có khoảng tin cậy)
| Dữ liệu | Kịch bản | Ngân sách (× mốc) | Bản cải tiến | Production hiện tại | Mốc tốt nhất | Δ fill vs mốc (điểm %) | Giảm lượt không phục vụ vs mốc (%) | Δ ngày hết sách vs mốc | Chi phí / mốc (%) | Thắng mốc | Δ fill vs production | Thắng production |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| public | Một nửa số bản thật | 0.5 | 97.62% | 94.62% | MA30_FIXED_LT/ONE_EACH 94.79% | 2.83 | 54.3 | -3873.0 | 100.0 | 1/1 | 3.00 | 1/1 |
| public | Một nửa số bản thật | 1 | 98.48% | 96.61% | MA30_FIXED_LT/ONE_EACH 97.16% | 1.32 | 46.6 | -1806.0 | 117.9 | 1/1 | 1.87 | 1/1 |
| public | Một nửa số bản thật | 1.5 | 98.75% | 97.73% | MA30_FIXED_LT/ONE_EACH 98.17% | 0.57 | 31.4 | -777.0 | 158.0 | 1/1 | 1.02 | 1/1 |
| public | 1 bản mỗi đầu sách | 0.5 | 91.78% | 85.40% | MA30_FIXED_LT/ONE_EACH 86.06% | 5.72 | 41.1 | -7709.0 | 100.0 | 1/1 | 6.38 | 1/1 |
| public | 1 bản mỗi đầu sách | 1 | 95.32% | 91.32% | MA30_FIXED_LT/ONE_EACH 92.36% | 2.96 | 38.7 | -3969.0 | 116.6 | 1/1 | 4.00 | 1/1 |
| public | 1 bản mỗi đầu sách | 1.5 | 96.36% | 94.25% | MA30_FIXED_LT/ONE_EACH 94.91% | 1.45 | 28.4 | -1938.0 | 153.4 | 1/1 | 2.11 | 1/1 |
| univ | Một nửa số bản thật | 0.5 | 88.73% | 85.82% | MA30_FIXED_LT/ONE_EACH 88.45% | 0.28 | 2.4 | -200.0 | 107.1 | 1/1 | 2.90 | 1/1 |
| univ | Một nửa số bản thật | 1 | 91.66% | 88.97% | MA30_FIXED_LT/ONE_EACH 91.38% | 0.28 | 3.2 | -166.0 | 117.9 | 1/1 | 2.69 | 1/1 |
| univ | Một nửa số bản thật | 1.5 | 93.07% | 90.76% | MA30_FIXED_LT/ONE_EACH 92.70% | 0.37 | 5.1 | -137.0 | 131.1 | 1/1 | 2.31 | 1/1 |
| univ | 1 bản mỗi đầu sách | 0.5 | 87.81% | 84.45% | MA30_FIXED_LT/ONE_EACH 87.33% | 0.48 | 3.8 | -241.0 | 107.0 | 1/1 | 3.35 | 1/1 |
| univ | 1 bản mỗi đầu sách | 1 | 90.96% | 88.07% | MA30_FIXED_LT/ONE_EACH 90.57% | 0.39 | 4.1 | -202.0 | 117.9 | 1/1 | 2.89 | 1/1 |
| univ | 1 bản mỗi đầu sách | 1.5 | 92.53% | 90.08% | MA30_FIXED_LT/ONE_EACH 92.05% | 0.48 | 6.0 | -161.0 | 131.0 | 1/1 | 2.45 | 1/1 |
<!-- AUTO:budget-improvement:end -->

## 5. Diễn giải (viết tay)

1. **Production hiện tại (`IP_RETURNS+FLOOR+MARGINAL`) không thắng cách chi tiền thực tế tốt nhất.** Trên 8 seed 20261301–08,
   ngân sách × 1, quy tắc min/max + "mỗi đầu sách thêm 1 bản mỗi vòng" (`REORDER_POINT/ONE_EACH`) cao hơn ở 24/24 lần chạy
   (−0,6 đến −2,0 điểm %), dù tiêu ít tiền hơn. Production vẫn thắng 7/8 mốc còn lại.
2. **Nguyên nhân chính:** `MARGINAL` định giá bản sách tiếp theo theo nhu cầu trong **thời gian giao** (14 ngày), nhưng một bản
   mua hôm nay phải phục vụ đến khi đơn **kế tiếp** có thể về: thời gian giao + chu kỳ xem xét (7 ngày). Định giá thiếu 1/3
   khoảng bảo vệ làm sách mượn nhiều bị mua thiếu. Bỏ số lượng tối thiểu theo ưu tiên gần như không đổi kết quả (≤ 0,01 điểm %).
3. **Bản cải tiến `SB_NOFLOOR_PROTECT`** (chọn trên seed phát triển theo quy tắc ghi trước, đóng băng, kiểm định **một lần** trên
   8 seed mới 20261401–08): thắng mốc tốt nhất **24/24** lần chạy ở ngân sách × 1 (+0,34 đến +2,35 điểm %, giảm 12–23% lượt
   không được phục vụ) và thắng production hiện tại 24/24 (+1,3 đến +3,7 điểm %). Thắng ở mọi mức ngân sách đã quét
   (đúng 118/120 lần chạy).
4. **So sánh sạch nhất là ngân sách chặt (× 0,5).** Ở mức này mọi chính sách đều tiêu gần hết tiền (chi phí ≈ 100% mốc), nên
   chênh lệch hoàn toàn do chi đúng chỗ: +1,15 đến +4,47 điểm %, giảm 17–32% lượt không được phục vụ. Ở × 1 trở lên, mốc tốt
   nhất không tiêu hết ngân sách còn bản cải tiến tiêu nhiều hơn 1–11% (× 1) — một phần lợi thế là do dùng hết tiền được cấp.
5. **Dữ liệu thật** (mô tả, mỗi ô một lần chạy): thư viện công cộng (12.079 đầu sách, ~268 nghìn lượt mượn) — bản cải tiến hơn mốc
   tốt nhất 0,6–5,7 điểm % (giảm 28–54% lượt không được phục vụ); thư viện ĐH (7.563 đầu sách, 52 nghìn lượt, lưu lượng thấp) —
   chỉ hơn 0,3–0,5 điểm %. Hạn chế: nhu cầu thật bị cắt bởi số bản thư viện từng có (đánh giá thấp nhu cầu), đơn giá là hằng số
   giả định, số bản ban đầu là kịch bản giảm bớt.
6. **Trạng thái (2026-11-26):** bản cải tiến đã được đưa vào code production của `GET /analytics/reorder-suggestions?budget=`:
   `priorityFloors: false` và `lambda = protectionDemand(avg_daily_demand, lead_time_days)` (`src/utils/budget-allocation.js`,
   `REVIEW_PERIOD_DAYS = 7`). Backtest gọi đúng hàm đó (test `budget-allocation.test.js`); chạy lại seed 20261401/BASE/× 1 cho kết
   quả trùng khớp. Không đổi: chế độ không ngân sách, thứ tự ưu tiên kho, tính năng điều phối tồn kho (`rebalancing.js`, chưa được
   đánh giá với khoảng bảo vệ mới). Cần build lại image analytics-service và ai-service để môi trường đang chạy dùng code mới.
