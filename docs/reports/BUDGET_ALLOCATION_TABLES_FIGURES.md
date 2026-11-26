# Bảng và hình: phân bổ ngân sách của SmartBook so với cách chi ngân sách thực tế (đánh giá ngày 26/11/2026)

Sinh tự động bởi `python thesis/scripts/budget_allocation_report.py` từ `thesis/data/budget_improvement_results.json` và `thesis/data/budget_realistic_results.json`; không sửa tay. SmartBook là cách phân bổ đang chạy trong hệ thống từ commit a13df1f (tên trong file kết quả: SB_NOFLOOR_PROTECT). Phương pháp, giao thức và giới hạn: `docs/reports/BUDGET_ALLOCATION_THESIS_SOURCE.md`.

### Bảng 1. Mức đáp ứng nhu cầu của SmartBook và tám cách chi ngân sách thực tế (8 hạt giống kiểm định 20261401–08, ngân sách × 1)

| Cách phân bổ ngân sách | Bình thường (hạng) | Giao chậm (hạng) | Tồn đầu một nửa (hạng) |
|---|---|---|---|
| **SmartBook** | 98,06% (1) | 97,53% (1) | 91,84% (1) |
| Điểm đặt hàng lại (5/10) + mỗi đầu sách một bản | 97,46% (2) | 97,19% (2) | 89,49% (2) |
| Điểm đặt hàng lại (5/10) + chia theo thể loại | 96,06% (3) | 95,84% (3) | 86,21% (4) |
| TB 30 ngày + tồn an toàn + mỗi đầu sách một bản | 95,54% (4) | 95,29% (4) | 87,57% (3) |
| Điểm đặt hàng lại (5/10) + đặt giữ trước | 95,42% (5) | 95,14% (5) | 84,75% (5) |
| Điểm đặt hàng lại (5/10) + mượn nhiều trước | 95,22% (6) | 94,95% (6) | 84,62% (6) |
| TB 30 ngày + tồn an toàn + chia theo thể loại | 93,49% (7) | 93,31% (7) | 81,70% (7) |
| TB 30 ngày + tồn an toàn + đặt giữ trước | 93,39% (8) | 93,15% (8) | 81,24% (8) |
| TB 30 ngày + tồn an toàn + mượn nhiều trước | 92,02% (9) | 91,90% (9) | 79,13% (9) |

Mỗi ô là mức đáp ứng trung bình trên 8 hạt giống; số trong ngoặc là thứ hạng trong 9 cách ở kịch bản đó. Tám cách chi thực tế ghép hai quy tắc tính số lượng (điểm đặt hàng lại tối thiểu 5, tối đa 10; trung bình 30 ngày cộng tồn an toàn) với bốn quy tắc chi tiền khi thiếu ngân sách. Mọi cách dùng cùng nhu cầu, cùng tồn đầu kỳ, cùng đơn giá và cùng ngân sách mỗi kỳ.

### Bảng 2. SmartBook so với cách chi tốt nhất, ngân sách × 1 (8 hạt giống kiểm định, so sánh ghép cặp)

| Kịch bản | Cách chi tốt nhất | SmartBook | Cách chi tốt nhất (mức đáp ứng) | Chênh lệch (điểm %, KTC 95%) | Số lần SmartBook cao hơn | Giảm lượt không được phục vụ (KTC 95%) | Chênh ngày hết sách | Chi phí so với cách chi tốt nhất |
|---|---|---|---|---|---|---|---|---|
| Bình thường | Điểm đặt hàng lại (5/10) + mỗi đầu sách một bản | 98,06% | 97,46% | +0,59 [0,50; 0,69] | 8/8 | 23,4% [19,9; 27,0] | −49 | 108,1% |
| Giao chậm | Điểm đặt hàng lại (5/10) + mỗi đầu sách một bản | 97,53% | 97,19% | +0,34 [0,21; 0,46] | 8/8 | 12,1% [7,6; 16,6] | −21 | 110,8% |
| Tồn đầu một nửa | Điểm đặt hàng lại (5/10) + mỗi đầu sách một bản | 91,84% | 89,49% | +2,35 [1,91; 2,79] | 8/8 | 22,3% [18,4; 26,2] | −190 | 101,3% |

