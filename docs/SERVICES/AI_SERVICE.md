# AI Service

## Mục tiêu

AI Service cung cấp năng lực tự động hóa nhập liệu sách bằng AI, tập trung vào OCR và chuẩn hóa metadata.

- Runtime: Python + FastAPI
- Entrypoint: services/ai-service/main.py
- Model runtime: OpenRouter là backend inference duy nhất (`llm_provider.py`, `get_openrouter_provider()`)
  — text, tool-calling, NLU, vision/OCR và embeddings đều qua nó. Không có Ollama, không có
  local chat/vision model, không cần GPU. CLIP (local, CPU) vẫn chạy riêng chỉ cho visual
  similarity của ảnh bìa (`cover_embeddings.py`) — độc lập với LLM.
- Vai trò: tra cứu ISBN, tạo tóm tắt tiếng Việt, OCR hóa đơn nhập kho, trợ lý ra quyết định

## Bảo mật & dữ liệu

- `OPENROUTER_API_KEY` chỉ nằm server-side (biến môi trường của `ai-service`) — không gửi xuống
  frontend, không log, không commit vào repo. Đã quét toàn bộ repo + git history, không có key
  thật nào bị commit.
- **Ảnh gửi ra bên thứ ba**: `/verify-packing-photo`, `/scan-receipt`, và OCR bìa sách
  (`/find-book-by-cover`) gửi ảnh (đóng gói, hóa đơn nhập kho, bìa sách) tới OpenRouter qua
  HTTPS để chạy vision/OCR — khác với trước đây khi Ollama chạy local, ảnh không rời máy. Đây
  là thay đổi về data residency cần lưu ý nếu có yêu cầu compliance (vd hóa đơn nhập kho có
  thể chứa thông tin nhà cung cấp/giá). Text truy vấn (chat, tìm sách, NLU) cũng qua OpenRouter
  tương tự — không khác biệt so với phần chat/tool-calling đã dùng OpenRouter từ trước.
