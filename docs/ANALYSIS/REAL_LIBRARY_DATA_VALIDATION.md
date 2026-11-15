# Kiểm định mô hình hỗ trợ ra quyết định trên dữ liệu mượn sách thật

Ngày: 2026-11-16 · Nhánh `hungg` · Tất cả số liệu dưới đây do script sinh ra (xem "Tái lập"); không chép tay.

## 1. Mục tiêu

Các mô hình dự báo nhu cầu và gợi ý sách của SmartBook trước đây chỉ được đánh giá trên bộ dữ liệu hành vi
**tổng hợp do chính dự án sinh ra** (`docs/SYNTHETIC_BEHAVIOR_DATASET.md`). Tài liệu này chạy **cùng mã nguồn
production và cùng giao thức đánh giá** trên dữ liệu mượn sách thật của hai thư viện, để trả lời: kết luận rút ra
trên dữ liệu tổng hợp có còn đúng trên dữ liệu thật không, và ở mức nào thì mô hình thực sự hỗ trợ ra quyết định.

## 2. Dữ liệu

Ibrahim, I., Heryadi, Y., Qomariyah, N., Budiharto, W. (2026), *University and Public Library Recommendation
Dataset for Sparse and Cold-Start Research*, Mendeley Data, V1, doi:10.17632/6rd45bvxjy.1. Giấy phép CC BY 4.0;
chỉ dùng cho nghiên cứu và giáo dục.

| | Thư viện ĐH Binus (Jakarta) | Hệ thống thư viện công cộng (Indonesia) |
|---|---|---|
| Tệp (SHA-256 khớp giá trị Mendeley công bố) | `dataset_univLib.csv` (53 MB) | `datasetPublicLib.csv` (143 MB) |
| Lượt mượn (sau khi bỏ bản ghi trùng) | 52.389 (bỏ 5) | 404.118 (bỏ 2.422) |
| Khoảng thời gian | 02/01/2018 – 09/04/2025 | 02/01/2023 – 28/07/2025 |
| Bạn đọc / đầu sách | 14.148 / 7.563 | 53.043 / 54.564 |

**Xử lý** (`services/ai-service/eval/real_library_loans.py`, có test `test_real_library_loans.py`):
- Chỉ đọc các cột mượn trả (mã bạn đọc, mã bản sách, nhan đề, tác giả, DDC, ngày mượn, ngày trả). Các cột nhân khẩu
  học (ngày/nơi sinh, giới tính, GPA, …) không được đọc ra khỏi tệp CSV.
- Đầu sách: tệp công cộng dùng mã thư mục `BIBID`; tệp ĐH dùng nhan đề + tác giả chuẩn hóa vì cột ISBN đã bị bảng
  tính làm hỏng (`9,78112E+12`). Mỗi `Book ID Number` là một bản sách vật lý.
- Thể loại: phân lớp DDC cấp 2 (ví dụ `614.42` → `DDC 610`).
- Tệp gốc và tệp chuyển đổi nằm trong `research-inputs/library-loans-mendeley/` (git-ignore, không commit vì vẫn
  là lịch sử mượn theo từng bạn đọc). Chỉ kết quả tổng hợp được commit.

## 3. Dự báo nhu cầu

### 3.1. Phương pháp

`services/analytics-service/eval/real-forecast.js` gọi lại đúng `evaluateForecastModels()` của `run-all.js`
(chuỗi lượt mượn theo ngày của từng đầu sách trong 180 ngày cuối, `rollingBacktest()` cửa sổ mở rộng) và bổ sung một
phép đo **ở mức quyết định**: `reorder-suggestion.js` không dùng dự báo từng ngày mà dùng **tổng nhu cầu 7 và 30
ngày tới** (`projectedDemand()`, làm tròn lên). Mỗi mẫu là một (đầu sách, cửa sổ); so với dự báo `ZERO` (luôn dự
báo 0, WAPE = 1 theo định nghĩa). Hai dòng `PRODUCTION_*` là chính hàm production; `*_CEIL` = có làm tròn lên.
Cùng phép đo được chạy lại trên dữ liệu tổng hợp để so sánh.

