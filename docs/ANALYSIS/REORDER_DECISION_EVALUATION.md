# Đánh giá định lượng hỗ trợ quyết định nhập kho (SmartBook)

> **Toàn bộ kết quả trong tài liệu này được tính trên dữ liệu TỔNG HỢP (synthetic) do bộ mô phỏng hành vi
> sinh ra, không phải dữ liệu người dùng hay thư viện thật** (xem `docs/SYNTHETIC_BEHAVIOR_DATASET.md`).
> Các mục có dấu *(tự động)* được `services/analytics-service/eval/run-all.js` ghi đè mỗi lần chạy,
> từ chính các file `thesis/data/*.json`; không có con số nào trong các mục đó được gõ tay.

Tái lập (từ thư mục gốc repo):

```bash
cd services/analytics-service && node eval/run-all.js && cd ../..
python -m pip install -r thesis/scripts/requirements.txt
python thesis/scripts/plot_reorder_evaluation.py
```

## 1. Mục tiêu

SmartBook gợi ý **nên nhập thêm bao nhiêu bản của mỗi đầu sách, ưu tiên đầu sách nào, trong ngân sách nào**
(`GET /analytics/reorder-suggestions`). Đây là *hỗ trợ quyết định*: thủ thư/quản lý duyệt gợi ý rồi mới
tạo Purchase Order trong luồng nghiệp vụ hiện có; hệ thống không tự đặt hàng, không dùng LLM để quyết
định số lượng (Qwen/OpenRouter chỉ giải thích, tóm tắt).

Câu hỏi đánh giá:

> SmartBook có giúp giảm nguy cơ hết sách và tăng mức đáp ứng nhu cầu mà không làm tồn kho hoặc chi phí
> tăng quá mức so với các chính sách nhập kho đơn giản hay không?

Để trả lời mà không thay đổi production, tài liệu này xây một quy trình đánh giá offline gồm bốn phần:
(1) so sánh mô hình dự báo, (2) backtest chính sách nhập kho trên kho ảo, (3) ablation từng thành phần
của SmartBook, (4) backtest lead time nhà cung cấp.

## 2. Kiến trúc thuật toán

```
Borrow history ─┐
Reservation ────┤
Wishlist ───────┤
Alert ──────────┤
Stock ──────────┤
Supplier lead time ┤
Seasonality ────┤
Budget ─────────┘
        ↓
Demand analysis      (đếm lượt mượn/đặt chỗ 30 ngày, kỳ trước, chuỗi mượn theo ngày)
        ↓
Forecast             (EWMA α=0.35 + xu hướng tuyến tính × hệ số mùa vụ)
        ↓
Safety stock         (z·σ·√L với z = 1.645)
        ↓
Reorder quantity     (nhu cầu trong lead time + safety stock − tồn khả dụng)
        ↓
Priority             (HIGH / MEDIUM / LOW theo luật)
        ↓
Budget allocation    (tham lam theo thứ tự ưu tiên, allocateBudget)
        ↓
Human approval       (thủ thư duyệt → Purchase Order trong luồng hiện có)
```

Mã nguồn production (dùng chung cho endpoint và cho đánh giá):

| Thành phần | File |
| --- | --- |
| Truy vấn dữ liệu, ghép đầu vào | `services/analytics-service/src/controllers/analytics.controller.js` |
| Tính gợi ý (forecast, safety stock, Q, priority, demand score, seasonal index) | `src/utils/reorder-suggestion.js` |
| EWMA, trend, σ, `projectedDemand`, các mô hình dự báo, `rollingBacktest` | `src/utils/forecast.js` |
| Lead time học từ lịch sử giao hàng | `src/utils/lead-time.js` |
| Phân bổ ngân sách | `src/utils/budget-allocation.js` |

`reorder-suggestion.js` được **tách nguyên văn** từ controller trong đợt này (không đổi công thức) để
backtest gọi đúng hàm production thay vì viết lại. Tính tương đương đã được kiểm tra: 400 bộ đầu vào ngẫu
nhiên cho ra kết quả giống hệt từng byte trước/sau khi tách; toàn bộ test cũ vẫn qua.

## 3. Công thức (đúng như production)

Ký hiệu: chuỗi `x₁..x_n` = số lượt mượn theo ngày của variant trong cửa sổ `days` (mặc định 30 ngày,
gồm 31 bucket ngày), `A` = `available_qty`, `L` = lead time (ngày), `s` = hệ số mùa vụ.

**Dự báo.** `level = EWMA(x, α = 0.35)`, `trend` = hệ số góc hồi quy tuyến tính trên `x`.

```
projectedDemand(H) = ceil( s × Σ_{d=1..H} max(0, level + trend × d) )
```

**Safety stock.**

```
SS = max( reorder_point,  ceil(z × σ × √L),  2 nếu có lượt mượn hoặc đặt chỗ trong kỳ, ngược lại 0 )
```

* `z = 1.645` — phân vị chuẩn ứng với mức phục vụ ~95% (xác suất không hết hàng trong một chu kỳ, nếu nhu
  cầu xấp xỉ chuẩn).
* `σ` — độ lệch chuẩn mẫu của số lượt mượn theo ngày trong cửa sổ (đơn vị: bản/ngày).
* `L` — lead time tính bằng ngày; `σ√L` là độ lệch chuẩn của tổng nhu cầu trong `L` ngày nếu các ngày độc lập.
* `reorder_point` lấy từ `stock_balances`; hai "sàn" còn lại là luật production.

**Số lượng đề xuất.**

```
Q = max(0, projectedDemand(L) + SS − A)
nếu priority = HIGH  và Q < 5 → Q = 5
nếu priority = MEDIUM và Q < 3 → Q = 3
```

**Priority.** `HIGH` nếu (A ≤ 0 và có mượn/đặt chỗ) hoặc (A ≤ 5 và ≥ 5 lượt mượn) hoặc
(`A / pace ≤ L`, pace = EWMA); `MEDIUM` nếu (A ≤ 10 và ≥ 3 lượt mượn) hoặc ≥ 2 đặt chỗ hoặc
`forecast_30d > A`; còn lại `LOW`.

**Demand score** (chỉ dùng để xếp hạng, không phải xác suất):
`2·mượn + 3·đặt chỗ + 1.5·wishlist + 2·alert + max(0, %tăng/10) + lowStockBonus(A)`.

**Hệ số mùa vụ.** `s = clamp( mượn_cùng_kỳ_năm_trước / (tổng_mượn_365_ngày / 365 × days), 0.5, 2 )`,
bỏ qua (s = 1) khi tổng 365 ngày < 5.

