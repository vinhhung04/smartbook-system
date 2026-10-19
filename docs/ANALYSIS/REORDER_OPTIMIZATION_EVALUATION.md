# SmartBook — Tối ưu nhập sách có xét chi phí (Phase 4, 2026-10-17/18)

Ký hiệu: **[ĐO]** đã chạy và đo · **[CHƯA ĐO]** chưa có số. Bảng giữa hai dấu `AUTO` do script sinh (không sửa tay); phần
còn lại viết tay. **Mọi kết quả backtest dùng dữ liệu tổng hợp** (bộ mô phỏng hành vi mượn/trả, không phải thư viện thật).

Tài liệu trước: [REORDER_DECISION_EVALUATION.md](REORDER_DECISION_EVALUATION.md) (backtest chính sách, mục 11 nêu các cơ chế
còn mở), [REORDER_CANDIDATES.md](REORDER_CANDIDATES.md) (ứng viên 2026-10-08: SHORTFALL_RANK).

## 1. Audit trước khi thay đổi

Đọc `reorder-suggestion.js`, `forecast.js`, `lead-time.js`, `budget-allocation.js`, `analytics.controller.js`
(`getReorderSuggestions`) và bộ backtest (`eval/inventory-simulator.js`, `reorder-policies.js`):

| Điểm | Hiện trạng (trước Phase 4) | Hệ quả |
|---|---|---|
| Vị thế tồn kho | `available_qty` (tồn khả dụng trên kệ) | Sách đang cho mượn coi như đã mất; sách **đang về** từ phiếu nhập đã gửi nhà cung cấp **không** được trừ → có thể đặt trùng. Backtest thì dùng kệ + đang đặt → production và backtest lệch nhau. |
| Không đếm hai lần | `reserved_qty` đã bị trừ trong `available_qty`; `borrowed_qty` không cộng | Đúng (không đếm hai lần), nhưng quá bảo thủ: mọi bản đang mượn coi như không trả. |
| Tồn an toàn | `max(reorder_point, ⌈z·σ·√L⌉, 2 nếu có nhu cầu)`, z = 1,645 | Không đổi ở Phase 4. |
| Số lượng tối thiểu | HIGH ≥ 5, MEDIUM ≥ 3 luôn áp dụng | Mua thêm cho đầu sách mà kệ đã đủ cho thời gian chờ. |
| Thời gian chờ | lịch sử giao theo variant → nhà cung cấp → cam kết → mặc định 14 ngày (`lead_time_source`) | Không đổi. |
| Ngân sách | cấp nguyên dòng theo thiếu hụt/VND (`SHORTFALL_PER_COST`); dòng không vừa thì bỏ qua cả dòng | Một dòng có nhu cầu thật nhưng đắt (vd. 250 bản × 89 000 đ) bị bỏ hẳn, tiền chảy sang dòng tồn an toàn. |
| Backtest ↔ production | backtest gọi đúng `calculateSuggestion` của production | Tốt; nhưng phân bổ ngân sách mới chỉ có trong `eval/`. |

## 2. Ứng viên và giao thức (đăng ký trước, trong đầu `eval/reorder-optimization.js`)

- Ứng viên không ngân sách: **IP_RETURNS** (vị thế = kệ + đang đặt + số bản đang mượn dự kiến trả trong thời gian chờ, ước
  lượng Kaplan–Meier — `src/utils/expected-returns.js`), **FLOOR_IF_SHORTFALL** (số lượng tối thiểu chỉ khi nhu cầu thời gian
  chờ > vị thế), **IP_RETURNS+FLOOR**, **IP_RETURNS+ADAPTIVE_Z** (z = 1,0 cho sách mượn < 0,2 lượt/ngày).
- Ứng viên có ngân sách: **MARGINAL** (số lượng production, cấp **từng bản** theo P(D > vị thế + k)/đơn giá, D ~ Poisson(nhu cầu
  thời gian chờ)), **IP_RETURNS+FLOOR**, **IP_RETURNS+FLOOR+MARGINAL**.
- So với baseline: NO_REORDER, REORDER_POINT, MA30_FIXED_LT, SMARTBOOK (production) — cùng cầu, cùng tồn đầu, cùng kịch bản
  thời gian chờ, cùng đơn giá, chu kỳ xem xét 7 ngày, cùng ngân sách mỗi lần xem xét.
