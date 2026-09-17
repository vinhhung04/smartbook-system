# AI Service

## Mục tiêu

AI Service cung cấp năng lực tự động hóa nhập liệu sách bằng AI, tập trung vào OCR và chuẩn hóa metadata.

- Runtime: Python + FastAPI
- Entrypoint: services/ai-service/main.py
- Model runtime: OpenRouter (mặc định — text/tool-calling, xem `llm_provider.py`) + Ollama local
  (vision/OCR và embeddings — xem `LLM_PROVIDER`/`ASSISTANT_PROVIDER` bên dưới để chạy fully-offline
  bằng Ollama thay vì OpenRouter)
- Vai trò: tra cứu ISBN, tạo tóm tắt tiếng Việt, OCR hóa đơn nhập kho, trợ lý ra quyết định

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
| POST | /assistant | Trợ lý hỗ trợ ra quyết định (Ollama tool-calling qua Analytics Service) |
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
- Khi ENABLE_MARKETPLACE_LOOKUP=true, /lookup-book-by-isbn tra cứu thêm Fahasa, Tiki, Vinabook song song với Google Books và Open Library.
- Với mã quét EAN-13 không phải ISBN chuẩn, hệ thống thử marketplace lookup trước thay vì bỏ ngay; response có trường `reason` để frontend phân biệt.
- `/assistant` là chatbot hỗ trợ ra quyết định dành riêng cho ADMIN/WAREHOUSE_MANAGER (hoặc superuser) — role/permission khác (kể cả CUSTOMER) bị chặn 403. Request: `{ "message": "string", "conversation_id": "string (optional)" }`. Model dùng tool-calling thật qua `llm_provider.py` (mặc định OpenRouter/`OPENROUTER_ASSISTANT_MODEL`, chọn qua `ASSISTANT_PROVIDER` — có thể là `ollama`/`ASSISTANT_MODEL` để chạy fully-offline) để tự chọn gọi các endpoint `/analytics/*` (định nghĩa trong `assistant_tools.py`) thay vì hard-code theo intent như `/chat`. Response: `{ "answer", "tools_used": [{ "name", "arguments" }], "data": { "<tool_name>": <raw tool result> }, "conversation_id", "grounding_warning", "pending_action", "evidence": [{ "label", "tool_name", "metric", "value", "unit", "description" }], "retrieval_warnings": [] }`. `ASSISTANT_PROVIDER` chọn đúng 1 provider — không tự động fallback sang provider khác nếu provider đó lỗi.
- **Trí nhớ hội thoại**: `conversation_id` không còn chỉ được echo lại — nếu thiếu hoặc không tồn tại, service tạo một hội thoại mới (bảng `ai_conversations`) và trả về `conversation_id` thật; nếu đã tồn tại, service nạp tối đa 10 message gần nhất (bảng `ai_messages`) làm ngữ cảnh cho lượt hỏi tiếp theo. Mỗi lượt hỏi/trả lời được lưu lại (kèm tool_calls, tool_results, pending_action_id, grounding_warning) để có thể tải lại toàn bộ hội thoại sau khi refresh trang qua `GET /assistant/conversations/{id}`.
- **Hybrid FAQ retrieval cho `/chat`**: khi câu hỏi không khớp intent nào trong 11 intent cố định (`intent.py`), nó rơi vào `GENERAL_QUERY`. `retrieval.py` gọi `faq_retrieval.find_relevant()`, đọc từ corpus `INTERNAL_DOC` trong pgvector (xem mục "Vector store / RAG" bên dưới — không còn `faq_data.py`/file cache JSON) theo hai nhánh như `search_books`: semantic (cosine, phải vượt `FAQ_MATCH_THRESHOLD` mới được tính) và keyword (Postgres full-text bỏ dấu — bắt được câu hỏi gần trùng từng chữ với heading của FAQ mà vector một mình bỏ lỡ), hợp nhất bằng RRF (`fusion.py`), rồi trả về đúng envelope `{summary, raw, sources, warnings, retrieved_at}` như mọi intent khác — nên `verify_numeric_grounding()` và `ensure_source_line()` hoạt động không đổi. Ollama lỗi hoặc không match nào vượt ngưỡng → giữ nguyên hành vi fallback cũ, không bao giờ trả 500. `GENERAL_QUERY` nằm trong `intent.ANALYTICS_BLOCK_EXEMPT_INTENTS` nên CUSTOMER/SUPPLIER cũng dùng được — đây chính là nhóm hay hỏi về chính sách mượn/trả và phí phạt nhất.
- **Hybrid book search**: tool `search_books` của `/assistant` truy vấn corpus `BOOK_METADATA` trong pgvector theo hai tín hiệu — semantic (cosine similarity trên embedding của `title + author + category + description + summary_vi`, `book_index.py`) và keyword (Postgres full-text, bỏ dấu bằng `unaccent`) — rồi hợp nhất bằng Reciprocal Rank Fusion (`fusion.py`, không còn trung bình cộng hai thang điểm khác bản chất). Riêng ISBN được xử lý TRƯỚC RRF bằng một short-circuit khớp chính xác (so khớp isbn đã chuẩn hoá — bỏ dấu gạch ngang/khoảng trắng — dưới dạng SUBSTRING của câu hỏi đã chuẩn hoá, không đòi hỏi câu hỏi chỉ gồm mỗi ISBN) vì ISBN cố ý không nằm trong nội dung embed/tsv (một mã định danh có cấu trúc, không phải ngôn ngữ tự nhiên). Ollama lỗi → chỉ còn tín hiệu keyword, đúng tinh thần hành vi trước đây (degrade, không lỗi).
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
- **Ingestion** (`ingestion.py`, incremental theo `content_hash` từng chunk — nội dung không đổi
  thì không gọi lại Ollama):
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

