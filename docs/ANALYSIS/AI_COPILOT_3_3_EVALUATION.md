# SmartBook AI Copilot 3.3 — Hybrid Semantic Verification: thiết kế và đánh giá độc lập (2026-10-17)

Ký hiệu: **[ĐO]** đã chạy và đo · **[CHƯA ĐO]** đã làm nhưng chưa có số · **[SAU TEST]** sửa sau khi đã chấm tập test,
không nằm trong số liệu test.
Mọi số trong tài liệu này lấy từ các file trong `services/ai-service/eval/` (liệt kê ở mục 10) và có thể chạy lại bằng các
lệnh ở mục 9. Không có số nào được ước lượng hay viết tay.

Tài liệu trước: [AI_COPILOT_3_2_DECISION_VERIFICATION.md](AI_COPILOT_3_2_DECISION_VERIFICATION.md).

---

## 0. Tóm tắt (đọc mục 8 trước khi trích dẫn)

| Câu hỏi | Kết quả trên tập **test đóng băng** (40 câu hỏi, 44 lượt) |
|---|---|
| Layer 1 (tất định) 3.3 có tốt hơn 3.2 không? | Có, nhỏ: recall 4/19 → 5/19, critical 0/12 → 1/12, FPR giữ 3/25. **Chấp nhận** (tiêu chí đăng ký trước). |
| Hybrid (Layer 2 LLM trích claim + Layer 3 backend phán quyết) có tốt hơn không? | Có về phát hiện: recall 8/19 (cả 2 lần trích), critical 3/12, FPR 3/25. **Nhưng** độ trễ trích claim p95 7,0–8,3 s > ngưỡng 6 s → **ship TẮT** (`COPILOT_SEMANTIC_CLAIMS=off`). |
| Câu trả lời cuối người dùng nhận có ít lỗi hơn không? | 3.2: 16/44 có lỗi (10 critical, 2 chặn oan). 3.3 run B: 13/44 (9 critical, 0 chặn oan). Run A (có lỗi tích hợp, đã sửa): 17/44 (12). **Chênh lệch nằm trong biên dao động giữa hai lần chạy LLM** — không khẳng định cải thiện có ý nghĩa thống kê. |
| Phát hiện quan trọng nhất | Bước **sửa tự động (repair) của 3.2 đã tự tạo lỗi**: 3/4 lần repair trên tập test viết sai một bản nháp **đúng** (vd. "117 đầu sách" → "40"). Đã sửa [SAU TEST]: không bao giờ viết đè một con số trùng với một đại lượng khác của dữ liệu. |

---

## 1. Audit pipeline 3.2 (trước khi viết mã 3.3)

Pipeline 3.2 (một lượt): planner tất định → tool (token người dùng) → evidence sheet → LLM → numeric grounding + overclaim
(XAI 2.0) + faithfulness 3.1 + trích claim tất định 3.2 → repair tất định → retry ≤ 1 → fallback BLOCKED. Cả `/assistant` và
`/assistant/stream` đi qua cùng `_finalize_assistant_turn` (đã kiểm tra lại; giữ nguyên ở 3.3).

Điểm yếu tìm thấy khi đọc mã và chạy trên tập dev:

