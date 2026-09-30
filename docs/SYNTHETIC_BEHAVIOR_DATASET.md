# SmartBook — Persona-conditioned Synthetic Behavioral Dataset

> **Đây là dữ liệu tổng hợp mô phỏng hành vi người dùng, không phải dữ liệu thu thập từ người dùng thực tế.**
> Mọi con số về nhân khẩu học, persona và hành vi dưới đây là **giả định mô phỏng** do nhóm thiết kế,
> không phải thống kê về người dùng SmartBook hay bất kỳ thư viện thật nào. Không được mô tả tập dữ liệu
> này là "real user dataset" hoặc khẳng định "người dùng thực tế có hành vi như vậy".

Mã nguồn: `services/borrow-service/prisma/simulation/` · Kết quả đo mới nhất: `prisma/simulation/simulation-report.md`.

---

## 1. Vì sao cần dữ liệu tổng hợp

Dữ liệu demo viết tay chỉ có vài chục giao dịch — không đủ để huấn luyện/đánh giá mô hình rủi ro trả trễ,
no-show, dự báo nhu cầu (backtest cần ≥ 37 quan sát/ngày cho mỗi đầu sách) hay gợi ý sách. Thu thập dữ liệu
người dùng thật nằm ngoài phạm vi khóa luận, nên hệ thống dùng một **mô phỏng hành vi có điều kiện và có
ground truth**: ta biết chính xác quá trình sinh ra dữ liệu, nên có thể đo mô hình đạt bao nhiêu so với
trần lý thuyết (Bayes-optimal) và kiểm tra mô hình có khôi phục được sở thích ẩn hay không.

Generator trước đó (`seed-history.js`, 400 khách chỉ khác nhau ở một biến `punctuality`, chọn khách đều
ngẫu nhiên, chọn sách theo một phân phối Zipf chung cho mọi người) đã được thay bằng mô phỏng này;
`seed-history.js` giờ chỉ gọi vào đây nên chỉ còn **một** quần thể tổng hợp duy nhất.

## 2. Kiến trúc

```
Demographics (tuổi → nghề nghiệp/giai đoạn sống; giới tính độc lập)
   ↓
Persona (P(persona | nghề nghiệp))
   ↓
Latent traits  = persona prior + biến thiên cá nhân (logit-space)
   ↓
Preferences    = persona × nghề nghiệp × nhiễu log-normal; tác giả yêu thích
   ↓
Temporal habits (giờ ưa thích, weekday/weekend, mùa vụ theo giai đoạn sống)
   ↓
Discrete-event simulation (một min-heap theo thời gian, tồn kho dùng chung)
   ↓
Rows cho borrow_db  +  simulation-truth.json  +  simulation-report.{json,md}
```

| File | Vai trò |
| --- | --- |
| `config.js` | Toàn bộ tham số (seed, quy mô, hệ số logistic, xác suất cơ sở) |
| `personas.js` | 8 persona, bảng tuổi/nghề/giới tính, mùa vụ & khung giờ theo giai đoạn sống |
| `random.js` | PRNG mulberry32 có seed, UUID tất định |
| `demographics.js`, `behavior-model.js`, `preferences.js`, `temporal-model.js` | Mô hình ẩn và các hàm xác suất có điều kiện |
| `catalog.js`, `catalog-manifest.json`, `build-catalog-manifest.js` | Danh mục sách thật (113 sách/114 variant) + popularity/quality prior |
| `simulate.js`, `stock.js` | Engine sự kiện, hiệu chỉnh số bản sao |
| `generate-*.js` | Chuỗi sự kiện: khách hàng, mượn/gia hạn/trả, đặt trước, wishlist, cảnh báo, review, phạt |
| `validation.js`, `evaluation.js`, `truth.js`, `report.js` | Kiểm tra, đánh giá AI, ground truth, báo cáo |
| `seed-simulation.js` | CLI + ghi DB (idempotent) |