- Kịch bản: BASE, SUPPLIER_DELAY (nhà cung cấp giao chậm), LEAN_START (tồn đầu ít).
- Seed phát triển 20260928, 20261101–03; **seed kiểm định mới** 20261201–08 (8 quần thể × 3 kịch bản = 24 lần chạy).
- Tiêu chí (cố định trước khi chạy seed kiểm định): ứng viên không ngân sách thay production nếu **mọi** lần chạy có fill rate
  ≥ SMARTBOOK − 0,05 điểm %, stockout days ≤ max(1,05×, +2) **và** tổng chi phí ≤ 90 % SMARTBOOK; ứng viên ngân sách thay thứ
  tự cấp vốn nếu fill rate **cao hơn** SMARTBOOK_BUDGET ở **mọi** lần chạy; nhiều ứng viên đạt → chọn tổng chi phí thấp nhất.

Ghi chú quy trình (công khai): bản đầu của script chọn ứng viên ngân sách theo fill rate thay vì "tổng chi phí thấp nhất" như
đã đăng ký; đã sửa mã theo đúng quy tắc đăng ký. Trên số liệu kiểm định, hai quy tắc chọn cùng một ứng viên
(IP_RETURNS+FLOOR+MARGINAL có cả fill rate cao nhất lẫn tổng chi phí thấp nhất trong nhóm đạt).

<!-- AUTO:reorder-optimization:start -->
> Sinh bởi `services/analytics-service/eval/reorder-optimization.js` — không sửa tay phần này. **Dữ liệu TỔNG HỢP** (bộ mô phỏng
> hành vi, không phải thư viện thật). Giao thức và tiêu chí chấp nhận cố định trong đầu script trước khi chạy seed kiểm định.

- Seed phát triển: 20260928, 20261101, 20261102, 20261103. **Seed kiểm định (mới):** 20261201, 20261202, 20261203, 20261204, 20261205, 20261206, 20261207, 20261208 (8 quần thể × 3 kịch bản).
- 114 variant, chu kỳ xem xét 7 ngày, warm-up 395 ngày, chấm điểm ~335 ngày; ngân sách mỗi lần xem xét = chi phí của baseline rẻ hơn ÷ số lần xem xét.

### Kết luận trên seed kiểm định
| Ứng viên (không ngân sách) | Mức phục vụ không kém (mọi seed × kịch bản) | Chi phí so với SMARTBOOK | Kết quả |
| --- | --- | --- | --- |
| IP_RETURNS | KHÔNG (1 lần) | 95.4% | không đạt |
| FLOOR_IF_SHORTFALL | KHÔNG (21 lần) | 83.4% | không đạt |
| IP_RETURNS+FLOOR | KHÔNG (24 lần) | 65.6% | không đạt |
| IP_RETURNS+ADAPTIVE_Z | KHÔNG (1 lần) | 95.3% | không đạt |

| Ứng viên (có ngân sách) | Fill rate cao hơn SMARTBOOK_BUDGET | Kết quả |
| --- | --- | --- |
| MARGINAL | 24/24 | **ĐẠT** |
| IP_RETURNS+FLOOR | 23/24 | không đạt |
| IP_RETURNS+FLOOR+MARGINAL | 24/24 | **ĐẠT** |

Ứng viên được chọn: **không có** (không ngân sách), **IP_RETURNS+FLOOR+MARGINAL** (thứ tự cấp vốn).

