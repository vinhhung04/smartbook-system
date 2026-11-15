# RAG Quality Upgrade — hồ sơ kỹ thuật

> Nhánh `hungg`, HEAD khi bắt đầu `84cd414` (2026-11-15). Kiến trúc giữ nguyên: PostgreSQL + pgvector,
> Qwen3 Embedding (`qwen/qwen3-embedding-8b@768`), hybrid semantic + keyword, RRF, `retrieval_confidence`
> và abstention, ingestion incremental, ai-service/gateway hiện có. **Không** có re-ranking/cross-encoder,
> không đổi ngưỡng production đang có (`tau_confident`, `tau_evidence`), không đổi schema, không deploy.
> Báo cáo từng lượt chạy: `services/ai-service/eval/reports/` (giờ UTC trong tên file).

## Cách chạy lại

```bash
cd services/ai-service
python eval/rag_integrity.py                                   # offline, CI-safe: cấu trúc + reachability
python eval/eval_rag.py --label X                              # rag_dataset.json (226 câu)
python eval/eval_rag.py --dataset eval/rag_dataset_supplement.json --label X   # 43 câu bổ sung
python eval/eval_rag.py --abstention off --dump-signals && python eval/calibrate_rag.py --split=hash <dump>
python eval/eval_query_rewrite.py                              # Phase 3, live (OpenRouter)
python eval/eval_chat_answers.py --password <demo>             # Phase 4, live qua gateway
```

Eval truy xuất chạy trong container tạm từ image ai-service, mount working tree (`/work`), dùng cache
embedding truy vấn `eval/.cache/query_embeddings.json` (đã đủ cho 226 + 43 câu). Mỗi lượt `eval_rag.py`
ghi thêm `rag_manifest_<ts>.json`: sha256 dataset và file review, định danh catalog (số sách + sha256 nội
dung được index), phiên bản corpus (số tài liệu + sha256), model và số chiều embedding, git commit (+ cờ
ai-service còn sửa chưa commit), toàn bộ cấu hình (ngưỡng, k, RRF_K, split, thống kê cache), thời điểm.

## Tổng hợp trước / sau

| Chỉ số | Trước (`p0-baseline`, HEAD) | Sau (`final-*`) |
|---|---:|---:|
| INTERNAL_DOC answerable R@1 / R@5 / MRR | 0,924 / 0,962 / 0,943 | 0,924 / 0,962 / 0,943 |
| INTERNAL_DOC no-answer acc / FPR / FNR | 0,70 / 0,30 / 0,00 | **0,775 / 0,225** / 0,00 |
| BOOK trusted answerable R@5 / MRR | 0,936 / 0,964 | 0,936 / 0,964 |
| BOOK trusted no-answer acc / FPR / FNR | 0,898 / 0,102 / 0,00 | 0,898 / 0,102 / 0,00 |
| Supplement (trusted) TITLE R@1 | 0,90 | **1,00** |
| Supplement ISBN gần đúng (không có trong catalog) FPR | 1,00 | **0,00** |
| Hội thoại tiếp nối (18 câu) answerable R@1 / FNR | 0,60 / 0,20 | **1,00 / 0,00** |
| Câu trả lời cuối PASS / FAIL / UNVERIFIABLE (33 câu, 1 lượt mỗi bên) | 30 / 2 / 1 | 28 / 4 / 1 (dao động LLM, xem Phase 4) |
| Citation precision / completeness | 0,633 / 0,80 | 0,667 / 0,80 (không có thay đổi trích dẫn được ship) |
| False refusal (câu trả lời cuối) | 0,000 | 0,000 |

---

## Phase 0 — Toàn vẹn benchmark

**Mục tiêu.** Baseline tái lập được; tách lỗi truy xuất thật khỏi lỗi dữ liệu/nhãn.

**Đã có sẵn.** Recall@1/3/5, MRR, answerable recall, no-answer accuracy, FPR/FNR, coverage, abstention
P/R/F1, selective accuracy, bảng theo loại truy vấn có cột `unreachable` (Phase E), split val/test bằng hash.

