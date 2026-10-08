# Rà soát & củng cố SmartBook cho KLTN — 2026-10-08

Phạm vi: các vấn đề nêu trong yêu cầu rà soát sau buổi họp GVHD 18/09/2026, được **kiểm chứng trên code và trên stack
Docker thật** trước khi sửa. Mỗi mục ghi: vị trí, bằng chứng, ảnh hưởng, cách sửa, kiểm thử. Không đổi ground truth,
không thêm microservice, không đổi schema Prisma.

## P0 — đã sửa

### P0-1. Corpus `BOOK_METADATA` không bao giờ được nạp tự động
- **Vị trí**: `services/ai-service/main.py::_startup_ingest_corpus` gọi `assistant_tools._get("/api/books", None)`.
- **Bằng chứng**: `/api/books` đòi JWT người dùng → gateway trả 401; log thật của container cũ:
  `startup ingest: 0 book documents ingested … phan hoi /api/books: {'error': '/api/books tra ve HTTP 401'}`.
  Corpus trong `ai_db` chỉ có dữ liệu do nạp tay (17–25/09) và còn 1 document rác `test-b2` từ integration test.
- **Ảnh hưởng**: môi trường mới/CI/sau reset → `search_books`, public discover, gợi ý semantic không có tín hiệu
  semantic; sách mới thêm/sửa sau lần nạp tay không bao giờ được cập nhật; sách bị ngừng vẫn còn trong corpus.
- **Sửa**:
  - inventory-service: `GET /internal/catalog/books` (`routes/internal-book-corpus.routes.js`) — xác thực
    service-to-service bằng `x-internal-service-key` (so sánh timing-safe, không fallback), chỉ sách `is_active`,
    phân trang keyset `id > after` (không dùng Prisma `cursor`: bản ghi con trỏ bị xoá giữa hai trang sẽ làm
    scan dừng sớm và AI xoá nhầm sách).
  - ai-service: `catalog_sync.py` — đồng bộ lúc khởi động + định kỳ (`CATALOG_SYNC_INTERVAL_SECONDS`, mặc định
    300 s); incremental theo hash nội dung + embedding identity; gỡ sách không còn trong lần quét **đầy đủ**; quét lỗi
    thì không xoá; catalog rỗng không xoá hàng loạt; retry/backoff cho timeout/5xx/429, 401/403 dừng ngay; provider
    embedding lỗi liên tiếp → hoãn phần còn lại (không đập OpenRouter); lock chống chạy chồng; metrics Prometheus
    `ai_catalog_sync_*`; endpoint `GET /internal/catalog-sync/status`, `POST /internal/catalog-sync`.
  - `ingestion.py`: cắt chunk mồ côi khi tài liệu ngắn lại; gỡ tài liệu nội bộ khi file `.md` bị xoá.
  - gateway chặn `/ai/internal/*` (404) để endpoint nội bộ không lộ ra public edge.
  - `reindex_embeddings.py` không còn cần JWT.
- **Kiểm thử**: `test_catalog_sync.py` (24 test: phân trang, retry, 403, thiếu khoá, con trỏ lặp, incremental,
  đổi metadata, chỉ đổi ISBN, gỡ sách, quét lỗi không xoá, catalog rỗng, OpenRouter sập rồi hồi phục, không trùng
  document/chunk, chạy chồng); `internal-book-corpus.test.js` (8 test); `test_pgvector_store.py` trên Postgres +
  pgvector thật (6 test, gồm đồng bộ end-to-end); CI job mới `ai-postgres`.
- **Tiêu chí chấp nhận — kiểm chứng trên stack thật**: lần đồng bộ đầu: 116/116 sách, 3 embed lại, 113 chỉ cập nhật
  metadata, gỡ `test-b2`; lần 2: 116 không đổi, 0 lời gọi embedding (372 ms). Đổi mô tả 1 sách → chỉ 1 sách embed lại
  → truy vấn mới tìm ra sách ở hạng 1 (CONFIDENT_MATCH); khôi phục mô tả → sách không còn khớp truy vấn đó.

### P0-2. Xác nhận AI action đồng thời thực thi nhiều lần (human-in-the-loop)
- **Vị trí**: `main.py::confirm_action`, `agent_store.mark_action_confirmed`.
- **Bằng chứng**: kiểm tra `status == PENDING` rồi mới thực thi; `mark_action_confirmed` không đổi trạng thái. Test
  Postgres với code cũ: 4 request xác nhận đồng thời → **thực thi 4 lần** (`AssertionError: 4 != 1`).