## 3. Personas (giả định)

| Persona | activity | loans/năm (≈) | đúng hạn | digital | explore | Thể loại ưu tiên |
| --- | --- | --- | --- | --- | --- | --- |
| HEAVY_READER | 0.82–0.97 | 40–70 | 0.60–0.97 | 0.50–0.95 | 0.20–0.40 | VH nước ngoài, VH Việt Nam, truyện ngắn |
| LITERATURE_LOVER | 0.55–0.80 | 18–40 | 0.45–0.95 | 0.30–0.80 | 0.08–0.20 | VH Việt Nam, VH nước ngoài, truyện ngắn |
| TECH_FOCUSED_READER | 0.55–0.80 | 18–40 | 0.40–0.90 | 0.85–1.00 | 0.10–0.25 | Kỹ thuật–CNTT, kỹ năng sống, kinh tế |
| SELF_DEVELOPMENT_READER | 0.50–0.74 | 15–33 | 0.50–0.95 | 0.50–0.90 | 0.10–0.25 | Kỹ năng sống, kinh tế |
| EXPLORER | 0.50–0.74 | 15–33 | 0.35–0.90 | 0.45–0.90 | 0.40–0.65 | đều nhau |
| PARENT_READER | 0.42–0.64 | 10–24 | 0.40–0.90 | 0.35–0.80 | 0.15–0.30 | Thiếu nhi, nuôi dạy con, ẩm thực |
| CASUAL_READER | 0.30–0.46 | 5–12 | 0.35–0.85 | 0.30–0.80 | 0.20–0.40 | Truyện ngắn, VH Việt Nam |
| LOW_ENGAGEMENT | 0.08–0.25 | 0–3 | 0.10–0.70 | 0.10–0.60 | 0.20–0.45 | Truyện ngắn, VH Việt Nam |

Mỗi persona còn định nghĩa reservation/wishlist/review/renewal tendency, tốc độ đọc (trang/ngày),
payment reliability, weekend affinity, phân phối số sách/lần mượn và xác suất "nguội dần" (churn) —
xem `personas.js`. Tuổi (8/34/27/16/9/6 %) quyết định nghề nghiệp; nghề nghiệp quyết định persona.

**Giới tính** (MALE/FEMALE/OTHER/UNSPECIFIED) chỉ để đa dạng nhân khẩu học và **không** là đầu vào của
bất kỳ hành vi nào. Test `gender is not an input` chứng minh điều đó: đổi toàn bộ phân phối giới tính,
mọi dòng dữ liệu sinh ra vẫn giống hệt từng byte.

## 4. Biến ẩn và hành vi

* **activity_level** → số phiên mượn/năm = 62 · activity^2.1 (lồi ⇒ long tail), nhân với mùa vụ theo
  giai đoạn sống, hệ số thứ trong tuần, nhiễu Gamma theo tháng, tăng 30% trong 60 ngày đầu, giảm 92% sau churn.
* **Chọn sách** `P(book|user) = Σ_c P(c|user)·P(book|c,user)`:
  * `P(c|user)` = (1−exploration)·pref(c)·habit(c) + exploration·đều;
  * `P(book|c,user) ∝ popularity(Zipf 1.25) × author affinity × (0.03 nếu đã đọc) × (4 nếu trong wishlist) × (1 − 0.5·digital nếu hết hàng)`;
  * mọi thừa số > 0, trừ sách đang giữ.
* **Tồn kho**: chạy pilot không giới hạn, đặt số bản = mức sử dụng trung bình × 1.5 ⇒ sách hot thỉnh thoảng
  hết (sinh wishlist/alert/đặt trước), long tail luôn còn.
* **Chuỗi nhân quả**: discover → wishlist → (mượn khi wishlist được boost); hết hàng → wishlist/alert →
  sáng hôm sau có bản trả về → alert NOTIFIED → theo dõi (đặt trước/mượn); đặt trước → mã nhận → nhận sách
  (tạo loan có `source_reservation_id` đúng thời điểm nhận) | no-show | hủy; mượn → gia hạn → trả → phạt → thanh toán → review.