**Vấn đề tìm thấy.**
- 30/55 case sách có đáp án trỏ tới 9 sách seed cũ (ISBN `604123456x`) đã bị xóa khỏi catalog. Không có bản
  tương đương theo ISBN; 2 sách có bản tái bản cùng tác phẩm (`Tôi Thấy Hoa Vàng…`, `Dế Mèn…`) — chỉ là
  **gợi ý remap** trong báo cáo integrity, không áp dụng.
- 3 case "không có đáp án" đã cũ: catalog thêm *Harry Potter and the Philosopher's Stone*, *How to Win
  Friends…* (= Đắc Nhân Tâm), *Atomic Habits* ngày 2026-10-19 (`bm-093/094/096`) — đang bị tính là false positive.
- Nhãn tác giả dựng trên dữ liệu seed sai (`bm-036/037/038`: "Chiếc lá cuối cùng"/"Dế Mèn" của Nam Cao,
  "Project Hail Mary" của Tô Hoài — catalog hiện ghi Andy Weir).
- `scoring.normalize_for_match` làm rơi chữ "đ" ("Đi" → "i"): sửa (gập đ→d). Không đổi phân loại truy vấn
  nào trong dataset; scorer câu trả lời (`eval_chat_answers.normalize`) vốn đúng.
- Cache embedding trên máy chỉ có 184/226 câu (42 câu `doc-078..119` từng chỉ có trong cache của container cũ);
  đã điền (OpenRouter, được duyệt, < 0,01 USD).

**Thay đổi.** `eval/rag_integrity.py` (mới): kiểm tra cấu trúc (id/câu hỏi trùng, trường thiếu, expected id
không truy được tới snapshot/corpus), phân loại REACHABLE / PARTIALLY_REACHABLE / UNREACHABLE /
NO_ANSWER / STALE_NO_ANSWER, cờ LABEL_AUTHOR_MISMATCH và UNVERIFIED_LABEL, gợi ý remap, manifest.
`eval/rag_dataset_review.json` (mới): hàng đợi người duyệt cho các nhãn tự động không xét được (không sửa
nhãn). `eval_rag.py`: bảng "trusted" theo corpus và theo loại truy vấn **bên cạnh** số liệu cũ (không thay),
`--dataset`, manifest. `eval/rag_catalog_snapshot_20261115.json` (136 sách đang hoạt động).
`eval/rag_dataset_supplement.json` (mới, 43 câu, phiên bản `s2`): ISBN đúng/gạch nối/không dấu, ISBN sai
1 chữ số, tiêu đề không hậu tố tái bản/không dấu/bắt đầu bằng "Đ", nhiều ấn bản, tác giả (không dấu, không
từ gợi ý), thể loại, và các câu gần đúng không có đáp án. 34 nhãn "mechanical" suy ra từ trường catalog (test
tái suy được); 9 nhãn "needs_human" bị loại khỏi tập trusted.

**Tập trusted** = REACHABLE, PARTIALLY_REACHABLE (chấm trên id còn trong catalog) hoặc NO_ANSWER, không cờ.
rag_dataset: BOOK 73/107 trusted (24 có đáp án), INTERNAL_DOC 119/119.

**Test.** `test_rag_integrity.py` (15 test, chạy trong `pnpm test:ai` của CI): dataset hợp lệ, cả hai corpus
còn ≥ 50 câu có đáp án và ≥ 20 câu không đáp án, file review chỉ trỏ case có thật, supplement reachable và
nhãn mechanical tái suy được, drift đã biết được phát hiện, manifest.

**Hạn chế.** Dataset truy xuất vẫn phụ thuộc catalog Docker; 30 case unreachable chỉ dùng lại được nếu khôi phục
seed cũ hoặc có người duyệt remap. Nhãn "needs_human" và `rag_dataset_review.json` cần người xác nhận.
Chưa có câu mơ hồ (ambiguous) được gán nhãn — cần người viết.

**Rollback.** Chỉ thêm công cụ eval; xóa file mới và revert `eval_rag.py`/`scoring.py`.

---

## Phase 1 — Chất lượng truy xuất

**Chẩn đoán BOOK_METADATA.** Nguyên nhân chính của R@5 thấp là catalog (mục Phase 0). Trên tập trusted:
R@5 0,936, MRR 0,964. Thử lại chế độ keyword `terms` sẵn có (`RAG_KEYWORD_MODE=terms`): **bác bỏ** lần
nữa — BOOK trusted FPR 0,10 → 0,37, DOC FPR 0,30 → 0,55, R@1 giảm (`rag_*_exp-terms-*`). Không đổi
keyword arm. Các lỗi tiêu đề/ISBN/thể loại xử lý ở Phase 2.