## Biến môi trường đặc thù

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| LLM_PROVIDER | openrouter | Provider cho `/chat`, tóm tắt/ISBN-enrichment, giải thích gợi ý lưu kho, nightly briefing: `openrouter` \| `ollama` |
| OPENROUTER_API_KEY | rỗng | Bắt buộc nếu `LLM_PROVIDER`/`ASSISTANT_PROVIDER=openrouter`. Không hard-code — lấy từ env/secret |
| OPENROUTER_BASE_URL | https://openrouter.ai/api/v1 | Base URL OpenRouter (OpenAI-compatible) |
| OPENROUTER_TEXT_MODEL | qwen/qwen3.7-flash | Model cho tóm tắt/chat/NLU qua OpenRouter (xác thực trực tiếp trên JSON thô của `/api/v1/models` ngày 2026-09-15 — hỗ trợ `tools`/`tool_choice`, context 1M; canonical_slug nội bộ của OpenRouter là `qwen/qwen3.7-flash-20260727`) |
| OPENROUTER_ASSISTANT_MODEL | qwen/qwen3.7-flash | Model cho `/assistant` (tool-calling) qua OpenRouter — cùng model như trên |
| OPENROUTER_FALLBACK_MODEL | rỗng | Model dự phòng (cùng OpenRouter key), thử lại 1 lần nếu model chính lỗi. Rỗng = tắt |
| NLU_PROVIDER | rỗng (dùng `LLM_PROVIDER`) | Provider cho phân loại intent (`nlu.py`) |
| ASSISTANT_PROVIDER | openrouter | Provider cho vòng lặp tool-calling của `/assistant`: `openrouter` \| `ollama` |
| OLLAMA_HOST | http://ollama:11434 | Địa chỉ Ollama trong Docker network — vẫn cần cho vision/OCR + embeddings, và khi chọn provider `ollama` |
| OLLAMA_MODEL | llava | Model xử lý ảnh (OCR hóa đơn, xác minh ảnh đóng gói) — luôn qua Ollama, không đổi bởi `LLM_PROVIDER` |
| SUMMARY_MODEL | llama3.1:8b-instruct-q4_0 | Model Ollama dùng khi `LLM_PROVIDER=ollama` (tóm tắt văn bản / `/chat`) |
| ASSISTANT_MODEL | llama3.1:8b-instruct-q4_0 | Model Ollama dùng khi `ASSISTANT_PROVIDER=ollama` (cần hỗ trợ Ollama tool-calling) |
| FAQ_EMBED_MODEL | nomic-embed-text | Model embedding (luôn qua Ollama) cho semantic FAQ + book search (cần `ollama pull nomic-embed-text`) |
| FAQ_MATCH_THRESHOLD | 0.75 | Ngưỡng cosine similarity tối thiểu để coi một mục FAQ là khớp |
| FAQ_TOP_K | 3 | Số mục FAQ tối đa đưa vào context mỗi lượt hỏi |
| BOOK_SEMANTIC_THRESHOLD | 0.6 | Ngưỡng cosine tối thiểu để một cuốn sách được coi là khớp ngữ nghĩa trong `search_books` |
| EMBED_TIMEOUT_SECONDS | 30 | Timeout tối đa cho một lần gọi embedding; quá hạn thì coi như không có tín hiệu ngữ nghĩa |
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
docker compose up -d --build ai-service ollama
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
- Khi chạy Docker, cần đảm bảo OLLAMA_HOST trỏ tới http://ollama:11434.

## Tài liệu liên quan

- README root: ../../README.md
- Docker runbook: ../RUN_WITH_DOCKER.md
- Kiến trúc tổng quan: ../PROJECT_OVERVIEW.md