* **Kênh WEB/STAFF**: P(WEB) = 0.06 + 0.9·digital_affinity (+0.15 nếu đến từ alert).
* **Gia hạn**: logistic theo renewal_tendency, áp lực đọc (tổng số trang ÷ tốc độ đọc so với hạn mượn), độ trễ.
  Sách thiếu `page_count` (100/113) được điền tất định theo thể loại (đánh dấu `page_count_imputed`).
* **Review**: chỉ sau khi đã trả; P ∝ review_tendency·(0.4+0.6·taste); điểm = ngưỡng hóa của
  1.3·taste + 0.6·quality + độ dễ tính cá nhân + nhiễu. Bình luận: template tất định (không gọi LLM).
* **Phạt**: phát sinh tại lần trả trễ = số ngày × fine_per_day; P(trả nhanh) = reliability², ngoài ra trả chậm
  hoặc trả tại quầy ở lần ghé sau (0.1 + 0.4·reliability²), còn lại để UNPAID.
* **Hạng thẻ**: chọn lúc đăng ký theo **activity ẩn** (không theo số lượt mượn thực tế ⇒ không vòng lặp).
* **Tenure**: 35% khách có từ trước cửa sổ (tối đa 2 năm), còn lại tham gia trong cửa sổ, nhiều hơn vào tháng 9/3.

## 5. Ground truth rủi ro (quá trình logistic công bố)

```
P(late)    = σ(b0 + b1(1−punctuality) + b2(max_loan_days−20)/8 + b3(items−1.5)/0.7 + b4·unpaid_fine_at_checkout + b5·tier)
             b = (−2.65, 3.2, 0.35, 0.25, 0.7, −0.4)
P(no-show) = σ(c0 + c1(1−punctuality) + c2·lead_z + c3(hold−30)/10 + c4·web + c5·prior_no_show_rate + c6(active_loans−1)/1.5)
             c = (−2.55, 2.6, 0.4, −0.3, 0.5, 2.0, 0.25)
```

Hệ số dốc giữ nguyên như generator cũ; chỉ intercept được hiệu chỉnh lại cho quần thể mới (giữ nguyên
b0 = −3.25 thì tỉ lệ trễ chỉ ~13%). Mọi đại lượng đầu vào là **point-in-time**: phạt chưa trả *tại thời điểm*
mượn, no-show trước đó chỉ tính các lần đã có kết quả, số khoản vay đang mở tại thời điểm đặt.
`simulation-truth.json` ghi hệ số, tỉ lệ cơ sở và **Bayes AUC** (trần lý thuyết).

## 6. Ngăn rò rỉ dữ liệu (data leakage)

1. **Mô hình production không đọc truth.** Persona, traits, sở thích thật chỉ nằm trong
   `simulation-truth.json`; test `no production service source reads the simulation truth` quét mã nguồn
   các service và thất bại nếu có file nào tham chiếu đến nó.
2. **Mô hình chỉ thấy dữ liệu hệ thống thật có**: loans, reservations, wishlist, reviews, fines, membership.
   Ví dụ: mô phỏng biết `pref(kinh-te)=0.91`; recommender chỉ thấy "6/10 lượt mượn thuộc kinh tế, 2 wishlist, lịch sử rating".
3. **Point-in-time features.** Khi kiểm tra, phát hiện SQL huấn luyện trong
   `analytics.controller.js` rò rỉ tương lai (đếm khoản vay trước đó dù kết quả trả xảy ra *sau* thời điểm mượn;
   dùng trạng thái phạt/khoản vay *hiện tại*). Đã sửa thành point-in-time; `evaluation.js` báo cáo cả hai
   ngữ nghĩa (`point_in_time`, `legacy_sql`) để định lượng ảnh hưởng.
