# Phase F — Benchmark trước / sau

> Mọi số dưới đây là số đo thật trong ngày 2026-11-13, từ các file trong `services/ai-service/eval/reports/`.
> Không có ground truth nào được tạo mới cho phần ảnh; bộ câu hỏi NLU mới do **một người** viết tay (cũng là người sửa code).

## 1. Giao thức

| Mục | Contextual reasoning | Multimodal | Explainability | Role-aware |
|---|---|---|---|---|
| Baseline | code HEAD `63c2fa8` (planner băm trong `nlu_phase_f_freeze.json`) | endpoint `/find-book-by-cover` hiện có (luôn trả top-1) | trước Phase F chatbot **không có** hợp đồng claim-level | – |
| Candidate | code băm trong `eval/nlu_phase_f/candidate_code.sha256` | `vision_context.decide` trên cùng candidate | `/chat` thật với `explainability` | registry + E2E |
| Dataset | `nlu_phase_f_questions.jsonl` (test 91 lượt chấm, dev 9) sha256 test `d0bd78f5…`; giữ nguyên bộ Phase 1 (test 108 lượt) | `research-inputs/cover-search-dataset` (dev/test sẵn có, rights review) | `chat_answer_dataset.json` (33 case, đã xác minh ở Phase E) | 6 tài khoản demo |
| Model / provider | `qwen/qwen3.7-flash` qua OpenRouter, temperature 0 | OCR: cùng model (dự đoán đã ghi của harness nghiên cứu) | cùng model | – |
| Số lần lặp | det 1; hybrid baseline 1; hybrid candidate 2 (đăng ký) + 1 chạy thêm tuần tự | 1 (offline) | 1 | E2E 2 lần |
| Tách split | dev dùng để sửa code; test chỉ chạy baseline + cuối | luật đặt trên dev, báo cáo test | – | – |

Quy tắc: không sửa code sau khi chạy test cuối; không sửa test set. Một sai sót kỷ luật được tự phát hiện và xử lý: khi viết unit test, vài câu
ban đầu trùng câu của test set — đã thay bằng câu dev/câu mới **trước** khi chạy test cuối, và không có thay đổi planner nào dựa trên các câu đó.

## 2. Contextual reasoning

### 2.1 Bộ held-out mới (test, 91 lượt chấm)

| Chỉ số | Det baseline | Det candidate | Hybrid baseline | Hybrid cand. run 1 | Hybrid cand. run 2 | Hybrid cand. run 3 (tuần tự) |
|---|---|---|---|---|---|---|
| Intent (trọn bộ capability) | 0,813 | 0,813 | 0,933 | 0,893 | 0,907 | 0,880 |
| Capability F1 | 0,905 | 0,905 | 0,961 | 0,943 | 0,949 | 0,936 |
| Tool F1 | 0,912 | 0,912 | 0,956 | 0,938 | 0,943 | 0,944 |
| **Context resolution** | 0,708 (17/24) | **0,875 (21/24)** | 0,750 (18/24) | **0,917 (22/24)** | **0,917** | **0,917** |
| Multi-intent coverage TB | 0,85 | 0,85 | 0,85 | 0,85 | 0,85 | 0,85 |
| Hỏi lại đúng khi cần | 2/4 | 3/4 | 3/4 | 4/4 | 4/4 | – |
| Hỏi lại thừa | 1/88 | 1/88 | 1/88 | 1/88 | 1/88 | 1/88 |
| Từ chối ngoài phạm vi | 7/7 | 7/7 | 7/7 | 7/7 | 7/7 | 7/7 |
| Vi phạm bảo mật | 0 | 0 | 0 | 0 | 0 | 0 |
| Gọi semantic planner cho câu ghi/cá nhân | 0 | 0 | 0 | 0 | 0 | 0 |
| Simple intent | 13/14 | 13/14 | 14/14 | 13/14 | 14/14 | 14/14 |
| Planning p95 | 1,1 ms | 1,6 ms | 2,88 s | 2,50 s | 2,59 s | 2,13 s |
| Lời gọi LLM lập kế hoạch / lượt | 0 | 0 | 0,162 | 0,133 | 0,114 | 0,114 |
| Chi phí cả tập (105 lượt) | 0 | 0 | 0,00060 USD | 0,00049 USD | 0,00046 USD | 0,00054 USD |
| Lượt semantic lỗi provider → rơi về luật | – | – | 0 | 3 | 5 | 5 |

