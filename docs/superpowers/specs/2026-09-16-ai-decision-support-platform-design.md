# Thiết kế: SmartBook AI Decision Support Platform — lấp 4 gap thật

**Ngày:** 2026-09-16
**Trạng thái:** Chờ review
**Branch:** `hungg`
**Thay thế một phần:** `2026-08-28-chatbot-faq-semantic-retrieval-design.md` (spec đó kết luận "không xây vector DB — quy mô dữ liệu vài chục đến ~100 mục không cần"; kết luận đó đúng tại thời điểm chỉ có FAQ tĩnh, nhưng không còn đúng khi corpus mở rộng sang toàn bộ catalog sách + tài liệu nội bộ, và khi `book_index.py` đã phải dựng index riêng bằng file JSON. Xem mục "Quan hệ với spec cũ".)

---

## 1. Bối cảnh

### 1.1. Xuất phát điểm

Yêu cầu ban đầu (`Claude AI Development Roadmap Prompt.md`) đề xuất 7 phase nâng cấp SmartBook từ "chatbot đơn giản" thành "AI Decision Support Library Platform". Sau khi đọc source code, giả định nền của roadmap đó **không đúng với thực tế**: phần lớn Phase 1–4 đã được implement.

### 1.2. AI Capability Matrix — trạng thái thực tế

| Capability | Roadmap đánh giá | Thực tế trong code |
|---|---|---|
| AI Chat + streaming | Existing | Có. `/chat`, `/chat/stream`, `/assistant`, `/assistant/stream` (SSE) |
| Tool Calling | "Cần phát triển" | **Đã có.** 11 tool native function-calling — `assistant_tools.py:248` (`TOOL_FUNCTIONS`, `ANALYTICS_TOOLS`) |
| Agent layer | "Cần phát triển" | **Đã có.** `agent_planner.py` (946 LOC), `agent_executor.py`, `agent_permissions.py`, `agent_store.py` |
| Human-in-the-loop writes | Phase 1 yêu cầu | **Đã có.** 5 action type, state machine `PENDING_CONFIRMATION → CONFIRMED → EXECUTED / FAILED / CANCELLED / EXPIRED`, TTL, risk LOW/MEDIUM/HIGH |
| AI không truy cập DB trực tiếp | Yêu cầu cốt lõi | **Đã đúng.** Mọi tool đi qua `api-gateway` bằng HTTP + forward JWT (`assistant_tools.py:_get`) |
| Decision Support | "Missing" | **Đã có phần lớn.** `reorder-suggestions`, `weeding-suggestions`, `aging-inventory`, `late-return-risk`, `forecast-accuracy`, `reservation-no-show-risk` + `logistic-regression.js`, `budget-allocation.js`, `risk-model.js`, `forecast.js` |
| Insight Generator (scheduled) | Phase 2 | **Đã có.** `nightly_briefing.py` — cron loop, đọc 6 analytics section, sinh `CREATE_REPORT_DRAFT` |
| ISBN pipeline + human review | Phase 3 | **Đã có.** `/isbn-intelligence`, `/enrich-book-after-isbn` + `metadata-reconciliations` per-field ACCEPT/REJECT + authority normalization |
| Vision / OCR | Phase 3 | **Đã có.** `/verify-packing-photo`, `/scan-receipt`, `cover_embeddings.py`, `routes_cover_search.py` |
| Recommendation hybrid | Phase 4 | **Đã có.** `recommendation.py` — semantic .40 + affinity .35 + quality .15 + availability .10, Bayesian shrink; LLM chỉ viết lý do, không chấm điểm |
| Evaluation harness | Phase 6 | **Một phần.** `eval/` + `scoring.py` có sẵn, nhưng dataset chỉ 30 / 34 / 25 case; **không có RAG eval, không đo hallucination rate** |
| Hybrid search | Phase 5 | **Một phần.** keyword + semantic threshold 0.6 trong `book_index.py`; **không có rerank** |
| **Vector Database** | Phase 5 | **KHÔNG CÓ.** Vector nằm trong file JSON trên đĩa (`.book_index_cache.json`, `.faq_embeddings_cache.json`), cosine tính trong RAM |
| **Document RAG** | Phase 5 | **KHÔNG CÓ.** "RAG" hiện tại là *structured RAG* — JSON từ API làm context (`rag.py::build_rag_context`) — cộng FAQ tĩnh hardcode 11 entry trong `faq_data.py` |