4. **Tách theo thời gian**: rủi ro dùng `temporalSplit` của risk-model.js; gợi ý dùng hold-out theo mốc thời gian
   (80% đầu → profile, 20% sau → đánh giá), không chia ngẫu nhiên. Recommendation V2 dùng train `< p60` /
   validation `[p60, p80)` (chọn trọng số) / test `[p80, end]` (báo cáo một lần).
5. Truth chỉ được dùng cho: trần Bayes, ranker tham chiếu `ORACLE_TRUE_PREFERENCE` (ghi rõ không triển khai được),
   và *preference recovery* (so sánh sở thích suy ra từ lịch sử quan sát với sở thích thật).
6. **Wishlist point-in-time.** Bảng `book_wishlists` là ảnh chụp cuối kỳ (DB xoá cứng wishlist khi đã mượn), nên
   một wishlist tạo trước mốc cắt và bị xoá sau mốc cắt biến mất khỏi dữ liệu train (survivorship). Simulator giữ
   `removed_at` trong bộ nhớ (không đổi dòng DB, không tiêu thụ RNG) và xuất vào
   `output/recommendation-events.json`, để V2 dựng lại wishlist đúng như tại mốc cắt. Giao thức "audited" cũng coi
   sách đang được đặt trước tại mốc cắt là đã thấy (không gợi ý, không phải target).

## 7. Đánh giá

`seed-simulation.js` (khi không có `--no-evaluate`) chạy:

* **Late return / no-show**: dựng đúng các cột SQL của analytics, đưa qua `risk-features.js` +
  `risk-model.js` (mã production) → AUC, Brier, ECE so với trần Bayes.
* **Forecast**: chuỗi ngày 180 ngày/variant như `/analytics/forecast-accuracy`, `rollingBacktest()`.
* **Recommendation**: `services/ai-service/eval/eval_recommendation_synthetic.py` chạy `recommendation.py`
  (collect_signals → build_taste_profile → rank_candidates, không embedding) trên lịch sử trước mốc cắt;
  so với POPULARITY, RANDOM, ORACLE; HitRate/Recall/NDCG@5,10, MRR, Coverage, Personalization; preference recovery.
  (POPULARITY trước đây đếm hai lần các lượt mượn của user eligible — đã sửa.)
* **Recommendation V2**: `python services/ai-service/eval/eval_recommendation_v2.py` đọc
  `output/recommendation-events.json` (chỉ dữ liệu quan sát được) và riêng `output/recommendation-oracle.json`
  (chỉ baseline ORACLE); chọn trọng số trên validation, báo cáo test với RANDOM/POPULARITY/V1/V2/ORACLE, ablation,
  cold-start, bootstrap CI → `services/ai-service/eval/reports/recommendation_v2_report.{json,md}`; kèm bảng
  "legacy protocol" khớp đúng `simulation-report.json`.
* **Turnover/Storage suggestion**: phân tầng variant HIGH/MEDIUM/LOW theo số lượt mượn 90 ngày.

## 8. Kiểm tra thống kê

`validation.js` ghi vào `simulation-report.{json,md}`:

* **Sanity (phải = 0)**: review sách chưa mượn-trả; loan/reservation/wishlist trước `created_at`; membership trước
  ngày tạo; trả trước mượn; nhận trước đặt; rating ngoài 1..5; hạn không hợp lệ; gia hạn sai thứ tự; phạt không có
  lần trả trễ / trả trễ không có phạt; FK sai (kể cả variant/book so với catalog); trùng review/wishlist/alert;
  trùng natural key; sự kiện sau ngày kết thúc; loan từ reservation không khớp.
* **Quan hệ thiết kế**: persona → hoạt động; punctuality → tỉ lệ trễ; digital → % WEB; exploration → đa dạng thể loại;
  sở thích → thể loại mượn; taste → rating; số trang → gia hạn; reliability → tỉ lệ trả phạt; activity → hạng thẻ;
  giới tính → (không có tác động); giờ/mùa theo giai đoạn sống; long tail sách & người dùng.