### Trung bình trên 8 seed kiểm định — không giới hạn ngân sách
| Kịch bản | Chính sách | Fill rate TB | Unmet TB | Stockout days TB | Tồn kho TB (bản) | Giá trị tồn TB (triệu) | Chi phí TB (triệu) | Số đơn TB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BASE | NO_REORDER | 84.50% | 1752 | 1515.0 | 748 | 92.6 | 0.0 | 0 |
| BASE | REORDER_POINT | 99.37% | 71 | 58.0 | 1791 | 213.3 | 148.8 | 181 |
| BASE | MA30_FIXED_LT | 99.45% | 63 | 55.6 | 1934 | 232.8 | 195.1 | 600 |
| BASE | SMARTBOOK | 99.49% | 58 | 51.1 | 2909 | 346.9 | 353.8 | 763 |
| BASE | IP_RETURNS | 99.49% | 58 | 51.4 | 2811 | 334.9 | 344.5 | 815 |
| BASE | FLOOR_IF_SHORTFALL | 99.43% | 65 | 57.5 | 2401 | 287.0 | 270.2 | 495 |
| BASE | IP_RETURNS+FLOOR | 99.29% | 81 | 70.3 | 2004 | 238.5 | 207.3 | 451 |
| BASE | IP_RETURNS+ADAPTIVE_Z | 99.49% | 58 | 51.4 | 2811 | 334.8 | 344.4 | 817 |
| SUPPLIER_DELAY | NO_REORDER | 84.50% | 1752 | 1515.0 | 748 | 92.6 | 0.0 | 0 |
| SUPPLIER_DELAY | REORDER_POINT | 99.13% | 99 | 81.8 | 1760 | 209.8 | 148.3 | 180 |
| SUPPLIER_DELAY | MA30_FIXED_LT | 99.19% | 92 | 80.6 | 1888 | 227.5 | 194.6 | 603 |
| SUPPLIER_DELAY | SMARTBOOK | 99.25% | 85 | 74.0 | 3200 | 381.8 | 418.4 | 665 |
| SUPPLIER_DELAY | IP_RETURNS | 99.25% | 85 | 74.1 | 2980 | 354.8 | 384.9 | 736 |
| SUPPLIER_DELAY | FLOOR_IF_SHORTFALL | 99.18% | 92 | 81.0 | 2988 | 356.1 | 390.6 | 553 |
| SUPPLIER_DELAY | IP_RETURNS+FLOOR | 99.07% | 106 | 92.3 | 2512 | 298.1 | 312.5 | 510 |
| SUPPLIER_DELAY | IP_RETURNS+ADAPTIVE_Z | 99.25% | 85 | 74.1 | 2975 | 354.1 | 383.7 | 739 |
| LEAN_START | NO_REORDER | 48.47% | 5827 | 4628.1 | 352 | 43.7 | 0.0 | 0 |
| LEAN_START | REORDER_POINT | 97.63% | 267 | 202.8 | 1733 | 205.2 | 198.6 | 224 |
| LEAN_START | MA30_FIXED_LT | 97.76% | 253 | 209.1 | 1824 | 219.6 | 242.7 | 728 |
| LEAN_START | SMARTBOOK | 97.94% | 232 | 190.0 | 2700 | 323.8 | 368.7 | 751 |
| LEAN_START | IP_RETURNS | 97.92% | 235 | 192.0 | 2601 | 311.0 | 359.0 | 801 |
| LEAN_START | FLOOR_IF_SHORTFALL | 97.84% | 244 | 200.8 | 2236 | 268.8 | 291.2 | 509 |
| LEAN_START | IP_RETURNS+FLOOR | 97.54% | 278 | 225.8 | 1857 | 222.5 | 228.4 | 459 |
| LEAN_START | IP_RETURNS+ADAPTIVE_Z | 97.92% | 235 | 192.0 | 2599 | 310.8 | 359.1 | 803 |