### 2.2 Bộ Phase 1 (giữ nguyên; **không còn held-out**: danh sách lỗi đã công bố trong báo cáo Phase 1 trước Phase F)

| Chỉ số | Det Phase 1 | Det candidate | Hybrid Phase 1 (2 lần) | Hybrid cand. run 1 / 2 / 3 |
|---|---|---|---|---|
| Capability F1 | 0,869 | 0,882 | 0,957 / 0,957 | 0,930 / 0,957 / 0,933 |
| Tool F1 | 0,864 | 0,878 | 0,953 / 0,953 | 0,927 / 0,952 / 0,929 |
| Context resolution | 0,762 | 0,857 | 0,810 / 0,810 | 0,905 / 0,905 / 0,905 |
| Multi-intent coverage | 0,812 | 0,812 | 0,938 / 0,938 | 0,938 / 0,938 / **0,812** |
| Hỏi lại đúng / thừa | 5/6 · 1 | 6/6 · 1 | 5/6 · 1 | 6/6 · 1 / 6/6 · 0 / – · 0 |
| Lượt lỗi provider | – | – | 0 | 8 / 6 / 8 |

### 2.3 Đối chiếu tiêu chí đăng ký (A1–A8, hybrid candidate)

| Tiêu chí | Ngưỡng | Bộ mới run 1 / 2 | Phase 1 run 1 / 2 | Run 3 (bổ sung) mới / Phase 1 |
|---|---|---|---|---|
| A1 Capability F1 | ≥ 0,90 | ✅ 0,943 / 0,949 | ✅ 0,930 / 0,957 | ✅ 0,936 / ✅ 0,933 |
| A2 Tool F1 | ≥ 0,90 | ✅ / ✅ | ✅ / ✅ | ✅ / ✅ |
| A3 Context resolution | ≥ 0,85 | ✅ 0,917 / 0,917 | ✅ 0,905 / 0,905 | ✅ / ✅ |
| A4 Multi-intent coverage | ≥ 0,85 | ✅ 0,85 / 0,85 | ✅ 0,938 / 0,938 | ✅ 0,85 / ❌ **0,812** |
| A5 Bảo mật | 0 / 0 | ✅ | ✅ | ✅ |
| A6 Simple intent | không thấp hơn baseline quá 1 | ✅ | ✅ | ✅ |
| A7 Từ chối / hỏi lại thừa | ≥ baseline / ≤ +2 | ✅ | ✅ | ✅ |
| A8 Chi phí / độ trễ | ≤ 0,5 lượt; p95 ≤ 6 s; ≤ 0,001 USD/lượt | ✅ (~0,000005 USD/lượt) | ✅ | ✅ |

### 2.4 Quyết định cờ `COPILOT_SEMANTIC_PLANNER`

**Vòng 1 — giữ OFF.** Hai lần chạy đăng ký đạt đủ A1–A8 trên cả hai bộ, nhưng khoảng 18–35% lượt được định tuyến bị lỗi HTTP
(3–8 trên 17–23 lượt mỗi lần) và lần chạy bổ sung trượt A4 trên bộ Phase 1 (0,812) vì các lượt đó rơi về luật.

**Chẩn đoán (vòng 2).** Chạy lại có bật log: lỗi là **HTTP 429 Too Many Requests**; provider vốn đã retry một lần nhưng retry **ngay lập
tức** nên 10/10 lần retry lại nhận 429; đường stream của assistant không retry chút nào (một câu trả lời assistant thật đã hỏng vì vậy).
Sửa gốc trong `llm_provider.py` (dùng chung cho mọi tính năng): trước lần retry sau 429, chờ theo `Retry-After`, tối đa 2 s; thêm đúng
một lần chờ-và-retry cho stream khi 429 đến trước token đầu tiên. Code planner **không đổi** (hash trong `candidate_code.sha256` vẫn khớp).

**Đo lại với cùng code planner (hybrid, concurrency 3 như lần đăng ký):**