## 9. Tái lập (reproducibility)

Mọi phép ngẫu nhiên đi qua `random.js` (mulberry32) — không có `Math.random` (test kiểm tra). Cửa sổ neo vào
`SIMULATION_END` cố định. UUID cũng sinh từ một luồng seed riêng, nên **cùng seed ⇒ cùng từng dòng, kể cả khóa
chính** (test `same seed reproduces the whole dataset, ids included`). Chạy trong Docker và trên máy local cho
cùng Bayes AUC.

## 10. Cách chạy

```bash
# từ services/borrow-service
npm run simulation:dry-run                        # không cần DB: sinh + kiểm tra + đánh giá + báo cáo
node prisma/seed-history.js                       # ghi vào borrow_db (entry point cũ vẫn dùng được)
SIMULATION_SEED=123 CUSTOMER_COUNT=1000 node prisma/simulation/seed-simulation.js
npm run simulation:catalog                        # dựng lại catalog-manifest.json sau khi đổi data/*.sql
node --test test/simulation.test.js test/simulation-catalog-leakage.test.js

# toàn stack Docker
pnpm demo:seed:history                            # image cần build lại sau khi sửa mã simulation
```

Biến môi trường: `SIMULATION_SEED` (bí danh `HISTORY_SEED`, mặc định 20260928), `CUSTOMER_COUNT` (600),
`SIMULATION_MONTHS` (24), `SIMULATION_END` (2026-09-28), `INVENTORY_DATABASE_URL` (tùy chọn — ánh xạ lại id
sách/variant/kho theo sku/book_code với inventory_db đang chạy).

**Idempotent**: mọi dòng mang tiền tố `SIM-` (customer_code, card_number, loan_number, reservation_number,
pickup_code, barcode) hoặc thuộc khách `SIM-`. Mỗi lần chạy xóa các dòng `SIM-` và dòng `HIST-` cũ (của generator
trước) rồi sinh lại; dữ liệu demo viết tay (`CUST-`, `LOAN-`, `RSV-`, `CARD-`) không bị đụng tới.

**Provenance**: mọi file sinh ra đều có `synthetic: true`, `generator_version`, `seed`, `simulation_start`,
`simulation_end` và lời cảnh báo tiếng Việt/tiếng Anh.

## 11. Giới hạn

* Tham số persona, phân phối tuổi/nghề và mọi xác suất là giả định hợp lý, **không được hiệu chỉnh từ dữ liệu thật**.
* Danh mục thật chỉ có sách ở 5/11 thể loại (không có CNTT, thiếu nhi, nuôi dạy con, ẩm thực, lịch sử). Sở thích với
  thể loại vắng mặt không có tác dụng ⇒ TECH_FOCUSED_READER và PARENT_READER thực tế đọc thể loại phụ. Khi thêm sách
  những thể loại đó vào inventory và dựng lại manifest, các persona này tự động dùng chúng.
* 100/113 sách thiếu số trang ⇒ số trang được điền theo thể loại.
* Tồn kho là mô phỏng (hiệu chỉnh từ nhu cầu), không khớp `stock_balances` của inventory_db; chưa mô phỏng mất sách,
  hỏng sách tính phí, miễn phạt, nâng/hạ hạng thẻ, gia hạn thẻ.
* Cảnh báo tồn kho được giả định gửi theo lô mỗi sáng; mọi khách mượn/trả trong giờ mở cửa 8–20h.
* Nhãn trễ/no-show sinh từ mô hình logistic ⇒ mô hình logistic của hệ thống có lợi thế cấu trúc; AUC đo được là
  cận trên lạc quan so với dữ liệu thật và chỉ nên so sánh tương đối với trần Bayes.
* Hành vi người dùng là độc lập có điều kiện (không có ảnh hưởng xã hội, xu hướng lan truyền, sách mới phát hành).
