# PHASE 0 — Technical Audit: Book-Cover Retrieval in SmartBook

Status: **COMPLETED** (2026-11-12). Read-only audit; no production file was modified.

## 0. Repository state at audit time

| Item | Value |
|---|---|
| Branch | `hungg` (no branch switch, no reset) |
| HEAD | `33c41c7ea8be2e6b9b71f3bdd0345c282164423c` |
| Uncommitted changes before this research | `.claude/settings.json`, `CLAUDE.md`, `docs/diagrams/**` (diagram work), several untracked thesis `.docx` files. None touch `services/ai-service`. |
| Rules read | `CLAUDE.md` (root + `.claude/`), `AGENTS.md` not needed for this scope |

## 1. Files audited (verbatim source read, not inferred from names)

| File | Role |
|---|---|
| `services/ai-service/routes_cover_search.py` | FastAPI router: `POST /find-book-by-cover`, `POST /find-book-by-cover/reindex`; OCR prompt, hedge filter, `_merge_candidates` (fusion) |
| `services/ai-service/cover_embeddings.py` | CLIP model loading + `embed_image()` |
| `services/ai-service/cover_gallery.py` | Gallery cache (memory + Postgres `ai_cover_embeddings`), sync from inventory-service `/internal/covers` |
| `services/ai-service/assistant_tools.py` (`_score_and_rank_books[_with_confidence]`) | Catalog text ranking reused by the OCR branch |
| `services/ai-service/vector_store.py`, `pg_vector_store.py`, `fusion.py`, `ingestion.py`, `book_index.py`, `embeddings.py`, `intent.normalize_text` | Text-retrieval substrate used by the OCR branch |
| `services/ai-service/llm_provider.py` (`OpenRouterProvider.analyze_image`, `_vision_json`, `_request_completion`, `_is_retryable`) | Vision-LLM call |
| `services/ai-service/test_cover_search.py` | 15 unit tests (hedge filter, OCR degradation, merge logic) |
| `scripts/cover-search-integration.mjs` | Live golden-path test through the Gateway (needs the docker stack) |
| `services/ai-service/main.py` (lines 117, 140, 258-260) | Router mount + CLIP warm-up at startup |
| `apps/web/src/services/cover-search.ts`, `apps/mobile/src/api/coverSearch.ts` | Clients (`/ai/find-book-by-cover`, multipart field `file`) |

## 2. End-to-end pipeline (as implemented)

```
client (web/mobile) ──multipart file──> API Gateway /ai/find-book-by-cover ──> ai-service find_book_by_cover()
   validate content_type startswith "image/" and non-empty bytes (else HTTP 400)
   asyncio.gather(
      _run_cover_ocr(bytes)        -> OpenRouter vision (Qwen) -> {"title","author"} (hedge phrases -> None)
      _fetch_catalog(auth header)  -> GET {GATEWAY}/api/books (caller's own token)
      _match_visual(bytes)         -> cover_gallery.get_gallery() + CLIP embed + cosine vs every gallery row
   )
   ocr_query = "title author" ; if non-empty and catalog non-empty:
        ocr_matches = assistant_tools._score_and_rank_books(books, ocr_query, limit=5)
   candidates = _merge_candidates(books, ocr_matches, visual_matches)
   keep confidence >= 0.5, top 5
   return {match_found, candidates[], signals{ocr_extracted, visual_gallery_size}}
```

## 3. The 20 required facts