| Chỉ số | Bộ mới run 1 | Bộ mới run 2 | Phase 1 run 1 | Phase 1 run 2 | Ngưỡng |
|---|---|---|---|---|---|
| A1 Capability F1 | 0,961 | 0,956 | 0,968 | 0,968 | ≥ 0,90 ✅ |
| A2 Tool F1 | 0,956 | 0,952 | 0,963 | 0,963 | ≥ 0,90 ✅ |
| A3 Context resolution | 0,917 | 0,875 | 0,905 | 0,905 | ≥ 0,85 ✅ |
| A4 Multi-intent coverage | 0,85 | 0,85 | 0,938 | 0,938 | ≥ 0,85 ✅ |
| A5 Vi phạm / semantic trên câu ghi-cá nhân | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | ✅ |
| A6 Simple intent | 14/14 | 14/14 | 14/14 | 14/14 | ✅ |
| A7 Từ chối / hỏi lại thừa | 7/7 · 1 | 7/7 · 1 | 6/6 · 0 | 6/6 · 0 | ✅ |
| A8 LLM/lượt · p95 lập kế hoạch · chi phí | 0,162 · 3,30 s · 0,00066 USD/105 lượt | 0,162 · 3,37 s · 0,00060 | 0,204 · 3,70 s · 0,00082/108 | 0,185 · 3,55 s · 0,00077 | ≤ 0,5 · ≤ 6 s · ≤ 0,001 USD/lượt ✅ |
| Lượt rơi về luật do lỗi provider | 0/17 | 0/17 | 1/23 | 3/23 | – |

**Quyết định: bật mặc định (ON).** Theo quy tắc đã đăng ký trong `nlu_phase_f_freeze.json` (A1–A8 trên cả hai bộ test, hai lần chạy):
đạt ở hai lần chạy đăng ký (vòng 1) và hai lần chạy sau khi sửa 429 (vòng 2). Lần trượt duy nhất (vòng 1, run 3) có nguyên nhân là
lỗi 429 đã được sửa. Tắt lại: `COPILOT_SEMANTIC_PLANNER=off` (không cần build lại). Lưu ý: khoảng 16–21% lượt assistant được định
tuyến sẽ tốn thêm ~2,5–3,5 s lập kế hoạch; khi provider lỗi, lượt đó tự rơi về planner luật (không hỏng request).

### 2.5 Phân tích lỗi còn lại (held-out, sau khi chạy cuối — không sửa)

- "Những cuốn đó còn đủ tồn kho không?" (sau top 5): planner luật không nhận "tồn kho" đứng một mình là năng lực rủi ro tồn kho → chỉ lấy top sách.
- "Còn kho kia thì sao?": đúng kho nhưng kế thừa thêm ý "bổ sung" (reorder) từ lượt trước → capability thừa.
- "Kho nào rủi ro nhất và nên nhập gì cho kho đó?": hỏi lại thay vì dùng kho rủi ro nhất cho vế sau (cần phụ thuộc giữa các ý).
- "Có độc giả nào giữ sách quá lâu không trả không?" → hiểu thành đặt chỗ (lỗi từ khóa "giữ sách").
- Các lượt paraphrase còn lại phụ thuộc lớp ngữ nghĩa (cờ OFF ở production).

## 3. Multimodal (offline, split test: 1.168 ảnh sách có trong thư viện + 27 ảnh sách ngoài thư viện)

| Chỉ số | Baseline (endpoint hiện có) | Phase F (`decide`) |
|---|---|---|
| Top-1 accuracy (xếp hạng, không đổi) | 0,923 | 0,923 |
| Top-5 accuracy | 0,960 | 0,960 |
| MRR | 0,935 | 0,935 |
| Ảnh sách **ngoài** thư viện bị trình bày là kết quả nhận diện (false positive) | **27/27 = 100%** | **2/27 = 7,4%** |
| Ảnh ngoài thư viện không bị kết luận IDENTIFIED | 0% | 92,6% (25 AMBIGUOUS → người dùng chọn/không chọn) |
| Ảnh ngoài thư viện trả NO_MATCH (abstention chặt) | 0% | 0% |
| Độ đúng khi hệ thống kết luận "đã nhận diện" | 1078/1162 = 0,928 | 1015/1016 = **0,999** |
| Tỷ lệ ảnh trong thư viện được kết luận IDENTIFIED | – | 0,870 (146 AMBIGUOUS, trong đó 106 có sách đúng trong danh sách chọn) |
| OCR: tên sách khớp chính xác (913 ảnh có tên nhìn thấy) | 0,828 | 0,828 |
| OCR: tác giả khớp | 0,691 | 0,691 |
| ISBN từ ảnh | không đo — prompt OCR chỉ đọc tên/tác giả | như trái |
| Độ trễ endpoint (harness, p50/p95, OCR từ cache) | 202 / 320 ms | – |
| Độ trễ thật một lần nhận diện qua gateway (E2E, ảnh tổng hợp) | – | 3,0–3,7 s |
| Chi phí OCR | theo `docs/research/cover-search/RESULTS_ANALYSIS.md` (≈ 1,8·10⁻⁵ USD/ảnh trong dữ liệu ghi) | như trái |