### 3.2. Kết quả theo ngày (chỉ số cũ)

Tỷ lệ ngày không có lượt mượn của một đầu sách: tổng hợp 79,5%, ĐH Binus 99,0%, công cộng 98,7%. Ở mức này **mọi mô
hình đều có WAPE > 1, tức kém hơn dự báo 0** — trên cả dữ liệu tổng hợp (1,23–1,33) lẫn dữ liệu thật (1,47–5,99);
`NAIVE_LAST_VALUE` thắng phần lớn "phiếu bầu" chỉ vì nó dự báo 0. Chỉ số theo ngày vì vậy không đủ để kết luận về
chất lượng dự báo phục vụ nhập sách. Chi tiết: `thesis/tables/forecast_model_results_real_{univ,public}.csv`.

### 3.3. Kết quả theo tổng nhu cầu của kỳ (mức quyết định)

**Tổng nhu cầu 7 ngày, theo đầu sách** (WAPE; trong ngoặc: tỷ lệ cửa sổ dự báo thiếu)

| Mô hình | Tổng hợp | ĐH Binus | TV công cộng |
|---|---|---|---|
| Cửa sổ không có nhu cầu | 30,0% | 94,2% | 91,5% |
| `ZERO` | 1,000 (70,0%) | 1,000 (5,8%) | 1,000 (8,5%) |
| `PRODUCTION_EWMA_TREND_CEIL` | 0,755 (26,8%) | 5,865 (4,2%) | 4,704 (5,5%) |
| `PRODUCTION_MOVING_AVERAGE_CEIL` | 0,526 (17,3%) | 10,783 (3,3%) | 7,294 (3,5%) |
| `MOVING_AVERAGE_30` | 0,508 (47,4%) | 1,958 (5,8%) | 1,730 (8,5%) |
| `TSB` | 0,543 (45,2%) | 1,531 (5,7%) | 1,476 (8,4%) |
| `SBA` | 0,512 (44,7%) | 5,458 (5,5%) | 3,477 (8,1%) |

**Tổng nhu cầu 30 ngày, theo đầu sách** (WAPE; trong ngoặc: tỷ lệ cửa sổ dự báo thiếu)

| Mô hình | Tổng hợp | ĐH Binus | TV công cộng |
|---|---|---|---|
| Cửa sổ không có nhu cầu | 4,0% | 78,5% | 70,0% |
| `ZERO` | 1,000 (96,0%) | 1,000 (21,5%) | 1,000 (30,0%) |
| `PRODUCTION_EWMA_TREND_CEIL` | 0,622 (54,7%) | 2,937 (17,4%) | 2,253 (21,8%) |
| `PRODUCTION_MOVING_AVERAGE_CEIL` | 0,258 (35,8%) | 2,885 (14,8%) | 1,864 (16,8%) |
| `MOVING_AVERAGE_30` | 0,301 (52,5%) | 1,709 (20,1%) | 1,360 (27,5%) |
| `TSB` | 0,341 (54,6%) | 1,429 (19,5%) | 1,264 (26,3%) |
| `SBA` | 0,304 (44,4%) | 5,177 (17,1%) | 3,042 (21,7%) |

**Tổng nhu cầu 7 ngày, theo phân lớp DDC** (WAPE; trong ngoặc: tỷ lệ cửa sổ dự báo thiếu)

| Mô hình | ĐH Binus | TV công cộng |
|---|---|---|
| Cửa sổ không có nhu cầu | 67,9% | 27,8% |
| `ZERO` | 1,000 (32,1%) | 1,000 (72,2%) |
| `PRODUCTION_EWMA_TREND_CEIL` | 1,143 (15,3%) | 0,428 (35,6%) |
| `PRODUCTION_MOVING_AVERAGE_CEIL` | 1,381 (9,8%) | 0,347 (28,4%) |
| `MOVING_AVERAGE_30` | 0,972 (21,8%) | 0,373 (39,6%) |
| `TSB` | 0,964 (20,7%) | 0,361 (39,9%) |
| `SBA` | 1,079 (18,8%) | 0,368 (41,1%) |