- Không gửi token xác thực, hồ sơ người dùng, hay dữ liệu nghiệp vụ nội bộ nào khác tới LLM
  ngoài nội dung câu hỏi/ảnh cần xử lý (xem `nlu.py`'s docstring).

## Endpoint chính

| Method | Endpoint | Mô tả |
|---|---|---|
| GET | /health | Kiểm tra trạng thái service |
| GET | /recommendations | Gợi ý đọc sách |
| POST | /recommendations | Gợi ý đọc sách theo payload |
| POST | /lookup-book-by-isbn | Tra cứu metadata theo ISBN |
| POST | /isbn-intelligence | Tra cứu ISBN có bằng chứng nguồn, confidence theo field và conflict |
| POST | /generate-book-summary | Tạo tóm tắt sách |
| POST | /generate-summary-vi | Tạo tóm tắt tiếng Việt phong cách nhà sách (Fahasa/Tiki style) |
| POST | /chat | Hỏi đáp AI |
| POST | /reading-stats | Tổng hợp thống kê đọc |
| POST | /assistant | Trợ lý hỗ trợ ra quyết định (tool-calling qua OpenRouter + Analytics Service) |
| POST | /assistant/stream | Bản streaming (SSE) của /assistant |
| POST | /actions/confirm | Xác nhận (hoặc hủy, nếu `confirm: false`) một pending action |
| POST | /actions/cancel | Hủy một pending action |
| GET | /actions/pending/{action_id} | Xem chi tiết một pending action (chủ sở hữu hoặc superuser) |
| GET | /actions/stats | Thống kê tổng số action pending/executed/total (admin) |
| GET | /assistant/actions | Action Center — danh sách action, filter theo `status`/`conversation_id`/`mine` |
| GET | /assistant/actions/{action_id} | Chi tiết action + audit log đầy đủ (CREATED→CONFIRMED→EXECUTED/...) |
| GET | /assistant/conversations | Danh sách hội thoại của user hiện tại |
| GET | /assistant/conversations/{conversation_id} | Chi tiết hội thoại + toàn bộ message |
| PATCH | /assistant/conversations/{conversation_id} | Đổi tên hội thoại (`{ "title": "..." }`) |
| DELETE | /assistant/conversations/{conversation_id} | Archive hội thoại (soft delete) |

Ghi chú quan trọng:

- Có endpoint alias /api/ai/generate-book-summary để tương thích khi đi qua gateway.
- /generate-summary-vi nhận thêm field `publisher` (optional). Output 180–280 từ, 3–5 đoạn tự nhiên, không ép format 4 section cứng. Cache key tính cả description + categories (sha256) để tránh trả kết quả cũ khi metadata thay đổi.
- /lookup-book-by-isbn hỗ trợ normalize ISBN-10/ISBN-13 và trả payload ổn định cho frontend.
- `/isbn-intelligence` là hợp đồng tra cứu chuẩn; `/lookup-book-by-isbn` và `lookup` của `/enrich-book-after-isbn` được mở rộng tương thích bằng `fieldEvidence`, `fieldConfidence`, `sources`, `conflicts`, `metadataQualityScore`, và `processingTimeMs`. Confidence được tính xác định từ độ tin cậy và đồng thuận dữ liệu nguồn, không dùng điểm do LLM sinh ra. Kết quả chỉ là đề xuất để nhân viên duyệt, không ghi catalog.
- **Field-level retrieval** (`ENABLE_FIELD_LEVEL_ISBN_RETRIEVAL`, mặc định tắt): sau lookup Google/Open Library, hệ thống đo độ đầy đủ theo field (`MISSING` / `LOW_CONFIDENCE` / `CONFLICTED` / `SUFFICIENT`) và chỉ gọi thêm provider có khả năng bổ sung field quan trọng còn thiếu (Tiki/Vinabook → Fahasa → web search), mỗi provider tối đa một lần và trong ngân sách `ISBN_LOOKUP_TOTAL_BUDGET_SECONDS`. Response bổ sung (additive) `metadataCoverage`, `fieldStatus`, `missingFields`, `lowConfidenceFields`, `conflictedFields`, `needsEnrichment`, `retrieval`, `sources[].phase/reasons` và trạng thái `SKIPPED`. `found` vẫn nghĩa là đã nhận diện được sách, không đồng nghĩa metadata đầy đủ. Kết quả chưa đầy đủ hoặc có provider lỗi chỉ được cache `ISBN_INCOMPLETE_CACHE_TTL_SECONDS`.
- **Field-level Metadata Evidence Fusion** (`isbn_fusion.py`, `ISBN_FUSION_MODE=evidence` mặc định): thay vì chọn "nguồn có reliability cao nhất thắng tuyệt đối" (thuật toán cũ, giữ lại qua `ISBN_FUSION_MODE=prior` để so sánh/rollback), mỗi field đi qua pipeline `Sources → Normalize evidence → Field-level candidate generation → Conflict detection → Reliability scoring → Evidence fusion → Final value + confidence + provenance`:
  - **Normalize trước khi so sánh**: publisher bỏ tiền tố (`NXB`/`Nhà Xuất Bản`/...), author tách theo `,`/`;`/`&`/`và` rồi bỏ dấu/case, ngày chỉ so theo năm (chấp nhận độ chi tiết khác nhau), ngôn ngữ map về mã ISO. Nhờ vậy "NXB Trẻ" / "Nhà Xuất Bản Trẻ" / "nxb tre" được nhận ra là MỘT giá trị, không còn bị báo `CONFLICTED` giả (xem `eval/metadata_fusion/run_eval.py` — Conflict Detection Accuracy tăng từ 0.667 lên 1.0 trên bộ fixture nhờ đúng thay đổi này, không đổi Field Accuracy).
  - **Reliability = source prior (`source_reliability.py`) × extraction-method prior (`isbn_fusion.METHOD_RELIABILITY`)**: JSON-LD/API structured (1.0) > DOM field (0.9) > regex/snippet (0.75) > LLM free-text inference (0.4, và các field factual — title/authors/publisher/pageCount — không được chọn evidence LLM-only làm giá trị cuối, "Evidence first, LLM second").
  - **Evidence agreement**: các nguồn đồng thuận (sau normalize) được gộp bằng noisy-OR có chiết khấu cho nguồn cùng nhóm độc lập (`INDEPENDENCE_GROUPS` — marketplace VN hay copy dữ liệu của nhau, capped tại `MAX_SUPPORT=0.97`); một nguồn đơn lẻ có confidence đúng bằng reliability của chính nó, không bị thưởng hay phạt vì đơn độc.
  - **Field-specific policy**: `categories` gộp (union, không chọn một); `description` chọn bản "giàu nhất" (dài × reliability) nhưng giữ provenance cả hai; `authors` so khớp theo tập con; `pageCount`/`publishedDate` có ngưỡng dung sai trước khi coi là xung đột thật.
  - `fieldEvidence[field]` có thêm (additive) `confidence`, `reasonCodes`, `candidates` (mọi nhóm giá trị, kèm support), `evidence` (từng nguồn kèm `method`/`reliability`/`sourceUrl`) — phục vụ Provenance API (giải thích "giá trị này từ đâu, vì sao được chọn, có mâu thuẫn không"). Các field top-level cũ (`title`, `authors`, `publisher`...) và `fieldStatus`/`conflicts` giữ nguyên hợp đồng cũ.
- Khi ENABLE_MARKETPLACE_LOOKUP=true, /lookup-book-by-isbn tra cứu thêm Fahasa, Tiki, Vinabook song song với Google Books và Open Library.
- Với mã quét EAN-13 không phải ISBN chuẩn, hệ thống thử marketplace lookup trước thay vì bỏ ngay; response có trường `reason` để frontend phân biệt.
- `/assistant` là chatbot hỗ trợ ra quyết định dành riêng cho ADMIN/WAREHOUSE_MANAGER (hoặc superuser) — role/permission khác (kể cả CUSTOMER) bị chặn 403. Request: `{ "message": "string", "conversation_id": "string (optional)" }`. Model dùng tool-calling thật qua `llm_provider.py` (OpenRouter/`OPENROUTER_ASSISTANT_MODEL`) để tự chọn gọi các endpoint `/analytics/*` (định nghĩa trong `assistant_tools.py`) thay vì hard-code theo intent như `/chat`. Response: `{ "answer", "tools_used": [{ "name", "arguments" }], "data": { "<tool_name>": <raw tool result> }, "conversation_id", "grounding_warning", "pending_action", "evidence": [{ "label", "tool_name", "metric", "value", "unit", "description" }], "retrieval_warnings": [] }`. `OPENROUTER_FALLBACK_MODEL` (nếu set) thử lại một lần trên cùng OpenRouter key nếu model chính lỗi — không có fallback sang provider khác.
- **Trí nhớ hội thoại**: `conversation_id` không còn chỉ được echo lại — nếu thiếu hoặc không tồn tại, service tạo một hội thoại mới (bảng `ai_conversations`) và trả về `conversation_id` thật; nếu đã tồn tại, service nạp tối đa 10 message gần nhất (bảng `ai_messages`) làm ngữ cảnh cho lượt hỏi tiếp theo. Mỗi lượt hỏi/trả lời được lưu lại (kèm tool_calls, tool_results, pending_action_id, grounding_warning) để có thể tải lại toàn bộ hội thoại sau khi refresh trang qua `GET /assistant/conversations/{id}`.
- **Hybrid FAQ retrieval cho `/chat`**: khi câu hỏi không khớp intent nào trong 11 intent cố định (`intent.py`), nó rơi vào `GENERAL_QUERY`. `retrieval.py` gọi `faq_retrieval.find_relevant()`, đọc từ corpus `INTERNAL_DOC` trong pgvector (xem mục "Vector store / RAG" bên dưới — không còn `faq_data.py`/file cache JSON) theo hai nhánh như `search_books`: semantic (cosine, phải vượt `FAQ_MATCH_THRESHOLD` mới được tính) và keyword (Postgres full-text bỏ dấu — bắt được câu hỏi gần trùng từng chữ với heading của FAQ mà vector một mình bỏ lỡ), hợp nhất bằng RRF (`fusion.py`), rồi trả về đúng envelope `{summary, raw, sources, warnings, retrieved_at}` như mọi intent khác — nên `verify_numeric_grounding()` và `ensure_source_line()` hoạt động không đổi. OpenRouter embedding lỗi hoặc không match nào vượt ngưỡng → giữ nguyên hành vi fallback cũ (degrade xuống keyword-only), không bao giờ trả 500. `GENERAL_QUERY` nằm trong `intent.ANALYTICS_BLOCK_EXEMPT_INTENTS` nên CUSTOMER/SUPPLIER cũng dùng được — đây chính là nhóm hay hỏi về chính sách mượn/trả và phí phạt nhất.
- **Hybrid book search**: tool `search_books` của `/assistant` truy vấn corpus `BOOK_METADATA` trong pgvector theo hai tín hiệu — semantic (cosine similarity trên embedding của `title + author + category + description + summary_vi`, `book_index.py`) và keyword (Postgres full-text, bỏ dấu bằng `unaccent`) — rồi hợp nhất bằng Reciprocal Rank Fusion (`fusion.py`, không còn trung bình cộng hai thang điểm khác bản chất). Riêng ISBN được xử lý TRƯỚC RRF bằng một short-circuit khớp chính xác (so khớp isbn đã chuẩn hoá — bỏ dấu gạch ngang/khoảng trắng — dưới dạng SUBSTRING của câu hỏi đã chuẩn hoá, không đòi hỏi câu hỏi chỉ gồm mỗi ISBN) vì ISBN cố ý không nằm trong nội dung embed/tsv (một mã định danh có cấu trúc, không phải ngôn ngữ tự nhiên). OpenRouter embedding lỗi → chỉ còn tín hiệu keyword, đúng tinh thần hành vi trước đây (degrade, không lỗi).
- **RAG No-Answer / Abstention Detection** (`retrieval_confidence.py`): sau RRF, một lớp confidence riêng quyết định `CONFIDENT_MATCH` / `UNCERTAIN` / `NO_EVIDENCE` thay vì chỉ dựa "top1 cosine > threshold" — kết hợp điểm cosine đã chuẩn hoá theo corpus (`cos_floor`/`cos_ceil`, khác nhau giữa `BOOK_METADATA` và `INTERNAL_DOC` vì phổ điểm khác nhau) với tín hiệu hạng của nhánh keyword (đồng thuận hai nhánh độc lập là tín hiệu mạnh hơn một mình semantic), cộng các luật cứng (khớp ISBN tuyệt đối, khớp tiêu đề tuyệt đối → `CONFIDENT_MATCH` ngay). Pipeline đầy đủ: `query → semantic + keyword → RRF → retrieval_confidence.evaluate() → LLM/response`.
  - `NO_EVIDENCE` trên `/chat` (câu hỏi tìm thông tin, không phải chào hỏi — xem `intent.is_information_seeking`): trả thẳng câu "Hiện hệ thống chưa có đủ thông tin trong dữ liệu nội bộ để trả lời câu hỏi này.", KHÔNG gọi LLM — tránh để LLM tự suy diễn từ context rỗng. Câu chào hỏi/small-talk với cùng quyết định `NO_EVIDENCE` vẫn được LLM trả lời bình thường.
  - `NO_EVIDENCE` trên tool `search_books` (`/assistant`): giữ nguyên tinh thần "Evidence-first" — không xoá dữ liệu catalog, chỉ không đưa "kết quả gần nhất tình cờ" vào response (`results: []`), kèm `retrievalStatus`/`retrievalConfidence`/`reasonCodes` để model biết. `UNCERTAIN` thì GIỮ kết quả nhưng model được yêu cầu trình bày như chưa chắc chắn (xem `evidence.py`, `ASSISTANT_SYSTEM_PROMPT`).
  - `RAG_ABSTENTION_ENABLED=false` tắt việc ẩn kết quả khi `NO_EVIDENCE` (dùng để tái lập baseline trong `eval/eval_rag.py --abstention off`) mà không đổi threshold hay thuật toán retrieval.
  - Hiệu chỉnh ngưỡng: `eval/eval_rag.py --abstention off --dump-signals` ghi tín hiệu thô từng case ra JSON, `eval/calibrate_rag.py` grid-search `tau_evidence`/`tau_confident` OFFLINE (không gọi lại OpenRouter/DB) trên nửa `calib`, báo cáo trên nửa `test` giữ lại — xem `eval/reports/calibration_*.md` khi đã chạy.
- **Evidence-first**: `evidence` được sinh best-effort từ kết quả tool (xem `evidence.py`) — nếu tool trả `{"error": ...}` hoặc hình dạng dữ liệu không khớp, extractor tương ứng chỉ trả `[]`, không lỗi.
- **AI Action Center + audit log**: `agent_store.py` không còn lưu action trong RAM — mỗi pending action được lưu trong bảng `ai_pending_actions` (Postgres, DB `ai_db`), và mọi bước trong vòng đời (CREATED/CONFIRMED/EXECUTED/CANCELLED/FAILED/EXPIRED) được ghi vào `ai_action_audit_logs`. Danh sách/chi tiết xem qua `GET /assistant/actions` và `GET /assistant/actions/{id}`. Denylist hành động nguy hiểm (`agent_actions.DANGEROUS_ACTION_DENYLIST`) không đổi.

## Database

Từ bản nâng cấp Action Center + trí nhớ hội thoại, `ai-service` có DB Postgres riêng (`ai_db`, tách biệt với `auth_db`/`inventory_db`/`borrow_db`, theo đúng quy ước mỗi service một DB của repo):

- **Truy cập DB**: SQLAlchemy (async, driver `asyncpg`) — xem `db.py`/`db_models.py`. Không dùng Prisma (đó là quy ước riêng của các service Node).
- **Migration**: không dùng Alembic — `schema.sql` chứa các câu lệnh `CREATE TABLE IF NOT EXISTS` idempotent, được áp dụng tự động lúc service khởi động (`@app.on_event("startup")` trong `main.py` gọi `db.init_db()`). An toàn khi chạy lại nhiều lần.
- **Bảng**: `ai_pending_actions`, `ai_action_audit_logs`, `ai_conversations`, `ai_messages` — chi tiết cột xem `schema.sql`/`db_models.py`.
- **Biến môi trường**: `DATABASE_URL=postgresql+asyncpg://<user>:<pass>@db:5432/ai_db` (xem `docker-compose.yml`), `AI_DB_NAME` (mặc định `ai_db`, khai báo trong `.env`).
- **Test**: `test_agent_store.py`/`test_conversation_store.py` chạy trên SQLite in-memory (`aiosqlite`), không cần Postgres thật để test đơn vị.

## Vector store / RAG (pgvector)

Từ Phase A, `search_books` và `faq_retrieval.find_relevant()` (dùng bởi `/chat` và `/assistant`)
không còn tự cache embedding ra file JSON (`.book_index_cache.json`/`.faq_embeddings_cache.json`,
`faq_data.py` — đã xoá) — cả hai đọc/ghi qua pgvector trong `ai_db`, cùng DB Postgres của service
(xem mục Database ở trên).

- **Hai corpus** (cột `corpus` trong `ai_documents`/`ai_document_chunks`, hằng số
  `vector_store.CORPUS_BOOK`/`vector_store.CORPUS_DOC`):
  - `BOOK_METADATA` — mỗi document là một cuốn sách (`source_id` = book id thật từ
    `inventory-service`), nội dung là `book_index.book_text()` (title/author/category/
    description/summary_vi — cố ý không gồm ISBN, xem phần "Hybrid book search" ở trên).
  - `INTERNAL_DOC` — mỗi document là một file Markdown trong `services/ai-service/corpus/`
    (`source_id` = tên file không có đuôi `.md`, dòng đầu tiên là câu hỏi/heading, phần còn lại
    là nội dung trả lời).
- **Bảng** (`schema.sql`):
  - `ai_documents(id, corpus, source_id, title, content, content_hash, metadata, updated_at)`
    — `UNIQUE (corpus, source_id)`, một document logic (một sách hoặc một file corpus).
  - `ai_document_chunks(id, document_id, corpus, chunk_index, content, content_hash, embedding
    vector(768), embedding_model, tsv, created_at)` — mỗi chunk có vector embedding riêng (HNSW
    index, `vector_cosine_ops`) và một cột `tsv` (full-text, GIN index) cho keyword search. Mọi
    truy vấn semantic đều lọc thêm `embedding_model = <model đang cấu hình>` (AD-3: đổi model thì
    vector cũ không lẫn vào kết quả mới cho tới khi ingest lại).
- **Ingestion** (`ingestion.py`, incremental theo `content_hash` từng chunk — hash gồm cả nội dung
  VÀ embedding identity (`embeddings.EMBED_IDENTITY` = model + dimensions), nên nội dung không đổi
  thì không gọi lại OpenRouter, nhưng đổi model/dimensions thì mọi chunk bị coi là "đã đổi" và được
  embed lại):
  - `ingestion.ingest_internal_docs()` — đọc toàn bộ `services/ai-service/corpus/*.md`, chạy tự
    động ở mỗi lần khởi động service (`main.py`'s `_startup_ingest_corpus`, không phụ thuộc auth,
    không chặn startup).
  - `ingestion.ingest_books(books)` — nhận list book dict (shape của `/api/books`) và ingest vào
    `BOOK_METADATA`. **Không tự chạy được lúc khởi động** — `_startup_ingest_corpus` gọi
    `/api/books` không kèm token, bị gateway trả 401 nên no-op im lặng (theo dõi ở follow-up
    `task_5448fb5f`). Cách chạy thủ công với JWT thật:
    ```bash
    docker compose -p smartbook-system exec ai-service python -c "
    import asyncio, httpx, ingestion
    async def main():
        token = '<JWT tu POST /auth/login>'
        async with httpx.AsyncClient() as c:
            books = (await c.get('http://api-gateway:3000/api/books',
                headers={'Authorization': f'Bearer {token}'})).json()
        print(await ingestion.ingest_books(books))
    asyncio.run(main())
    "
    ```
  - Kiểm tra số chunk theo corpus: `docker compose -p smartbook-system exec db psql -U <user> -d
    ai_db -c "SELECT corpus, count(*) FROM ai_document_chunks GROUP BY corpus;"`.
- **Biến môi trường mới**: xem `INGEST_MAX_CHUNK_CHARS`, `ENABLE_CORPUS_INGEST` trong bảng dưới.

### Embedding Provider: OpenRouter only

Embedding cho semantic FAQ + book search (`faq_retrieval.find_relevant()` và `search_books` tool trong `/assistant`) dùng đúng một provider — OpenRouter (`OPENROUTER_EMBED_MODEL=qwen/qwen3-embedding-8b`). Không còn Ollama, không còn circuit breaker giữa hai provider (không có gì để chuyển đổi nữa). `embed_batch()`/`embed_text()` không bao giờ raise: lỗi (timeout, HTTP error, dimension/count mismatch) trả về `None`, caller tự degrade xuống keyword-only search.

**`OPENROUTER_API_KEY` rỗng = mọi embedding call trả `None` ngay**: `OpenRouterEmbedder` dừng trước khi gửi request nào, không để nội dung truy vấn/tài liệu rời máy khi chưa cấu hình key.

**Quan trọng: `dimensions:768` là bắt buộc** — `ai_document_chunks.embedding` được định nghĩa cố định là `vector(768)` trong schema (xem `schema.sql`). Model `qwen/qwen3-embedding-8b` mặc định trả embedding 4096 chiều, nên **luôn gửi `dimensions: 768`** trong request (`OPENROUTER_EMBED_DIMENSIONS`) để model trả 768 chiều trực tiếp.

**Embedding identity = model + dimensions** (`embeddings.EMBED_IDENTITY`, ví dụ `qwen/qwen3-embedding-8b@768`) — được lưu vào cột `embedding_model` của mỗi chunk VÀ gấp vào `content_hash` (xem `ingestion.chunk_hash`). Đổi `OPENROUTER_EMBED_MODEL`/`OPENROUTER_EMBED_DIMENSIONS` khiến mọi chunk bị coi là "đã đổi" nên được embed lại tự động; `VectorStore.delete_chunks_except_model()` (gọi lúc khởi động và bởi `reindex_embeddings.py`) còn dọn cả những vector của model cũ thuộc tài liệu không được ingest lại (không còn trong `corpus/` hoặc `/api/books`) — xem "Migration embedding model" bên dưới.

**Debug**: khi provider lỗi, xem log từ `embeddings.py` (dòng `embed_call model=... error=...`) để biết nguyên nhân (timeout, HTTP error, dimension mismatch...).

### Migration embedding model (vd đổi từ nomic-embed-text sang qwen3-embedding-8b)

Vector cũ của một model khác **không dùng lại được** — nó nằm trong một không gian vector khác, so sánh cosine với nó là vô nghĩa. Cách re-index toàn bộ:

```bash
cd services/ai-service
REINDEX_AUTH_TOKEN=<JWT của ADMIN/WAREHOUSE_MANAGER, từ POST /auth/login> python reindex_embeddings.py
```

Script này: (1) xoá mọi chunk không mang `embedding_model` hiện tại (`delete_chunks_except_model`), (2) `ingest_internal_docs()`, (3) `ingest_books()` qua `/api/books` (cần token vì endpoint đó có auth — startup ingest không có token, xem ghi chú `task_5448fb5f` ở trên). Không có token, script chỉ re-index corpus `INTERNAL_DOC` và in cảnh báo bỏ qua `BOOK_METADATA`. Kiểm tra kết quả: `SELECT embedding_model, count(*) FROM ai_document_chunks GROUP BY 1;` — chỉ nên còn đúng một giá trị.

### Upgrade notes: đổi image Postgres sang `pgvector/pgvector:pg15`

Phase A đổi image của service `db` trong `docker-compose.yml` từ `postgres:15-alpine` sang
`pgvector/pgvector:pg15` để có extension `vector`. Hai image này **khác thư viện C**: Alpine dùng
musl, `pgvector/pgvector:pg15` dựa trên Debian nên dùng glibc. Collation của kiểu `text` do thư
viện C cung cấp, nên đổi provider bên dưới một **data directory đã tồn tại** có thể làm các btree
index phụ thuộc collation (và các unique constraint dựa trên chúng) lệch âm thầm: index tưởng là
sorted theo thứ tự cũ trong khi Postgres mới so sánh theo thứ tự mới → lookup trượt, unique
constraint không còn chặn được trùng. Volume `postgres_data` ở đây dùng chung cho cả bốn database
`inventory_db`, `auth_db`, `borrow_db`, `ai_db`, và cả bốn đều có unique constraint trên cột text
(email, ISBN, slug…), nên rủi ro không chỉ nằm ở `ai_db`.

Khi nâng cấp một deployment **đã có dữ liệu**, sau khi đổi image phải reindex từng database:

```bash
for db_name in inventory_db auth_db borrow_db ai_db; do
  docker compose -p smartbook-system exec db psql -U <user> -d "$db_name" -c "REINDEX DATABASE $db_name;"
done
```

Nếu chấp nhận mất dữ liệu (môi trường dev, seed lại được), cách thay thế là dựng mới hoàn toàn:
`docker compose -p smartbook-system down -v` rồi `up -d` và seed lại. Deployment mới tinh (volume
chưa từng được `postgres:15-alpine` khởi tạo) không bị ảnh hưởng và không cần làm gì.

### Kết quả eval RAG: baseline (trước Phase A) so với sau Phase A

Đo bằng `eval/eval_rag.py` trên cùng bộ 100 câu (`eval/rag_dataset.json`, 60 `BOOK_METADATA` + 40
`INTERNAL_DOC`) chạy thẳng vào tầng retrieval (`assistant_tools.search_books`/
`faq_retrieval.find_relevant`), không qua HTTP. Baseline đo trước khi đổi sang pgvector
(`eval/reports/rag_baseline_20260916_072855.md`); "sau Phase A" đo sau khi 10 task hoàn tất
(`eval/reports/rag_after_20260917_025751.md`); "sau fix wave" đo lại sau đợt sửa của review cuối
nhánh (`eval/reports/rag_final_fixes_20260917_061603.md`).

| Metric | Baseline (trước) | Sau Phase A | Sau fix wave | Chênh lệch vs baseline |
|---|---|---|---|---|
| Recall@1 | 0.5136 | 0.5736 | 0.5836 | +0.0700 |
| Recall@3 | 0.6331 | 0.7147 | 0.7247 | +0.0916 |
| Recall@5 | 0.7086 | 0.7267 | 0.7367 | +0.0281 |
| MRR | 0.601 | 0.6667 | 0.6767 | +0.0757 |
| Case không đáp án trả đúng rỗng | 1/10 | 2/10 | 2/10 | +1 |

**Tiêu chí chấp nhận (Recall@5 không thấp hơn baseline): ĐẠT** — 0.7367 ≥ 0.7086.

Theo corpus (sau fix wave): `BOOK_METADATA` (60 case) R@1 0.5394, R@3 0.6912, R@5 0.7111, MRR
0.6611 (không đổi so với "sau Phase A" — đợt sửa không chạm vào thứ tự xếp hạng phía sách);
`INTERNAL_DOC` (40 case) R@1 0.65, R@3 0.775, R@5 0.775, MRR 0.7 (mỗi chỉ số +0.025 = đúng 1
case, `doc-001`, hồi phục nhờ fix engine-per-call của `faq_retrieval`).

Lần đo đầu tiên sau khi hoàn tất Task 7–9 (trước khi phát hiện và sửa bug bên dưới) cho Recall@5
0.6167 — **thấp hơn** baseline. Điều tra "Case truot" cho thấy gần như toàn bộ phần giảm đến từ
11/15 case ISBN (`bm-001`…`bm-015`, dạng câu hỏi thật "Tìm sách ISBN `<isbn>`", không phải ISBN
trần): short-circuit ISBN mới thêm ở Task 8 so khớp CHÍNH XÁC TOÀN BỘ chuỗi câu hỏi đã chuẩn hoá
với ISBN sách, nên không khớp khi ISBN chỉ là một phần của câu — trong khi cơ chế keyword cũ (bị
thay thế) từng chấm điểm theo từng token nên vẫn khớp được. Đã sửa: so khớp ISBN sách như một
SUBSTRING của câu hỏi đã chuẩn hoá (thay vì bằng tuyệt đối cả chuỗi), có ngưỡng độ dài tối thiểu để
tránh false-positive từ ISBN rỗng/quá ngắn — xem `assistant_tools._score_and_rank_books`,
`test_book_index.py::test_isbn_match_inside_natural_language_sentence`. Sau khi sửa, Recall@5 tăng
lên 0.7267 như bảng trên. Các case tụt hạng còn lại sau khi sửa (`bm-023`, `bm-040`, `doc-001`) là
case ngữ nghĩa khó (diễn đạt lại không trùng từ khoá, một fact đơn lẻ) — không lệch hệ thống, và số
case cải thiện nhờ pgvector (`bm-038`, `doc-005`, `doc-014`, `doc-021`) nhiều hơn số case tụt mới.

### Kết quả eval RAG sau migration OpenRouter/Qwen — trước và sau Abstention Detection

Migration bỏ Ollama, chuyển embedding sang `qwen/qwen3-embedding-8b@768` (commit `9501b6f`) đồng thời
hạ `FAQ_MATCH_THRESHOLD`/`BOOK_SEMANTIC_THRESHOLD` từ 0.75/0.6 xuống 0.3 (phổ điểm cosine của Qwen3
thấp/phẳng hơn nomic). Đo trên 100 case gốc (`eval/reports/rag_20260925_041036.md`):

| Metric | Giá trị |
|---|---|
| Recall@1 / @3 / @5 | 0.7736 / 0.805 / 0.8264 |
| MRR | 0.8225 |
| BOOK_METADATA (60 case) R@1/@3/@5, MRR | 0.7394 / 0.775 / 0.8106, 0.8125 |
| INTERNAL_DOC (40 case) R@1/@3/@5, MRR | 0.825 / 0.85 / 0.85, 0.8375 |
| Case không đáp án trả đúng rỗng | **0/10** |

Recall tăng mạnh so với baseline trước migration, nhưng no-answer đúng rỗng giảm xuống 0/10 — hệ
thống gần như luôn trả "kết quả gần nhất tình cũ" ngay cả khi corpus không có đáp án. Đây là lý do
`retrieval_confidence.py` (mục trên) được thêm vào **sau** RRF thay vì tăng threshold trở lại (tăng
threshold sẽ mất lại phần lớn recall vừa đạt được — xem comment trong `faq_retrieval.py`).

Dataset eval được mở rộng từ 10 lên 40 case "không đáp án" (`bm-061`..`bm-075`, `doc-041`..`doc-055`
trong `eval/rag_dataset.json`) để đo abstention có ý nghĩa thống kê hơn — tổng 130 case (75
`BOOK_METADATA`, 55 `INTERNAL_DOC`). Chạy trực tiếp trên stack Docker thật (`docker compose --profile
ai up -d`, Postgres + OPENROUTER_API_KEY thật) ngày 2026-09-25:

**Bước 1 — `eval/eval_rag.py --abstention off --dump-signals`** (tái lập hành vi trước khi có
`retrieval_confidence.py`, dùng để calibrate — `eval/reports/rag_20260925_081134.md`):

| Metric | Giá trị |
|---|---|
| No-answer Accuracy (theo quyết định NO_EVIDENCE, chưa ẩn kết quả) | **40/40 = 1.0**, FPR 0.0 |
| Answerable Recall@1/3/5 | 0.8707 / 0.9167 / 0.9293 |

Ngay cả với threshold TẠM/chưa hiệu chỉnh, quyết định NO_EVIDENCE đã đúng 100% trên toàn bộ 40 case
không đáp án (cả hai corpus) — xác nhận thiết kế (hard rule ISBN/title exact + semantic đã chuẩn hoá
theo corpus + đồng thuận keyword) hoạt động đúng hướng ngay từ đầu.

**Bước 2 — `eval/calibrate_rag.py`** trên bộ tín hiệu ở bước 1: `INTERNAL_DOC` không có đánh đổi nào
trong `tau_evidence ∈ [0.15, 0.40]` (Answerable Recall@5 = 1.0 suốt dải, No-answer Accuracy đạt 1.0
tại 0.35) — giữ nguyên `tau_evidence=0.35`. `BOOK_METADATA` có đánh đổi thật (câu hỏi kiểu "Tác phẩm
nào của tác giả X?" có tín hiệu semantic yếu, khó phân biệt với câu hỏi không đáp án):

| tau_evidence (BOOK) | Answerable R@5 | No-answer Accuracy | FPR |
|---|---|---|---|
| 0.25 | 0.830 (−0.054 so baseline 0.884) | 15/20 = 0.75 | 0.25 |
| 0.30 | 0.798 (−0.086) | 19/20 = 0.95 | 0.05 |
| 0.35 (ban đầu) | 0.753 (−0.132) | 20/20 = 1.0 | 0.0 |

Theo nguyên tắc "không được làm Recall@5 tụt mạnh chỉ để tăng no-answer" (Chức năng 1.8), chọn
**`BOOK_CONF_TAU_EVIDENCE=0.25`** (đánh đổi recall nhỏ nhất trong các mức có cải thiện no-answer rõ
rệt) thay vì 0.35. Xem rationale đầy đủ trong comment của `retrieval_confidence._BOOK_DEFAULTS` và
`eval/reports/calibration_20260925_082519.md`.

**Bước 3 — `eval/eval_rag.py`** (mặc định, `--abstention on`, ngưỡng đã hiệu chỉnh —
`eval/reports/rag_20260925_083313.md`):

| Metric | Giá trị |
|---|---|
| Answerable Recall@1/3/5 | 0.8373 / 0.8722 / **0.8849** |
| Selective Accuracy@1 (trên case hệ thống chọn trả lời) | 0.8373 |
| No-answer Accuracy tổng | **35/40 = 0.875** (FPR 0.125) |
| No-answer Accuracy `BOOK_METADATA` | 15/20 = 0.75 (FPR 0.25) |
| No-answer Accuracy `INTERNAL_DOC` | 20/20 = 1.0 (FPR 0.0) |

So với baseline trước khi có abstention (Answerable Recall@5 kết hợp ước tính 0.918, No-answer
Accuracy 0/10 = 0%): Recall giảm nhẹ (−0.033, trong "tolerance nhỏ") đổi lấy No-answer Accuracy tăng
từ 0% lên 87.5%. Chạy live gặp 2-3 lượt `ReadTimeout`/`ConnectTimeout` từ OpenRouter (mạng, không
phải lỗi code) — các câu hỏi đó tự động rơi về keyword-only, tạo thêm nhiễu nhỏ cho số liệu; xem
`eval/README.md` để chạy lại và tái xác nhận trên môi trường ổn định hơn.

### Eval Metadata Evidence Fusion (offline, fixture-based)

`eval/metadata_fusion/run_eval.py` (18 case tổng hợp — không nối mạng, không cần Postgres — xem
`eval/metadata_fusion/dataset.json`) so sánh `ISBN_FUSION_MODE=prior` (thuật toán cũ) với
`evidence` (Evidence Fusion mới) trên cùng bộ evidence giả lập:

| Metric | `prior` | `evidence` |
|---|---|---|
| Field Accuracy / Precision / Recall | 1.0 / 1.0 / 1.0 | 1.0 / 1.0 / 1.0 |
| Coverage | 1.0 | 1.0 |
| Missing-field Detection Accuracy | 1.0 | 1.0 |
| Conflict Detection Accuracy (case-level) | **0.667** (12/18) | **1.0** (18/18) |
| Conflict Detection Precision/Recall (field-level) | 0.333 / 1.0 | 1.0 / 1.0 |

6/18 case bị `prior` báo `CONFLICTED` sai (publisher/author/pageCount/description/category/date chỉ
khác cách viết, không khác giá trị thật) — normalize trước khi so sánh (Chức năng 2.5) sửa toàn bộ
6 case này mà không đổi Field Accuracy/Coverage. Xem `eval/reports/metadata_fusion_*.md` mới nhất.

## Biến môi trường đặc thù

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| OPENROUTER_API_KEY | rỗng | Bắt buộc — không có key thì mọi tính năng AI (text/tool-calling/vision/embedding) đều lỗi/degrade. Không hard-code — lấy từ env/secret, không log, không gửi xuống frontend |
| OPENROUTER_BASE_URL | https://openrouter.ai/api/v1 | Base URL OpenRouter (OpenAI-compatible) |
| OPENROUTER_TEXT_MODEL | qwen/qwen3.7-flash | Model cho tóm tắt/chat/NLU qua OpenRouter (xác thực trực tiếp trên JSON thô của `/api/v1/models` ngày 2026-09-15 — hỗ trợ `tools`/`tool_choice`/`response_format`, context 1M; canonical_slug nội bộ của OpenRouter là `qwen/qwen3.7-flash-20260727`) |
| OPENROUTER_ASSISTANT_MODEL | qwen/qwen3.7-flash | Model cho `/assistant` (tool-calling) qua OpenRouter — cùng model như trên |
| OPENROUTER_VISION_MODEL | qwen/qwen3.7-flash | Model vision/OCR cho cover search, xác minh ảnh đóng gói, quét hóa đơn |
| OPENROUTER_FALLBACK_MODEL | rỗng | Model dự phòng (cùng OpenRouter key), thử lại 1 lần nếu model chính lỗi. Rỗng = tắt. Phải là model OpenRouter — không có fallback provider khác |
| ASSISTANT_TOOL_CONTEXT_CHARS | 2000 | Số ký tự tối đa một tool result đóng góp vào prompt `/assistant` |
| OPENROUTER_EMBED_MODEL | qwen/qwen3-embedding-8b | Model embedding cho semantic FAQ + book search |
| OPENROUTER_EMBED_DIMENSIONS | 768 | Số chiều gửi kèm trong request OpenRouter để khớp cột `vector(768)` trong `ai_document_chunks` — model này mặc định trả 4096 chiều, không được bỏ |
| OPENROUTER_EMBED_TIMEOUT_SECONDS | 30 | Timeout tối đa cho một lần gọi embedding; quá hạn thì coi như không có tín hiệu ngữ nghĩa |
| FAQ_MATCH_THRESHOLD | 0.3 | Ngưỡng cosine similarity tối thiểu để nhánh semantic của một mục FAQ được đưa vào RRF (hạ từ 0.75 sau khi đổi sang qwen/qwen3-embedding-8b — phổ điểm cosine của Qwen3 thấp/phẳng hơn nomic hẳn, xem comment trong `faq_retrieval.py`). Đây KHÔNG còn là ngưỡng quyết định "có trả lời hay không" — quyết định đó nay do `retrieval_confidence.py` đảm nhiệm (xem mục Abstention bên dưới), threshold này chỉ còn là sàn candidate trước RRF |
| FAQ_TOP_K | 3 | Số mục FAQ tối đa đưa vào context mỗi lượt hỏi |
| BOOK_SEMANTIC_THRESHOLD | 0.3 | Ngưỡng cosine tối thiểu để nhánh semantic của một cuốn sách được đưa vào RRF trong `search_books` (hạ từ 0.6, cùng lý do). Cũng chỉ còn là sàn candidate — xem `retrieval_confidence.py` |
| RAG_ABSTENTION_ENABLED | true | Tắt để `find_relevant()` không còn ẩn kết quả khi `retrieval_confidence.py` trả `NO_EVIDENCE` (dùng để tái lập baseline trong `eval/eval_rag.py --abstention off`) |
| BOOK_CONF_TAU_CONFIDENT / BOOK_CONF_TAU_EVIDENCE / BOOK_CONF_COS_FLOOR / BOOK_CONF_COS_CEIL | 0.66 / **0.25** / 0.30 / 0.60 | Ngưỡng quyết định CONFIDENT_MATCH/UNCERTAIN/NO_EVIDENCE cho corpus `BOOK_METADATA`. `tau_evidence=0.25` là kết quả calibration thật (`eval/calibrate_rag.py`, xem mục eval RAG bên trên) — đã đánh đổi có chủ đích để không làm Recall@5 tụt mạnh |
| DOC_CONF_TAU_CONFIDENT / DOC_CONF_TAU_EVIDENCE / DOC_CONF_COS_FLOOR / DOC_CONF_COS_CEIL | 0.66 / 0.35 / 0.30 / 0.55 | Như trên, cho corpus `INTERNAL_DOC` |
| ISBN_FUSION_MODE | evidence | `evidence` (mặc định): chọn giá trị field bằng Evidence Fusion (`isbn_fusion.py`) — chuẩn hoá + gộp nhóm nguồn đồng thuận trước khi chọn. `prior`: thuật toán cũ (nguồn có reliability cao nhất thắng tuyệt đối), giữ lại để so sánh/rollback |
| PACKING_VISION_MAX_TOKENS / PACKING_VISION_TIMEOUT_SECONDS | 200 / 15 | Cap output/timeout cho `/verify-packing-photo` — timeout thấp hơn `AbortSignal.timeout(20000)` của caller (`packing-evidence-ai.service.js`) |
| RECEIPT_VISION_MAX_TOKENS / RECEIPT_VISION_TIMEOUT_SECONDS | 1200 / 30 | Cap output/timeout cho `/scan-receipt` |
| INGEST_MAX_CHUNK_CHARS | 1200 | Độ dài tối đa (ký tự) mỗi chunk khi `ingestion.py` cắt nội dung document trước khi embed |
| ENABLE_CORPUS_INGEST | true | Bật/tắt đồng bộ vector store nền lúc khởi động (`ingest_internal_docs`/`ingest_books`) — tắt trong môi trường test e2e không cần semantic |
| GOOGLE_BOOKS_API_BASE_URL | https://www.googleapis.com/books/v1/volumes | Nguồn metadata chính |
| OPEN_LIBRARY_API_BASE_URL | https://openlibrary.org/api/books | Nguồn metadata bổ sung |
| GOOGLE_BOOKS_API_KEY | rỗng | API key tùy chọn |
| ENABLE_WORLDCAT_LOOKUP | false | Bật/tắt tra cứu WorldCat |
| ENABLE_MARKETPLACE_LOOKUP | false | Bật tra cứu Fahasa/Tiki/Vinabook |
| BOOK_MARKETPLACE_TIMEOUT_SECONDS | 20 | Timeout (giây) cho từng marketplace lookup |
| BOOK_LOOKUP_TIMEOUT_SECONDS | 15 | Timeout (giây) cho Google Books/Open Library/WorldCat |
| BOOK_LOOKUP_MAX_WEB_RESULTS | 5 | Số kết quả DuckDuckGo tối đa mỗi query |
| BOOK_LOOKUP_USER_AGENT | SmartBookBot/1.0 | User-Agent khi fetch trang nhà sách |
| ENABLE_FAHA_CLOAKBROWSER | false | Bật fallback CloakBrowser (headless Chromium) cho Fahasa khi httpx thất bại |
| BOOK_BROWSER_TIMEOUT_SECONDS | 20 | Timeout cho mỗi `page.goto()` trong CloakBrowser |
| FAHASA_BROWSER_HARD_TIMEOUT_SECONDS | 35 | Ngưỡng cứng cho toàn bộ 1 phiên CloakBrowser (chạy trong subprocess riêng, `fahasa_browser.py`, bị SIGKILL cả process group nếu vượt quá — cần thiết vì `page.goto()`'s timeout không chặn được `launch()` bị treo) |
| FAHASA_SEARCH_RESPONSE_WAIT_SECONDS | 8 | Thời gian tối đa poll response API tìm kiếm nội bộ của Fahasa sau khi trang bắt đầu tải |

**CloakBrowser binary cache:** lần `launch()` đầu tiên tải một bản Chromium đã vá (~217MB) từ `cloakbrowser.dev` về `/root/.cloakbrowser`. Thư mục này **phải** được mount volume persistent (xem `ai_service_cloakbrowser_cache` trong `docker-compose.yml`) — nếu không, container bị xoá/tạo lại sẽ làm mất cache và phải tải lại từ đầu mỗi lần, và vì tốc độ tải quan sát được chỉ ~30KB/s trong container, một lần tải có thể mất hàng chục phút đến hơn 1 giờ, khiến mọi lookup Fahasa timeout liên tục dù đã tăng timeout.

## Chạy nhanh

### Cách 1: Docker Compose

```bash
docker compose --profile ai up -d --build ai-service
```

### Cách 2: Chạy local

```bash
cd services/ai-service
pip install -r requirements.txt
python main.py
```

## Demo: Action Center + trí nhớ hội thoại + Evidence-first

1. Chạy Docker Compose đầy đủ (xem `RUN_WITH_DOCKER.md`), đăng nhập với tài khoản ADMIN hoặc WAREHOUSE_MANAGER, mở trang **Trợ lý AI**.
2. Tab "Hội thoại": hỏi "Sách nào cần nhập thêm gấp trong 30 ngày tới?" — câu trả lời hiển thị kèm 3 khối có thể mở/đóng: "Bằng chứng AI đã dùng", "Công cụ đã gọi", "Dữ liệu gốc"; nếu có `grounding_warning`/`retrieval_warnings` sẽ thấy banner cảnh báo màu vàng.
3. Hỏi tiếp "Tạo đề xuất nhập hàng cho các sách đó" — action card xuất hiện với trạng thái "Chờ xác nhận". Bấm **Xác nhận**.
4. Chuyển sang tab "Trung tâm hành động AI" — action vừa xác nhận xuất hiện với badge trạng thái/risk; bấm vào dòng để xem payload, kết quả, và lịch sử audit log (CREATED → CONFIRMED → EXECUTED).
5. Refresh trang — hội thoại vẫn còn (danh sách hội thoại nạp lại từ `GET /assistant/conversations`, tự động mở lại hội thoại đang hoạt động).
6. Mở lại hội thoại cũ trong sidebar, hỏi câu tiếp theo tham chiếu ngữ cảnh trước ("So với kết quả trên thì ưu tiên kho nào?") — trợ lý dùng 10 message gần nhất của hội thoại đó làm ngữ cảnh.

## Tích hợp với hệ thống

- Gateway định tuyến vào AI qua /ai và /api/ai.
- Frontend gọi qua VITE_AI_BASE_URL.
- Khi chạy Docker, chỉ cần `OPENROUTER_API_KEY` trong `.env` — không cần container/GPU nào khác cho AI.

## Tài liệu liên quan

- README root: ../../README.md
- Docker runbook: ../RUN_WITH_DOCKER.md
- Kiến trúc tổng quan: ../PROJECT_OVERVIEW.md