Giả thuyết ghi trước khi chạy (SmartBook cao hơn cách chi tốt nhất ở mọi hạt giống × kịch bản, ngân sách × 1): 24/24 lần chạy, được xác nhận. Cách chi tốt nhất được chọn sau khi đã có kết quả nên có lợi cho phía so sánh. Chi phí trên 100% nghĩa là SmartBook tiêu nhiều hơn: ở ngân sách × 1 cách chi tốt nhất không tiêu hết ngân sách, nên một phần lợi thế của SmartBook đến từ việc dùng hết ngân sách được cấp. Chênh ngày hết sách âm là ít ngày hết sách hơn.

### Bảng 3. SmartBook so với cách chi tốt nhất ở mọi mức ngân sách (8 hạt giống kiểm định; mỗi dòng là trung bình 8 lần chạy)

| Kịch bản | Ngân sách mỗi kỳ | SmartBook | Cách chi tốt nhất | Chênh lệch (điểm %) | Số lần SmartBook cao hơn | Giảm lượt không được phục vụ | Chênh ngày hết sách | Chi phí so với cách chi tốt nhất |
|---|---|---|---|---|---|---|---|---|
| Bình thường | × 0,5 | 95,56% | 93,51% | +2,05 | 8/8 | 31,5% | −212 | 99,6% |
| Bình thường | × 0,75 | 97,34% | 96,27% | +1,07 | 8/8 | 28,5% | −99 | 100,2% |
| Bình thường | × 1 | 98,06% | 97,46% | +0,59 | 8/8 | 23,4% | −49 | 108,1% |
| Bình thường | × 1,25 | 98,43% | 98,03% | +0,40 | 8/8 | 20,2% | −28 | 116,2% |
| Bình thường | × 1,5 | 98,65% | 98,38% | +0,27 | 8/8 | 16,5% | −14 | 122,1% |
| Giao chậm | × 0,5 | 94,35% | 93,20% | +1,15 | 8/8 | 16,9% | −131 | 99,9% |
| Giao chậm | × 0,75 | 96,49% | 95,98% | +0,51 | 7/8 | 12,9% | −40 | 100,2% |
| Giao chậm | × 1 | 97,53% | 97,19% | +0,34 | 8/8 | 12,1% | −21 | 110,8% |
| Giao chậm | × 1,25 | 98,02% | 97,77% | +0,26 | 8/8 | 11,4% | −12 | 130,1% |
| Giao chậm | × 1,5 | 98,28% | 98,11% | +0,17 | 7/8 | 9,0% | −5 | 148,7% |
| Tồn đầu một nửa | × 0,5 | 81,52% | 77,05% | +4,47 | 8/8 | 19,3% | −560 | 99,8% |
| Tồn đầu một nửa | × 0,75 | 88,55% | 85,08% | +3,46 | 8/8 | 23,0% | −340 | 99,8% |
| Tồn đầu một nửa | × 1 | 91,84% | 89,49% | +2,35 | 8/8 | 22,3% | −190 | 101,3% |
| Tồn đầu một nửa | × 1,25 | 93,49% | 91,81% | +1,68 | 8/8 | 20,3% | −113 | 102,4% |
| Tồn đầu một nửa | × 1,5 | 94,40% | 93,54% | +0,86 | 8/8 | 13,0% | −68 | 87,6% |