**Tổng nhu cầu 30 ngày, theo phân lớp DDC** (WAPE; trong ngoặc: tỷ lệ cửa sổ dự báo thiếu)

| Mô hình | ĐH Binus | TV công cộng |
|---|---|---|
| Cửa sổ không có nhu cầu | 37,5% | 10,2% |
| `ZERO` | 1,000 (62,5%) | 1,000 (89,8%) |
| `PRODUCTION_EWMA_TREND_CEIL` | 1,257 (37,9%) | 0,405 (51,0%) |
| `PRODUCTION_MOVING_AVERAGE_CEIL` | 0,839 (16,4%) | 0,222 (33,1%) |
| `MOVING_AVERAGE_30` | 0,819 (33,6%) | 0,266 (44,1%) |
| `TSB` | 0,895 (35,4%) | 0,221 (40,2%) |
| `SBA` | 0,913 (23,6%) | 0,208 (39,0%) |

### 3.4. Diễn giải

1. **Theo từng đầu sách, dữ liệu thật thưa đến mức không mô hình nào tốt hơn dự báo 0** (91–94% số tuần không có
   lượt mượn). Đây là đặc trưng nhu cầu gián đoạn: dự báo tối ưu theo MAE là trung vị, mà trung vị bằng 0. Dự báo 0
   lại không bao giờ đề xuất nhập, nên ở mức đầu sách quyết định phải dựa vào tồn kho an toàn và quy tắc, không dựa vào
   độ chính xác điểm.
2. **Hàm production `EWMA_TREND` có làm tròn lên dự báo dư trên đầu sách thưa**: một lượt mượn gần đây làm dự báo 7
   ngày thành 2 rồi 1 bản dù không ai mượn tiếp (test `real-forecast.test.js`); trên dữ liệu thật nó dự báo dư ở
   29–32% số cửa sổ 7 ngày. Trên dữ liệu tổng hợp hiện tượng này bị che vì nhu cầu dày hơn nhiều (chỉ 30% tuần trống).
3. **Gộp theo phân lớp DDC ở thư viện công cộng, dự báo có giá trị rõ**: WAPE 30 ngày của `PRODUCTION_MOVING_AVERAGE_CEIL`
   là 0,222 (tổng hợp: 0,258) và của `PRODUCTION_EWMA_TREND_CEIL` là 0,405 (tổng hợp: 0,622). Thứ tự các mô hình
   giống trên dữ liệu tổng hợp: trung bình trượt / nhóm Croston tốt hơn `EWMA_TREND`. Ở thư viện ĐH (khoảng 1 lượt
   mượn/phân lớp/tuần trong 180 ngày cuối) dự báo theo phân lớp vẫn chỉ ngang dự báo 0.
4. Hệ quả cho thiết kế: dự báo phù hợp để **phân bổ ngân sách theo nhóm/thể loại** ở thư viện có lưu lượng đủ lớn; đề
   xuất nhập từng đầu sách nên được trình bày là "quy tắc + tồn kho an toàn có dự báo hỗ trợ", không phải dự báo chính
   xác từng đầu sách. Không thay đổi mã production trong đợt này.

## 4. Gợi ý sách

### 4.1. Phương pháp

`services/ai-service/eval/eval_recommendation_v2.py --real-data --skip-ablations` chạy **đúng giao thức đã dùng cho dữ
liệu tổng hợp** (cắt theo thời gian tại phân vị 60%/80% của lượt mượn; chọn trọng số V2 trên cửa sổ validation; báo cáo
một lần trên cửa sổ test; relevance = đầu sách lần đầu được mượn trong cửa sổ; bootstrap ghép cặp 1.000 lần) và cùng mã
`recommendation.py` (V1) / `recommendation_v2.py` (V2). Khác biệt so với lần chạy tổng hợp:
- Trọng số V2 được chọn lại trên validation của từng thư viện; **trọng số production không bị ghi đè** (cờ `--real-data`
  từ chối `--write-weights`, có test `test_real_library_loans.py`).
