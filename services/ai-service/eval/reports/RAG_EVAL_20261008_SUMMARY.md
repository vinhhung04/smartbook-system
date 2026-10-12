# Đánh giá RAG — 2026-10-08 (tổng hợp)

Mọi con số dưới đây lấy nguyên từ các report cùng thư mục; không có số gõ tay ngoài bảng tóm tắt.
Chạy trên stack Docker thật (Postgres + pgvector `ai_db`, catalog 116 sách active trong `inventory_db`),
embedding `qwen/qwen3-embedding-8b@768` qua OpenRouter, ngưỡng `retrieval_confidence` giữ nguyên
(BOOK 0.66/0.25, DOC 0.66/0.35). Dataset `eval/rag_dataset.json` (130 case, **không sửa ground truth**).

## Thay đổi phương pháp đánh giá (để kết quả tái lập được)

1. **Cache embedding câu hỏi** (`eval/embed_cache.py`, `eval/.cache/`, git-ignored): một lượt chạy trước đó có 3 lần
   OpenRouter timeout → 3 case âm thầm thành keyword-only, làm số liệu dao động giữa các lần chạy. Nay mọi lượt
   chạy cùng embedding identity dùng **cùng** vector câu hỏi; lỗi provider được retry và report ghi rõ số case thiếu
   tín hiệu semantic (tất cả report dưới đây: 0).
2. **Tách validation/test cố định** (`scoring.dataset_split`, hash của id case — không phụ thuộc thứ tự, không sửa
   dataset): val 52 case (36 có đáp án / 16 không), test 78 case (54 / 24). Thiết kế/tuning chỉ nhìn val; test
   chỉ để báo cáo.
3. Catalog lấy qua feed nội bộ (`INTERNAL_SERVICE_KEY`) khi không có `EVAL_AUTH_TOKEN`; catalog rỗng → dừng với
   lỗi thay vì ghi report sai (trước đây mọi case sách sẽ âm thầm thành NO_EVIDENCE).

## Các cấu hình

| Ký hiệu | Corpus | Nhánh keyword | Report |
| --- | --- | --- | --- |
| A | trước đồng bộ (nạp tay 17–25/09, còn 1 document rác `test-b2`) | cũ (`plainto_tsquery`, AND mọi từ) | `rag_20261008_034028_A-baseline.md` |
| B | sau `catalog_sync` (116/116 sách, rác đã gỡ) | cũ | `rag_20261008_040343_B-legacy.md`, `..._040334_B-legacy_test.md` |
| C | sau `catalog_sync` | content-terms, coverage ≥ 0.67 (chọn trên val) | `rag_20261008_040359_C-terms067.md`, `..._040349_C-terms067_test.md` |

## Kết quả

Toàn bộ 130 case:

| | AR@1 | AR@3 | AR@5 | MRR | No-answer Acc | FPR | FNR | Coverage |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | 0.8485 | 0.8722 | 0.8960 | 0.6208 | 0.850 | 0.150 | 0.0556 | 0.700 |
| B | 0.8485 | 0.8722 | 0.8960 | 0.6208 | 0.875 | 0.125 | 0.0556 | 0.692 |
| C | 0.8262 | 0.8898 | 0.9071 | 0.6169 | 0.825 | 0.175 | 0.0444 | 0.715 |

Tập test (78 case — số liệu dùng để kết luận):

| | AR@1 | AR@3 | AR@5 | MRR | No-answer Acc | Book FPR | FNR |
| --- | --- | --- | --- | --- | --- | --- | --- |
| B | 0.8472 | 0.8519 | 0.8750 | 0.6051 | 0.8333 | 0.3333 | 0.0741 |
| C | 0.8287 | 0.8565 | 0.8750 | 0.5987 | 0.7917 | 0.4167 | 0.0741 |

(AR = Answerable Recall, chỉ trên case có đáp án. INTERNAL_DOC: No-answer Accuracy 1.0 và FNR 0 ở cả B và C.)

Lưới chọn ngưỡng coverage trên **val** (`rag_20261008_0354*_grid-*_val.md`): legacy AR@5 0.928 / No-answer 0.875;
terms ≥0.34: 0.983 / 0.750; ≥0.5: 0.955 / 0.8125; ≥0.67: 0.955 / 0.875 → chọn 0.67.

## Kết luận

* **Đồng bộ catalog (A → B)** không đổi recall (corpus trước đó đã được nạp tay đầy đủ), loại bỏ 1 document rác do
  integration test để lại → giảm 1 false positive sách. Giá trị chính của `catalog_sync` là vận hành: corpus tự đầy đủ
  và tự cập nhật, không cần JWT/thao tác tay (kiểm chứng end-to-end: đổi mô tả 1 sách → chỉ 1 sách được embed lại →
  truy vấn mới tìm ra sách ở hạng 1; khôi phục → kết quả trở lại như cũ).
* **Nguyên nhân gốc của nhiều false negative**: nhánh keyword dùng `plainto_tsquery` (AND mọi từ, kể cả "sách", "nào",
  "của") nên với câu hỏi tự nhiên gần như không bao giờ khớp — trên val nó chỉ hỗ trợ top-1 ở 4/36 câu có đáp án,
  tức hybrid retrieval thực chất chỉ còn semantic.