**Lead time.** `resolveLeadTime`: trung vị ≥ 3 lần giao thực tế của variant → của nhà cung cấp →
lead time nhà cung cấp khai báo → mặc định 14 ngày. Trung vị (không phải trung bình) để một lần giao trễ
bất thường không làm phồng mọi gợi ý sau đó.

**Ngân sách.** Ứng viên đã sắp theo (priority, demand score, Q, tên); duyệt lần lượt, cấp vốn mọi dòng
còn vừa ngân sách còn lại (dòng đắt không chặn dòng rẻ phía sau).

## 4. Các mô hình dự báo

| Mô hình | Dự báo mỗi ngày | Ghi chú |
| --- | --- | --- |
| Naive | giá trị ngày cuối | baseline |
| MA7 / MA30 | trung bình 7 / 30 ngày cuối | baseline |
| EWMA + trend | `max(0, level + trend·d)` | **mô hình production** (chưa nhân mùa vụ, chưa làm tròn) |
| Croston | `ẑ / p̂` — làm trơn riêng cỡ cầu khác 0 và khoảng cách giữa hai lần có cầu, chỉ cập nhật ngày có cầu | intermittent demand |
| SBA | `(1 − α/2) · ẑ / p̂` | hiệu chỉnh độ chệch dương của Croston |
| TSB | `d̂ · ẑ` — xác suất có cầu `d̂` cập nhật **mọi** ngày | dự báo giảm dần qua chuỗi ngày 0 dài |

Croston/SBA/TSB dùng α = β = 0.1 (giá trị mặc định trong tài liệu: Syntetos & Boylan 2005; Teunter,
Syntetos & Babai 2011), cố định trước, **không tinh chỉnh trên dữ liệu đánh giá**. Cả ba là hàm thuần
(`croston`, `tsb` trong `forecast.js`), không âm, trả 0 cho chuỗi toàn 0, xử lý chuỗi ngắn (khởi tạo ở lần
có cầu đầu tiên). Chúng được thêm vào `rollingBacktest()` (và do đó vào `/analytics/forecast-accuracy`)
như **ứng viên đánh giá**; mô hình production cho gợi ý nhập kho **không bị thay**.

## 5. Quy trình đánh giá (evaluation protocol)

### 5.1 Dự báo

* Dữ liệu: các lượt mượn của bộ dữ liệu tổng hợp đã ghi vào `borrow_db` (seed 20260928, 600 khách, 24 tháng).
* Chuỗi: 180 ngày cuối, một chuỗi/variant, giống `/analytics/forecast-accuracy` và `simulation-report`.
* **Temporal backtest** (`rollingBacktest`): cửa sổ huấn luyện mở rộng từ 30 ngày; mỗi fold dự báo
  `horizon` ngày tiếp theo **chỉ từ phần dữ liệu trước mốc cắt**; horizon 7 và 14 ngày (14 = lead time mặc định).
* Gộp giữa các variant chính xác theo từng cặp (thực tế, dự báo): `MAE = Σ|e|/n`, `RMSE = √(Σe²/n)`,
  `WAPE = Σ|e| / Σ thực tế`, `MAPE` chỉ trên ngày có cầu, `bias = Σ(dự báo − thực tế)/n`.
  (Báo cáo mô phỏng cũ lấy trung bình có trọng số của WAPE từng variant — không phải WAPE gộp — nên WAPE ở
  đây khác số cũ; MAE/RMSE của 4 mô hình cũ trùng khớp.)
* Lưu ý: trên chuỗi nhiều ngày 0, MAE ưu tiên dự báo gần 0; vì vậy luôn đọc kèm `bias`.

### 5.2 Backtest chính sách nhập kho (kho ảo)

**Nhu cầu.** Bộ mô phỏng chạy hai lần cùng một quần thể: lần *pilot* với kho không giới hạn, rồi lần chính
với số bản sao hiệu chỉnh từ pilot. Lượt mượn của lần chính đã bị *kiểm duyệt* bởi hết hàng (yêu cầu bị từ
chối không thành lượt mượn). Backtest kho cần nhu cầu **chưa bị kiểm duyệt** — nếu một chính sách giữ nhiều
bản hơn bộ mô phỏng, những yêu cầu từng bị từ chối phải còn đó để được phục vụ — nên dùng mọi yêu cầu mượn của
lần pilot (cùng seed). Bộ sưu tập ban đầu là số bản hiệu chỉnh của chính bộ mô phỏng (test xác nhận trùng
với bộ dữ liệu trong DB).

**Kho ảo, bản sách luân chuyển.** Mỗi chính sách có một kho ảo **độc lập**; không dùng `stock_balances`
hiện tại (thời gian không khớp với lịch sử tổng hợp). Một lượt mượn được phục vụ giữ một bản đến ngày trả
(lấy từ chính dòng dữ liệu); mua thêm làm tăng số bản sở hữu vĩnh viễn; yêu cầu không có bản trên kệ bị mất.

**Vòng lặp theo ngày** (`eval/inventory-simulator.js`):

1. hàng của PO đến hạn về kho (`available += q`, `owned += q`);
2. bản sách đến hạn trả quay lại kệ;
3. nếu là ngày xem xét (mỗi 7 ngày): chính sách quyết định — đơn **không** cộng vào kho ngay mà thành
   đơn chờ, về sau `lead_time_days`;
4. áp nhu cầu thực tế trong ngày theo thứ tự thời gian: còn bản thì phục vụ, hết thì ghi nhận unmet;
5. ghi nhận fulfilled, unmet, tồn cuối ngày, stockout, số lượng đặt, chi phí.

**Không rò rỉ tương lai.** Chính sách không bao giờ nhận dòng thời gian nhu cầu; nó chỉ nhận trạng thái kho
và **nhật ký các lượt mượn mà chính kho ảo đó đã phục vụ**. Bước 3 chạy trước bước 4, nên tại thời điểm quyết
định nhật ký chỉ chứa lượt mượn của các ngày trước. Hai test khóa điều này: (a) mọi timestamp chính sách thấy
đều < đầu ngày quyết định; (b) hai dòng nhu cầu giống nhau đến ngày k nhưng khác sau đó cho ra quyết định
giống hệt đến ngày k. Đặt chỗ và wishlist được dựng lại **tại đúng thời điểm** (đặt chỗ còn mở tại `to`;
wishlist tồn tại tại `to`, kể cả dòng sau này bị DB xóa cứng — bộ mô phỏng giữ `removed_at`).