**Chẩn đoán INTERNAL_DOC (12 false positive, `rag_signals_*_p1-signals-raw.json` có kèm nội dung chunk).**
Mọi câu có đáp án lẫn không đáp án đều quanh confidence 0,5 (semantic mạnh, keyword AND không khớp), nên
ngưỡng không tách được. Phân loại: *tương đồng chủ đề nhưng không có bằng chứng* (thú cưng, ngày lễ, hỏa
hoạn, bọc bìa, đổi trả, máy tính xách tay, audiobook, mượn liên thư viện) và *trùng từ nhưng sai nghĩa*
(trang phục, lương nhân viên kho, gia hạn thẻ qua SMS). Không thấy lỗi phiên bản/mâu thuẫn (corpus một phiên bản).

**Thay đổi.** Tín hiệu `focus_coverage` trong `retrieval_confidence.py`: tỷ lệ từ nội dung của câu hỏi có trong
chunk top-1. Kết quả UNCERTAIN có `focus_coverage < min_focus_coverage` → NO_EVIDENCE
(`LOW_QUERY_TERM_COVERAGE`). Không đổi thứ tự kết quả (không phải re-ranking), không chạm CONFIDENT_MATCH,
không áp dụng khi embedding lỗi (giữ nhánh keyword-only), BOOK tắt (=0). `calibrate_rag.py` thêm chiều
`MIN_FOCUS_COVERAGE_GRID`, chỉ hợp lệ khi FNR trên nửa calib không tăng.

**Chọn ngưỡng.** `calibrate_rag.py --split=hash` (`calibration_20261114_232736.md`): BOOK `NO_VALID_CANDIDATE`;
INTERNAL_DOC đề xuất tau 0,6/0,35 + focus 0,2 — **không** nhận tau mới (0,40 là trần của nhánh keyword-only, đã
ghi trong code). Giữ tau production; 0,2–0,4 hòa trên val, quy tắc hòa chọn 0,2 (test: FPR 0,304 → 0,217, FNR 0).

**Sửa sau eval câu trả lời cuối.** Với 0,2, lượt chat live `chat_answers_20261115_020850` từ chối nhầm câu tiền đề
sai `ans-contra-01` ("Tôi nghe nói… có đúng không?", focus 0,167 — câu có nhiều từ đệm không có trong tài liệu),
và không thêm câu từ chối đúng nào (hai câu near-miss bị chặn thêm vốn đã được LLM từ chối). Khoảng cách giữa câu
có đáp án (thấp nhất 0,167) và FP (0–0,17) quá hẹp cho một ngưỡng tinh chỉnh → đổi thành quy tắc **không trùng từ
nào** (`min_focus_coverage = 0,01`). Trên nửa test bắt đúng các case như 0,2 (FPR 0,304 → 0,217, FNR 0, R@5 không đổi).
(0,3 tốt hơn trên test nhưng chọn sau khi xem test là rò rỉ — không dùng.)

**Kết quả production path** (`rag_*_final2-main.md`): DOC FPR 0,30 → 0,225, no-answer acc 0,70 → 0,775, FNR 0,
R@5 không đổi; BOOK không đổi. 9 FP còn lại đều UNCERTAIN, đã có nhãn "độ tin cậy chưa cao" + quy tắc prompt ở
tầng trả lời.

**Test.** `test_retrieval_confidence.py` +5 (tính coverage, gate, không chạm CONFIDENT/keyword-only, BOOK tắt, 0,167 vẫn trả lời).

**Rollback.** `DOC_CONF_MIN_FOCUS_COVERAGE=0` (env) hoặc revert `_DOC_DEFAULTS`.

---

## Phase 2 — Truy xuất dựa trên metadata

**Hiện trạng.** Index sách lưu `author/category/isbn`; đã có route ISBN chính xác, tiêu đề bằng nguyên câu, tác
giả (Phase E). Tài liệu nội bộ **không** có metadata phiên bản/hiệu lực/trạng thái (Markdown một phiên bản trên
git) và không FP nào do lệch phiên bản → không thêm trường metadata (tránh trường trùng/suy đoán).