* **Sửa nhánh keyword (C) không tổng quát hóa**: tốt hơn trên val nhưng trên test thêm 1 false positive sách và Recall@1
  giảm 1 case. Vì vậy **không bật mặc định** (`RAG_KEYWORD_MODE=all`); chế độ mới giữ ở dạng opt-in
  (`RAG_KEYWORD_MODE=terms`) để tái lập. Giả thuyết: ngưỡng `retrieval_confidence` được hiệu chỉnh cho phân bố tín hiệu
  keyword cũ; hiệu chỉnh lại cần nhiều case no-answer hơn (val chỉ có 8 case sách không đáp án — một case = 12.5 điểm %).

## Giới hạn

* Mẫu nhỏ: test có 12 câu sách không đáp án; chênh lệch 1 case = 8.3 điểm % No-answer Accuracy. Không có kiểm định
  thống kê nào ở đây đủ mạnh để khẳng định khác biệt giữa B và C.
* `expected_ids` gắn với id sách trong volume Docker hiện tại (xem `RAG_DATASET_NOTES.md`).
* Ngưỡng `retrieval_confidence` (giữ cố định cho cả A/B/C) đã được hiệu chỉnh ngày 25/09 trên một nửa dataset này
  (`calibrate_rag.py`, chia theo seed khác, nên có giao với tập test của đợt này). Mức tuyệt đối của No-answer
  Accuracy/FPR vì vậy có thể hơi lạc quan cho cả B lẫn C; phép so sánh B ↔ C trên test không bị ảnh hưởng bởi lựa
  chọn nào trong đợt này (coverage 0.67 chỉ được chọn trên val).

## Bổ sung (cùng ngày): hiệu chỉnh lại ngưỡng với thêm câu hỏi không đáp án

**Dữ liệu.** Thêm 54 case không đáp án (`bm-076..107`: 32 câu sách, `doc-056..077`: 22 câu tài liệu nội bộ) — chỉ
thêm, không sửa/xóa case cũ (130 → 184 case). Câu hỏi do AI soạn, mỗi câu được đối chiếu tự động (độ bao phủ từ khóa
với toàn bộ văn bản của 116 sách / 10 tài liệu) và đọc thủ công các trường hợp bị gắn cờ; 2 câu bị loại vì có thể có đáp
án ("Rừng Na Uy" = "Norwegian Wood" có trong catalog; "thiên văn học" gần với sách khoa học viễn tưởng). Snapshot catalog
dùng để đối chiếu: `eval/rag_catalog_snapshot_20261008.json`. **Cần người xác nhận lại các nhãn này.** Tập val nay có
24 câu sách không đáp án (trước: 8).

**Quy trình.** Dump tín hiệu abstention-off cho cả hai chế độ keyword (`rag_signals_*_D-raw-all.json`,
`*_D-raw-terms.json`); `calibrate_rag.py --split=hash` chọn ngưỡng trên val theo quy tắc chọn có sẵn (tối đa No-answer
Accuracy với ràng buộc recall); so sánh với ngưỡng hiện tại trên test.

| Corpus / ngưỡng | Test: Answerable R@5 | No-answer Acc | FPR | FNR |
| --- | --- | --- | --- | --- |
| DOC hiện tại (`tau_evidence` 0.35) | 1.0 | 0.917 | 0.083 | 0.0 |
| DOC chọn trên val (0.40) | 1.0 | **1.0** | **0.0** | 0.0 |
| BOOK hiện tại (0.25) | 0.782 | 0.857 | 0.143 | 0.129 |
| BOOK chọn trên val (0.30) | 0.710 | 0.929 | 0.071 | **0.226** |
| BOOK, keyword `terms`, chọn trên val (0.40) | 0.734 | 0.821 | 0.179 | 0.258 |

**Quyết định.** Áp dụng `DOC_CONF_TAU_EVIDENCE=0.40` (cải thiện thuần trên test). Giữ `BOOK` = 0.25: ngưỡng chặt hơn giảm
false positive nhưng tăng false negative trên test — đúng kiểu "tăng threshold tùy tiện" cần tránh. Giữ keyword `all`.

**Kết quả cuối với cấu hình production** (`rag_*_E-final_test.md`, `rag_*_E-before_test.md`, cùng 184-case dataset):

| Tập test | Answerable R@1/3/5 | No-answer Acc | FPR | FNR |
| --- | --- | --- | --- | --- |
| Trước (DOC 0.35) | 0.847 / 0.852 / 0.875 | 0.885 | 0.115 | 0.074 |
| Sau (DOC 0.40) | 0.847 / 0.852 / 0.875 | **0.923** | **0.077** | 0.074 |

False positive sách còn lại trên toàn bộ dataset đều là `UNCERTAIN` với độ tin cậy 0.26–0.38 (được trình bày kèm cảnh báo),
phần lớn là sách gần chủ đề (hỏi "Atomic Habits" → "7 Thói Quen Hiệu Quả", "Kaizen").

**Lưu ý nhãn cũ cần người duyệt:** `bm-059` ("Có truyện tranh nào dành cho trẻ em 5 tuổi không?") đang là *không đáp án*,
nhưng catalog hiện có "Truyện Tranh Dành Cho Trẻ Em - Định Luật Murphy" — nhãn không được sửa trong đợt này.