**Giống nhau giữa các chính sách** trong cùng kịch bản: cùng nhu cầu, cùng bộ sưu tập ban đầu, cùng kịch bản
lead time (lead time của một đơn là hàm tất định của (variant, ngày đặt)), cùng đơn giá (`unit_cost` từ
`data/smartbook_catalog_enrichment_seed.sql`), cùng cửa sổ chấm điểm, cùng chu kỳ xem xét. Chỉ khác logic đặt hàng.

**Thời gian.** 395 ngày đầu (365 ngày cho hệ số mùa vụ + 30 ngày cửa sổ production) là *warm-up*: kho ảo chạy
không đặt hàng, giống nhau cho mọi chính sách, để có lịch sử cho quyết định đầu tiên. Chấm điểm từ ngày 396
đến hết dữ liệu.

**Vị trí tồn kho.** Mọi chính sách so với `vị trí = bản trên kệ + bản đang đặt`. `available_qty` của
production chỉ là bản trên kệ; cộng bản đang đặt mô phỏng việc thủ thư không mua lại hàng đã đặt. Bản đang
cho mượn **không** được tính — giống production.

**Các chính sách.**

| Chính sách | Quy tắc |
| --- | --- |
| `NO_REORDER` | tham chiếu: không bao giờ đặt; cho thấy riêng bộ sưu tập ban đầu đáp ứng được bao nhiêu |
| `REORDER_POINT` (A) | nếu vị trí ≤ 5 thì đặt đủ lên 10. 5 là `LOW_STOCK_THRESHOLD` mặc định của production, 10 = 2×5; không tinh chỉnh |
| `MA30_FIXED_LT` (B) | `Q = max(0, ceil(MA30 × 14) + ceil(1.645 × σ₃₀ × √14) − vị trí)` trên 30 ngày trọn vẹn gần nhất; lead time cố định 14 ngày; không trend, không mùa vụ, không tín hiệu, không sàn theo priority |
| `SMARTBOOK` (C) | gọi nguyên văn `calculateSuggestion()` của production với đầu vào dựng lại tại thời điểm; đặt `suggested_reorder_qty` |
| `SMARTBOOK_BUDGET_MATCHED` | SMARTBOOK + ngân sách mỗi lần xem xét = chi phí tổng của baseline rẻ hơn (A hoặc B, cùng kịch bản) ÷ số lần xem xét; phân bổ bằng `allocateBudget()` theo thứ tự production |

SMARTBOOK được gọi như production chạy lúc 23:59:59.999 ngày hôm trước (chuỗi gồm 31 ngày trọn). *Quan sát về
production:* nếu endpoint được gọi lúc 00:00, chuỗi có thêm một bucket rỗng cho "hôm nay" và mức EWMA giảm
35% — kết quả gợi ý phụ thuộc giờ gọi trong ngày. Backtest không tái hiện hiệu ứng này; đây là điểm nên
cân nhắc sửa ở production (chỉ dùng ngày trọn vẹn).

**Kịch bản** (giả định mô phỏng, không phải hành vi nhà cung cấp đo được):

| Kịch bản | Bộ sưu tập ban đầu | Lead time thực của mỗi đơn |
| --- | --- | --- |
| `BASE` | số bản hiệu chỉnh của bộ mô phỏng | đúng 14 ngày |
| `SUPPLIER_DELAY` | như BASE | 14–28 ngày (nhà cung cấp chậm hơn mức khai báo 14) |
| `LEAN_START` | một nửa (tối thiểu 1 bản) | đúng 14 ngày |

Bộ dữ liệu tổng hợp chỉ có một nhà cung cấp ảo và không có lead time khai báo, nên chuỗi `resolveLeadTime`
của SMARTBOOK là: lịch sử giao của variant → của nhà cung cấp ảo → 14 ngày. Lịch sử giao là các đơn **mà
chính kho ảo đó đã nhận** trước ngày quyết định.

**Cửa sổ ổn định (bổ sung sau lần chạy đầu).** Trong 28 ngày đầu chấm điểm (lead time dài nhất có thể), chưa
đơn nào đặt trong cửa sổ chấm điểm kịp về, nên mọi chính sách vẫn chạy trên đúng kho warm-up như nhau. Lần chạy
đầu cho thấy phần lớn stockout days rơi vào giai đoạn này (seed mặc định, SMARTBOOK ở BASE: 62/64 ngày nằm trong
14 ngày đầu). Vì vậy tài liệu báo cáo thêm chỉ số cho cửa sổ từ ngày thứ 29 — **bên cạnh**, không thay thế, chỉ số toàn
cửa sổ đã định trước. Thứ tự xếp hạng các chính sách không phụ thuộc lựa chọn này.

### 5.3 Định nghĩa chỉ số kinh doanh

Tính trên ngày chấm điểm, cộng trên toàn bộ 114 variant.

| Chỉ số | Định nghĩa |
| --- | --- |
| `total_demand` | số yêu cầu mượn (mỗi yêu cầu = 1 bản) |
| `fulfilled_demand` | số yêu cầu được phục vụ ngay (còn bản trên kệ) |
| `unmet_demand` | `total_demand − fulfilled_demand` (yêu cầu bị mất) |
| `fill_rate` | `fulfilled_demand / total_demand` |
| `stockout_days` | số cặp (variant, ngày) có `unmet > 0` |
| `stockout_rate` | `stockout_days / (số variant × số ngày chấm điểm)` |
| `average_inventory` | trung bình theo ngày của tổng số bản **sở hữu** cuối ngày (cả bản đang cho mượn) |
| `max_inventory` | giá trị lớn nhất của tổng số bản sở hữu cuối ngày |
| `average_available_inventory` | như trên nhưng chỉ bản trên kệ |
| `ordered_units` / `order_count` | tổng số bản đặt / số dòng đặt hàng (variant × lần xem xét) |
| `procurement_cost` | `Σ số bản đặt × unit_cost` (VND), tính tại ngày đặt, kể cả đơn chưa về khi hết dữ liệu |
| `average_order_size` | `ordered_units / order_count` |
| `budget_utilization` | chi tiêu / tổng ngân sách được cấp (chỉ khi có ngân sách) |
| `unfunded_reorder_count` | số dòng đề xuất Q > 0 không được cấp vốn |

Ở cửa sổ ổn định, chi phí và số đơn chỉ tính các đơn đặt trong cửa sổ đó.