- Không chạy ablation từng nhóm đặc trưng và mô hình chẩn đoán `V2_NO_CANDIDATE_PRUNING` (`--skip-ablations`): với
  7.563–21.509 đầu sách mỗi lần tinh chỉnh mất 30–90 phút, và mô hình chẩn đoán dựng đặc trưng cho mọi bạn đọc × mọi
  đầu sách (vượt 16 GB RAM ở thư viện công cộng). Các mô hình so sánh chính (POPULARITY, V1, V2) giữ nguyên. Lần chạy
  ĐH Binus được thực hiện trước thay đổi này nên báo cáo JSON của nó vẫn có `V2_NO_CANDIDATE_PRUNING`.
- Thư viện công cộng dùng mẫu cố định 6.000 bạn đọc (SHA-256 của DOI + mã bạn đọc nhỏ nhất, giữ trọn lịch sử mỗi bạn
  đọc), vì toàn bộ 53.043 bạn đọc / 54.564 đầu sách vượt quá thời gian chạy hợp lý. Không lọc theo `Location Code` vì
  cùng một bạn đọc mượn ở nhiều vị trí.
- Không có mô hình "ORACLE" (sở thích thật chỉ tồn tại trong bộ mô phỏng).

### 4.2. Kết quả

| | Tổng hợp (production) | ĐH Binus (toàn bộ) | TV công cộng (mẫu 6.000 bạn đọc) |
|---|---|---|---|
| Bạn đọc / đầu sách / lượt mượn | 600 / 113 / 33.866 | 14.148 / 7.563 / 52.389 | 6.000 / 21.509 / 47.641 |
| Bạn đọc đủ điều kiện (validation / test) | 329 / 344 | 549 / 200 | 557 / 616 |
| Cửa sổ test | 2026-05-30 → 2026-09-28 | 2023-03-06 → 2025-04-09 | 2024-12-08 → 2025-07-28 |

**Tổng hợp (production)**

| Mô hình | HR@10 | NDCG@10 | Recall@10 | MRR | Độ phủ danh mục@10 |
|---|---|---|---|---|---|
| `POPULARITY` | 0,767 | 0,352 | 0,445 | 0,469 | 0,796 |
| `V1_PRODUCTION` | 0,579 | 0,212 | 0,275 | 0,311 | 0,938 |
| `V2` | 0,861 | 0,427 | 0,541 | 0,533 | 0,885 |

**ĐH Binus (toàn bộ)**

| Mô hình | HR@10 | NDCG@10 | Recall@10 | MRR | Độ phủ danh mục@10 |
|---|---|---|---|---|---|
| `POPULARITY` | 0,135 | 0,041 | 0,060 | 0,057 | 0,002 |
| `V1_PRODUCTION` | 0,020 | 0,003 | 0,004 | 0,013 | 0,034 |
| `V2` | 0,230 | 0,078 | 0,116 | 0,101 | 0,104 |

**TV công cộng (mẫu 6.000 bạn đọc)**

| Mô hình | HR@10 | NDCG@10 | Recall@10 | MRR | Độ phủ danh mục@10 |
|---|---|---|---|---|---|
| `POPULARITY` | 0,029 | 0,009 | 0,005 | 0,032 | 0,001 |
| `V1_PRODUCTION` | 0,023 | 0,004 | 0,006 | 0,010 | 0,022 |
| `V2` | 0,104 | 0,026 | 0,029 | 0,052 | 0,192 |

**Chênh lệch ghép cặp của V2 (khoảng tin cậy bootstrap 95%)**

| Dữ liệu | So với | NDCG@10 | Recall@10 | MRR |
|---|---|---|---|---|
| Tổng hợp (production) | V1 | +0,216 [0,186; 0,247] | +0,266 [0,225; 0,308] | +0,222 [0,174; 0,267] |
| Tổng hợp (production) | POPULARITY | +0,076 [0,050; 0,101] | +0,096 [0,066; 0,128] | +0,063 [0,024; 0,103] |
| ĐH Binus (toàn bộ) | V1 | +0,074 [0,050; 0,102] | +0,112 [0,076; 0,153] | +0,087 [0,057; 0,122] |
| ĐH Binus (toàn bộ) | POPULARITY | +0,037 [0,012; 0,063] | +0,056 [0,024; 0,092] | +0,044 [0,011; 0,079] |
| TV công cộng (mẫu 6.000 bạn đọc) | V1 | +0,022 [0,015; 0,031] | +0,023 [0,013; 0,034] | +0,043 [0,030; 0,057] |
| TV công cộng (mẫu 6.000 bạn đọc) | POPULARITY | +0,017 [0,009; 0,026] | +0,024 [0,015; 0,034] | +0,020 [0,001; 0,039] |