- **Ảnh hưởng**: double-click / client retry / hai tab tạo trùng bản nháp nhập hàng, cảnh báo, nhiệm vụ kho.
- **Sửa**: claim nguyên tử `UPDATE … WHERE status IN (PENDING_CONFIRMATION, FAILED)` → `CONFIRMED`; request thua nhận
  409 hoặc kết quả idempotent nếu đã `EXECUTED`. `/actions/cancel` chỉ huỷ khi còn `PENDING_CONFIRMATION` (trước đây
  huỷ được cả hành động đã thực thi → nhật ký audit sai).
- **Kiểm thử**: `test_agent_store.py` (+4), `test_agent_store_pg.py` (2, Postgres thật: 8 claim đồng thời → đúng 1
  thắng; 4 request đồng thời → thực thi đúng 1 lần).

## P1 — đã sửa

| # | Vấn đề & bằng chứng | Sửa | Kiểm thử |
| --- | --- | --- | --- |
| P1-1 | Chuỗi dự báo nhập kho gồm bucket "hôm nay" chưa trọn → dự báo phụ thuộc giờ gọi. DB thật, cùng ngày: code cũ `forecast_30d` 168 (08:00) vs 182 (22:00), chênh 8.3%, và thấp có hệ thống | `getDailyBorrowSeriesByVariant` chỉ dùng ngày trọn `[trunc(from), trunc(to))`; bản mô phỏng `eval/point-in-time.js` đồng bộ theo | test bất biến theo giờ gọi; code mới 253 vs 257 (chênh 1.6% còn lại do các cửa sổ đếm trượt) |
| P1-2 | Metadata `CONFLICTED`/`LOW_CONFIDENCE` (nguồn mâu thuẫn, bằng chứng yếu) ở luồng ISBN mặc định vẫn **tự động ACCEPTED** trong draft (`AUTO_ACCEPT_FIELDS`), chỉ V2 mới hạ cấp | `initialDecisionStatuses()` hạ các field đó về `PENDING`; `AuthorityReviewPanel` thêm dòng duyệt cho field không thuộc authority | 3 test mới `metadata-provenance.test.js`; `tsc` sạch |
| P1-3 | `test_pgvector_store.py` để lại document `test-b2` trong corpus `ai_db` thật (không dọn ở tearDown) | `addCleanup` sau mỗi test; tài liệu hoá dùng DB riêng | chạy trên Postgres tạm: 0 document còn lại |
| P1-4 | Đánh giá RAG không tái lập: OpenRouter timeout làm case thành keyword-only âm thầm; catalog rỗng (token hết hạn) cũng âm thầm | cache + retry embedding câu hỏi (`eval/embed_cache.py`), báo số case thiếu semantic, dừng khi catalog rỗng, tách val/test cố định theo hash id | các report 08/10 đều 0 case thiếu semantic |

## P2 — đã sửa
- Fallback secret `smartbook_internal_key` / `smartbook-internal-dev-key` ở 13 module Node/Python (không chạy được
  vì `requireEnv` chặn khởi động, nhưng là secret công khai trong code). Đã bỏ; hai receiver ở borrow-service trước đây
  chấp nhận khoá rỗng nếu env rỗng (`'' === ''`) nay từ chối. `tests/security-config.test.mjs` quét toàn bộ source.

## Đã kiểm tra, không cần sửa (có bằng chứng)
- VNPay: `finalizeVnpayPayment` claim nguyên tử `updateMany … status: 'PENDING'`, kiểm tra số tiền, return/IPN
  cùng một hàm idempotent.
- Metadata V2: ứng viên không có bằng chứng bị loại khỏi fusion (`UNSUPPORTED_ITEM`); edition chưa xác minh, xung
  đột, độ tin cậy < 0.8 → `REVIEW_REQUIRED`; áp dụng draft cần quyền quản lý và không còn field `PENDING`.
- Dataset metadata 120 editions đã ghi rõ `ai_generated_claude_not_human_annotated`.

## Thực nghiệm (chi tiết trong các file riêng)
- RAG: `services/ai-service/eval/reports/RAG_EVAL_20261008_SUMMARY.md` — nguyên nhân gốc false negative (keyword arm
  AND mọi từ); bản sửa keyword tốt hơn trên val nhưng **không** tốt hơn trên test → không bật mặc định.
- Dự báo/nhập kho: `docs/ANALYSIS/FORECAST_DIAGNOSTICS.md`, mục 5.2 và 13.1 của `REORDER_DECISION_EVALUATION.md` —
  α = 0.35 quá nhạy + trend nhiễu; MA30 giảm chi phí 24–38% nhưng tăng nhẹ stockout → giữ production.