### Trung bình trên 8 seed kiểm định — cùng ngân sách mỗi lần xem xét
| Kịch bản | Chính sách | Fill rate TB | Unmet TB | Stockout days TB | Tồn kho TB (bản) | Giá trị tồn TB (triệu) | Chi phí TB (triệu) | Số đơn TB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BASE | REORDER_POINT | 94.22% | 653 | 568.1 | 1342 | 159.2 | 135.6 | 165 |
| BASE | MA30_FIXED_LT | 94.26% | 651 | 556.1 | 1362 | 161.5 | 147.0 | 502 |
| BASE | SMARTBOOK | 94.02% | 675 | 584.1 | 1568 | 161.3 | 146.6 | 193 |
| BASE | MARGINAL | 96.02% | 450 | 398.0 | 1520 | 161.8 | 148.0 | 447 |
| BASE | IP_RETURNS+FLOOR | 95.21% | 542 | 492.1 | 1491 | 161.4 | 146.0 | 335 |
| BASE | IP_RETURNS+FLOOR+MARGINAL | 96.95% | 345 | 303.5 | 1459 | 161.4 | 144.9 | 420 |
| SUPPLIER_DELAY | REORDER_POINT | 93.91% | 688 | 598.6 | 1316 | 156.1 | 134.8 | 164 |
| SUPPLIER_DELAY | MA30_FIXED_LT | 94.10% | 668 | 573.1 | 1334 | 158.3 | 146.3 | 505 |
| SUPPLIER_DELAY | SMARTBOOK | 92.32% | 867 | 748.0 | 1597 | 158.2 | 146.1 | 175 |
| SUPPLIER_DELAY | MARGINAL | 93.89% | 692 | 601.4 | 1571 | 158.6 | 147.5 | 388 |
| SUPPLIER_DELAY | IP_RETURNS+FLOOR | 93.22% | 767 | 694.8 | 1523 | 158.3 | 146.7 | 300 |
| SUPPLIER_DELAY | IP_RETURNS+FLOOR+MARGINAL | 95.19% | 545 | 475.0 | 1515 | 158.5 | 147.3 | 373 |
| LEAN_START | REORDER_POINT | 78.53% | 2425 | 1911.9 | 1127 | 133.0 | 183.3 | 203 |
| LEAN_START | MA30_FIXED_LT | 79.55% | 2317 | 1768.5 | 1169 | 135.6 | 194.8 | 608 |
| LEAN_START | SMARTBOOK | 81.15% | 2133 | 1672.1 | 1392 | 135.8 | 196.5 | 246 |
| LEAN_START | MARGINAL | 86.84% | 1490 | 1200.3 | 1331 | 136.3 | 197.9 | 558 |
| LEAN_START | IP_RETURNS+FLOOR | 85.73% | 1615 | 1402.6 | 1290 | 135.7 | 193.5 | 372 |
| LEAN_START | IP_RETURNS+FLOOR+MARGINAL | 89.23% | 1219 | 967.3 | 1252 | 135.0 | 186.8 | 526 |

### Chênh lệch ghép cặp so với SMARTBOOK (trung bình [KTC 95% t] trên seed kiểm định)
| Ứng viên | Kịch bản | Δ fill rate (điểm %) | Δ stockout days | Δ chi phí (%) | Δ tồn kho TB (bản) |
| --- | --- | --- | --- | --- | --- |
| IP_RETURNS | BASE | -0.00 [-0.01; 0.00] | 0.3 [-0.1; 0.6] | -2.6 [-2.9; -2.3] | -98 [-109; -86] |
| IP_RETURNS | SUPPLIER_DELAY | -0.00 [-0.01; 0.00] | 0.1 [-0.6; 0.8] | -8.0 [-8.8; -7.2] | -219 [-245; -194] |
| IP_RETURNS | LEAN_START | -0.02 [-0.04; -0.00] | 2.0 [0.2; 3.8] | -2.6 [-3.2; -2.0] | -99 [-112; -86] |
| FLOOR_IF_SHORTFALL | BASE | -0.06 [-0.08; -0.04] | 6.4 [3.4; 9.3] | -23.6 [-24.9; -22.3] | -508 [-526; -490] |
| FLOOR_IF_SHORTFALL | SUPPLIER_DELAY | -0.07 [-0.11; -0.03] | 7.0 [2.9; 11.1] | -6.7 [-8.0; -5.4] | -211 [-243; -180] |
| FLOOR_IF_SHORTFALL | LEAN_START | -0.11 [-0.13; -0.08] | 10.8 [8.5; 13.0] | -21.0 [-21.9; -20.2] | -464 [-481; -447] |
| IP_RETURNS+FLOOR | BASE | -0.20 [-0.27; -0.13] | 19.1 [12.5; 25.7] | -41.4 [-42.2; -40.6] | -905 [-938; -871] |
| IP_RETURNS+FLOOR | SUPPLIER_DELAY | -0.18 [-0.25; -0.11] | 18.3 [11.0; 25.5] | -25.4 [-26.3; -24.4] | -688 [-708; -667] |
| IP_RETURNS+FLOOR | LEAN_START | -0.40 [-0.52; -0.29] | 35.8 [28.1; 43.4] | -38.0 [-38.5; -37.6] | -843 [-876; -811] |
| IP_RETURNS+ADAPTIVE_Z | BASE | -0.00 [-0.01; 0.00] | 0.3 [-0.1; 0.6] | -2.6 [-3.0; -2.3] | -98 [-109; -87] |
| IP_RETURNS+ADAPTIVE_Z | SUPPLIER_DELAY | -0.00 [-0.01; 0.00] | 0.1 [-0.6; 0.8] | -8.3 [-9.1; -7.4] | -225 [-251; -198] |
| IP_RETURNS+ADAPTIVE_Z | LEAN_START | -0.02 [-0.04; -0.00] | 2.0 [0.2; 3.8] | -2.6 [-3.2; -2.0] | -101 [-114; -88] |