Dev (dùng để đặt luật): OOC 9/9 không bị IDENTIFIED. Giới hạn: đường hội thoại mới re-encode ảnh (≤ 1600 px, bỏ EXIF) trước OCR/CLIP;
bộ đo dùng dự đoán đã ghi trên ảnh gốc — đo lớp quyết định, chưa phải chạy lại đầu-cuối trên toàn bộ dataset.
Không có hiệu chỉnh xác suất → không hiển thị phần trăm (không có reliability diagram/ECE).

## 4. Role-aware

| Chỉ số | Kết quả | Nguồn |
|---|---|---|
| Role capability coverage | 6/6 role có trải nghiệm đúng (`experience`) | E2E `capabilities:*` |
| Permission enforcement | 19 test registry/personal context/allowlist + 16 subtest | `test_phase_f_role_aware.py` |
| Unauthorized read rate | **0** (supplier/khách không chạm endpoint nội bộ; 4 role → 403 assistant; ảnh người khác 410) | E2E 39 check × 2 lần |
| Unauthorized write rate | **0** (không thêm đường ghi; action vẫn qua xác nhận — test cũ pass) | pytest |
| Cross-user leakage | 0 (ngữ cảnh ảnh theo chủ sở hữu; book_id giả → 400) | unit + E2E |
| Cross-warehouse leakage | 0 (planner lọc kho theo quyền hiện tại; bộ NLU: 0 vi phạm `forbid_wh`) | NLU + `test_warehouse_scope` |
| Supplier isolation | đọc đúng một endpoint lọc theo nhà cung cấp | unit + E2E |

## 5. Explainability (`/chat` thật, 33 case)

| Chỉ số | Trước Phase F | Sau |
|---|---|---|
| Hợp đồng claim-level | không có | có trên 33/33 câu trả lời |
| Evidence coverage (case cần trả lời) | 0 | 24/25 |
| Claim có verdict | 0 | 157 |
| Claim support rate | – | 0,516 |
| Unsupported claim rate | – | 0,006 |
| Unverifiable rate | – | 0,478 (chủ yếu câu diễn đạt lại tài liệu; kiểm theo trùng từ) |
| Contradicted (dữ liệu thật) | – | 0 (phát hiện mâu thuẫn được kiểm bằng unit test) |
| Citation precision (tài liệu trong bằng chứng thuộc tài liệu kỳ vọng) | – | 26/60 (retrieval trả nhiều đoạn top-k, không phải đoạn nào cũng là tài liệu kỳ vọng) |
| Citation recall | – | 26/30 |
| Abstention đúng (case phải từ chối) | 4/8 (không đổi so với pipeline: near-miss vẫn được trả lời) | 4/8; 4 near-miss có trạng thái PARTIAL (không PASSED) |
| PASSED trong khi có claim UNSUPPORTED/CONTRADICTED | – | **0** |
| Phân bố trạng thái | – | PASSED 2 · PARTIAL 25 · WARNING 1 · NO_EVIDENCE 5 |

Không có chỉ số calibration vì không phát ra confidence số.

## 6. Hạn chế chung

- Bộ NLU: một người gán nhãn, nhỏ (24 lượt context, 10 multi-intent); bộ Phase 1 không còn held-out.
- Hybrid phụ thuộc OpenRouter; vòng 1 có tỉ lệ lỗi 429 cao, vòng 2 (sau khi chờ theo Retry-After) còn 0–3 lượt/lần chạy.
- Multimodal: đo offline trên dự đoán đã ghi; E2E thật dùng ảnh bìa tổng hợp (không phải ảnh chụp thật).
- Explainability: kiểm theo luật, không kiểm ngữ nghĩa; n = 1 lần chạy.