**Khởi đầu lạnh (NDCG@10)**

| Dữ liệu | Bạn đọc mới (0 lượt): V2 / POPULARITY | Bạn đọc thưa (1–2 lượt): V2 / POPULARITY |
|---|---|---|
| Tổng hợp (production) | 0,432 / 0,429 (n=58) | 0,285 / 0,407 (n=13) |
| ĐH Binus (toàn bộ) | 0,024 / 0,031 (n=2702) | 0,094 / 0,031 (n=231) |
| TV công cộng (mẫu 6.000 bạn đọc) | 0,001 / 0,006 (n=966) | 0,019 / 0,000 (n=113) |

- Tổng hợp (production): quy tắc chấp nhận (V2 hơn cả V1 và POPULARITY trên NDCG@10, Recall@10, MRR với khoảng tin cậy trên 0) **đạt**.
- ĐH Binus (toàn bộ): quy tắc chấp nhận (V2 hơn cả V1 và POPULARITY trên NDCG@10, Recall@10, MRR với khoảng tin cậy trên 0) **đạt**.
- TV công cộng (mẫu 6.000 bạn đọc): quy tắc chấp nhận (V2 hơn cả V1 và POPULARITY trên NDCG@10, Recall@10, MRR với khoảng tin cậy trên 0) **đạt**.

### 4.3. Diễn giải

1. **Kết luận chính của dữ liệu tổng hợp được giữ nguyên trên cả hai thư viện thật**: V2 tốt hơn có ý nghĩa thống kê
   so với cả V1 và xếp hạng theo độ phổ biến trên NDCG@10, Recall@10, MRR (khoảng tin cậy ghép cặp nằm trên 0), nên
   quy tắc chấp nhận dùng để chọn V2 làm mặc định đạt trên cả ĐH Binus và thư viện công cộng. Thứ tự V2 > POPULARITY > V1
   lặp lại trên NDCG@10 ở cả ba bộ dữ liệu.
2. Giá trị tuyệt đối thấp hơn nhiều so với dữ liệu tổng hợp (NDCG@10: tổng hợp 0,427; ĐH Binus 0,078; thư viện công cộng
   0,026) do dữ liệu thật rất thưa và danh mục lớn gấp 67–190 lần; vì vậy **không dùng số tuyệt đối của dữ liệu tổng hợp
   để mô tả chất lượng thực tế**, chỉ dùng thứ tự và chênh lệch.
3. Trọng số được chọn trên validation khác nhau giữa hai thư viện: ĐH Binus dồn vào lọc cộng tác (`collaborative` 3,0),
   còn thư viện công cộng dồn vào tín hiệu nội dung (`author` 3,0, `semantic` 2,0, `preference` 1,5; `collaborative`
   0,25, `popularity` 0). Điều này ủng hộ thiết kế V2 kết hợp nhiều nhóm tín hiệu có trọng số chỉnh được, thay vì một
   thuật toán cố định.
4. **Bạn đọc mới (chưa có lượt mượn)**: POPULARITY tốt hơn V2 ở cả hai thư viện (ĐH Binus 0,031 so với 0,024; công cộng
   0,006 so với 0,0005 khi trọng số `popularity` được chọn bằng 0). V2 hiện chấm điểm bạn đọc mới bằng cùng bộ trọng số
   (chỉ gắn mã giải thích `COLD_START_FALLBACK`), không chuyển hẳn sang xếp hạng theo độ phổ biến. Đây là một cải tiến
   có căn cứ (chưa triển khai): với bạn đọc 0 lượt mượn thì dùng xếp hạng phổ biến. Với bạn đọc có 1–2 lượt mượn V2 đã
   tốt hơn rõ (ĐH Binus 0,094 so với 0,031; công cộng 0,019 so với 0).