### 5.4 Ablation

Cùng giao thức, chỉ tắt một thành phần của SMARTBOOK:

| Biến thể | Thay đổi |
| --- | --- |
| `SMARTBOOK_FULL` | đầy đủ (= SMARTBOOK) |
| `SMARTBOOK_NO_SEASONALITY` | hệ số mùa vụ = 1 |
| `SMARTBOOK_FIXED_LEAD_TIME` | lead time cố định 14 ngày thay cho lead time học |
| `SMARTBOOK_NO_SAFETY_STOCK` | safety stock = 0 (tùy chọn `includeSafetyStock: false`, chỉ dùng trong đánh giá) |
| `SMARTBOOK_NO_DEMAND_SIGNALS` | số đặt chỗ và wishlist = 0 |

Demand score chỉ ảnh hưởng thứ tự xếp hạng, nên tín hiệu nhu cầu chỉ có thể có tác dụng khi ngân sách buộc
phải chọn; do đó cặp FULL / NO_DEMAND_SIGNALS được chạy thêm dưới ngân sách khớp baseline.

**Tính năng không thể backtest đúng thời điểm: availability alert.** Alert được tạo khi *hết bản*, tức phụ
thuộc chính stockout của từng chính sách; thế giới nhu cầu pilot (kho vô hạn) không có alert nào. Dùng bảng
alert cuối kỳ của bộ dữ liệu quan sát sẽ là rò rỉ stockout của một thế giới khác. Vì vậy `alert = 0` ở **mọi**
biến thể SMARTBOOK, và ablation NO_DEMAND_SIGNALS chỉ đo đặt chỗ + wishlist.

### 5.5 Lead time

`eval/lead-time-backtest.js` phát lại các lần giao (PO → goods receipt, cùng phép nối và bộ lọc như
`getLeadTimeHistory()`) theo ngày đặt; mỗi lần giao chỉ được dự đoán từ những lần giao **đã nhận trước ngày
đặt của nó**. So sánh `FIXED_14_DAYS`, `SUPPLIER_DECLARED`, `LEARNED_MEDIAN` (chỉ khi thực sự học được, ≥ 3 quan
sát) trên tập cặp chung, kèm `PRODUCTION_RESOLVER` (chuỗi fallback đầy đủ). Dưới 5 cặp ⇒ `INSUFFICIENT_DATA`,
không báo chỉ số sai số. Lead time **không** được đánh giá trên dữ liệu tổng hợp: bộ mô phỏng không sinh lịch sử
giao hàng, và một kịch bản lead time do chính ta đặt ra sẽ chỉ chứng minh điều ta giả định.

## 6. Kết quả dự báo *(tự động)*

<!-- AUTO:forecast:start -->
Dữ liệu: 114 variant có lượt mượn trong 180 ngày cuối; tỉ lệ ngày không có lượt mượn trung bình 79.5%; phân lớp nhu cầu (Syntetos–Boylan): INTERMITTENT 113, SMOOTH 1.

**Horizon 7 ngày** (114 variant, 16758 điểm dự báo mỗi mô hình; sắp xếp theo MAE)

| Mô hình | MAE | RMSE | WAPE | MAPE (ngày có cầu) | Bias | Số variant thắng (MAE) |
| --- | --- | --- | --- | --- | --- | --- |
| MA30 | 0.3314 | 0.5221 | 1.234 | 0.677 | -0.0088 | 18 |
| TSB | 0.3328 | 0.5279 | 1.240 | 0.681 | -0.0103 | 3 |
| MA7 | 0.3381 | 0.5499 | 1.259 | 0.690 | -0.0050 | 11 |
| EWMA + trend (production) | 0.3382 | 0.5687 | 1.260 | 0.716 | -0.0221 | 11 |
| SBA | 0.3436 | 0.5227 | 1.280 | 0.670 | 0.0032 | 18 |
| Croston | 0.3492 | 0.5228 | 1.301 | 0.659 | 0.0175 | 3 |
| Naive (giá trị cuối) | 0.3577 | 0.7282 | 1.333 | 0.806 | -0.0320 | 50 |

**Horizon 14 ngày** (114 variant, 15960 điểm dự báo mỗi mô hình; sắp xếp theo MAE)

| Mô hình | MAE | RMSE | WAPE | MAPE (ngày có cầu) | Bias | Số variant thắng (MAE) |
| --- | --- | --- | --- | --- | --- | --- |
| TSB | 0.3278 | 0.5232 | 1.237 | 0.680 | -0.0111 | 3 |
| MA30 | 0.3280 | 0.5188 | 1.238 | 0.676 | -0.0080 | 19 |
| EWMA + trend (production) | 0.3286 | 0.5620 | 1.240 | 0.709 | -0.0304 | 10 |
| MA7 | 0.3299 | 0.5419 | 1.245 | 0.692 | -0.0099 | 16 |
| Naive (giá trị cuối) | 0.3400 | 0.7048 | 1.283 | 0.797 | -0.0519 | 47 |
| SBA | 0.3428 | 0.5204 | 1.293 | 0.669 | 0.0073 | 17 |
| Croston | 0.3484 | 0.5205 | 1.315 | 0.657 | 0.0216 | 2 |

**MAE theo lớp nhu cầu, horizon 7 ngày**

| Lớp nhu cầu | Số variant | Naive (giá trị cuối) | MA7 | MA30 | EWMA + trend (production) | Croston | SBA | TSB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| INTERMITTENT | 113 | 0.3440 | 0.3278 | 0.3214 | 0.3273 | 0.3392 | 0.3337 | 0.3228 |
| SMOOTH | 1 | 1.9048 | 1.5044 | 1.4576 | 1.5770 | 1.4720 | 1.4656 | 1.4687 |
<!-- AUTO:forecast:end -->

Hình: `thesis/figures/forecast_mae_comparison.png`, `thesis/figures/forecast_rmse_comparison.png`.

## 7. Kết quả backtest chính sách nhập kho *(tự động)*

### 7.1 Toàn cửa sổ chấm điểm

<!-- AUTO:reorder:start -->
Cửa sổ chấm điểm: 2025-10-28 → 2026-09-28 (không gồm ngày cuối), 335 ngày × 114 variant; xem xét đặt hàng mỗi 7 ngày. Tồn kho = tổng số bản sở hữu của toàn danh mục (cả bản đang cho mượn).

**Kịch bản BASE** — Calibrated starting collection, every order delivered after 14 days. Bộ sưu tập ban đầu: 724 bản.