**Thay đổi (`assistant_tools.py`, cùng mẫu route tác giả).**
- *Exact filter — tiêu đề:* câu hỏi, sau khi bỏ từ gợi ý ở đầu/cuối ("tìm sách…", "có cuốn… không"), trùng tiêu
  đề bỏ hậu tố trong ngoặc ("(Tái Bản 2022)"); mọi ấn bản trùng được đưa lên đầu, `TITLE_EXACT`. "Tuổi Thơ Dữ Dội
  tập 2" không khớp "Tập 1".
- *Exact filter — ISBN không có:* câu chỉ gồm một số dạng ISBN + từ gợi ý mà không sách nào mang ISBN đó →
  NO_EVIDENCE `ISBN_NOT_FOUND`, không gọi embedding; semantic không được thay thế định danh.
- *Soft filter — thể loại:* đã viết, đo, **gỡ bỏ**: sách đúng thể loại không nằm trong 24 ứng viên fused nên lọc mềm
  không có gì để chuyển; không cải thiện case nào. Route thêm ứng viên sẽ đổi quyết định abstention — 3 case không
  đủ để chứng minh an toàn.
- *No filter:* mọi câu khác đi đường hybrid như cũ.

**Kết quả.** Supplement trusted: TITLE R@1 0,90 → 1,00; ISBN gần đúng FPR 1,0 → 0,0; answerable R@5 0,870 → 0,905;
không case nào giảm. rag_dataset trusted: **không đổi**. rag_dataset all-cases: BOOK FNR 0,127 → 0,218 vì 5 câu
ISBN của sách đã bị xóa (`bm-001..007`, unreachable) nay trả "không tìm thấy" thay vì 8 sách sai — đúng hành vi,
selective accuracy 0,368 → 0,404.

**Test.** `test_book_index.py::MetadataRouteTest` (5 test): tiêu đề không hậu tố/không dấu/có từ gợi ý, nhiều ấn
bản, tập khác, ISBN không có, ISBN + chữ vẫn qua hybrid.

**Bổ sung (cùng ngày).** ISBN-10 hợp lệ trong câu hỏi được đổi sang ISBN-13 (dùng lại `canonical_isbn` của
`metadata_intelligence/verification.py`) trước khi so khớp chính xác, vì catalog chỉ lưu ISBN-13; ISBN-10 sai chữ số
kiểm tra vẫn là `ISBN_NOT_FOUND`. Test: `test_isbn10_matches_the_catalog_isbn13`. Không case eval nào dùng ISBN-10,
nên số liệu benchmark không đổi.

**Hạn chế.** Câu hỏi thể loại vẫn yếu (R@5 0,08 trên 3 case) — cần thêm nhãn người viết rồi mới thiết kế route.
Tên tác giả có chữ viết tắt dính liền ("J.K. Rowling") chưa khớp.

**Rollback.** Revert `assistant_tools.py`.

---

## Phase 3 — Hiểu truy vấn và viết lại có chọn lọc

**Hiện trạng.** Đường LLM của NLU đã đọc 4 lượt lịch sử và tự trả `query`. Khoảng trống: đường nhanh cho câu hỏi
chính sách (`rule_policy`), đường rule và đường fallback dùng **nguyên văn** tin nhắn, bỏ qua lịch sử — nên "Còn
hạng Bạc Sĩ thì sao?" mất chủ ngữ.

**Thay đổi.** `query_rewrite.py` (mới) + `nlu._with_rewrite` cho ba đường trên khi intent là GENERAL_QUERY:
- Đủ điều kiện (tất định): có lịch sử, câu tiếp nối ("còn…", "thế còn…", "… thì sao", "cuốn đó/hạng đó/cái đó…",
  ≤ 3 từ). Không bao giờ: ISBN, tiêu đề trong ngoặc kép, câu đầy đủ. 0/226 câu độc lập của rag_dataset đủ điều kiện.
- Kiểm tra kết quả: 5–300 ký tự, không thêm số mới, giữ mọi từ nội dung của câu người dùng. Lỗi/timeout (3 s)/không
  hợp lệ → dùng câu gốc. `query_original`, `query_rewrite` (trạng thái) được giữ trong kết quả NLU.