1. **Chỉ nhận ra cách diễn đạt đã biết.** Claim 3.2 do regex trích; một câu nói cùng nội dung bằng cấu trúc khác ("7 đầu sách
   khác đã xuống dưới ngưỡng", "tổng cộng 10 tựa") không thành claim → không được kiểm tra.
2. **Lỗi nặng và nhẹ bị xử lý như nhau.** Một suy luận heuristic sai (vd. lexicon "tối ưu") cũng dẫn tới retry rồi BLOCKED
   toàn bộ câu trả lời, kể cả khi phần còn lại đúng.
3. **Retry có thể làm tệ hơn.** Câu trả lời retry được nhận nếu không còn critical, dù nó có nhiều lỗi khác hơn bản đầu.
4. **Không có dữ liệu nhưng vẫn đưa số.** Khi planner không gọi tool nào, LLM có thể bịa số ("Hôm nay có 12 đầu sách dưới
   ngưỡng"); grounding 2.0 coi "không có dữ liệu" là "không có gì để đối chiếu".
5. **Khoảng ngày** ("16/10/2025 – 16/10/2026") không được so với kỳ thật của tool.
6. **Tập đánh giá 3.2 không độc lập**: rule được viết từ chính các câu dùng để đo.

## 2. Thiết kế 3.3

### 2.1 Layer 1 — tất định (luôn bật)

- `Claim.basis` ∈ `exact` (đối chiếu trực tiếp một con số/khoảng ngày với dữ liệu) / `heuristic` (lexicon, suy luận) /
  `semantic` (từ Layer 3). `EXACT_CATEGORIES` quyết định basis mặc định.
- **NO_DATA** (`figures_without_data`): lượt không truy xuất được dữ liệu nào (không có fact, mọi evidence đều lỗi) mà câu
  trả lời có số liệu → UNSUPPORTED, critical, exact. Ngữ cảnh = câu hỏi + các câu trả lời **trước** lượt hiện tại (để số người
  dùng tự nêu không bị coi là bịa).
- **Khoảng ngày** (`_check_date_ranges` trong `_check_periods`): khoảng ngày viết ra phải trùng một kỳ trong dữ liệu.
- Sửa các báo động giả tìm được trên dev/val (lexicon "tối ưu hơn" khi là điều kiện, "cả hai kho đều…", xếp hạng trong ngoặc).
- Planner (`copilot_plan.py`): các câu dev/val mà 3.2 không gọi tool hoặc gọi sai tool (lượt trả, nhu cầu theo đầu sách, giá
  mỗi bản ≠ ngân sách, "giảm … xuống X %", xu hướng đặt chỗ…).

### 2.2 Layer 2 + 3 — hybrid (`copilot_claims.py`, cờ `COPILOT_SEMANTIC_CLAIMS`, mặc định **off**)

- **Layer 2** — một lời gọi `chat_json` (temperature 0, JSON object, prompt `3.3.2`): LLM **chỉ trích** claim
  `{quote, metric, entity, scope, period, operator, value}` từ câu trả lời, dùng danh mục ~53 metric và tên thực thể (không đưa
  giá trị số vào prompt). LLM **không** phán đúng/sai. JSON hỏng/cắt cụt được cứu (`_salvage`) hoặc bỏ qua.
- **Layer 3** — backend phán quyết: quote phải nằm trong câu trả lời, giá trị phải được viết trong quote, rồi so với giá trị
  thật lấy từ evidence sheet/collected data → SUPPORTED / CONTRADICTED / UNSUPPORTED / UNVERIFIABLE, kèm phân loại nhầm
  ENTITY / SCOPE / MISSING_DATA. Kiểm tra xu hướng, thứ hạng, "đã hết hàng", được/không được duyệt, "không có dữ liệu"…
- Claim Layer 3 có `basis="semantic"`.

### 2.3 Chính sách sau kiểm tra (cùng cho `/assistant` và `/assistant/stream`)

```
critical có basis exact          → repair an toàn → retry ≤1 → còn lỗi: BLOCKED (fallback từ dữ liệu, không AI Action)
critical chỉ heuristic/semantic   → withdraw: bỏ đúng các câu sai, giữ phần đã đối chiếu → WARNING, safe_to_act = false
                                    (nếu phải bỏ > 1/2 câu hoặc còn < 2 câu → xử lý như exact)
retry tệ hơn bản đầu (score)      → giữ bản đầu (retry_discarded = true)
AI Action (đề xuất phiếu nhập)    → chỉ khi verification.safe_to_act
```

UI (`apps/web/src/lib/copilot-verification.ts`) hiển thị WARNING có `withdrawn` là "Một số nhận định không khớp với dữ liệu đã
được lược bỏ khỏi câu trả lời".

## 3. Giao thức đánh giá

| Mục | Chi tiết |
|---|---|
| Câu hỏi | `eval/copilot33_questions.json`: **110 câu**, 10 nhóm × 11 (tự nhiên, viết tắt/không dấu, nhiều điều kiện, so sánh kho, ngân sách, xu hướng/nguyên nhân, what-if, thiếu dữ liệu, bẫy đơn vị/thực thể/kỳ, hội thoại nhiều lượt) — 121 lượt. Viết **trước** mọi thay đổi mã 3.3, không trùng các tập 3.0–3.2. |
| Chia tập | Theo vị trí trong mỗi nhóm: dev 40 / val 30 / test 40 câu (test = 44 lượt). Rule chỉ được viết từ dev, tinh chỉnh trên val. |
| Đóng băng | Tập test: sha256 `83ed77d61e17d04a89595e4a2a9644f5cba3742a1da1b7e78cd1c79ae24b8773` (2026-10-17 08:18). Mã: `eval/copilot33_code_freeze.json` (09:29, trước khi gán nhãn test). |
| Tiêu chí | `eval/copilot33_acceptance.json`, viết **trước** khi chạy detector 3.3 trên test. |
| Dữ liệu | Hệ thống dev local (dữ liệu seed + giao dịch mô phỏng), không phải dữ liệu thư viện thật. |
| Mô hình | OpenRouter `qwen/qwen3.7-flash`, cùng cấu hình cho 3.2 và 3.3. |
| Detector 3.2 | Chạy từ git worktree của commit `badad94` (bản 3.2 đã push), trên **cùng** bản nháp. |
| Nhãn | 1 người gán nhãn (cũng là người viết rule) — xem giới hạn mục 8. Nhãn viết từ câu trả lời + dữ liệu tool, không nhìn kết quả detector. |

Nhãn bản nháp: dev 44 lượt (15 có lỗi), val 33 (14 có lỗi), test 44 (19 có lỗi, 12 critical). Phân bố lỗi test: ASSUMPTION 6,
PERCENT 4, COUNT 3, ENTITY 3, PERIOD 3, MISSING_DATA 2, CAUSALITY 2, RANKING 1, BUDGET 1.

Sửa nhãn (ghi trong file nhãn): val `abbr-05` (bỏ sót một lỗi trùng lặp), dev `tr-01` (tháng 4 chỉ một phần). Cả hai sửa
trước khi mở tập test.

**Sai lệch giao thức phải công khai:** đã chạy thử planner một lần trên câu test `c33-wi-08` trước khi chấm (không viết rule
nào từ đó).

## 4. Kết quả detector trên bản nháp [ĐO]

### 4.1 Test (chấm một lần)

| Detector | Precision | Recall (lượt có lỗi bị bắt) | FPR (lượt sạch bị bắt) | Critical bắt được | Latency kiểm tra p50 / p95 |
|---|---|---|---|---|---|
| v3.2 (badad94) | 0,571 | 4/19 | 3/25 | 0/12 | 2,7 / 7,1 ms |
| **3.3 Layer 1** | 0,625 | 5/19 | 3/25 | 1/12 | 2,3 / 6,7 ms |
| 3.3 hybrid, lần trích 1 | 0,727 | 8/19 | 3/25 | 3/12 | + trích claim |
| 3.3 hybrid, lần trích 2 | 0,727 | 8/19 | 3/25 | 3/12 | + trích claim |

Cả 3 báo động giả (multi-09, bd-09, wi-08) đến từ rule Layer 1 có sẵn từ 3.2, không phải từ Layer 3. Hai lần trích độc lập
cho cùng tổng số nhưng khác một lượt (tr-10 ↔ mt-10#1) — biến động của LLM trích claim là có thật.

### 4.2 Dev / val (đã dùng để viết và chỉnh rule — **không** độc lập)

| Detector | Dev recall | Dev FPR | Dev critical | Val recall | Val FPR | Val critical |
|---|---|---|---|---|---|---|
| v3.2 | 4/15 | 3/29 | 3/10 | 5/14 | 0/19 | 4/11 |
| 3.3 Layer 1 | 6/15 | 0/29 | 6/10 | 5/14 | 0/19 | 4/11 |
| 3.3 hybrid (2 lần) | 8/15, 8/15 | 0/29 | 7/10 | 10/14, 11/14 | 0/19 | 8/11 |

(Chấm với nhãn đã sửa ở mục 3; Layer 1 là mã hiện tại.)

Khoảng cách val (10–11/14) → test (8/19) cho thấy rule Layer 3 khớp quá mức với cách diễn đạt của dev/val — đúng lý do phải có
tập test đóng băng.

### 4.3 Chi phí Layer 2 (đo trên lời gọi thật)

| | Test lần 1 | Test lần 2 | Dev+val lần 1 | Dev+val lần 2 |
|---|---|---|---|---|
| Lời gọi / lỗi | 44 / 0 | 44 / 0 | 77 | 77 |
| Latency p50 | 4,35 s | 4,60 s | 4,51 s | 4,63 s |
| Latency p95 | 7,02 s | 8,26 s | 9,35 s | 11,06 s |
| Token prompt / completion (trung bình) | 2510 / 361 | 2510 / 365 | | |
| Chi phí / lời gọi | ~0,000073 USD | ~0,000072 USD | | |

### 4.4 Quyết định theo tiêu chí đăng ký trước

| Tiêu chí | Ngưỡng | Đo | Kết quả |
|---|---|---|---|
| L1: recall ≥ v3.2, FPR ≤ v3.2 + 1 | 4/19, ≤ 4/25 | 5/19, 3/25 | **Đạt** → L1 ship |
| Hybrid (a) bắt ≥ L1 + 3 | ≥ 8 | 8 | Đạt |
| (b) FPR ≤ L1 + 1 | ≤ 4 | 3 | Đạt |
| (c) critical ≥ L1 | ≥ 1 | 3 | Đạt |
| (d) thêm ≤ 6 s ở p95 | ≤ 6 s | 7,0–8,3 s | **Không đạt** → hybrid ship **tắt** |

Mã hybrid được giữ (có test, bật bằng cờ) vì nó bắt thêm được lỗi; nó có thể bật lại khi có model trích nhanh hơn hoặc chạy
song song với stream — **chưa đo** phương án đó.

## 5. Câu trả lời cuối người dùng nhận (live, test, gán nhãn thủ công từng câu) [ĐO]

Ba lần chạy live, cùng 40 câu hỏi test, qua gateway với tài khoản demo:

| | 3.2 baseline | 3.3 run A | 3.3 run B |
|---|---|---|---|
| Ghi chú | ảnh 3.2 | lỗi tích hợp NO_DATA (đã sửa sau run này) | sau khi sửa |
| Câu cuối có lỗi | **16/44** | 17/44 | **13/44** |
| Có lỗi critical | 10/44 | 12/44 | 9/44 |
| Độ chính xác câu cuối | 0,636 | 0,614 | 0,705 |
| Trạng thái | PASSED 38, REPAIRED 2, BLOCKED 3, – 1 | PASSED 39, WARNING 3, REPAIRED 1, – 1 | PASSED 34, WARNING 4, REPAIRED 3, BLOCKED 2, – 1 |
| BLOCKED oan (bản nháp không có lỗi critical) | 2 (multi-10, bd-09) | 0 | 0 |
| Tỉ lệ retry | 0,227 | 0,250 | 0,273 |
| Lời gọi LLM / lượt | 1,57 | 1,68 | 1,52 |
| Token / lượt | 9 725 | 10 279 | 9 347 |
| Chi phí cả lượt chạy | 0,0133 USD | 0,0069 USD | 0,0076 USD |
| Latency end-to-end p50 / p95 | 3,51 / 13,91 s | 3,37 / 14,55 s | 3,27 / 9,36 s |

("–" là lượt hỏi lại để làm rõ, không qua kiểm tra.) Hai lượt BLOCKED ở run B (nat-08, nat-11) đều đúng: bản nháp bịa số khi
planner không gọi tool; câu fallback nói rõ chưa truy xuất được dữ liệu.

Tiêu chí live đăng ký trước (không tăng lỗi, không tăng critical, không tăng chặn oan so với 3.2): run B **đạt** cả ba; run A
**không đạt** hai tiêu chí đầu. So từng câu: run B sửa được 6 câu 3.2 sai (bait-09, mt-08#0, mt-10#0, mt-10#1, nat-08, wh-11),
có 3 câu sai mới (bd-10, bd-11, wi-09), 10 câu sai ở cả hai.

**Diễn giải trung thực:** câu trả lời do LLM sinh lại ở mỗi lần chạy, nên khác biệt 16 → 13 gộp cả hiệu ứng của 3.3 lẫn dao
động sinh văn bản (run A và run B cách nhau ±4 câu). Với 44 lượt, không thể kết luận 3.3 giảm lỗi có ý nghĩa thống kê. Điều
chắc chắn hơn: **chặn oan giảm 2 → 0** (cơ chế withdraw/basis) và các trường hợp không có dữ liệu được chặn đúng.

### 5.1 Repair tự động đã tạo lỗi

Trong ba lần chạy có 4 lượt test được repair; 3 lần repair **biến bản nháp đúng thành sai**:

| Lượt | Bản nháp (đúng) | Sau repair | Nguyên nhân |
|---|---|---|---|
| run A bd-10 | "85.791.250 ₫ cho **117** đầu sách" | "… cho **40** đầu sách" | câu nói về nhu cầu đầy đủ nhưng có cụm "Ngân sách 50 triệu" → bị đọc như số được duyệt |
| run B bd-10 | "… **117** đầu sách (**763** bản)" | "… **40** đầu sách (**461** bản)" | như trên |
| run B bd-11 | "bỏ lại **89** đầu sách" | "bỏ lại **5** đầu sách" | "bỏ lại N" bị đọc là số được duyệt |
| baseline wi-08 | 3.000.000 → 2.975.000 | — | hai cách hiểu đều chấp nhận được |

Sửa [SAU TEST] trong `copilot_verification.py`:
1. Mệnh đề có từ "tổng nhu cầu / nhu cầu đầy đủ…" mà không có "duyệt" được kiểm tra với **nhu cầu đầy đủ**, kể cả khi câu
   có nhắc ngân sách.
2. "bỏ lại / chưa được duyệt / bị loại N đầu sách" có vai trò riêng (`left_out`), chấp nhận số đầu sách ưu tiên cao chưa duyệt
   hoặc tổng chưa duyệt; **không bao giờ** repair.
3. **Nguyên tắc chung mới:** một con số trùng với một đại lượng khác của dữ liệu (vai trò khác của cùng phương án, hoặc nhu cầu
   đầy đủ) không bao giờ bị viết đè — vẫn CONTRADICTED, đi qua retry/fallback. Viết đè lặng lẽ là hành động rủi ro nhất vì câu
   sai mang nhãn REPAIRED ("đã xác minh").
4. "~85,7 triệu" được hiểu là số xấp xỉ.

Kiểm tra lại: phát hiện Layer 1 trên dev/val/test **không đổi** (dev 6/15 · 0/29, val 5/14 · 0/19, test 5/19 · 3/25,
`reports/c33/score_v33L1_postfix_*.json`); với mã mới, bản nháp bd-10/bd-11 của cả hai run không còn bị gắn lỗi. Đây là
phát lại phần tất định, **không phải** một lần chạy live mới.

## 6. Các sửa [SAU TEST] khác (không nằm trong số liệu test)

Ghi hash trong `copilot33_code_freeze.json → post_test_fixes`:

| Khi | Sửa | Lộ ra từ |
|---|---|---|
| sau run A | ngữ cảnh NO_DATA lấy cả bản nháp của chính lượt đó; evidence chỉ có lỗi làm tắt rule NO_DATA | run A |
| sau run B | `withdraw()` cắt ở ";" có thể để lại mảnh câu → chỉ cắt ở ranh giới câu | run B multi-10 |
| sau run B | planner: "dưới mức tồn tối thiểu" → `get_warehouse_stock_risk`; "các chỉ số chính" → `get_dashboard_kpis` | test nat-08, nat-11 |
| sau run B | repair an toàn (mục 5.1) | test bd-10, bd-11 |

Sửa thêm trong Phase 4 và Phase 6 (2026-10-18/19), cũng [SAU TEST]: kiểm tra số bản / chi phí **theo từng đầu sách** được
duyệt (phân bổ mới duyệt một phần dòng), câu "không có đầu sách nào duyệt một phần", nhu cầu theo tồn dự kiến và chi phí trên
đường mức phục vụ là con số đúng, "N đầu sách … không được nhập / bị bỏ lại", số dòng được liệt kê / ngoài danh sách, câu so
sánh hai phương án, "tiết kiệm khoảng X", "nhu cầu thực tế cao" (không phải nhu cầu đầy đủ), trích chỉ số "100 % thiếu hụt dự
kiến". Sau tất cả các sửa, chạy lại Layer 1 trên **bản nháp 3.2** (cùng file, không gọi LLM): dev **6/15 · FPR 0/29**, val **4/14 ·
0/19**, test **4/19 · 3/25** (critical 1/12). So với mã đóng băng: val 5→4 và test 5→4, mỗi tập mất đúng một lượt bắt "đúng
mục, sai lý do" (val bd-07: cờ nằm trên số bản *đúng* của từng đầu sách; test mt-08#1: OVERCLAIM trên câu trích đúng chỉ số
"100 % thiếu hụt"). Con số chính thức của 3.3 vẫn là của mã đóng băng (mục 4.1). Chi tiết vòng sửa: AI_DECISION_EXPERIENCE.md
mục 6.2.

Lỗ hổng đã thấy trên test nhưng **chưa** sửa ở Phase 3 (chuyển sang Phase 6 – follow-up theo ngữ cảnh): "Nếu giảm 20 %" ở lượt
sau áp −20 % lên toàn bộ nhu cầu thay vì ngân sách 15 triệu của lượt trước (mt-08#1, sai ở cả ba lần chạy); Layer 1 bỏ sót
"thêm 7 đầu sách khác … dưới ngưỡng" (trùng lặp hết hàng ⊂ dưới ngưỡng); "Dế mèn không nằm trong danh sách" khi danh sách
trong prompt bị rút gọn (mt-11#1).

## 7. Kiểm thử tự động [ĐO]

- `services/ai-service`: `python -m pytest -q` → **1059 passed, 8 skipped** (2026-10-18). Gồm `test_copilot_claims.py`
  (~58 test: Layer 3, NO_DATA, báo động giả, trích claim với provider giả, withdraw, retry bị loại, stream/non-stream cùng
  chính sách, hybrid lỗi → fallback, tắt mặc định), `Copilot33PlannerGapTests`, và test repair mới
  (`test_another_quantity_of_the_data_is_not_rewritten`, `test_full_need_and_left_out_counts_in_a_budget_answer`).
- `apps/web`: `tests/copilot-verification.test.mjs` 6 pass, `tsc` OK.
- Thay đổi hành vi so với 3.2: "duyệt 5 đầu sách" khi 5 là số đầu sách **ưu tiên cao** được duyệt không còn được repair
  thành 9 mà đi qua retry (test 3.2 đã đổi sang số 7 không trùng đại lượng nào).

## 8. Giới hạn

1. **Một người gán nhãn**, đồng thời là người viết rule → có thể thiên lệch về loại lỗi rule nhận ra; chưa đo độ đồng thuận
   (cần người gán nhãn thứ hai cho tập test).
2. **Cỡ mẫu nhỏ**: 44 lượt test, 19 có lỗi; một lượt = 5 điểm phần trăm recall. Không có khoảng tin cậy có ý nghĩa.
3. **Dao động LLM**: câu trả lời cuối và claim Layer 2 đổi giữa các lần chạy; mỗi cấu hình live chỉ chạy 1–2 lần.
4. Recall tuyệt đối vẫn thấp (hybrid 8/19, Layer 1 5/19): phần lớn lỗi còn lại là ASSUMPTION/CAUSALITY (suy luận không có căn
   cứ) mà kiểm tra số không bắt được.
5. Dữ liệu là hệ thống dev với dữ liệu mô phỏng, một mô hình LLM duy nhất.
6. Các sửa [SAU TEST] chưa có tập độc lập mới để đo.

## 9. Chạy lại

```bash
cd services/ai-service
python eval/copilot33_eval.py hash                                   # phải ra 83ed77d6…
python eval/collect_faithfulness_answers.py --cases c33 --splits test --out eval/copilot33_answers_x.json   # cần stack + EVAL_PASSWORD
python eval/copilot33_eval.py detect --answers eval/copilot33_answers_baseline32.json --split test --out d.json [--semantic on --extract --run 2]
python eval/copilot33_eval.py score  --detections d.json --labels eval/copilot33_labels_test.json --split test
python eval/copilot33_eval.py final  --answers eval/copilot33_answers_v33_test_runB.json --labels eval/copilot33_final_labels_v33_runB_test.json --split test
```

## 10. File

- Mã: `copilot_claims.py` (mới), `copilot_verification.py`, `copilot_plan.py`, `copilot_faithfulness.py`, `copilot_explain.py`,
  `llm_provider.py` (`chat_json`), `main.py`; web `copilot-verification.ts`.
- Test: `test_copilot_claims.py` (mới), `test_copilot_plan.py`, `test_copilot_verification.py`.
- Đánh giá: `eval/copilot33_questions.json`, `copilot33_eval.py`, `copilot33_acceptance.json`, `copilot33_code_freeze.json`,
  `copilot33_labels_{dev,val,test}.json`, `copilot33_answers_baseline32.json`, `copilot33_answers_v33_test_run{A,B}.json`,
  `copilot33_final_labels_{baseline32,v33_runA,v33_runB}_test.json`, `reports/c33/*`.