### 1.3. Technical debt

1. **`main.py` 4882 LOC / 24 endpoint** — god file. Đã bắt đầu tách (`routes_actions.py`, `routes_conversations.py`, `routes_cover_search.py`) nhưng chưa xong.
2. **Vector store là file JSON** — không share giữa replica; catalog đổi một quyển thì content-hash lệch và **rebuild toàn bộ index**; không có ANN, cosine tuyến tính trên toàn bộ vector trong RAM.
3. **Embedding hard-depend Ollama** — `embeddings.py` chỉ gọi `ollama.Client`. Text LLM đã migrate sang OpenRouter/Qwen (commit `1aa2413`, `3f0df6b`), embedding thì chưa. "Hybrid architecture" mới xong một nửa.
4. **Decision Support không có UI** — API và nightly briefing đầy đủ; `apps/web` chỉ có `ai-action-center.tsx` (duyệt pending action). **Không có trang AI Library Insight.**

### 1.4. Phạm vi spec này

Lấp đúng 4 gap trên. **Ngoài phạm vi:** xây lại tool calling, agent planner, ISBN pipeline, recommendation engine, vision/OCR — tất cả đã hoạt động và spec này không chạm vào logic của chúng.

---

## 2. Quyết định kiến trúc

### AD-1: pgvector trong `ai_db`, không dùng vector DB riêng

**Chọn:** bật extension `vector` trên database `ai_db` đang có.

**Phương án đã cân nhắc:**

| | pgvector (chọn) | Qdrant container riêng | Giữ JSON + rerank |
|---|---|---|---|
| Hạ tầng mới | đổi image `postgres:15-alpine` → `pgvector/pgvector:pg15` | +1 container, +1 ops surface | không |
| Consistency | một nguồn sự thật; chunk và vector cùng transaction | dual-write Postgres↔Qdrant, tự lo sync và reconcile | rebuild toàn bộ khi catalog đổi |
| Hybrid search | cosine + full-text trong **cùng một câu SQL** | phải fuse ở tầng app | chỉ keyword + threshold |
| Quy mô cần | vài nghìn → vài trăm nghìn chunk | thiết kế cho hàng triệu | không scale |

**Lý do chọn pgvector, cụ thể với repo này:**
- `ai_db` đã tồn tại (`db-init/01-create-databases.sql`).
- `db.py::init_db()` đã có cơ chế apply `schema.sql` idempotent lúc startup.
- `db-init/02-create-extensions.sql` đã sẵn pattern `CREATE EXTENSION IF NOT EXISTS`.
- Corpus là metadata sách + tài liệu nội bộ (text ngắn, vài nghìn chunk). Qdrant giải bài toán quy mô mà hệ này không có, đổi lại bằng bài toán dual-write mà hệ này hiện không có.

**Đánh đổi chấp nhận:** pgvector HNSW chậm hơn Qdrant ở quy mô hàng triệu vector. Không liên quan ở quy mô hiện tại. Nếu sau này cần, `vector_store.py` (AD-2) là chỗ thay implementation mà không đụng call site.

### AD-2: `vector_store.py` theo protocol, có implementation in-memory cho test

**Ràng buộc:** test hiện chạy trên **SQLite in-memory** (`db.py:18`, `aiosqlite` + `StaticPool`). pgvector không tồn tại ở đó. Nếu retrieval gọi thẳng SQL pgvector thì toàn bộ test phải có Postgres thật.

**Chọn:** định nghĩa protocol `VectorStore` với hai implementation:
- `PgVectorStore` — production, SQL thật.
- `InMemoryVectorStore` — test, cosine tuyến tính trên dict.

Chọn implementation theo `DATABASE_URL` scheme, đúng pattern `db.py` đã dùng để chọn engine.

Đây cũng là convention sẵn có của service: `embeddings.py`, `book_index.py`, `faq_retrieval.py` đều "degrade gracefully, never raise".

### AD-3: `embedding_model` và `dim` là cột trong bảng, không phải config toàn cục