| Chính sách | Fill rate | Unmet | Stockout days | Stockout rate | Tồn kho TB (bản) | Tồn kho max | Số bản đặt | Số đơn | Chi phí (triệu VND) | Cỡ đơn TB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| NO_REORDER | 82.71% | 1905 | 1634 | 4.279% | 724.0 | 724 | 0 | 0 | 0.0 | — |
| REORDER_POINT | 98.98% | 112 | 83 | 0.217% | 1793.9 | 1972 | 1259 | 165 | 146.8 | 7.63 |
| MA30_FIXED_LT | 99.27% | 80 | 69 | 0.181% | 1950.8 | 2338 | 1629 | 524 | 199.6 | 3.11 |
| SMARTBOOK | 99.33% | 74 | 64 | 0.168% | 2925.9 | 3669 | 2991 | 728 | 365.4 | 4.11 |
| SMARTBOOK_BUDGET_MATCHED | 90.77% | 1017 | 920 | 2.409% | 1293.4 | 1882 | 1215 | 187 | 145.4 | 6.50 |

Ngân sách SMARTBOOK_BUDGET_MATCHED: 3.1 triệu VND/lần xem xét; mức sử dụng 99.1%; 3785 dòng đề xuất không được cấp vốn.

**Kịch bản SUPPLIER_DELAY** — Calibrated starting collection, each order delivered after 14-28 days (supplier slower than its declared 14 days). Bộ sưu tập ban đầu: 724 bản.

| Chính sách | Fill rate | Unmet | Stockout days | Stockout rate | Tồn kho TB (bản) | Tồn kho max | Số bản đặt | Số đơn | Chi phí (triệu VND) | Cỡ đơn TB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| NO_REORDER | 82.71% | 1905 | 1634 | 4.279% | 724.0 | 724 | 0 | 0 | 0.0 | — |
| REORDER_POINT | 98.73% | 140 | 110 | 0.288% | 1765.8 | 1971 | 1266 | 166 | 147.8 | 7.63 |
| MA30_FIXED_LT | 98.98% | 112 | 100 | 0.262% | 1905.8 | 2319 | 1627 | 537 | 199.3 | 3.03 |
| SMARTBOOK | 99.04% | 106 | 95 | 0.249% | 3213.9 | 4119 | 3511 | 630 | 428.1 | 5.57 |
| SMARTBOOK_BUDGET_MATCHED | 89.67% | 1138 | 1023 | 2.679% | 1287.4 | 1886 | 1241 | 164 | 146.5 | 7.57 |

Ngân sách SMARTBOOK_BUDGET_MATCHED: 3.1 triệu VND/lần xem xét; mức sử dụng 99.1%; 3835 dòng đề xuất không được cấp vốn.

**Kịch bản LEAN_START** — Half of the calibrated starting collection (at least 1 copy), 14-day delivery. Bộ sưu tập ban đầu: 340 bản.

| Chính sách | Fill rate | Unmet | Stockout days | Stockout rate | Tồn kho TB (bản) | Tồn kho max | Số bản đặt | Số đơn | Chi phí (triệu VND) | Cỡ đơn TB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| NO_REORDER | 46.93% | 5849 | 4689 | 12.278% | 340.0 | 340 | 0 | 0 | 0.0 | — |
| REORDER_POINT | 97.21% | 308 | 228 | 0.597% | 1728.9 | 2021 | 1689 | 217 | 199.8 | 7.78 |
| MA30_FIXED_LT | 97.50% | 276 | 231 | 0.605% | 1831.5 | 2324 | 1999 | 684 | 247.2 | 2.92 |
| SMARTBOOK | 97.75% | 248 | 207 | 0.542% | 2743.1 | 3434 | 3124 | 731 | 382.2 | 4.27 |
| SMARTBOOK_BUDGET_MATCHED | 76.86% | 2550 | 2250 | 5.892% | 1099.2 | 1920 | 1641 | 243 | 198.8 | 6.75 |

Ngân sách SMARTBOOK_BUDGET_MATCHED: 4.2 triệu VND/lần xem xét; mức sử dụng 99.5%; 3541 dòng đề xuất không được cấp vốn.
<!-- AUTO:reorder:end -->

### 7.2 Cửa sổ ổn định

<!-- AUTO:reorder_steady:start -->
Cửa sổ ổn định: từ 2025-11-25 (307 ngày). Chi phí và số đơn chỉ tính các đơn đặt trong cửa sổ này.

**Kịch bản BASE**

| Chính sách | Fill rate | Unmet | Stockout days | Stockout rate | Tồn kho TB (bản) | Tồn kho max | Số bản đặt | Số đơn | Chi phí (triệu VND) | Cỡ đơn TB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| NO_REORDER | 82.74% | 1762 | 1509 | 4.312% | 724.0 | 724 | 0 | 0 | 0.0 | — |
| REORDER_POINT | 99.62% | 39 | 20 | 0.057% | 1849.7 | 1972 | 331 | 58 | 41.5 | 5.71 |
| MA30_FIXED_LT | 99.92% | 8 | 7 | 0.020% | 2033.5 | 2338 | 876 | 353 | 105.5 | 2.48 |
| SMARTBOOK | 99.98% | 2 | 2 | 0.006% | 3086.5 | 3669 | 1643 | 478 | 198.2 | 3.44 |
| SMARTBOOK_BUDGET_MATCHED | 91.37% | 881 | 799 | 2.283% | 1342.9 | 1882 | 1101 | 174 | 133.3 | 6.33 |

**Kịch bản SUPPLIER_DELAY**

| Chính sách | Fill rate | Unmet | Stockout days | Stockout rate | Tồn kho TB (bản) | Tồn kho max | Số bản đặt | Số đơn | Chi phí (triệu VND) | Cỡ đơn TB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| NO_REORDER | 82.74% | 1762 | 1509 | 4.312% | 724.0 | 724 | 0 | 0 | 0.0 | — |
| REORDER_POINT | 99.62% | 39 | 20 | 0.057% | 1842.9 | 1971 | 340 | 59 | 42.5 | 5.76 |
| MA30_FIXED_LT | 99.88% | 12 | 11 | 0.031% | 1999.4 | 2319 | 897 | 371 | 107.3 | 2.42 |
| SMARTBOOK | 99.94% | 6 | 6 | 0.017% | 3423.0 | 4119 | 2146 | 385 | 258.9 | 5.57 |
| SMARTBOOK_BUDGET_MATCHED | 90.19% | 1001 | 901 | 2.574% | 1337.9 | 1886 | 1126 | 150 | 134.3 | 7.51 |