- Metadata: công cụ gán nhãn thủ công `eval/metadata_intelligence/human_review.py`.

## Đợt 2 (cùng ngày) — các việc P1 còn lại

### Chính sách nhập kho: sàn số lượng và thứ tự cấp vốn
- **Giao thức**: thiết kế trên seed phát triển 20260928; tiêu chí cố định trong `eval/reorder-candidates.js` **trước**
  khi chạy 3 seed kiểm định mới (20261101–03); phải đạt ở mọi seed × mọi kịch bản. Kết quả:
  `docs/ANALYSIS/REORDER_CANDIDATES.md`, mục 13.2 của `REORDER_DECISION_EVALUATION.md`.
- **Bỏ sàn số lượng: không áp dụng** — rẻ hơn ~16.5% nhưng stockout days vượt biên +5%.
- **Cấp vốn theo thiếu hụt kỳ vọng trên mỗi đồng: đã áp dụng vào production** (`allocateBudgetInOrder` +
  `compareByShortfallPerCost`; danh sách vẫn hiển thị theo priority, `budget.funding_order` mới trong API). Đạt 9/9:
  cùng mức chi, fill rate +0.22…+4.03 điểm %, unmet −2.7…−29.6%. DB thật, ngân sách 1.5 triệu: 4 dòng / 20 bản được
  cấp vốn (thứ tự cũ: 2 dòng / 14 bản).
- **Đính chính phương pháp**: so sánh "cùng tổng chi" cũ bất lợi cho SmartBook vì baseline được dồn tiền vào các tuần
  đầu. Dưới cùng ngân sách **mỗi tuần** khoảng cách chỉ còn −0.35…−2.08 điểm % (trước: −6.5…−20.6). Backtest chính
  nay có thêm `*_SAME_BUDGET`.

### Hiệu chỉnh lại ngưỡng RAG
- Thêm 54 câu không đáp án đã đối chiếu với catalog/corpus (chỉ thêm, không sửa case cũ; 130 → 184). Chọn ngưỡng trên
  val, kiểm định trên test (`calibrate_rag.py --split=hash`).
- **INTERNAL_DOC `tau_evidence` 0.35 → 0.40: đã áp dụng** — test: No-answer Accuracy 0.917 → 1.0, recall giữ 1.0.
  Tổng thể trên test: No-answer Accuracy 0.885 → 0.923, FPR 0.115 → 0.077, FNR không đổi.
- **BOOK_METADATA giữ 0.25**: ngưỡng chặt hơn làm FNR trên test tăng 0.13 → 0.23. Keyword `terms` tiếp tục kém hơn.
- Chi tiết: `services/ai-service/eval/reports/RAG_EVAL_20261008_SUMMARY.md`.

### Gán nhãn metadata
- **Phần cần con người chưa làm** (không thể và không được để AI tự gán nhãn thay). Đã chuẩn bị: phiếu
  `eval/metadata_intelligence/annotation/review_A.csv` (120 edition) và `review_B.csv` (24 edition phân tầng cho
  người thứ hai), hướng dẫn tiếng Việt `HUONG_DAN_GAN_NHAN.md`, nhập có phân xử bất đồng, đánh dấu `secondAnnotator`,
  đầu ra được `run_experiments.py` chấp nhận.

## Còn lại
- **P1 — cần người**: gán nhãn 2 phiếu, phân xử bất đồng, rồi chạy B1–B5 trên `human_dataset.json`; người xác nhận lại
  54 nhãn "không đáp án" mới của RAG và nhãn cũ `bm-059` (catalog hiện có "Truyện Tranh Dành Cho Trẻ Em…").
- **P1**: SMARTBOOK vẫn kém min/max ở kịch bản nhà cung cấp giao chậm (SUPPLIER_DELAY); vị trí tồn kho chưa tính bản
  đang cho mượn sắp trả (production có `due_date`, bộ mô phỏng chưa cung cấp cho chính sách).
- **P2**: dữ liệu demo có tác giả sai (vd. "Dế Mèn Phiêu Lưu Ký — Nam Cao", "Project Hail Mary — To Hoai") làm nhiễu
  đánh giá RAG theo tác giả; action kẹt ở `CONFIRMED` khi process chết; các cửa sổ đếm khác của gợi ý nhập kho vẫn trượt
  theo giờ (~1.6%); nên ghim digest base image ai-service.
- **Môi trường**: `.env` local thiếu `GRAFANA_ADMIN_PASSWORD`.