Đổi embedding model làm mọi vector cũ vô nghĩa (khác không gian vector, có thể khác chiều). Lưu model name + dim theo từng chunk cho phép:
- phát hiện chunk stale mà không cần xoá sạch bảng,
- reindex dần từng corpus,
- chạy song song hai model khi so sánh chất lượng trong Phase D.

Index HNSW tạo riêng cho mỗi (corpus, model) đang hoạt động.

### AD-4: LLM không sinh số trong insight

`/insights` (Phase C) lấy **toàn bộ số liệu** từ analytics endpoints đã có. LLM chỉ viết phần diễn giải ngôn ngữ tự nhiên. Đây là convention đã được thiết lập trong repo:
- `recommendation.py` — "LLM never picks the books and never assigns the score";
- `number_grounding.py` — kiểm tra mọi số trong câu trả lời có xuất hiện trong context không;
- `_build_isbn_intelligence` — confidence tính bằng code, không hỏi model.

Spec này giữ nguyên convention đó, không tạo ngoại lệ.

### AD-5: Giữ nguyên chữ ký public của retrieval

`assistant_tools.search_books()` và `faq_retrieval.find_relevant()` **giữ nguyên chữ ký và shape trả về**. Phase A thay ruột (JSON cache → pgvector), không đổi interface. Hệ quả: 11 tool trong `ANALYTICS_TOOLS`, `retrieval.py`, `/chat`, `/assistant` **không phải sửa gì**. Đáp ứng yêu cầu "không phá vỡ API hiện tại".

---

## 3. Phase A — Vector Store & Hybrid Retrieval

**Lấp gap:** vector DB + document RAG.

### A0. Đo baseline TRƯỚC khi đổi gì

Việc đầu tiên, trước mọi thay đổi code retrieval: dựng dataset RAG eval và chạy trên hệ thống **hiện tại**.

Lý do: không có baseline thì không chứng minh được pgvector + hybrid + rerank cải thiện được gì. Đây là số liệu quan trọng nhất để bảo vệ đồ án, và nó **chỉ đo được một lần** — sau khi đổi code thì baseline cũ không dựng lại được nữa.

Sản phẩm: `eval/rag_dataset.json` + `eval/eval_rag.py` + một report baseline trong `eval/reports/`.

### A1. Schema

Thêm vào `services/ai-service/schema.sql` (idempotent, apply lúc startup như hiện nay):

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS unaccent;   -- bỏ dấu tiếng Việt cho full-text (xem A3)

CREATE TABLE IF NOT EXISTS ai_documents (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    corpus        VARCHAR(32)  NOT NULL,   -- BOOK_METADATA | INTERNAL_DOC
    source_id     VARCHAR(128) NOT NULL,   -- book id, hoặc slug tài liệu
    title         TEXT,
    content       TEXT         NOT NULL,
    content_hash  VARCHAR(64)  NOT NULL,   -- phát hiện thay đổi, tránh re-embed thừa
    metadata      JSONB        NOT NULL DEFAULT '{}',
    updated_at    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    UNIQUE (corpus, source_id)
);