5. V2 gợi ý đa dạng hơn: độ phủ danh mục@10 của V2 là 0,104 (ĐH Binus) và 0,192 (công cộng), so với 0,002 và 0,0005 của
   POPULARITY.

## 5. Số bản sách theo đầu sách

### 5.1. Phương pháp

`services/analytics-service/eval/real-copies.js` dựng lại số bản đang được mượn của từng đầu sách theo từng ngày từ
ngày mượn và ngày trả. Một lượt mượn giữ bản sách từ ngày mượn đến ngày trước ngày trả, tối thiểu là chính ngày mượn;
216 lượt của ĐH Binus không có ngày trả được gán độ dài mượn trung vị (8 ngày). Số bản của một đầu sách là số bản khác
nhau từng xuất hiện trong dữ liệu. Ngày **"hết bản trên kệ"** của một đầu sách là ngày mọi bản đều đang được mượn. Vì dữ
liệu chỉ ghi lượt mượn đã phục vụ, đây là dấu hiệu quan sát được duy nhất cho việc một đầu sách cần thêm bản; nhu cầu
không được phục vụ thì không biết.

Hai phép đo:
1. **Mô tả 365 ngày cuối của dữ liệu**: tỷ lệ bản-ngày đang được mượn, tỷ lệ đầu sách-ngày hết bản trên kệ, số đầu sách
   hết bản ≥ 50% số ngày ("thiếu bản kéo dài"), số bản **"nhàn rỗi"** (đầu sách không có bản nào được mượn cả năm) và số
   bản **"dư"** (với đầu sách có lượt mượn: số bản trừ số bản nhiều nhất từng được mượn cùng một ngày).
2. **Kiểm định ngược đề xuất nhập sách của production**: 12 kỳ rà soát hàng tháng trong năm cuối. Ở mỗi kỳ, mọi đầu sách
   có lượt mượn trong 30 ngày trước được đưa qua `calculateSuggestion` và sắp xếp bằng `compareReorderCandidates`
   (dùng nguyên mã production, đầu vào chỉ lấy dữ liệu trước ngày rà soát). Kết quả được chấm bằng tỷ lệ ngày hết bản
   trên kệ trong 30 ngày **sau khi đơn đặt hàng sẽ về** (ngày 14–44, thời gian giao hàng mặc định 14 ngày), để lượt mượn
   đang diễn ra lúc rà soát ít ảnh hưởng đến kết quả. Đầu vào production không có trong dữ liệu (đặt giữ, wishlist, cảnh
   báo chờ hàng, reorder point, giá) được đặt bằng 0; hệ số mùa vụ cố định bằng 1.

### 5.2. Kết quả

| 365 ngày cuối | ĐH Binus | TV công cộng |
|---|---|---|
| Đầu sách / bản sách | 7.563 / 8.369 | 54.564 / 127.178 |
| Đầu sách chỉ có 1 bản | 93,2% | 36,6% |
| Tỷ lệ bản-ngày đang được mượn | 2,0% | 4,0% |
| Tỷ lệ đầu sách-ngày hết bản trên kệ | 1,7% | 0,9% |
| Đầu sách thiếu bản kéo dài (hết bản ≥ 50% số ngày) | 18 (17 đầu sách 1 bản) | 27 (cả 27 đầu sách 1 bản) |
| Bản nhàn rỗi (đầu sách không được mượn cả năm) | 6.228 (74,4% số bản) | 26.815 (21,1%) |
| Bản dư của đầu sách có lượt mượn | 297 (13,9%) | 50.300 (50,1%) |
| Bản dư ở đầu sách có 3–5 bản | 51,0% | 56,7% |

Bảng đầy đủ theo số bản mỗi đầu sách: `thesis/tables/copies_saturation_real_{univ,public}.csv`. Mười phân lớp DDC có
nhiều đầu sách-ngày hết bản nhất nằm trong `thesis/data/copies_needed_real_{univ,public}.json`.

**Kiểm định ngược đề xuất nhập sách** (12 kỳ; "hết bản sau đó" là tỷ lệ ngày 14–44 sau kỳ rà soát mà mọi bản đều đang
được mượn; "thiếu bản kéo dài" là hết bản ≥ 50% số ngày đó)