**Kịch bản LEAN_START**

| Chính sách | Fill rate | Unmet | Stockout days | Stockout rate | Tồn kho TB (bản) | Tồn kho max | Số bản đặt | Số đơn | Chi phí (triệu VND) | Cỡ đơn TB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| NO_REORDER | 46.73% | 5437 | 4352 | 12.435% | 340.0 | 340 | 0 | 0 | 0.0 | — |
| REORDER_POINT | 99.19% | 83 | 44 | 0.126% | 1806.3 | 2021 | 589 | 100 | 72.4 | 5.89 |
| MA30_FIXED_LT | 99.62% | 39 | 35 | 0.100% | 1944.2 | 2324 | 1313 | 499 | 161.9 | 2.63 |
| SMARTBOOK | 99.86% | 14 | 12 | 0.034% | 2926.0 | 3434 | 1777 | 491 | 217.6 | 3.62 |
| SMARTBOOK_BUDGET_MATCHED | 78.77% | 2167 | 1931 | 5.517% | 1165.7 | 1920 | 1490 | 225 | 182.2 | 6.62 |
<!-- AUTO:reorder_steady:end -->

Hình: `reorder_fill_rate.png`, `reorder_stockout_days.png`, `reorder_average_inventory.png`,
`reorder_procurement_cost.png`, `inventory_timeline_example.png` (trong `thesis/figures/`).

## 8. Ablation *(tự động)*

<!-- AUTO:ablation:start -->

**Kịch bản BASE** (Δ so với SMARTBOOK_FULL cùng điều kiện ngân sách)

| Biến thể | Ngân sách | Fill rate | Δ fill | Stockout days | Δ stockout | Tồn kho TB | Δ tồn kho | Chi phí (triệu) | Δ chi phí |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SMARTBOOK_FULL | không | 99.33% | +0.00 điểm % | 64 | +0 | 2925.9 | 0.0% | 365.4 | 0.0% |
| SMARTBOOK_NO_SEASONALITY | không | 99.33% | +0.00 điểm % | 64 | +0 | 3190.4 | 9.0% | 425.9 | 16.6% |
| SMARTBOOK_FIXED_LEAD_TIME | không | 99.33% | +0.00 điểm % | 64 | +0 | 2925.9 | 0.0% | 365.4 | 0.0% |
| SMARTBOOK_NO_SAFETY_STOCK | không | 99.30% | -0.03 điểm % | 67 | +3 | 2836.6 | -3.1% | 356.8 | -2.4% |
| SMARTBOOK_NO_DEMAND_SIGNALS | không | 99.33% | +0.00 điểm % | 64 | +0 | 2921.6 | -0.1% | 363.5 | -0.5% |
| SMARTBOOK_FULL | có | 90.77% | +0.00 điểm % | 920 | +0 | 1293.4 | 0.0% | 145.4 | 0.0% |
| SMARTBOOK_NO_DEMAND_SIGNALS | có | 92.37% | +1.60 điểm % | 739 | -181 | 1372.7 | 6.1% | 145.2 | -0.2% |

**Kịch bản SUPPLIER_DELAY** (Δ so với SMARTBOOK_FULL cùng điều kiện ngân sách)

| Biến thể | Ngân sách | Fill rate | Δ fill | Stockout days | Δ stockout | Tồn kho TB | Δ tồn kho | Chi phí (triệu) | Δ chi phí |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SMARTBOOK_FULL | không | 99.04% | +0.00 điểm % | 95 | +0 | 3213.9 | 0.0% | 428.1 | 0.0% |
| SMARTBOOK_NO_SEASONALITY | không | 99.04% | +0.00 điểm % | 95 | +0 | 3493.1 | 8.7% | 485.5 | 13.4% |
| SMARTBOOK_FIXED_LEAD_TIME | không | 99.04% | +0.00 điểm % | 95 | +0 | 2855.3 | -11.2% | 364.6 | -14.8% |
| SMARTBOOK_NO_SAFETY_STOCK | không | 99.01% | -0.03 điểm % | 98 | +3 | 3009.6 | -6.4% | 396.8 | -7.3% |
| SMARTBOOK_NO_DEMAND_SIGNALS | không | 99.04% | +0.00 điểm % | 95 | +0 | 3212.4 | -0.0% | 428.1 | 0.0% |
| SMARTBOOK_FULL | có | 89.67% | +0.00 điểm % | 1023 | +0 | 1287.4 | 0.0% | 146.5 | 0.0% |
| SMARTBOOK_NO_DEMAND_SIGNALS | có | 91.40% | +1.72 điểm % | 827 | -196 | 1347.0 | 4.6% | 146.1 | -0.2% |

**Kịch bản LEAN_START** (Δ so với SMARTBOOK_FULL cùng điều kiện ngân sách)

| Biến thể | Ngân sách | Fill rate | Δ fill | Stockout days | Δ stockout | Tồn kho TB | Δ tồn kho | Chi phí (triệu) | Δ chi phí |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SMARTBOOK_FULL | không | 97.75% | +0.00 điểm % | 207 | +0 | 2743.1 | 0.0% | 382.2 | 0.0% |
| SMARTBOOK_NO_SEASONALITY | không | 97.75% | +0.00 điểm % | 207 | +0 | 3021.7 | 10.2% | 469.3 | 22.8% |
| SMARTBOOK_FIXED_LEAD_TIME | không | 97.75% | +0.00 điểm % | 207 | +0 | 2743.1 | 0.0% | 382.2 | 0.0% |
| SMARTBOOK_NO_SAFETY_STOCK | không | 97.65% | -0.10 điểm % | 216 | +9 | 2643.3 | -3.6% | 372.0 | -2.7% |
| SMARTBOOK_NO_DEMAND_SIGNALS | không | 97.74% | -0.01 điểm % | 208 | +1 | 2739.2 | -0.1% | 379.5 | -0.7% |
| SMARTBOOK_FULL | có | 76.86% | +0.00 điểm % | 2250 | +0 | 1099.2 | 0.0% | 198.8 | 0.0% |
| SMARTBOOK_NO_DEMAND_SIGNALS | có | 79.59% | +2.73 điểm % | 1931 | -319 | 1113.7 | 1.3% | 198.1 | -0.3% |
<!-- AUTO:ablation:end -->

Hình: `thesis/figures/reorder_ablation.png`.

## 9. Lead time *(tự động)*