| Ứng viên (ngân sách) | Kịch bản | Δ fill rate (điểm %) | Δ unmet | Δ stockout days |
| --- | --- | --- | --- | --- |
| MARGINAL | BASE | 2.00 [1.77; 2.23] | -225 [-248; -203] | -186.1 [-201.1; -171.1] |
| MARGINAL | SUPPLIER_DELAY | 1.57 [1.19; 1.95] | -176 [-213; -138] | -146.6 [-178.2; -115.0] |
| MARGINAL | LEAN_START | 5.69 [5.26; 6.11] | -644 [-707; -580] | -471.9 [-523.4; -420.4] |
| IP_RETURNS+FLOOR | BASE | 1.18 [0.85; 1.52] | -133 [-170; -97] | -92.0 [-119.5; -64.5] |
| IP_RETURNS+FLOOR | SUPPLIER_DELAY | 0.90 [0.23; 1.57] | -100 [-174; -26] | -53.3 [-108.4; 1.9] |
| IP_RETURNS+FLOOR | LEAN_START | 4.58 [4.19; 4.97] | -519 [-574; -463] | -269.5 [-316.2; -222.8] |
| IP_RETURNS+FLOOR+MARGINAL | BASE | 2.93 [2.64; 3.22] | -330 [-359; -301] | -280.6 [-303.7; -257.6] |
| IP_RETURNS+FLOOR+MARGINAL | SUPPLIER_DELAY | 2.87 [2.33; 3.41] | -323 [-375; -270] | -273.0 [-315.7; -230.3] |
| IP_RETURNS+FLOOR+MARGINAL | LEAN_START | 8.07 [7.54; 8.61] | -914 [-1003; -826] | -704.9 [-768.2; -641.6] |

### Vị trí Pareto (chi phí ↔ fill rate) so với baseline đơn giản, số seed × kịch bản
| Ứng viên | vs REORDER_POINT: trội / bị trội / đánh đổi | vs MA30_FIXED_LT: trội / bị trội / đánh đổi |
| --- | --- | --- |
| SMARTBOOK | 0 / 1 / 23 | 0 / 0 / 24 |
| IP_RETURNS | 0 / 1 / 23 | 0 / 0 / 24 |
| FLOOR_IF_SHORTFALL | 0 / 3 / 21 | 0 / 11 / 13 |
| IP_RETURNS+FLOOR | 0 / 18 / 6 | 0 / 16 / 8 |
| IP_RETURNS+ADAPTIVE_Z | 0 / 1 / 23 | 0 / 0 / 24 |