| Nhóm | ĐH Binus: mẫu | hết bản sau đó | thiếu bản kéo dài | TV công cộng: mẫu | hết bản sau đó | thiếu bản kéo dài |
|---|---|---|---|---|---|---|
| Ưu tiên HIGH | 1.442 | 27,5% | 25,2% | 16.296 | 4,8% | 3,7% |
| Ưu tiên MEDIUM | 291 | 4,3% | 3,1% | 18.660 | 0,5% | 0,2% |
| Ưu tiên LOW | 1.350 | 4,8% | 3,9% | 66.128 | 0,6% | 0,4% |
| 50 đầu sách đầu tiên theo xếp hạng production | 600 | 27,3% | 25,5% | 600 | 6,7% | 5,3% |
| 50 đầu sách mượn nhiều nhất 30 ngày qua | 600 | 21,5% | 20,0% | 600 | 3,8% | 2,8% |
| Mọi đầu sách ứng viên | 3.083 | 15,4% | 13,8% | 101.084 | 1,3% | 0,9% |

| Số bản đề xuất trung bình | ĐH Binus: HIGH / MEDIUM / LOW | TV công cộng: HIGH / MEDIUM / LOW |
|---|---|---|
| Production (mức tối thiểu theo ưu tiên luôn áp dụng) | 5,37 / 3,02 / 0,99 | 5,57 / 3,01 / 0,23 |
| `priorityFloors: 'IF_SHORTFALL'` | 5,35 / 1,87 / 0,99 | 5,49 / 1,44 / 0,23 |
| Không có mức tối thiểu | 3,78 / 1,87 / 0,99 | 4,58 / 1,44 / 0,23 |

Nhóm HIGH chứa 85,4% (ĐH Binus) và 65,9% (TV công cộng) số trường hợp thiếu bản kéo dài về sau.

### 5.3. Diễn giải

1. **Cả hai thư viện thừa bản nhiều hơn thiếu bản**: chỉ 2–4% bản-ngày có bản sách đang được mượn, và trên 1.000 đầu
   sách-ngày chỉ có 9–17 ngày hết bản trên kệ. Một nửa số bản của các đầu sách có lượt mượn ở thư viện công cộng chưa
   bao giờ được cần đến cùng lúc; với đầu sách 3–5 bản, tỷ lệ này trên 50%. Quyết định có giá trị ở đây là **không mua
   thêm bản cho đầu sách đã có nhiều bản** và dùng ngân sách cho đầu sách mới.
2. **Thiếu bản kéo dài chỉ xảy ra ở đầu sách có 1 bản** (44/45 trường hợp ở hai thư viện). Mua bản thứ hai cho đúng các
   đầu sách này là quyết định nhập sách có căn cứ rõ nhất mà dữ liệu cho thấy.
3. **Xếp hạng ưu tiên của production đúng hướng**: 50 đầu sách đứng đầu danh sách đề xuất về sau hết bản nhiều hơn 50
   đầu sách được mượn nhiều nhất (27,3% so với 21,5% ở ĐH Binus; 6,7% so với 3,8% ở TV công cộng) và gấp 1,8–5,3 lần
   mức trung bình. Nhóm HIGH chứa phần lớn các trường hợp thiếu bản về sau.
4. **Số lượng đề xuất cho nhóm HIGH quá lớn so với dữ liệu thật**: ở thư viện công cộng, đầu sách HIGH chỉ hết bản 4,8%
   số ngày sau khi hàng về nhưng được đề xuất trung bình 5,6 bản (khoảng 1.358 đầu sách mỗi kỳ). Nguyên nhân là điều
   kiện HIGH `available_qty <= 0 && borrow_count > 0`: mọi đầu sách 1 bản đang được mượn đều thành HIGH, rồi mức tối
   thiểu 5 bản được áp dụng. Lựa chọn `IF_SHORTFALL` đã có trong production chỉ giảm nhóm MEDIUM, không giảm nhóm HIGH
   (vì `available_qty` bằng 0); bỏ hẳn mức tối thiểu vẫn còn 3,8–4,6 bản do tồn kho an toàn. Đây là một cải tiến có số
   liệu chứng minh (**chưa triển khai**, cần sửa code production): tính cả số bản sẽ được trả trong thời gian giao hàng
   (`expectedReturns`, đã có trong production cho chế độ ngân sách) trước khi xếp HIGH, hoặc đặt mức tối thiểu theo số
   lượt mượn thay vì cố định 5 bản. Dữ liệu không cho biết nhu cầu không được phục vụ, nên chưa kết luận được số bản
   đúng cho mỗi đầu sách.