<!-- AUTO:lead_time:start -->
Trạng thái: **INSUFFICIENT_DATA** — nguồn `seed:data/smartbook_sample_seed.sql`: 2 lần giao, 2 variant, 1 nhà cung cấp; 0 lần giao đủ điều kiện so sánh cặp (cần ≥ 5).

Only 0 deliveries had >= 3 earlier observations plus a declared lead time (need 5); error metrics are withheld rather than computed on too few points.

| Phương pháp | Mẫu dự đoán được | MAE (ngày) | Median AE | RMSE | Mẫu so sánh cặp | MAE cặp |
| --- | --- | --- | --- | --- | --- | --- |
| FIXED_14_DAYS | 2 | — | — | — | 0 | — |
| SUPPLIER_DECLARED | 2 | — | — | — | 0 | — |
| LEARNED_MEDIAN | 0 | — | — | — | 0 | — |
| PRODUCTION_RESOLVER | 2 | — | — | — | — | — |
<!-- AUTO:lead_time:end -->

Với dữ liệu thật: xuất các lần giao thành JSON
(`[{variant_id, supplier_id, order_date, received_at, declared_lead_time_days}]`) rồi chạy
`node eval/run-all.js --deliveries deliveries.json`, hoặc đọc trực tiếp DB:
`INVENTORY_DATABASE_URL=postgres://... node eval/run-all.js --lead-time-from-db`.
`lead_time_mae.png` chỉ được vẽ khi trạng thái là `OK`.

## 10. Tóm tắt so sánh *(tự động)*

<!-- AUTO:findings:start -->
- Dự báo, horizon 7 ngày: MAE thấp nhất là MA30 (0.3314); EWMA + trend (production) xếp hạng 4/7 (MAE 0.3382, bias -0.0221); mô hình intermittent tốt nhất là TSB (MAE 0.3328, thấp hơn EWMA 1.6%).
- Dự báo, horizon 14 ngày: MAE thấp nhất là TSB (0.3278); EWMA + trend (production) xếp hạng 3/7 (MAE 0.3286, bias -0.0304); mô hình intermittent tốt nhất là TSB (MAE 0.3278, thấp hơn EWMA 0.2%).
- BASE, toàn cửa sổ: SMARTBOOK so với REORDER_POINT — fill rate 99.33% vs 98.98% (+0.34 điểm %), stockout days 64 vs 83, tồn kho TB 2925.9 vs 1793.9 bản (×1.63), chi phí 365.4 vs 146.8 triệu VND (×2.49).
- BASE, toàn cửa sổ: SMARTBOOK so với MA30_FIXED_LT — fill rate 99.33% vs 99.27% (+0.05 điểm %), stockout days 64 vs 69, tồn kho TB 2925.9 vs 1950.8 bản (×1.50), chi phí 365.4 vs 199.6 triệu VND (×1.83).
- BASE, cửa sổ ổn định: SMARTBOOK so với REORDER_POINT — fill rate 99.98% vs 99.62% (+0.36 điểm %), stockout days 2 vs 20, tồn kho TB 3086.5 vs 1849.7 bản (×1.67), chi phí 198.2 vs 41.5 triệu VND (×4.78).
- BASE, cửa sổ ổn định: SMARTBOOK so với MA30_FIXED_LT — fill rate 99.98% vs 99.92% (+0.06 điểm %), stockout days 2 vs 7, tồn kho TB 3086.5 vs 2033.5 bản (×1.52), chi phí 198.2 vs 105.5 triệu VND (×1.88).
- BASE, cùng ngân sách với REORDER_POINT: SMARTBOOK_BUDGET_MATCHED đạt fill rate 90.77%, thấp hơn REORDER_POINT (98.98%), chênh -8.21 điểm %.
- SUPPLIER_DELAY, toàn cửa sổ: SMARTBOOK so với REORDER_POINT — fill rate 99.04% vs 98.73% (+0.31 điểm %), stockout days 95 vs 110, tồn kho TB 3213.9 vs 1765.8 bản (×1.82), chi phí 428.1 vs 147.8 triệu VND (×2.90).
- SUPPLIER_DELAY, toàn cửa sổ: SMARTBOOK so với MA30_FIXED_LT — fill rate 99.04% vs 98.98% (+0.05 điểm %), stockout days 95 vs 100, tồn kho TB 3213.9 vs 1905.8 bản (×1.69), chi phí 428.1 vs 199.3 triệu VND (×2.15).
- SUPPLIER_DELAY, cửa sổ ổn định: SMARTBOOK so với REORDER_POINT — fill rate 99.94% vs 99.62% (+0.32 điểm %), stockout days 6 vs 20, tồn kho TB 3423.0 vs 1842.9 bản (×1.86), chi phí 258.9 vs 42.5 triệu VND (×6.09).
- SUPPLIER_DELAY, cửa sổ ổn định: SMARTBOOK so với MA30_FIXED_LT — fill rate 99.94% vs 99.88% (+0.06 điểm %), stockout days 6 vs 11, tồn kho TB 3423.0 vs 1999.4 bản (×1.71), chi phí 258.9 vs 107.3 triệu VND (×2.41).
- SUPPLIER_DELAY, cùng ngân sách với REORDER_POINT: SMARTBOOK_BUDGET_MATCHED đạt fill rate 89.67%, thấp hơn REORDER_POINT (98.73%), chênh -9.06 điểm %.
- LEAN_START, toàn cửa sổ: SMARTBOOK so với REORDER_POINT — fill rate 97.75% vs 97.21% (+0.54 điểm %), stockout days 207 vs 228, tồn kho TB 2743.1 vs 1728.9 bản (×1.59), chi phí 382.2 vs 199.8 triệu VND (×1.91).
- LEAN_START, toàn cửa sổ: SMARTBOOK so với MA30_FIXED_LT — fill rate 97.75% vs 97.50% (+0.25 điểm %), stockout days 207 vs 231, tồn kho TB 2743.1 vs 1831.5 bản (×1.50), chi phí 382.2 vs 247.2 triệu VND (×1.55).
- LEAN_START, cửa sổ ổn định: SMARTBOOK so với REORDER_POINT — fill rate 99.86% vs 99.19% (+0.68 điểm %), stockout days 12 vs 44, tồn kho TB 2926.0 vs 1806.3 bản (×1.62), chi phí 217.6 vs 72.4 triệu VND (×3.01).
- LEAN_START, cửa sổ ổn định: SMARTBOOK so với MA30_FIXED_LT — fill rate 99.86% vs 99.62% (+0.24 điểm %), stockout days 12 vs 35, tồn kho TB 2926.0 vs 1944.2 bản (×1.50), chi phí 217.6 vs 161.9 triệu VND (×1.34).
- LEAN_START, cùng ngân sách với REORDER_POINT: SMARTBOOK_BUDGET_MATCHED đạt fill rate 76.86%, thấp hơn REORDER_POINT (97.21%), chênh -20.34 điểm %.
<!-- AUTO:findings:end -->