### Đường đánh đổi theo z (mô tả, seed kiểm định đầu tiên)
| Chính sách | Kịch bản | z | Fill rate | Stockout days | Chi phí (triệu) | Tồn kho TB |
| --- | --- | --- | --- | --- | --- | --- |
| SWEEP_SMARTBOOK_z1 | BASE | 1 | 99.35% | 64.0 | 358.0 | 2908 |
| SWEEP_IP_RETURNS+FLOOR_z1 | BASE | 1 | 99.04% | 95.0 | 189.3 | 1883 |
| SWEEP_SMARTBOOK_z1.28 | BASE | 1.28 | 99.35% | 64.0 | 360.2 | 2924 |
| SWEEP_IP_RETURNS+FLOOR_z1.28 | BASE | 1.28 | 99.09% | 91.0 | 197.0 | 1931 |
| SWEEP_SMARTBOOK_z1.645 | BASE | 1.645 | 99.35% | 64.0 | 360.2 | 2943 |
| SWEEP_IP_RETURNS+FLOOR_z1.645 | BASE | 1.645 | 99.17% | 82.0 | 207.9 | 2003 |
| SWEEP_SMARTBOOK_z2.05 | BASE | 2.05 | 99.35% | 64.0 | 364.1 | 2973 |
| SWEEP_IP_RETURNS+FLOOR_z2.05 | BASE | 2.05 | 99.22% | 76.0 | 218.2 | 2078 |
| SWEEP_SMARTBOOK_z1 | SUPPLIER_DELAY | 1 | 99.17% | 81.0 | 411.2 | 3151 |
| SWEEP_IP_RETURNS+FLOOR_z1 | SUPPLIER_DELAY | 1 | 98.94% | 107.0 | 295.8 | 2407 |
| SWEEP_SMARTBOOK_z1.28 | SUPPLIER_DELAY | 1.28 | 99.17% | 81.0 | 412.5 | 3176 |
| SWEEP_IP_RETURNS+FLOOR_z1.28 | SUPPLIER_DELAY | 1.28 | 98.97% | 104.0 | 303.0 | 2447 |
| SWEEP_SMARTBOOK_z1.645 | SUPPLIER_DELAY | 1.645 | 99.17% | 81.0 | 422.0 | 3229 |
| SWEEP_IP_RETURNS+FLOOR_z1.645 | SUPPLIER_DELAY | 1.645 | 99.03% | 97.0 | 319.2 | 2551 |
| SWEEP_SMARTBOOK_z2.05 | SUPPLIER_DELAY | 2.05 | 99.17% | 81.0 | 432.5 | 3294 |
| SWEEP_IP_RETURNS+FLOOR_z2.05 | SUPPLIER_DELAY | 2.05 | 99.05% | 94.0 | 333.4 | 2658 |
| SWEEP_SMARTBOOK_z1 | LEAN_START | 1 | 98.09% | 179.0 | 365.1 | 2649 |
| SWEEP_IP_RETURNS+FLOOR_z1 | LEAN_START | 1 | 97.25% | 253.0 | 208.1 | 1727 |
| SWEEP_SMARTBOOK_z1.28 | LEAN_START | 1.28 | 98.09% | 179.0 | 366.4 | 2658 |
| SWEEP_IP_RETURNS+FLOOR_z1.28 | LEAN_START | 1.28 | 97.41% | 242.0 | 215.1 | 1768 |
| SWEEP_SMARTBOOK_z1.645 | LEAN_START | 1.645 | 98.09% | 179.0 | 367.5 | 2671 |
| SWEEP_IP_RETURNS+FLOOR_z1.645 | LEAN_START | 1.645 | 97.58% | 224.0 | 224.3 | 1828 |
| SWEEP_SMARTBOOK_z2.05 | LEAN_START | 2.05 | 98.10% | 178.0 | 370.2 | 2697 |
| SWEEP_IP_RETURNS+FLOOR_z2.05 | LEAN_START | 2.05 | 97.78% | 208.0 | 234.7 | 1898 |
<!-- AUTO:reorder-optimization:end -->

## 3. Đọc kết quả (viết tay)

**Không ngân sách — không ứng viên nào đạt; production giữ nguyên.** [ĐO]
- IP_RETURNS gần như không đổi mức phục vụ (Δ fill ≈ 0, KTC chứa 0 ở BASE/SUPPLIER_DELAY; LEAN_START −0,02 điểm %, stockout
  +2,0 ngày, KTC [0,2; 3,8]) và giảm chi phí 2,6–8,0 %. Nó trượt hai điều kiện: tổng chi phí 95,4 % (> 90 %) và 1/24 lần chạy
  (seed 20261205, LEAN_START) có fill rate thấp hơn SMARTBOOK quá biên 0,05 điểm %. ADAPTIVE_Z cho kết quả gần như trùng
  IP_RETURNS → giảm z cho sách mượn chậm không mang lại gì đo được.
- FLOOR_IF_SHORTFALL và IP_RETURNS+FLOOR rẻ hơn rõ (−21 % đến −41 %) nhưng làm tăng stockout days có ý nghĩa ở mọi kịch bản
  (KTC không chứa 0): đó là một **đánh đổi** chi phí ↔ phục vụ, không phải cải thiện. Vị trí Pareto cho thấy IP_RETURNS+FLOOR
  bị REORDER_POINT trội ở 18/24 lần chạy — tiết kiệm nhờ mua ít đi chứ không nhờ mua đúng hơn.