5. Ở ĐH Binus, tỷ lệ hết bản về sau của nhóm HIGH cao (27,5%) một phần vì có lượt mượn rất dài (lâu nhất 1.735 ngày, có
   thể là sách bị mất), nên bản sách vẫn chưa về sau 14–44 ngày.

## 6. Hạn chế

- Hai thư viện ở Indonesia, không phải Việt Nam; một thư viện ĐH và một hệ thống thư viện công cộng.
- Dữ liệu chỉ có lượt mượn đã xảy ra: nhu cầu bị cắt bởi số bản sách hiện có (không biết bạn đọc muốn mượn mà không có
  sách), nên chưa chạy được mô phỏng chính sách nhập hàng (cần nhu cầu không bị cắt và tồn kho ban đầu) và không có dữ
  liệu thời gian giao hàng.
- Không có ngày đến hạn trả, nên chưa kiểm định được mô hình rủi ro trả trễ.
- Số bản sách: chỉ biết các bản từng được mượn (bản chưa bao giờ được mượn thì không biết, nên số bản nhàn rỗi ở mục 5
  là cận dưới); bản mua sau được tính như có từ đầu kỳ; 0,02–0,09% số đầu sách-ngày có số lượt mượn chồng nhau nhiều hơn
  số bản (lỗi dữ liệu nguồn, giữ nguyên).
- Thư viện ĐH có lượng mượn giảm mạnh trong 2024–2025 (tháng 03/2025: 228 lượt) và giai đoạn COVID nằm trong dữ liệu;
  cửa sổ validation của bài toán gợi ý (11/2019 – 03/2023) trùng giai đoạn COVID.
- Gợi ý sách: chỉ có lượt mượn (không có danh sách yêu thích, đánh giá, đặt giữ), không có mô tả sách; số bạn đọc đủ
  điều kiện ở tập test nhỏ (vài trăm), nên khoảng tin cậy rộng; chưa chạy ablation trên dữ liệu thật; thư viện công
  cộng chỉ dùng mẫu 6.000 bạn đọc.

## 7. Tái lập

```bash
python services/ai-service/eval/real_library_loans.py research-inputs/library-loans-mendeley/dataset_univLib.csv --library univ
```

```bash
python services/ai-service/eval/real_library_loans.py research-inputs/library-loans-mendeley/datasetPublicLib.csv --library public
```

```bash
cd services/analytics-service && node --max-old-space-size=4096 eval/real-forecast.js ../../research-inputs/library-loans-mendeley/derived/public_events.json public
```

Thay `public` bằng `univ` cho thư viện ĐH; `node eval/real-forecast.js --synthetic synthetic` cho dữ liệu tổng hợp.

Số bản sách theo đầu sách (vài giây):

```bash
cd services/analytics-service && node eval/real-copies.js ../../research-inputs/library-loans-mendeley/derived/public_events.json public
```

Thay `public` bằng `univ` cho thư viện ĐH.

Gợi ý sách (mỗi lần 1–4 giờ, không gọi mạng, không tốn phí):

```bash
python services/ai-service/eval/real_library_loans.py research-inputs/library-loans-mendeley/datasetPublicLib.csv --library public --sample-readers 6000
```

```bash
cd services/ai-service && python eval/eval_recommendation_v2.py --real-data --skip-ablations --events ../../research-inputs/library-loans-mendeley/derived/univ_events.json --out-dir eval/reports/real_library/univ
```

Với thư viện công cộng: `--events ../../research-inputs/library-loans-mendeley/derived/public_sample6000_events.json
--out-dir eval/reports/real_library/public_sample6000`.