Ngân sách × 1 là mức tham chiếu (chi phí của cách chi rẻ hơn khi không giới hạn, chia đều cho các kỳ). Cách chi tốt nhất được chọn riêng cho từng dòng: Điểm đặt hàng lại (5/10) + mỗi đầu sách một bản, trừ Tồn đầu một nửa × 1,5: TB 30 ngày + tồn an toàn + mỗi đầu sách một bản. Tổng cộng SmartBook cao hơn cách chi tốt nhất ở 118/120 lần chạy. Ngân sách × 0,5 là so sánh rõ nhất vì mọi cách đều tiêu gần hết ngân sách (chi phí xấp xỉ 100%).

### Bảng 4. SmartBook so với cách chi tốt nhất trên lượt mượn thật của hai thư viện Indonesia (mỗi dòng một lần chạy, không có khoảng tin cậy)

| Thư viện | Số bản ban đầu | Ngân sách mỗi kỳ | SmartBook | Cách chi tốt nhất | Chênh lệch (điểm %) | Giảm lượt không được phục vụ |
|---|---|---|---|---|---|---|
| Công cộng | Một nửa số bản thật | × 0,5 | 97,62% | 94,79% | +2,83 | 54,3% |
| Công cộng | Một nửa số bản thật | × 1 | 98,48% | 97,16% | +1,32 | 46,6% |
| Công cộng | Một nửa số bản thật | × 1,5 | 98,75% | 98,17% | +0,57 | 31,4% |
| Công cộng | 1 bản mỗi đầu sách | × 0,5 | 91,78% | 86,06% | +5,72 | 41,1% |
| Công cộng | 1 bản mỗi đầu sách | × 1 | 95,32% | 92,36% | +2,96 | 38,7% |
| Công cộng | 1 bản mỗi đầu sách | × 1,5 | 96,36% | 94,91% | +1,45 | 28,4% |
| Đại học | Một nửa số bản thật | × 0,5 | 88,73% | 88,45% | +0,28 | 2,4% |
| Đại học | Một nửa số bản thật | × 1 | 91,66% | 91,38% | +0,28 | 3,2% |
| Đại học | Một nửa số bản thật | × 1,5 | 93,07% | 92,70% | +0,37 | 5,1% |
| Đại học | 1 bản mỗi đầu sách | × 0,5 | 87,81% | 87,33% | +0,48 | 3,8% |
| Đại học | 1 bản mỗi đầu sách | × 1 | 90,96% | 90,57% | +0,39 | 4,1% |
| Đại học | 1 bản mỗi đầu sách | × 1,5 | 92,53% | 92,05% | +0,48 | 6,0% |

Cách chi tốt nhất trên dữ liệu thật: TB 30 ngày + tồn an toàn + mỗi đầu sách một bản. Dữ liệu: Mendeley doi:10.17632/6rd45bvxjy.1 (CC BY 4.0). Thư viện công cộng: 267.930/404.118 lượt mượn (đầu sách có ít nhất 10 lượt), 12.079 đầu sách, 939 ngày; thư viện đại học: 52.389 lượt mượn, 7.563 đầu sách, 2.655 ngày. Đơn giá 100.000 đồng/bản và số bản ban đầu là giả định; dữ liệu chỉ có lượt mượn đã được phục vụ nên nhu cầu bị đánh giá thấp.

### Hình đề xuất

- `thesis/figures/budget_eval_x1_all_policies.png` — Hình 7.x. Mức đáp ứng nhu cầu của SmartBook và tám cách chi ngân sách thực tế ở ngân sách × 1 (trung bình 8 hạt giống kiểm định, dữ liệu tổng hợp). Trục ngang của ba ô có thang khác nhau. Số liệu: Bảng 1.
- `thesis/figures/budget_eval_fill_by_budget.png` — Hình 7.y. Mức đáp ứng nhu cầu của SmartBook và cách chi tốt nhất theo mức ngân sách (8 hạt giống kiểm định, dữ liệu tổng hợp). Trục dọc của ba ô có thang khác nhau. Số liệu: Bảng 3.