- Vì tiêu chí đăng ký trước không đạt, `suggested_reorder_qty` của danh sách đề xuất **không đổi**.

**Có ngân sách — IP_RETURNS+FLOOR+MARGINAL đạt 24/24 và được tích hợp.** [ĐO]
- Cùng ngân sách mỗi lần xem xét: fill rate +2,93 (BASE), +2,87 (SUPPLIER_DELAY), +8,07 (LEAN_START) điểm % so với
  SMARTBOOK_BUDGET; KTC 95 % đều dương. Trung bình 96,95 / 95,19 / 89,23 % so với REORDER_POINT 94,22 / 93,91 / 78,53 % và
  MA30_FIXED_LT 94,26 / 94,10 / 79,55 %.
- Phần lớn lợi ích đến từ **cấp từng bản** (MARGINAL một mình: +2,00 / +1,57 / +5,69); vị thế tính cả bản trả về và số lượng
  tối thiểu có điều kiện cộng thêm khi đi kèm. Lý do: khi tiền không đủ, chi cho bản sách có xác suất được mượn cao nhất trên
  mỗi đồng thay vì cho cả một dòng tồn an toàn.
- Khi tiền có hạn, mua ít bản hơn cho một đầu sách chưa chắc thiếu (vì đang có bản sắp được trả) là hợp lý; khi tiền không hạn
  chế, cùng cơ chế lại làm giảm phục vụ — nên chỉ áp dụng trong chế độ ngân sách.

## 4. Tích hợp vào production (2026-10-18)

`GET /analytics/reorder-suggestions?budgetVnd=…` (không truyền `budgetVnd` → hành vi cũ, byte-cho-byte):

- `src/utils/budget-allocation.js`: `allocateMarginal(lines, budget)` và `poissonTail` — **cùng một hàm** được backtest gọi
  (`eval/reorder-policies.js → marginalAllocation` giờ ủy quyền cho nó). Chạy lại toàn bộ `reorder-optimization.js` sau khi
  chuyển: `thesis/data/reorder_optimization_results.json` **trùng khớp 100 %** với lần chạy trước (0 trường khác).
- Controller (chỉ khi có ngân sách): đọc vay đang mở + lượt trả 365 ngày từ `borrow_db` (Kaplan–Meier gộp toàn thư viện;
  < 30 lượt trả → không tính bản trả về và ghi rõ), cộng số bản **đang về** = `ordered_qty − received_qty` của phiếu nhập ở
  trạng thái APPROVED / SENT_TO_SUPPLIER / SUPPLIER_CONFIRMED / PARTIALLY_RECEIVED (DRAFT, PENDING_APPROVAL không phải cam kết;
  SHORTAGE_REPORTED có thể không về → không tính), tính lại số lượng với `expectedReturns` + `priorityFloors: 'IF_SHORTFALL'`
  làm **trần**, rồi `allocateMarginal`.
- Hợp đồng API — chỉ thêm trường: mỗi dòng `funded_qty`, `funded_cost`, `budget_plan {incoming_qty, expected_returns,
  inventory_position, cap_qty}`; `within_budget` = `funded_qty > 0`; khối `budget` thêm `funded_lines`, `funded_qty`,
  `partially_funded_lines`, `capped_need_cost`, `returns_model`, `assumptions`; `funding_order` đổi giá trị
  `SHORTFALL_PER_COST` → `MARGINAL_SERVICE_PER_COST`. `summary`, thứ tự danh sách và `suggested_reorder_qty` giữ nguyên
  (kiểm tra live: giống hệt lời gọi không ngân sách).
- Copilot (chỉ đọc): `simulate_reorder_budget` dùng `funded_qty`, báo `partially_funded_lines`, `lines_covered_by_position`,
  `need_with_position_vnd`; quy tắc phân bổ và giả định được đưa vào ngữ cảnh mô hình; bộ xác minh kiểm tra số bản/chi phí
  từng đầu sách được duyệt, câu "không có đầu sách nào duyệt một phần", và coi phương án duyệt đủ nhu cầu theo vị thế là đủ.
  Phiếu đề xuất nháp từ danh sách có ngân sách chỉ lấy dòng được duyệt, với số bản được duyệt — vẫn **chỉ là nháp** cần người
  dùng xác nhận; hệ thống không tự tạo/duyệt PO.