- Đường LLM của NLU, lệnh mượn/đặt, dữ liệu động: không đổi.

**Đánh giá** (`eval/rag_conversation_dataset.json`, 18 câu; nhãn chép từ case rag_dataset có cùng nghĩa —
`standalone_of`; `query_rewrite_20261114_234110_p3-final.md`):

| Biến thể | Ans R@1 | Ans R@5 | MRR | No-answer acc | FPR | FNR |
|---|---:|---:|---:|---:|---:|---:|
| Câu gốc (trước Phase 3) | 0,60 | 0,667 | 0,622 | 1,00 | 0,00 | 0,20 |
| Viết lại | **1,00** | **1,00** | **1,00** | 0,333 | 0,667 | **0,00** |
| Câu độc lập (cận trên) | 1,00 | 1,00 | 1,00 | 0,333 | 0,667 | 0,00 |

Tỷ lệ lỗi viết lại 0/14; 4/4 câu đối chứng giữ nguyên; độ trễ p50 0,70 s, max 0,99 s (chỉ câu đủ điều kiện).
Một lần sửa prompt sau lượt đầu (lượt đầu: ghép chủ đề cũ vào câu đổi chủ đề, và làm mất "đặt trước").

**Hạn chế (quan trọng).** FPR trên 3 câu tiếp nối không đáp án tăng 0 → 2/3 so với câu gốc. Cả hai là câu viết
lại **đúng**; cùng câu đó hỏi độc lập cũng bị FP (giới hạn confidence INTERNAL_DOC của Phase 1, kết quả UNCERTAIN).
Câu gốc mơ hồ trước đây "may mắn" bị từ chối — cũng là lý do 20 % câu có đáp án bị từ chối nhầm. Dataset 18 câu vừa
dùng để thiết kế vừa để báo cáo — cần bộ hội thoại do người viết làm held-out.

**Rollback.** `RAG_QUERY_REWRITE_ENABLED=false`.

---

## Phase 4 — Grounding câu trả lời và trích dẫn

**Hiện trạng.** "Trích dẫn" mà UI và eval thấy là `context_sources` = **mọi** tài liệu FAQ được truy xuất (top-3),
gắn bất kể câu trả lời có dùng hay không; dòng "Nguồn dữ liệu" cũng liệt kê tất cả khi CONFIDENT. Đã có sẵn: kiểm tra
số liệu (`verify_numeric_grounding`), quy tắc prompt chống bịa, khối dữ liệu hiện hành (live) thắng tài liệu, tách dữ
liệu động khỏi RAG (API nghiệp vụ bằng token người dùng), scorer PASS/FAIL/UNVERIFIABLE với phân loại claim.

**Thử nghiệm citation attribution — bác bỏ, không ship.**

| Biến thể | Precision | Completeness | Ghi chú |
|---|---:|---:|---|
| Hiện tại (mọi tài liệu truy xuất) | 0,633 | 0,80 | baseline cùng ngày `chat_answers_20261114_235359` |
| Offline, mức tài liệu (≥1 số hoặc ≥2 từ riêng) | 0,692 | 0,80 | trên câu trả lời đã lưu, văn bản cả tài liệu |
| Offline, mức claim (mỗi câu → tài liệu hỗ trợ tốt nhất) | 0,717 | **0,70** | làm rơi 2 trích dẫn đúng |
| Live, mức chunk (lượt 1 / lượt 2) | 0,649 / 0,633 | **0,75 / 0,75** | làm rơi `membership-plans-overview` của `ans-false-03` (số liệu đến từ khối live) |

Không biến thể nào đạt tiêu chí (precision tăng **và** completeness tăng). Đã gỡ khỏi `main.py`/`rag.py`.
Nguyên nhân precision thấp: (1) top-3 luôn được gắn; (2) nhiều trích dẫn "thừa" thực ra được câu trả lời dùng
(vd. số lần gia hạn trong câu trả lời về hạn mức mượn — `renewal-count`) nhưng không nằm trong `expected_docs`/
`acceptable_docs` — cần người rà nhãn, không tự sửa. Completeness bị chặn bởi truy xuất: `membership-plans-overview`
không vào top-5 với các câu phạt theo hạng (top-5 chỉ cứu 1/4 case, không đổi `FAQ_TOP_K`).