CREATE TABLE IF NOT EXISTS ai_document_chunks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id     UUID NOT NULL REFERENCES ai_documents (id) ON DELETE CASCADE,
    corpus          VARCHAR(32)  NOT NULL,   -- phi chuẩn hoá có chủ đích: lọc corpus không cần JOIN
    chunk_index     INT          NOT NULL,
    content         TEXT         NOT NULL,
    content_hash    VARCHAR(64)  NOT NULL,
    embedding       vector(768)  NOT NULL,
    embedding_model VARCHAR(64)  NOT NULL,
    tsv             tsvector,                -- full-text; ghi lúc upsert, KHÔNG phải generated column (xem A3)
    created_at      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    UNIQUE (document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS ix_ai_chunks_embedding
    ON ai_document_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS ix_ai_chunks_tsv
    ON ai_document_chunks USING gin (tsv);
CREATE INDEX IF NOT EXISTS ix_ai_chunks_corpus_model
    ON ai_document_chunks (corpus, embedding_model);
```

`vector(768)` khớp `nomic-embed-text` đang dùng. Đổi model khác chiều → cần cột riêng hoặc bảng riêng; xử lý ở Phase B, không giải quyết trước khi cần.

**Lưu ý triển khai:** `docker-compose.yml` phải đổi image `db` sang `pgvector/pgvector:pg15`, và `db-init/02-create-extensions.sql` thêm `\c ai_db` + `CREATE EXTENSION IF NOT EXISTS vector;`. Volume `postgres_data` đang có sẽ giữ nguyên dữ liệu; extension tạo được trên database đang chạy.

### A2. Ingestion pipeline

Module mới `services/ai-service/ingestion.py`:

```
nguồn → normalize → chunk → hash → (chỉ chunk đổi) embed → upsert
```

- **Nguồn `BOOK_METADATA`:** gọi `/api/books` qua gateway (đúng ràng buộc "AI không truy cập DB trực tiếp"). Text embed dùng lại `book_index.book_text()` đang có — title, author, category, description, summary_vi.
- **Nguồn `INTERNAL_DOC`:** file Markdown trong `services/ai-service/corpus/`, review qua git như code (cùng triết lý `faq_data.py`, nhưng không hardcode trong `.py`).
- **Chunking:** tài liệu nội bộ cắt theo heading Markdown, fallback theo đoạn với overlap. Metadata sách một quyển = một chunk (text vốn ngắn), không cắt.
- **Incremental:** so `content_hash` từng chunk. Chunk không đổi → không gọi embedding. Đây là điểm sửa trực tiếp debt #2: hiện tại đổi một quyển sách là rebuild toàn bộ index.

Chạy được theo hai đường: lúc startup (như `init_db`) và bằng lệnh thủ công để reindex.

### A3. Hybrid search

`services/ai-service/vector_store.py`:

```python
class VectorStore(Protocol):
    async def upsert_chunks(self, chunks: list[Chunk]) -> None: ...
    async def search_semantic(self, corpus: str, query_vec: list[float], k: int) -> list[Hit]: ...
    async def search_keyword(self, corpus: str, query: str, k: int) -> list[Hit]: ...
```

- **Semantic:** `ORDER BY embedding <=> $1 LIMIT k` (cosine distance, dùng HNSW index).
- **Keyword:** `tsv @@ plainto_tsquery(...)`, tiếng Việt bỏ dấu bằng `unaccent`.

  **Không dùng `GENERATED ALWAYS AS` cho cột `tsv`.** Postgres yêu cầu generated column phải gọi hàm `IMMUTABLE`, mà `unaccent()` mặc định là `STABLE` (nó đọc dictionary config) — schema sẽ bị từ chối lúc `CREATE TABLE`. Hai đường vòng phổ biến là bọc `unaccent` trong một wrapper khai `IMMUTABLE` (nói dối planner, hỏng nếu đổi dictionary) hoặc dùng trigger (thêm một chỗ ẩn để logic trôi đi).

  Chọn: `ingestion.py` ghi thẳng `tsv` trong câu `INSERT ... ON CONFLICT DO UPDATE`, bằng biểu thức `to_tsvector('simple', unaccent($n))`. Ingestion vốn đã là nơi duy nhất ghi vào bảng này, nên không có đường nào khác làm `tsv` lệch khỏi `content`.
- **Hợp nhất:** Reciprocal Rank Fusion — `score = Σ 1/(60 + rank_i)`. Chọn RRF thay vì cộng điểm có trọng số vì không cần chuẩn hoá hai thang điểm khác bản chất (cosine vs ts_rank), và không có tham số phải tune mù.
- **Rerank:** nằm sau feature flag, **mặc định tắt**. Chỉ bật nếu eval ở A0/Phase D chứng minh có cải thiện. Không thêm độ trễ vào đường chat vì một giả định.

### A4. Chuyển hai call site hiện có

- `book_index.py` → gọi `vector_store` thay cho `.book_index_cache.json`. `assistant_tools.search_books()` giữ nguyên chữ ký (AD-5).
- `faq_retrieval.py` → corpus `INTERNAL_DOC`. `faq_data.FAQ_ENTRIES` (11 entry hardcode) chuyển thành file Markdown trong `corpus/`. `find_relevant()` giữ nguyên chữ ký.

Hai file cache JSON cũ trở thành rác — xoá, và bỏ code đọc/ghi chúng (đây là orphan do thay đổi này tạo ra, nên dọn; không đụng dead code có sẵn khác).

### A5. Tiêu chí hoàn thành Phase A

- Toàn bộ test hiện có vẫn pass, không sửa test nào vì đổi interface (nếu phải sửa → đã vi phạm AD-5).
- `eval_rag.py` chạy được và cho số liệu so được với baseline A0.
- Recall@5 không thấp hơn baseline. Nếu thấp hơn → dừng, tìm nguyên nhân, không đi tiếp.

---

## 4. Phase B — Embedding Provider Hybrid

**Lấp gap:** `embeddings.py` chỉ gọi Ollama, không có fallback khi Ollama chết.

### AD-6: Cloud fallback qua OpenRouter (`qwen/qwen3-embedding-8b`), không vendor mới

**Chọn:** `CloudEmbedder` gọi `POST {OPENROUTER_BASE_URL}/embeddings` (OpenAI-compatible, đã xác nhận tồn tại — không phải `/chat/completions`), model `qwen/qwen3-embedding-8b`, tham số `"dimensions": 768` để cắt đúng khớp cột `vector(768)` hiện có.

**Đã cân nhắc và loại:**
- OpenAI `text-embedding-3-small` — cũng hỗ trợ `dimensions`, nhưng thêm một vendor/API key mới ngoài OpenRouter đã có.
- `qwen/qwen3-embedding-4b` — đắt hơn 8B ($0.02 vs $0.01/1M token, xác nhận trên trang pricing OpenRouter) *và* chất lượng thấp hơn (8B đứng đầu MTEB multilingual lúc ra mắt). Không có lý do chọn 4B.
- Tự host qua Ollama — model 8B tham số quá nặng cho một fallback ít khi kích hoạt; đây là lý do CÓ cloud fallback ngay từ đầu.

**Lý do chọn OpenRouter:** `OPENROUTER_API_KEY`/`OPENROUTER_BASE_URL` đã cấu hình sẵn cho chat (`llm_provider.py`). Không cần vendor, không cần secret mới. `.env.example`'s comment "OpenRouter doesn't serve this [embeddings]" đã lỗi thời — xác nhận trực tiếp qua tài liệu OpenRouter (`/docs/api/api-reference/embeddings/create-embeddings`) rằng endpoint `/embeddings` tồn tại và nhận `dimensions`.

### AD-7: `embed_batch`/`embed_text` trả kèm tên model đã dùng — không còn đọc `EMBED_MODEL` tĩnh khi query

**Vấn đề:** `pg_vector_store.py::search_semantic` hiện lọc `embedding_model = :embedding_model` bằng cách đọc thẳng hằng số module-level `embeddings.EMBED_MODEL` (giá trị đọc một lần từ env lúc import). Khi circuit breaker chuyển sang cloud giữa chừng, hằng số này **không đổi** — nó vẫn là `"nomic-embed-text"` dù vector vừa được cloud embed. Hệ quả nếu không sửa: chunk mới embed bằng cloud bị gắn nhãn sai (hoặc filter dùng sai model), search có thể trả về rỗng một cách khó hiểu thay vì rõ ràng "đang chạy dưới model khác, chưa có dữ liệu khớp."

**Chọn:** `embed_batch`/`embed_text` đổi kiểu trả về thành `EmbedResult(vectors, model, provider)` (namedtuple nhẹ, không dùng dataclass đầy đủ như `ChatUsage` vì không cần token count) thay vì `list[float] | None`. Mọi call site (`book_index.semantic_scores`, `assistant_tools._score_and_rank_books`, `faq_retrieval._find_relevant_async`, `ingestion._ingest_one`) nhận và truyền tiếp `result.model` xuống đúng chỗ cần gắn nhãn hoặc lọc:
- `ingestion.py`: `Chunk.embedding_model = result.model` (đã đúng hướng, chỉ đổi nguồn đọc).
- `pg_vector_store.search_semantic`: thêm tham số bắt buộc `embedding_model: str`, bỏ việc tự đọc `embeddings.EMBED_MODEL` bên trong. Caller (book_index, faq_retrieval) truyền `result.model` từ **chính lần embed query đó** — không phải hằng số tĩnh.
- `vector_store.VectorStore` protocol: `search_semantic` thêm tham số này (áp dụng cho cả `InMemoryVectorStore`).

**Hệ quả đúng đắn của thiết kế này:** khi breaker mở (Ollama chết), query mới embed bằng cloud model → search chỉ thấy chunk đã ingest bằng cloud model → **rỗng** cho tới khi đủ dữ liệu re-ingest dưới model đó, hoặc Ollama hồi phục. Đây là hành vi **đúng như AD-3 mô tả** ("reindex có kiểm soát, không phải corrupt dần"), không phải bug — nhưng chỉ đúng nếu embedding_model được truyền động, không đọc hằng số tĩnh.

### Circuit breaker

- 3 lỗi liên tiếp (`EMBED_BREAKER_THRESHOLD`, mặc định 3) → mở mạch, mọi call tiếp theo đi thẳng cloud trong 60s (`EMBED_BREAKER_COOLDOWN_SECONDS`), sau đó thử lại Ollama bằng một request thăm dò trước khi đóng mạch lại.
- State máy: `CLOSED` (Ollama) → `OPEN` (cloud, đếm cooldown) → `HALF_OPEN` (1 request thăm dò Ollama) → `CLOSED` nếu thành công / `OPEN` lại nếu vẫn lỗi.
- Hiện tại mỗi lần Ollama chết là mỗi request tự ăn trọn `EMBED_TIMEOUT_SECONDS=30` — breaker cắt việc này sau lần lỗi thứ 3, không phải chờ timeout mỗi lần.

### Giữ nguyên

- Interface đồng bộ: `embed_batch`/`embed_text` **vẫn là hàm sync**, gọi qua `asyncio.to_thread` từ caller — không đổi sang async, vì Phase B là thêm circuit breaker + fallback, không phải viết lại toàn bộ call chain. `CloudEmbedder` dùng `httpx.Client` đồng bộ (không phải `AsyncClient`), khớp cách `OllamaProvider`/`ollama.Client` đang chạy.
- Hành vi "degrade gracefully": embedding hỏng ở **cả hai** provider → không có tín hiệu semantic, keyword vẫn chạy. Không raise — giữ đúng convention hiện tại của `embeddings.py`.
- Tách `embeddings.py` thành provider protocol, theo đúng khuôn `llm_provider.py` đã làm cho chat (cùng quy ước: log 1 dòng structured mỗi lần gọi, có latency/provider/model).

---

## 5. Phase C — AI Library Insight

**Lấp gap:** có API và nightly briefing, không có UI.

### C1. Schema

```sql
CREATE TABLE IF NOT EXISTS ai_insights (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type           VARCHAR(32)  NOT NULL,   -- INVENTORY | BORROW_TREND | PURCHASING | WEEDING
    severity       VARCHAR(16)  NOT NULL,   -- LOW | MEDIUM | HIGH
    problem        TEXT         NOT NULL,
    evidence       JSONB        NOT NULL,   -- số liệu thô + endpoint nguồn
    recommendation TEXT         NOT NULL,
    confidence     NUMERIC(4,3) NOT NULL,   -- tính bằng code, không hỏi LLM
    source_run_id  UUID         NOT NULL,
    status         VARCHAR(16)  NOT NULL DEFAULT 'NEW',  -- NEW | ACKNOWLEDGED | DISMISSED
    created_at     TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ai_insights_status_created ON ai_insights (status, created_at DESC);
```

### C2. Generator

Module `services/ai-service/insight_generator.py`. Mỗi loại insight là một hàm thuần: nhận payload analytics, trả về list insight — **không I/O, không LLM**, cùng convention `recommendation.py` và `forecast.js` (test được trực tiếp bằng dữ liệu mẫu).

- `inventory_insights(warehouse_stock_risk, low_stock)` — sách sắp hết, tồn kho lâu
- `trend_insights(borrow_trends, top_books)` — thể loại tăng trưởng, sách phổ biến
- `purchasing_insights(reorder_suggestions, budget)` — nhập gì, bao nhiêu, vì sao
- `weeding_insights(weeding_suggestions, aging_inventory)` — sách cần thanh lý

`confidence` tính từ độ lớn mẫu và độ mạnh tín hiệu, bằng code. LLM **chỉ** được gọi ở bước cuối để diễn giải `problem` và `recommendation` thành tiếng Việt tự nhiên (AD-4).

`nightly_briefing.py` gọi generator và persist vào `ai_insights`, bên cạnh `CREATE_REPORT_DRAFT` đang có. Không đổi hành vi hiện tại của nó.

### C3. API và UI

- `GET /insights?status=&type=&limit=` — danh sách
- `PATCH /insights/{id}` — `{status: ACKNOWLEDGED | DISMISSED}`
- `POST /insights/generate` — chạy thủ công (ADMIN / WAREHOUSE_MANAGER), để demo không phải chờ cron

Đặt trong `routes_insights.py` mới, **không** thêm vào `main.py` (đang 4882 LOC).

UI: `apps/web/src/components/pages/ai-insights.tsx` — nhóm theo `type`, sắp theo `severity`, mỗi thẻ hiện problem / evidence (số thật) / recommendation / confidence, nút Acknowledge và Dismiss. Dùng lại pattern của `ai-action-center.tsx`.

---

## 6. Phase D — Evaluation & Refactor

**Lấp gap:** eval mỏng + `main.py` 4882 LOC.

### D1. RAG evaluation — 100 câu

`eval/rag_dataset.json`, mỗi case: `{question, expected_doc_ids, expected_answer_facts, corpus}`.

Chỉ số:
- **Retrieval:** Recall@k (k = 1, 3, 5), MRR
- **Answer correctness:** so với `expected_answer_facts` bằng `scoring.py` đang có
- **Hallucination rate:** tận dụng `number_grounding.py` — module này **đã** parse mọi số trong câu trả lời và đối chiếu với context. Đây là cách đo hallucination tự động, khách quan, không cần LLM-as-judge. Đã có sẵn, chỉ cần gắn vào eval loop.

### D2. Agent evaluation

Mở rộng `assistant_dataset.json` từ 34 → 60 case, bổ sung: chọn sai tool, tham số sai, câu hỏi nhiều bước, câu hỏi không đủ dữ liệu (model phải nói "chưa đủ dữ liệu" chứ không đoán).

### D3. Refactor `main.py`

Tách theo pattern `routes_*.py` đã bắt đầu: `routes_isbn.py`, `routes_chat.py`, `routes_assistant.py`, `routes_vision.py`, `routes_recommendations.py`. Thuần cơ học, không đổi hành vi — mỗi bước tách xong chạy lại full test trước khi tách tiếp.

---

## 7. Data flow

### Truy vấn có RAG (sau Phase A)

```
User → /assistant (JWT)
  → NLU intent (nlu.py)
  → fast-path seeding (assistant_loop.seed_fast_path)
  → LLM chọn tool (llm_provider, OpenRouter/Qwen)
      ├─ analytics tool → api-gateway → analytics-service → DB
      └─ search_books   → vector_store
                            ├─ semantic: embedding <=> query (HNSW)
                            └─ keyword:  tsv @@ tsquery
                            → RRF fusion → [rerank nếu bật]
  → tool_context.render → prompt
  → LLM sinh câu trả lời
  → number_grounding kiểm tra: số trong câu trả lời có trong context không
  → nếu ungrounded → retry_once_if_ungrounded
  → Response (+ sources, + pending action nếu có)
```

Ràng buộc "AI không truy cập DB trực tiếp" **vẫn được giữ**: `vector_store` đọc `ai_db` — database riêng của chính ai-service, chứa index do chính nó dựng. Nó không đọc `inventory_db` / `borrow_db` / `auth_db`. Dữ liệu nghiệp vụ vẫn chỉ vào qua gateway.

### Sinh insight (Phase C)

```
cron (nightly_briefing_loop)
  → 6 analytics endpoint (internal service key)
  → insight_generator.* (hàm thuần, tính confidence)
  → LLM diễn giải (chỉ ngôn ngữ, không sinh số)
  → ai_insights (persist)
  → CREATE_REPORT_DRAFT (pending action, giữ nguyên hành vi cũ)
  → socket_emitter.push_ai_action_event
Staff → /ai-insights → đọc, Acknowledge / Dismiss
```

---

## 8. Error handling

Nguyên tắc chung, kế thừa convention đã có trong service: **retrieval không bao giờ raise**, mọi lỗi degrade xuống mức thấp hơn.

| Hỏng | Hành vi | Nền tảng |
|---|---|---|
| Ollama embedding chết | Phase A: không có tín hiệu semantic, keyword vẫn chạy. Phase B: circuit breaker → cloud | `embeddings.py` đã "return None rather than raising" |
| pgvector query lỗi | Fallback sang keyword-only, log warning | mới, theo cùng nguyên tắc |
| `ai_db` không lên | `init_db` fail rõ ràng lúc startup — đây là lỗi cấu hình, phải fail to | `db.py::init_db` hiện tại đã vậy |
| Analytics endpoint timeout | Insight bỏ qua section đó, ghi `evidence.missing` | `nightly_briefing._get_internal` đã trả `{"error": ...}` |
| LLM diễn giải insight fail | Vẫn lưu insight với `problem`/`recommendation` template, không mất số liệu | AD-4: số liệu không phụ thuộc LLM |
| Chunk có `embedding_model` cũ | Bị loại khỏi kết quả query, không dùng nhầm | AD-3 |

---

## 9. Testing strategy

| Tầng | Cách test | Cần Postgres? |
|---|---|---|
| `vector_store` | `InMemoryVectorStore` (AD-2) | Không |
| `ingestion` chunking + hashing | Hàm thuần, dữ liệu mẫu | Không |
| `insight_generator` | Hàm thuần, payload analytics mẫu — cùng cách `test_recommendation.py` đang test | Không |
| RRF fusion | Hàm thuần, hai danh sách rank mẫu | Không |
| `PgVectorStore` SQL | Integration test, đánh dấu skip khi không có Postgres | Có |
| Contract `/insights` | Theo pattern `test/contract/ai-analytics.contract.test.js` đã có | Không |
| RAG end-to-end | `eval/eval_rag.py` — eval, không phải unit test | Có |

Mọi test mới theo convention `unittest` của service (`python -m unittest discover` từ `services/ai-service`).

---

## 10. Thứ tự thực hiện

```
A0 (baseline eval)  ──►  A (vector store + hybrid)  ──►  B (embedding provider)
                                   │
                                   └──►  C (insight + UI)  ──►  D (eval đầy đủ + refactor)
```

A0 phải xong trước A. B và C độc lập nhau sau khi A xong. D cuối, vì nó đo kết quả của A–C.

---

## 11. Quan hệ với spec cũ

Spec `2026-08-28-chatbot-faq-semantic-retrieval-design.md` kết luận không cần vector DB. Kết luận đó **đúng tại thời điểm đó**: corpus là FAQ tĩnh vài chục mục, và file cache JSON là lựa chọn cân xứng.

Điều đã thay đổi kể từ đó:
- `book_index.py` ra đời, dựng thêm một index riêng cũng bằng file JSON — giờ có **hai** cơ chế cache vector song song, cùng vấn đề.
- Corpus mở rộng sang toàn bộ catalog sách, không còn là vài chục mục.
- Rebuild toàn bộ khi catalog đổi trở thành chi phí thật, không còn là chi phí giả định.

Spec này thay thế phần "không xây vector DB" của spec cũ. Phần còn lại của spec cũ (semantic FAQ trong `GENERAL_QUERY`, threshold, fallback behavior) **vẫn còn hiệu lực** — Phase A chỉ đổi nơi lưu vector, không đổi hành vi retrieval mà spec đó mô tả.

---

## 12. Yêu cầu từ roadmap gốc — đối chiếu

| Yêu cầu | Xử lý |
|---|---|
| Không phá vỡ API hiện tại | AD-5: giữ nguyên chữ ký `search_books`, `find_relevant`. Endpoint mới là thêm, không sửa |
| Ưu tiên mở rộng service hiện có | Không thêm service nào. Chỉ thêm module trong `ai-service` |
| Giữ clean architecture | Hàm thuần tách khỏi I/O; route mới không nhét vào `main.py` |
| Viết test, documentation, API spec | Mục 9; spec này; OpenAPI cho `/insights` trong Phase C |
| Mỗi feature có purpose / architecture decision / implementation plan / files changed / testing strategy | Mục 2 (AD-1…AD-5), 3–6, 9; file changed và plan chi tiết → `writing-plans` |