## 11. Diễn giải

*Phần này viết tay, sau khi đọc kết quả của seed mặc định (20260928). Mọi con số nằm ở các mục tự động phía
trên; nếu chạy lại với seed khác, phải đọc lại mục 10 trước khi dùng phần diễn giải này.*

**Dự báo.** Trên dữ liệu gần như toàn intermittent, chênh lệch MAE giữa các mô hình chỉ vài phần trăm. Mô
hình production (EWMA + trend) không phải tốt nhất nhưng cũng không kém rõ rệt; MA30 và TSB dẫn đầu ở MAE;
Croston/SBA có RMSE sát mức tốt nhất nhưng MAE kém hơn và bias dương (dự báo cao). EWMA + trend có bias âm (dự báo thấp) lớn nhất trong nhóm làm
trơn. Không mô hình nào thắng áp đảo trên cả hai horizon và mọi chỉ số.

**Chính sách nhập kho.** SMARTBOOK đạt fill rate cao nhất và ít stockout days nhất trong cả ba kịch bản, nhưng
mức hơn baseline rất nhỏ, trong khi tồn kho trung bình và chi phí mua cao hơn rõ rệt (xem mục 10). Khi bị giới
hạn ở đúng mức chi tiêu của baseline rẻ hơn, SMARTBOOK đáp ứng **kém hơn** baseline đó. Nói cách khác, ở dữ
liệu này phần cải thiện của SMARTBOOK đến từ việc mua nhiều hơn, không phải từ việc phân bổ thông minh hơn.

Nguyên nhân quan sát được từ cơ chế:
1. Công thức production coi lượt mượn trong lead time như hàng *tiêu hao*, trong khi sách thư viện quay lại
   kệ sau khi trả; kho ảo giữ nhiều bản nằm trên kệ (xem `average_available_inventory`).
2. Sàn số lượng theo priority (MEDIUM ≥ 3, HIGH ≥ 5) kích hoạt ở mỗi lần xem xét khi priority còn MEDIUM
   (`forecast_30d > available`); phần lớn đơn của SMARTBOOK ở BASE là MEDIUM (`decision_stats.by_priority`
   trong `reorder_policy_results.json`).
3. Khi có ngân sách, thứ tự (priority, demand score) ưu tiên các dòng HIGH/MEDIUM có sàn số lượng, không ưu
   tiên nơi một bản thêm giảm được nhiều unmet nhất.

**Ablation.** Mùa vụ giúp *giảm* chi phí mà không đổi fill rate trên dữ liệu này; lead time học chỉ có tác dụng
khi nhà cung cấp thực sự lệch khai báo (SUPPLIER_DELAY) và ở đó làm tăng chi phí mà fill rate gần như không đổi;
safety stock có tác động nhỏ (sàn priority đã lấn át); tín hiệu nhu cầu gần như không tác động khi không có ngân
sách, và dưới ngân sách thì bỏ chúng đi lại cho fill rate cao hơn — demand score hiện tại xếp hạng chưa tốt.

## 12. Giới hạn

* **Dữ liệu tổng hợp.** Nhu cầu do bộ mô phỏng persona sinh ra, không phải người dùng thật; tham số hành vi là
  giả định, không hiệu chỉnh từ thư viện thật. Không khẳng định kết quả tương đương môi trường thư viện thật.
* **Nhu cầu thưa / intermittent.** ~80% ngày không có lượt mượn; 113/114 variant thuộc lớp INTERMITTENT;
  chỉ số sai số dự báo ở mức tuyệt đối nhỏ và chênh lệch giữa mô hình hẹp.
* **Kho ảo.** Không dùng tồn kho thật; giả định yêu cầu không có bản thì mất (không chờ, không đặt chỗ), không
  mất/hỏng sách, không thanh lý, một nhà cung cấp ảo, đơn giá cố định, không có số lượng đặt tối thiểu.
* **Giả định mô phỏng.** Kịch bản lead time, bộ sưu tập ban đầu, chu kỳ xem xét 7 ngày, ngân sách tuần
  không cộng dồn (luật định trước; ngân sách theo tháng/năm có cộng dồn có thể cho kết quả khác), vị trí tồn kho
  có cộng hàng đang đặt (production không làm vậy).
* **Tín hiệu nhu cầu.** Đặt chỗ/wishlist lấy từ thế giới pilot, không phản ứng theo stockout của từng chính
  sách; availability alert không backtest được và được đặt bằng 0.
* **Lịch sử nhà cung cấp.** Repo chỉ có 1 PO / 1 phiếu nhập (2 dòng) ⇒ lead time `INSUFFICIENT_DATA`; lợi ích
  của lead time học chưa được kiểm chứng trên dữ liệu thật.
* **Một seed.** Kết quả của một quần thể tổng hợp; chưa có khoảng tin cậy qua nhiều seed.

## 13. Kết luận

Trên dữ liệu tổng hợp và giao thức trên, câu trả lời cho câu hỏi đánh giá là **chưa**: SmartBook có giảm hết
sách và tăng mức đáp ứng so với chính sách đơn giản, nhưng chỉ với biên rất nhỏ, đổi lại tồn kho và chi phí
tăng nhiều; ở cùng mức chi tiêu thì một chính sách min/max đơn giản đáp ứng tốt hơn. Về dự báo, các mô hình
intermittent (Croston/SBA/TSB) không vượt trội rõ rệt so với mô hình production.

Vì vậy **không thay mô hình dự báo production** dựa trên các kết quả này. Các hướng cải tiến có căn cứ từ
thực nghiệm (cần đánh giá lại bằng chính pipeline này trước khi đưa vào production):
(1) tính vị trí tồn kho có cộng bản đang cho mượn sắp trả và hàng đang đặt; (2) xem lại sàn số lượng theo
priority; (3) xếp hạng dưới ngân sách theo unmet kỳ vọng giảm được trên mỗi đồng; (4) chỉ dùng ngày trọn
vẹn trong chuỗi dự báo; (5) thu thập lịch sử giao hàng thật để đánh giá lead time học.