**Thay đổi ship.** Chỉ ở scorer: chỉ số **riêng** `evidence_completeness_with_live_sources` (nguồn live
`/public/membership/plans`, `/public/catalog/branches` được tính là bằng chứng cho tài liệu chỉ diễn giải các giá trị
đó — đúng thiết kế "giá trị hiện hành thắng tài liệu"). Các chỉ số citation cũ giữ nguyên, là số chính thức.

**Kết quả câu trả lời cuối** (33 câu, live qua gateway, image local build từ working tree; mỗi lượt gọi LLM thật):

| Lượt | Code | PASS / FAIL / UNVERIF. | False refusal | Abstention acc | Cit. precision / completeness | Evidence compl. (live) | Numeric support |
|---|---|---|---:|---:|---|---:|---:|
| `chat_answers_20261114_235359` | trước (HEAD) | 30 / 2 / 1 | 0,000 | 0,875 | 0,633 / 0,80 | 0,95 | 0,915 |
| `chat_answers_20261115_020850` | gate 0,2 + attribution | 28 / 4 / 1 | **0,062** | 0,875 | 0,649 / 0,75 | 0,90 | 0,930 |
| `chat_answers_20261115_021650` | gate 0,01 + attribution | 30 / 3 / 0 | 0,000 | 0,875 | 0,633 / 0,75 | 0,95 | 1,000 |
| `chat_answers_20261115_022532` | **ship** (gate 0,01, không attribution) | 28 / 4 / 1 | 0,000 | 0,750 | 0,667 / 0,80 | 0,95 | 0,929 |

Diễn giải: lượt 1 lộ ra lỗi do Phase 1 (từ chối nhầm `ans-contra-01`) → đã sửa (quy tắc không trùng từ). Các khác
biệt còn lại nằm trong dao động giữa các lượt LLM: `ans-near-04` đạt ở lượt 2, trượt ở lượt 3 trên cùng truy xuất;
`ans-part-03` có confidence 0,414 sát ngưỡng 0,40 và **không** bao giờ truy xuất được `roles-permissions` (trước lẫn
sau) — lượt 3 là NO_EVIDENCE do embedding live dao động (gate focus không liên quan: coverage 0,6). Không có cải
thiện nào ở tầng câu trả lời được khẳng định; dữ liệu động 5/5 ở mọi lượt, không lộ dữ liệu ngoài quyền.

**Trạng thái.** Chưa đạt: citation precision ≥ 0,80, completeness ≥ 0,90. Đạt: false refusal không tăng
(0,0), dữ liệu động và phân quyền không đổi.

**Đề xuất tiếp.** (1) Người rà `acceptable_docs` của 20 câu có trích dẫn; (2) xử lý `membership-plans-overview`
không được truy xuất cho câu phạt theo hạng (tài liệu này chủ yếu bị thay bằng khối live); (3) chạy mỗi cấu hình ≥ 3
lượt và báo khoảng dao động trước khi so sánh tầng câu trả lời.

**Rollback.** Không có thay đổi production ở Phase 4; scorer: revert `eval_chat_answers.py`.

---

## CI/CD

Test xác định mới (`test_rag_integrity.py`, `test_query_rewrite.py`, các test thêm trong `test_retrieval_confidence.py`,
`test_book_index.py`, `test_rag.py`, `test_eval_chat_answers.py`) chạy trong job `verify` hiện có qua `pnpm test:ai`
(PR và push lên `main`/`hungg`). Không thêm workflow: eval live (`eval_rag.py`, `eval_query_rewrite.py`,
`eval_chat_answers.py`) cần stack Docker, catalog và OpenRouter — giữ ngoài CI, chạy tay trước phát hành theo
mục "Cách chạy lại". Không có bước deploy nào được thêm hay kích hoạt.

Kết quả cuối (2026-11-15): `pnpm test:ai` 1589 passed, 12 skipped. 12 test bị bỏ qua là test cần Postgres
(`test_pgvector_store.py`, `test_agent_store_pg.py`); đã chạy riêng giống job `ai-postgres` của CI — container
`pgvector/pgvector:pg15` dùng một lần, mạng Docker riêng, image ai-service — 12 passed.