| # | Item | Exact value in code | Source |
|---|---|---|---|
| 1 | CLIP model ID | `openai/clip-vit-base-patch32` (env `CLIP_MODEL_NAME`); HF revision resolved in our run: `3d74acf9a28c67741b2f4f2ea7635f0aaf6f0268` (`refs/main`) | `cover_embeddings.py:17` |
| 2 | Embedding dimension | 512 (projected image embedding, `get_image_features` → `.pooler_output` on transformers 5.17.0) | measured: `len(vector)=512` |
| 3 | Image preprocessing | `PIL.Image.open(...).convert("RGB")` → `CLIPProcessor` defaults: resize shortest edge to 224 (bicubic), **center-crop 224×224**, rescale, normalize with CLIP mean/std. No EXIF-orientation handling, no cover detection/cropping. | `cover_embeddings.py:53-56`; processor config printed in run |
| 4 | Normalization | L2: `vector / vector.norm()` (norm measured = 1.0) | `cover_embeddings.py:66` |
| 5 | Similarity | `embeddings.cosine_similarity` (pure-Python dot/(‖a‖‖b‖)), computed against **every** gallery row (linear scan) | `routes_cover_search.py:_match_visual`, `embeddings.py:186` |
| 6 | Gallery indexing | One row per **book variant (edition)** that has `cover_image_url`, from inventory-service `GET /internal/covers` (internal key). Image downloaded, embedded, stored in `ai_cover_embeddings` (unique `variant_id`, `book_id`, title, author, url, `model_name`, JSON `embedding`). | `cover_gallery.py:_sync`, `db_models.py:117` |
| 7 | Gallery caching | Two tiers: process memory `(hash, rows)` + Postgres table. Hash = SHA-256 over sorted `(variant_id, cover_image_url)` + model name. Lazy re-check on every request; changed/new rows re-embedded, removed rows deleted. Explicit `POST /find-book-by-cover/reindex`. | `cover_gallery.py:get_gallery/rebuild` |
| 8 | Qwen Vision model ID | `OPENROUTER_VISION_MODEL`, default = `OPENROUTER_TEXT_MODEL` = `qwen/qwen3.7-flash`; local `.env` sets `qwen/qwen3.7-flash`. Optional global fallback `OPENROUTER_FALLBACK_MODEL` (unset in local `.env`). | `llm_provider.py:607-609`, `.env` (names only inspected) |
| 9 | OCR prompt | Vietnamese: *"Nhìn vào ảnh chụp bìa sách này. Đọc tên sách và tên tác giả in trên bìa. Trả về DUY NHẤT JSON … {"title": "...", "author": "..."}. Nếu không đọc được, đặt giá trị null."* | `routes_cover_search.py:PROMPT_COVER_OCR` |
| 10 | OCR output schema | JSON object `{title, author}`; request uses `response_format={"type":"json_object"}`, `temperature=0.0`, `reasoning.enabled=false`, `max_tokens=200`. Non-JSON → `VisionResponseError`. Image sent as base64 data-URL of the **original bytes** (no resize); MIME sniffed from magic bytes. | `llm_provider.py:_vision_json`, `_image_part` |
| 11 | OCR normalization | `_clean_ocr_value`: strip; empty or exact (case-insensitive) hedge phrase (`không tìm thấy`, `unknown`, `n/a`, `none`, …14 phrases) → `None`. No accent folding at this step. Query = `" ".join([title, author])`. | `routes_cover_search.py:_clean_ocr_value` |
| 12 | Candidate retrieval (OCR branch) | `_score_and_rank_books(books, query, 5)`: (a) semantic: Qwen3-Embedding-8B @768-d query embedding (OpenRouter) vs catalog document embeddings (`book_text` = title+author+category+description+summary_vi), keep cosine ≥ `BOOK_SEMANTIC_THRESHOLD` = 0.3, k=15; (b) keyword: Postgres full-text `plainto_tsquery('simple', unaccent(q))` (all terms required), k=15; (c) **RRF (k=60)** over the two rankings, score normalized by 2/61 so rank-1-in-one-branch = 0.5, rank-1-in-both = 1.0; (d) ISBN substring hit forced to score 1.0. | `assistant_tools.py:198-311`, `fusion.py`, `pg_vector_store.py:159` |
| 13 | Score fusion | `_merge_candidates`: per book, best visual row with score ≥ 0.80; OCR matches keyed by book id. Both signals → `v·w + o·(1−w)`; visual only → `v`; OCR only → `o`. Dedup on `book_id`; books not in live catalog dropped; sort by confidence desc. Returned `variant_id` = matched gallery variant if visual fired. | `routes_cover_search.py:_merge_candidates` |
| 14 | Visual weight | `COVER_SEARCH_VISUAL_WEIGHT` = 0.6 | env default |
| 15 | OCR weight | `1 − 0.6 = 0.4` (implicit) | same |
| 16 | Confidence | The fused number above (not an LLM self-assessment), rounded to 3 decimals | same |
| 17 | Matching threshold | Visual gate `COVER_SEARCH_VISUAL_THRESHOLD` = 0.80 (pre-fusion); final gate `COVER_SEARCH_MIN_CONFIDENCE` = 0.5; result limit `COVER_SEARCH_RESULT_LIMIT` = 5. `match_found = len(candidates) > 0`. | env defaults, `docker-compose.yml:419-426` |
| 18 | Error handling | Every branch degrades instead of raising: OCR exception → `{title:None, author:None}`; catalog fetch error → `[]`; gallery unreachable → last cached gallery or `[]`; CLIP failure → `None` → `[]`. HTTP 400 only for non-image content-type / empty file. | all three modules |
| 19 | API timeouts | Vision `COVER_OCR_TIMEOUT_SECONDS` = 20 s per HTTP attempt; provider retries the same model once on timeout/transport/429/5xx (so worst case ≈ 2×20 s, plus fallback model if configured). Catalog fetch 15 s; cover download 10 s; embedding call 30 s. | `routes_cover_search.py`, `llm_provider.py:_request_completion`, `embeddings.py` |
| 20 | Model warm-up | `main.py` startup schedules `cover_embeddings.warm_up()` (loads CLIP into memory, non-fatal). Gallery is **not** warmed at startup; first request (or `/reindex`) pays gallery sync. Measured locally (CPU, research venv): cold model load + first embed 38.6 s (includes first-time HF download), warm embed ≈ 0.32 s. | `main.py:258-260`, `cover_embeddings.warm_up` |