- UI trang Đề xuất nhập: khi có ngân sách, số lượng mặc định = số bản được duyệt; dòng duyệt một phần hiện "Ngân sách duyệt
  X/Y cuốn"; giả định hiện ở tooltip "ngân sách còn".

### 4.1 Hành vi đo trên hệ thống dev (dữ liệu seed, không phải backtest) [ĐO]

| | 6 triệu | 15 triệu | 50 triệu |
|---|---|---|---|
| Chi đã duyệt | 5 997 000 | 14 966 930 | 32 013 740 |
| Đầu sách / bản được duyệt | 2 / 68 | 33 / 167 | 70 / 308 |
| Dòng duyệt một phần | 2 | 21 | 0 |
| Thời gian phản hồi | 97 ms | 113 ms | 88 ms (không ngân sách: 141 ms) |

- Kaplan–Meier ước lượng từ 15 958 lượt trả trong 365 ngày và 905 lượt đang mượn; 76/116 dòng được giảm trần vì bản đang mượn
  dự kiến trả; nhu cầu cần tiền theo vị thế **32,0 triệu** so với 79,3 triệu nếu coi mọi bản đang mượn là mất.
- **Cần người quản lý xem xét:** với 6 triệu, 67/68 bản dồn cho *Dac trung tam ly hoc cua nguoi Viet* vì đây là gần như dòng
  duy nhất mà dự báo nhu cầu thời gian chờ > 0 (nhiều đầu sách HIGH khác có dự báo 30 ngày = 0 do lượt mượn gần đây giảm mạnh
  trong dữ liệu demo). Thuật toán tối đa hóa nhu cầu được phục vụ **theo dự báo**; nếu dự báo sai, phân bổ tập trung sẽ sai
  theo. Không thêm giới hạn "mỗi dòng tối đa X %" vì chưa được kiểm định — đây là hướng tiếp theo (mục 6).

## 5. Kiểm thử [ĐO]

- `services/analytics-service`: `npm test` → 131 pass, 3 skip (gồm 6 test mới cho `allocateMarginal`: không vượt ngân sách/trần,
  bản kế tiếp đi đến dòng tăng xác suất phục vụ nhiều nhất trên mỗi đồng, duyệt một phần, ngân sách 0 / dư, và backtest gọi đúng
  hàm production).
- `services/ai-service`: 1067 pass (test mới: duyệt một phần, dòng vị thế đã đủ không tính là bị bỏ lại, phiếu nháp chỉ lấy dòng
  được duyệt, kiểm tra số bản/chi phí theo đầu sách, câu về duyệt một phần, độ phủ theo vị thế).
- Live qua gateway (manager01): 3 câu hỏi ngân sách trước/sau từng bản sửa — lỗi tìm thấy live và đã sửa: "(68 bản)" cho cả hai
  đầu sách, chi phí đầu sách lấy nhầm số dư ngân sách, BLOCKED oan câu 50 triệu do 16 đầu sách ngoài danh sách, "không có đầu
  sách nào duyệt một phần" khi thực tế có.

## 6. Giới hạn và hướng tiếp theo

1. **Dữ liệu tổng hợp**: mọi số backtest đến từ bộ mô phỏng; mô hình trả sách trong mô phỏng do chính dự án viết. Kết luận về
   fill rate không chuyển thẳng sang thư viện thật.
2. Poisson cho nhu cầu thời gian chờ đánh giá thấp độ biến động khi nhu cầu theo đợt (mùa thi); chưa kiểm định phân phối khác.
3. Kaplan–Meier gộp toàn thư viện (không theo đầu sách/khách); bỏ qua sách mất.
4. Chưa có ràng buộc nhà cung cấp (MOQ, bội số đóng gói, lịch giao) và ngân sách theo kho.
5. Phân bổ có thể tập trung vào một đầu sách (mục 4.1). Một giới hạn đa dạng hóa cần được đề xuất và kiểm định bằng đúng giao
   thức này trước khi đưa vào.
6. 8 seed × 3 kịch bản; KTC t với n = 8.

## 7. Chạy lại

```bash
cd services/analytics-service
node eval/reorder-optimization.js          # ~1 phút; ghi thesis/data/reorder_optimization_results.json + phần AUTO ở trên
npm test
```