## 4. Properties of the fusion that matter for the experiment (observed in code, not changed)

1. **Non-monotonic fusion.** A book with visual 0.85 and no OCR evidence gets 0.85; the same book with visual 0.85 *and* agreeing OCR evidence at 0.5 gets 0.6·0.85+0.4·0.5 = 0.71. Adding corroborating evidence can lower its rank relative to a visual-only competitor.
2. **Hard visual gate before fusion.** Visual candidates below cosine 0.80 never enter fusion, so for hybrid and CLIP-only the ranked list is truncated; Recall@5 can be lower than the raw CLIP ranking would give.
3. **OCR score scale is rank-based.** `o` is a normalized RRF score; a book that is rank-1 in only one of the two text branches scores exactly 0.5, which is exactly the final gate value — so OCR-only answers survive the 0.5 gate only if rank-1 in some branch or found by both branches.
4. **Center crop.** Portrait covers (~2:3) lose ≈ 1/3 of their height in CLIP's 224×224 center crop; titles printed near the top/bottom edge are partly removed from the visual signal.
5. **Edition vs work.** Gallery is per variant (edition); fusion and output dedupe per `book_id` (work-level catalog entry). Retrieval correctness in production is therefore book-level; the variant id is a by-product of the visual branch.

## 5. What is missing for a controlled experiment (and how the research harness fills it without touching production)

| Gap | Research-side solution (in `services/ai-service/eval/cover_search/`) |
|---|---|
| `find_book_by_cover` needs a live Gateway (`/api/books`) and inventory-service gallery | Call the **real** endpoint function with a constructed `Request`/`UploadFile`, monkeypatching only the two data-source functions (`_fetch_catalog`, `cover_gallery.get_gallery`) inside the eval process to return the research catalog snapshot and its gallery (gallery vectors computed by the production `cover_embeddings.embed_image`). |
| No OCR-only / CLIP-only modes exist | Ablation by patching one branch in-process: OCR-only = `_match_visual → []`; CLIP-only = `_run_cover_ocr → {None, None}`. Fusion, gates and limits stay production code. |
| OCR text ranking requires the pgvector store in `ai_db` | Populate an in-process store with production `ingestion.ingest_books`. Initially the repository's `InMemoryVectorStore` (token-substring keyword matching); the pilot showed this distorts rankings, so from protocol v1.2 `pg_fts_emulation.PgSemanticsInMemoryStore` reproduces Postgres `plainto_tsquery('simple', unaccent(q))` AND semantics (ts_rank approximated). Docker/Postgres was not running, no local Postgres binary existed, and the business/AI databases must not receive research data. |
| `_run_cover_ocr` discards token usage/cost | Wrap the provider returned by `get_openrouter_provider` in-process to record `ChatUsage` (latency, tokens, `cost`) — read-only observation. |
| No ground-truth dataset | Phase 1-2 builds one. |
| No budget configuration for OpenRouter | None found (only `max_tokens`). Per protocol: ≤ 5 paid pilot queries, then cost estimate; full paid runs wait for approval. |

## 6. Environment used for research runs

- Isolated venv: `services/ai-service/eval/cover_search/.venv-research` (Python 3.14.3, torch 2.15.0+cpu, transformers 5.17.0 — same transformers/Pillow/numpy/httpx versions as the ai-service venv). The ai-service `.venv` (which lacks torch) was not modified.
- HF cache: `services/ai-service/eval/cover_search/.hf-cache` (separate from the Docker-mounted `ai_service_model_cache`, which was not written to).
- Hardware: Windows 11 laptop, CPU inference (an RTX 3050 Ti is present but production is CPU-only, so CPU is used for fidelity).
