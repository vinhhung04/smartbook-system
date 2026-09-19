# Field-Level ISBN Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chuyển ISBN Intelligence từ "tìm được sách là dừng" sang "phát hiện field thiếu / yếu / mâu thuẫn rồi chỉ gọi đúng provider có khả năng bổ sung field đó", giữ nguyên contract cũ.

**Architecture:** Giữ `_build_isbn_intelligence()` làm lớp evidence/confidence duy nhất. Thêm 2 module thuần (không import `main`): `isbn_coverage.py` (phân loại field) và `isbn_targeted.py` (capability + planner + ledger). Orchestrator mới nằm trong `main.py` (vì test patch `main.<fn>`), gọi provider theo từng round có ngân sách thời gian, sau mỗi round build lại intelligence và phân tích lại coverage. Toàn bộ sau feature flag `ENABLE_FIELD_LEVEL_ISBN_RETRIEVAL`.

**Tech Stack:** Python 3 / FastAPI / httpx / unittest (ai-service), React + TS (apps/web), Node/Prisma (inventory-service, không đổi code).

**Spec:** Yêu cầu do người dùng nêu trong hội thoại (không có spec file riêng); phân tích code thật ở mục A–C bên dưới đóng vai trò spec.

## Global Constraints

- Chỉ **additive** response contract; không đổi tên/xoá field hiện có (`success, found, isbn, isbn13, isbn10, title, authors, publisher, description, categories, language, pageCount, thumbnail, source, confidence, summaryVi, keywords, fieldEvidence, fieldConfidence, sources, conflicts, metadataQualityScore, processingTimeMs`).
- Không dùng LLM để chấm confidence hoặc chọn/điền field factual (`publisher, pageCount, publishedDate, isbn, authors, title`). Qwen chỉ nhận metadata đã grounded.
- Mỗi provider tối đa **1 lần / request** (ledger). Không loop không giới hạn: `MAX_ROUNDS = 3`, có tổng ngân sách thời gian.
- Barcode mode (non-ISBN numeric) không đi qua field-level planner.
- Test patch theo tên `main.<fn>` phải tiếp tục chạy: **không di chuyển** các hàm provider / `_lookup_book_by_isbn_legacy` / `_run_standard_lookups` / `_fetch_all_marketplace` / `_fetch_web_search_fallback` ra khỏi `main.py`.
- Flag mặc định `false` khi merge; chỉ bật mặc định sau khi eval đạt tiêu chí (mục J).

---

# A. Current State Analysis (đọc từ code thật, branch `HEAD`, `services/ai-service/main.py`)

## A1. Luồng hiện tại

```
POST /lookup-book-by-isbn | /isbn-intelligence      main.py:2443
POST /enrich-book-after-isbn                          main.py:2589 (web gọi cái này: index.tsx:221)
        │
        ▼
lookup_book_by_isbn()                                 :2414   cache get (key "isbn13:bool(summary)")
        │
        ▼
_lookup_book_by_isbn_legacy()                         :2152
   ├─ validation_error + 10/13 chữ số + ENABLE_MARKETPLACE_LOOKUP  → BARCODE MODE (:2161-2226)
   │      _fetch_all_marketplace → _merge_with_marketplace → trả result (KHÔNG có _providerMetadata)
   ├─ validation_error khác → _manual_entry_response
   └─ ISBN hợp lệ:
        asyncio.gather(                                      :2233
            _run_standard_lookups  = Google ‖ OpenLibrary ‖ [WorldCat nếu ENABLE_WORLDCAT_LOOKUP]
            _fetch_all_marketplace = DDGS(fahasa URLs, serial, ≤30s) → Fahasa ‖ Tiki ‖ Vinabook
        )                                     (marketplace chạy song song NGAY TỪ ĐẦU nếu ENABLE_MARKETPLACE_LOOKUP)
        merged = _merge_lookup_metadata_with_fallbacks(G, OL, WC)   :2265   waterfall: G > OL > WC
        merged = _merge_with_marketplace(merged, F, T, V)           :2267   chỉ điền chỗ trống
        found  = bool(title or authors or description)              :2269   ← ROOT CAUSE
        if not found and ENABLE_MARKETPLACE_LOOKUP: web fallback    :2271   chỉ khi found == False
        (summary Qwen từ `merged` nếu generateVietnameseSummary)    :2315
        result = {found, fields từ `merged`, source flags, confidence, _providerMetadata, _providerOutcomes}
        │
        ▼
lookup_book_by_isbn (tiếp)
   _build_isbn_intelligence(provider_metadata, statuses)  :1663  → chọn theo reliability, KHÔNG theo waterfall
   result.update(intelligence.metadata) nếu found         :2431  ← GHI ĐÈ field của waterfall
   + fieldEvidence, fieldConfidence, sources, conflicts, metadataQualityScore, processingTimeMs
   cache.set nếu found (TTL 7 ngày)                       :2438
        │
        ▼ (enrich endpoint)
_normalize_with_catalog_authority → POST inventory /internal/authority/normalize   :2558
_build_post_isbn_ai_suggestions → Qwen: summaryVi/keywords, normalize_description, suggest_categories  :2476
        │
        ▼ web: mapLookupToForm → createReconciliationDraft → checkDuplicate → review tab
```

## A2. Provider thực tế (đọc từng hàm)

| Provider | Cách gọi | Chi phí | Flag | Field parser thực sự trả về (code) |
|---|---|---|---|---|
| Google Books | httpx `q=isbn:` (isbn13 rồi isbn10 nếu rỗng) `:1840` | rẻ (~1s) | luôn bật | title, subtitle, authors, publisher, publishedDate, description, categories, language, pageCount, thumbnail (tuỳ volume có hay không) |
| Open Library | `/api/books?jscmd=data`; nếu thiếu description → edition JSON → work JSON (≤3 call) `:1933,:1760` | rẻ | luôn bật | như Google; `subjects`→categories; `number_of_pages`→pageCount |
| WorldCat | Classify XML `:1901` | rẻ | `ENABLE_WORLDCAT_LOOKUP` (mặc định false) | **chỉ title+authors** (publisher/... hard-code `None`, `:1867`); Classify API nhiều khả năng đã ngừng — cần xác minh live |
| Tiki | httpx search + detail API (`sku == isbn`) `:1244` | rẻ (2 call) | `ENABLE_MARKETPLACE_LOOKUP` | title, authors(specs), publisher(specs), description, thumbnail, language="vi" hard-code. **pageCount/publishedDate/categories luôn None/[]** |
| Vinabook | httpx `/search` + `products/x.js` `:1380` | rẻ (2 call) | idem | title, authors, publisher, publishedDate, description, pageCount, thumbnail, language="vi" hard-code. categories luôn [] |
| Fahasa | **DDGS** (serial, ≤30s) rồi CloakBrowser subprocess (≤35s) rồi fallback httpx `:882,:1444,fahasa_browser.py` | **đắt/chậm** (26s+ thực đo, comment `:148`) | idem + `ENABLE_FAHA_CLOAKBROWSER` (.env=true, compose default=false) | title, authors, publisher, publishedDate, description, pageCount, thumbnail, language. **categories luôn []** |
| Web Search | DDGS snippet + regex `Ký mã hiệu…; Tác giả…; Nhà XB…; Năm…` `:1161,:1225` | chậm, flaky | idem | **chỉ khi snippet có đủ title+author+publisher** → title, authors, publisher, publishedDate. Không bao giờ có description/pageCount/categories |

`docker-compose.yml:375` và `.env:65`: `ENABLE_MARKETPLACE_LOOKUP=true` (code default `false` `:147`) → trong môi trường chạy thật marketplace **đang bật và chạy song song ngay từ đầu**.

## A3. Hai hệ merge song song (nguồn gốc bất nhất)

1. **Waterfall legacy** (`_merge_lookup_metadata*`, `_merge_with_marketplace`): ưu tiên cứng G > OL > WC > marketplace, "chỉ điền chỗ trống". Quyết định `found`, và là input của `_generate_summary_vi_and_keywords` (`:2316`).
2. **Intelligence** (`_build_isbn_intelligence`): chọn theo `reliability(source, field)`, tính `fieldConfidence`, `conflicts`. Kết quả **ghi đè** field của (1) trong response (`:2432`).

Hệ quả: summary có thể sinh từ giá trị khác giá trị hiển thị. Plan **không** thêm hệ thứ ba: trong nhánh field-level, `found`, coverage, gap và summary đều tính từ output của `_build_isbn_intelligence`.

## A4. Root cause của partial-metadata

`found` (`:2269`) là predicate "có ≥1 trong title/authors/description" trên `merged`, và web fallback chỉ nằm trong `if not found`. Google chỉ có title+authors ⇒ `found=True` ⇒ không có bước nào (a) đo field thiếu, (b) gọi thêm nguồn. Marketplace đã gọi song song từ đầu nên "bổ sung" chỉ xảy ra nếu marketplace tình cờ có dữ liệu; **không có cơ chế nhắm vào field thiếu** và web search không bao giờ được thử khi `found=True`.

## A5. Phát hiện quan trọng khi đọc code (ảnh hưởng thiết kế)

- **B1 – Confidence đơn nguồn = reliability, không phải "yếu hơn".** `agreement = Σreliab(agree)/Σreliab(all responding)`; với 1 nguồn `agreement=1` ⇒ `corroboration=1.0` ⇒ `confidence = reliability`. Comment `:1699` ("single provider cannot be as strong") không đúng với công thức. Hệ quả: Google đơn nguồn có `description=1.0`, `pageCount=1.0`, `publisher=0.82`. **Không thể** định nghĩa LOW_CONFIDENCE chỉ bằng ngưỡng `fieldConfidence` trên priors hiện tại (ví dụ `0.48` trong đề bài không xảy ra: prior thấp nhất là webSearch `0.55`). Plan: *không đổi công thức* (đổi sẽ làm dịch `metadataQualityScore` và test cũ); thêm tín hiệu `agreementCount` (đã có trong `selectionReason`) vào rule.
- **B2 – Bug conflict detection.** `alternatives` lấy từ `confirmations[1:]` (`:1705`) giả định phần tử được chọn là `confirmations[0]`, nhưng selected = max reliability. Ví dụ `publisher`: Google (0.82, đứng đầu `ISBN_SOURCE_ORDER`) = "NXB A", Fahasa (0.84) = "NXB B" ⇒ selected = Fahasa, `confirmations[1:] = [Fahasa]` ⇒ **không có conflict nào được báo**. Đây đúng là Case 5 của yêu cầu ⇒ phải sửa + test trước.
- **B3 – Provider categories.** Chỉ Google/OL có thể trả `categories`. `SOURCE_RELIABILITY` có prior categories cho fahasa/tiki/vinabook nhưng không parser nào phát ra. Targeted retrieval **không thể** lấp `categories` với code hiện tại ⇒ phải nói thẳng "không có provider đủ khả năng" và để Qwen `suggest_categories` + human review xử lý (đã có), hoặc thêm parser (Task 9, tuỳ chọn, cần fixture thật).
- **B4 – `language="vi"` hard-code** ở Tiki/Vinabook/web search là giả định, không phải evidence; reliability default 0.8/0.75/0.55 làm nó thắng Google `"en"` ở một số ca. Hạ prior `language` cho ba nguồn này (Task 1).
- **B5 – Nguồn không được gọi bị báo `NOT_FOUND`.** `_build_source_statuses` (`:2398`) mặc định `NOT_FOUND` cho provider không có trong `source_flags`. Khi provider bị hoãn/bỏ qua vì không cần, UI sẽ hiển thị sai. Cần trạng thái `SKIPPED`.
- **B6 – `durationMs` của mọi source = tổng thời gian request** (`:2393`), không phải từng provider. Ledger sẽ sửa.
- **B7 – (nghi ngờ, cần characterization test trước khi sửa) Barcode mode có thể bị xoá metadata.** Nhánh barcode trả `found=True` + title… nhưng không có `_providerMetadata`; wrapper `lookup_book_by_isbn` `pop("_providerMetadata", {})` → `{}` → `_build_isbn_intelligence({})` trả metadata rỗng → `result.update(intelligence["metadata"])` (`:2432`, vì `found=True`) ghi đè title/authors bằng `None`. Nếu đúng, đây là bug có sẵn (không do plan). Task 0 viết test đặc trưng; nếu xác nhận thì sửa bằng cách nhánh barcode cũng trả `_providerMetadata`/`_providerOutcomes`.
- **B8 – Cache.** Chỉ cache `found`, TTL 7 ngày, key `isbn13:bool(summary)`. Một kết quả "found nhưng marketplace timeout, thiếu description" hiện được cache 7 ngày ⇒ thiếu dữ liệu dính lâu. Field-level làm vấn đề này rõ hơn (Task 8).
- **B9 – Frontend gọi `enrichBookAfterIsbn` (1 request)**; `IsbnLookupProgress` là animation staged giả (`isbn-lookup-progress.tsx:10`), không phản ánh tiến độ thật. Timeout của axios `aiAPI` không tìm thấy trong `apps/web/src/services` — **cần xác minh ở Task 0** vì tổng thời gian tra cứu có thể dài hơn (budget ở mục F).
- **B10 – Inventory.** `metadata-reconciliation.controller.js` lưu nguyên `raw_metadata` (JSON) và `fieldEvidence`; `AUTO_ACCEPT_FIELDS` (`:10`) tự chấp nhận title/description/pageCount/publishedDate…, nên field LOW_CONFIDENCE **không** tự buộc staff review ở tầng reconciliation. Không thay đổi trong plan này (xem Follow-ups). Endpoint `/internal/authority/normalize` nằm trong `routes/internal-authority.routes.js` (không có controller riêng như đề bài liệt kê).

---

# B. Proposed Architecture

```
ISBN (valid)                                   barcode / invalid → nhánh cũ, KHÔNG đổi
 │
 ▼
[Round 0  INITIAL, parallel]  Google ‖ OpenLibrary ‖ [WorldCat nếu flag]
 │        (marketplace KHÔNG chạy ở đây khi flag field-level bật)
 ▼
Provider Evidence Store  = provider_metadata{} + Ledger{provider → status, phase, reasons, ms}
 │
 ▼
_build_isbn_intelligence()  ──►  analyze_field_coverage()          (isbn_coverage.py, thuần)
 │                                   MISSING / LOW_CONFIDENCE / CONFLICTED / SUFFICIENT
 │                                   gaps "đáng gọi" = critical + high-value
 ▼
 gaps rỗng? ── yes ─► STOP(COVERAGE_OK)
 │ no
 ▼
plan_targeted_retrieval(gaps, ledger, flags, remaining_budget)     (isbn_targeted.py, thuần)
 │   chỉ chọn provider: chưa gọi + có capability cho ≥1 gap + đủ thời gian còn lại
 ▼
[Round 1  TARGETED-CHEAP, parallel]   Tiki ‖ Vinabook              (httpx API)
 │  → intelligence → coverage → gaps?
 ▼
[Round 2  TARGETED-EXPENSIVE]         Fahasa (DDGS + CloakBrowser)
 │  → intelligence → coverage → gaps?
 ▼
[Round 3  LAST-RESORT]                webSearch  (chỉ cho authors/publisher/publishedDate/title còn thiếu)
 │
 ▼  STOP khi: COVERAGE_OK | NO_ELIGIBLE_PROVIDER | BUDGET_EXHAUSTED | MAX_ROUNDS
 ▼
Evidence Fusion cuối = _build_isbn_intelligence(provider_metadata)   (selected, confirmations, conflicts, confidence)
 ▼
coverage/fieldStatus/needsEnrichment/retrieval trace   ← additive
 ▼
(tuỳ chọn) summary Qwen từ intelligence.metadata
 ▼
Authority normalization (inventory)  →  Qwen enrichment (chỉ metadata đã grounded)  →  Human review
```

**Quyết định kiến trúc chính (và lý do):**

- **D1. Provider gốc là "one-shot & đầy đủ".** Google và OL trong code hiện tại đã trả mọi field họ có (OL còn tự đi edition→work JSON cho description). Không có endpoint thứ hai của chính họ mà code biết sẽ cho thêm publisher/pageCount ⇒ *targeted retrieval = chọn thêm provider khác chưa gọi*, không phải gọi lại provider cũ. Vì vậy "raw response reuse" thực chất là **ledger**: kết quả đã parse của provider nằm trong `provider_metadata`, không bao giờ gọi lại. (Không thêm `volumes/{id}` của Google: chưa có bằng chứng đem lại field mới; báo cáo *provider contribution* của eval sẽ cho biết có cần không.)
- **D2. Hoãn marketplace khỏi Round 0 — thay đổi có chủ đích so với kiến trúc song song hiện tại.** Nếu marketplace vẫn chạy song song ngay từ đầu thì Case 10 ("metadata đủ tốt thì không gọi marketplace/browser") là không thể. Chi phí: ca có gap phải chờ Round 0 (Google/OL ~1–3s, tối đa 15s) rồi mới tới Round 1 ⇒ **+1–3s** cho ca thiếu, đổi lại tiết kiệm toàn bộ DDGS+CloakBrowser cho ca đủ. Fahasa (đắt nhất) chỉ chạy khi Tiki/Vinabook không lấp được gap. Cổng đo: nếu eval cho thấy p95 latency ca VN tăng quá ngưỡng (mục J), thêm gợi ý "eager Fahasa cho ISBN tiền tố `978604`/`893`" (quyết định đo được, không đoán trước).
- **D3. Web search chỉ là round cuối, và chỉ hứa những gì parser làm được** (authors/publisher/publishedDate/title). Không quảng cáo nó có thể lấp description/pageCount/categories.
- **D4. Không đổi công thức confidence.** Thêm trạng thái field dựa trên `fieldConfidence` + `agreementCount` + `conflictCount` (đều là tín hiệu deterministic sẵn có).
- **D5. Orchestrator ở `main.py`; logic thuần ở 2 module mới.** Lý do: patch target của test hiện có (`main._fetch_tiki_by_isbn_api`, `main._ddgs_search_one_domain`, …) và tránh di chuyển 4.9k dòng. Module mới không import `main` ⇒ test thuần, không cần sqlalchemy.

---

# C. Field Strategy Matrix

Tier lấy từ `ISBN_QUALITY_WEIGHTS` (`main.py:1643`): **critical** = weight ≥ 2.0; **high** = 1.0–1.5; **supporting** = 0.5; `subtitle` không có trọng số ⇒ *optional* (chỉ hiển thị, không tính coverage, không bao giờ kích hoạt gọi).

| Field | Tier (weight) | Initial (Round 0) | Targeted sources — theo thứ tự chi phí (capability thật của parser) | Điều kiện dừng riêng |
|---|---|---|---|---|
| title | critical (2.0) | Google, OL, [WC] | Tiki, Vinabook → Fahasa → webSearch | có giá trị & không conflict |
| authors | critical (2.0) | Google, OL, [WC] | Vinabook (options), Tiki (specs) → Fahasa → webSearch | có giá trị & không conflict; nếu conflict & không còn provider ⇒ giữ conflict cho staff |
| publisher | high (1.0) | Google, OL | Tiki, Vinabook → Fahasa → webSearch | có giá trị, conf ≥ 0.70, không conflict |
| publishedDate | high (1.0) | Google, OL | Vinabook → Fahasa → webSearch (Tiki: None) | có giá trị |
| description | high (1.5) | Google, OL (+edition/work JSON) | Tiki, Vinabook → Fahasa. **webSearch: không** | có giá trị & ≥ 80 ký tự (khớp `_check_book_quality`) |
| pageCount | high (1.0) | Google, OL | Vinabook → Fahasa. **Tiki/webSearch: không** (parser trả None) | có giá trị (conflict ⇒ cần thêm 1 vote) |
| categories | supporting (0.5) | Google, OL | **Không provider nào** (B3). Tuỳ chọn Task 9: Tiki breadcrumbs / Vinabook `type`,`tags` | không kích hoạt gọi; để Qwen `suggest_categories` + human review |
| language | supporting (0.5) | Google, OL | Fahasa (DOM) — *piggyback*, không kích hoạt gọi riêng | không kích hoạt gọi |
| thumbnail | supporting (0.5) | Google, OL | Tiki, Vinabook, Fahasa — *piggyback* | không kích hoạt gọi |
| subtitle | optional | Google, OL | — | — |

**Quy tắc "đáng gọi":** một provider chỉ được lên lịch nếu nó có capability cho **ít nhất một gap critical/high** còn mở. Field supporting chỉ được lấp "ké" khi provider đó đã được lên lịch vì lý do khác (tránh gọi Fahasa chỉ vì thiếu thumbnail).

**Trạng thái field** (`isbn_coverage.classify_field`):

```
value rỗng?                                   → MISSING
conflictCount > 0 và field ∈ FACTUAL_FIELDS   → CONFLICTED      (authors, publisher, publishedDate, pageCount, title)
                                                 (description/subtitle KHÔNG bao giờ là CONFLICTED: văn bản tự do luôn khác nhau)
fieldConfidence < 0.70                        → LOW_CONFIDENCE  reason=LOW_CONFIDENCE
description < 80 ký tự                        → LOW_CONFIDENCE  reason=SHORT_DESCRIPTION
agreementCount == 1 và field ∈ CORROBORATE_FIELDS (publisher, publishedDate, pageCount) và
      selectedSource ∈ {webSearch}            → LOW_CONFIDENCE  reason=SINGLE_WEAK_SOURCE
else                                          → SUFFICIENT
```

Ngưỡng `0.70` là hằng số có tên (`LOW_CONFIDENCE_THRESHOLD`) để eval hiệu chỉnh; với priors hiện tại nó bắt được webSearch (0.55) và language/authors yếu của nguồn thương mại; **không** bắt Google đơn nguồn (B1) — đúng chủ ý vì Google là nguồn có prior cao nhất và ta không muốn gọi marketplace cho mọi ISBN. Một field LOW_CONFIDENCE/CONFLICTED chỉ kích hoạt gọi nếu còn provider chưa gọi có thể "bỏ phiếu" cho field đó; nếu không, nó giữ nguyên trạng thái và hiển thị cho staff.

---

# D. File-by-file Implementation Plan

## D1. `services/ai-service/isbn_coverage.py` — **Create**
- **Trách nhiệm:** hằng số field + phân loại field + coverage. Thuần, không import `main`.
- **Chuyển vào đây (main re-export để giữ `main.ISBN_*`):** `ISBN_SOURCE_ORDER`, `ISBN_INTELLIGENCE_FIELDS`, `ISBN_QUALITY_WEIGHTS`.
- **Mới:**
  - `FIELD_TIERS: dict[str, str]` (`critical|high|supporting`), `OPTIONAL_FIELDS = {"subtitle"}`, `FACTUAL_FIELDS`, `LOW_CONFIDENCE_THRESHOLD = 0.70`, `MIN_DESCRIPTION_CHARS = 80`.
  - `classify_field(field: str, evidence: dict, confidence: float) -> dict` → `{"status": "MISSING|LOW_CONFIDENCE|CONFLICTED|SUFFICIENT", "reason": str|None}`.
  - `analyze_field_coverage(intelligence: dict) -> dict` → `{"fieldStatus": {...}, "missingFields": [...], "lowConfidenceFields": [...], "conflictedFields": [...], "coverage": {"foundFields": int, "totalFields": 9, "ratio": float, "weightedRatio": float, "byTier": {...}}, "worthCallingGaps": [{"field","status","tier","weight"}], "needsEnrichment": bool}`.
- **Contract impact:** không (nội bộ). **Tests:** `test_isbn_coverage.py` (Task 2).

## D2. `services/ai-service/isbn_targeted.py` — **Create**
- **Trách nhiệm:** capability + planner + ledger. Thuần.
- **Mới:**
  - `PROVIDER_CAPABILITY: dict[str, frozenset[str]]` (bảng mục C, đối chiếu code thật), `PROVIDER_COST: dict[str, str]` (`cheap|expensive|last_resort`), `PROVIDER_MIN_SECONDS: dict[str, float]`, `ROUND_PLAN = ("cheap", "expensive", "last_resort")`, `MAX_ROUNDS = 3`.
  - `class ProviderLedger`: `record(provider, status, phase, reasons, duration_ms)`, `called(provider) -> bool`, `to_sources(...)`, `provider_call_count`.
  - `plan_targeted_retrieval(gaps, ledger, enabled: set[str], round_index: int, remaining_seconds: float) -> list[dict]` → `[{"provider": "tiki", "reasons": ["MISSING:publisher", "MISSING:description"]}]`. Quy tắc: bỏ provider đã gọi; bỏ provider không enabled; bỏ nếu `remaining_seconds < PROVIDER_MIN_SECONDS[p]`; chỉ lấy provider thuộc cost class của round; chỉ lấy nếu capability ∩ worthCallingGaps ≠ ∅; gom mọi field vào **một** lần gọi/provider (batching).
  - `stop_reason(...)`. **Tests:** `test_isbn_targeted.py` (Task 3).

## D3. `services/ai-service/main.py` — **Modify**
| Vị trí | Thay đổi |
|---|---|
| `:1638-1647` | Thay 3 hằng số bằng `from isbn_coverage import ISBN_SOURCE_ORDER, ISBN_INTELLIGENCE_FIELDS, ISBN_QUALITY_WEIGHTS` |
| `:1705` `_build_isbn_intelligence` | Sửa B2: `alternatives = [c for c in confirmations if c is not selected and normalized(c) != selected_normalized]` (giữ nguyên chữ ký hàm) |
| `:144-170` cấu hình | `ENABLE_FIELD_LEVEL_ISBN_RETRIEVAL` (default `false`), `ISBN_LOOKUP_TOTAL_BUDGET_SECONDS` (default `45`, ≤ trần hiện tại 60s = 30+30 của marketplace) |
| `:1444` `_fetch_all_marketplace` | Tách `_fetch_fahasa_provider(isbn13)` (DDGS + `_fetch_first_valid`) và `_fetch_cheap_marketplace(isbn13)` (Tiki ‖ Vinabook). `_fetch_all_marketplace` giữ nguyên chữ ký & hành vi, gọi lại hai hàm này (giữ nguyên tên `_ddgs_search_one_domain`, `_fetch_first_valid`, `_fetch_tiki_by_isbn_api`, `_fetch_vinabook_by_isbn_api` để test cũ còn patch được) |
| mới | `async def _run_field_level_lookup(isbn13, isbn10, generate_summary) -> dict`: orchestrator (mục F). Trả **cùng shape** với nhánh ISBN hợp lệ cũ + `_retrievalTrace` |
| `:2231` `_lookup_book_by_isbn_legacy` | Sau `validation_error` (barcode branch **không đụng**): `if ENABLE_FIELD_LEVEL_ISBN_RETRIEVAL: return await _run_field_level_lookup(...)`; nhánh cũ còn nguyên phía dưới |
| `:2382` `_build_source_statuses` | Nhận thêm `ledger`/`trace` (tham số tuỳ chọn); provider không gọi vì không cần ⇒ `SKIPPED`; `durationMs` theo từng provider; thêm `phase`, `reasons` |
| `:2414` `lookup_book_by_isbn` | Sau `_build_isbn_intelligence`: gọi `analyze_field_coverage` (chạy cả khi flag tắt để eval có baseline) và ghép trường additive (mục E); cache key thêm mode; TTL theo `needsEnrichment`/lỗi provider (mục H); log JSON có cấu trúc (mục K) |
| `:2589` `enrich_book_after_isbn` | Thêm cảnh báo tiếng Việt từ `missingFields` cho `pageCount`/`publishedDate` (không đổi `_check_book_quality`); **không** truyền field factual nào cho Qwen ngoài metadata đã có; không đổi prompt |
| `source_reliability.py` | Hạ prior `language` cho tiki/vinabook/webSearch (B4), có test |

## D4. `services/ai-service/cache.py` — **Modify** (additive)
`SummaryCache.set(key, data, ttl_seconds: int | None = None)` lưu `expires_at`; `get` tôn trọng TTL riêng; hành vi mặc định không đổi. **Tests:** `test_isbn_lookup_cache.py` giữ nguyên 5 test + thêm 4 (Task 8).

## D5. `services/ai-service/eval/*`
- `eval_isbn_extraction.py`: thêm `--mode legacy|field-level|both`, xoá `isbn_lookup_cache` giữa các lần chạy, ghi trace (providerCalls, coverage trước/sau, processingTimeMs); `render_report` thêm bảng so sánh.
- `scoring.py`: hàm thuần `coverage_of(result)`, `fill_rate(results, field)`, `aggregate_field_level_scores(results)`, `compare_modes(legacy, new)`; test trong `test_eval_scoring.py`.
- `isbn_dataset.json`: thêm ≥15 ISBN "gap case" (sách VN Google-thiếu-publisher, sách chỉ có trên Tiki/Vinabook/Fahasa) + trường tuỳ chọn `pageCount`; giữ 25 entry cũ. Ground truth nhập tay từ trang Fahasa/NXB.
- `README.md`: mục 1 cập nhật cách chạy `--mode both`.

## D6. `apps/web`
| File | Thay đổi |
|---|---|
| `services/ai.ts` | `IsbnLookupSource.status` thêm `'SKIPPED'`, thêm `phase?: 'INITIAL'\|'TARGETED'`, `reasons?: string[]`; `IsbnFieldEvidence` thêm `selectionReason?`, `selectedPhase?`; `LookupBookByIsbnResponse` thêm `metadataCoverage?`, `fieldStatus?`, `missingFields?`, `lowConfidenceFields?`, `needsEnrichment?`, `retrieval?` (tất cả optional) |
| `components/pages/ai-import/utils.ts` | `describeFieldStatus(field, status)`; `FIELD_LABELS` (tiếng Việt cho librarian); `hasIsbnEvidence` giữ nguyên |
| `isbn-intelligence-panel.tsx` | Thêm `ReviewDisclosure` "Độ đầy đủ metadata `7/9`": danh sách ✓/⚠ theo field, ghi "Bổ sung từ {source}" cho field `selectedPhase === "TARGETED"`, "Chưa tìm thấy từ nguồn đáng tin cậy" cho MISSING; badge `SKIPPED` variant `neutral`; ẩn hoàn toàn nếu backend chưa gửi `metadataCoverage` (tương thích ngược) |
| `metadata-found-hero.tsx` | Chip nhỏ `Thiếu: mô tả, số trang` khi `needsEnrichment` (một dòng, không thêm số liệu kỹ thuật) |
| `lib/i18n.tsx` | Thêm khoá `isbn_intelligence.coverage`, `.missing`, `.enriched_from`, `.low_confidence`, `.skipped` (vi + en) |
| `isbn-lookup-progress.tsx` | Chỉ kiểm tra: animation staged có còn hợp lý nếu lookup dài hơn; đổi mốc thời gian nếu cần (không đổi cấu trúc) |
| `index.tsx:246` | Không đổi (tab review vẫn chỉ mở theo conflicts/draft) |

Web không có test runner đơn vị (`package.json` chỉ có `test:e2e` playwright) ⇒ kiểm tra bằng `tsc`/lint + preview thủ công (Task 10).

## D7. Inventory service — **không đổi code**
`raw_metadata`/`fieldEvidence` là JSON nên field mới đi qua an toàn. Task 10 thêm bước xác minh thủ công: tạo draft với payload có `metadataCoverage` không lỗi.

---

# E. Data Contract Changes (additive)

**Trước** (rút gọn, sách VN chỉ Google có title+authors, marketplace timeout):
```json
{ "success": true, "found": true, "title": "Nhà Giả Kim", "authors": ["Paulo Coelho"],
  "publisher": null, "description": null, "pageCount": null, "categories": [],
  "sources": [{"name":"googleBooks","status":"SUCCESS","durationMs":2100},
              {"name":"fahasa","status":"TIMEOUT","durationMs":2100}, ...],
  "metadataQualityScore": 0.41, "conflicts": [] }
```

**Sau** (flag bật; mọi field cũ giữ nguyên):
```json
{ "success": true, "found": true, "title": "Nhà Giả Kim", "authors": ["Paulo Coelho"],
  "publisher": "NXB Hội Nhà Văn", "description": "…", "pageCount": 228, "categories": [],
  "fieldEvidence": { "publisher": { "selectedValue": "NXB Hội Nhà Văn", "selectedSource": "vinabook",
      "confirmations": [{"source":"vinabook","value":"NXB Hội Nhà Văn","sourceUrl":"…"}],
      "selectionReason": {"sourceReliability":0.72,"agreementCount":1,"conflictCount":0},
      "selectedPhase": "TARGETED" }, … },
  "sources": [
    {"name":"googleBooks","status":"SUCCESS","durationMs":950,"phase":"INITIAL"},
    {"name":"openLibrary","status":"NOT_FOUND","durationMs":700,"phase":"INITIAL"},
    {"name":"tiki","status":"SUCCESS","durationMs":1200,"phase":"TARGETED","reasons":["MISSING:publisher","MISSING:description"]},
    {"name":"vinabook","status":"SUCCESS","durationMs":1500,"phase":"TARGETED","reasons":["MISSING:publisher","MISSING:pageCount"]},
    {"name":"fahasa","status":"SKIPPED","durationMs":0},
    {"name":"webSearch","status":"SKIPPED","durationMs":0}, {"name":"worldCat","status":"DISABLED","durationMs":0} ],
  "metadataQualityScore": 0.83,
  "metadataCoverage": { "foundFields": 8, "totalFields": 9, "ratio": 0.889, "weightedRatio": 0.94,
      "byTier": {"critical":{"found":2,"total":2},"high":{"found":4,"total":4},"supporting":{"found":2,"total":3}} },
  "fieldStatus": { "title":"SUFFICIENT","authors":"SUFFICIENT","publisher":"SUFFICIENT","publishedDate":"SUFFICIENT",
                   "description":"SUFFICIENT","pageCount":"SUFFICIENT","categories":"MISSING","language":"SUFFICIENT","thumbnail":"SUFFICIENT" },
  "missingFields": ["categories"], "lowConfidenceFields": [], "needsEnrichment": false,
  "retrieval": { "mode":"field-level", "rounds":1, "providerCalls":4, "stopReason":"NO_ELIGIBLE_PROVIDER",
                 "budgetMs":45000, "elapsedMs":3900,
                 "initialCoverage":{"foundFields":3,"totalFields":9,"ratio":0.333},
                 "recoveredFields":["publisher","description","pageCount","publishedDate"],
                 "remainingGaps":["categories"] } }
```

Ghi chú contract:
- `found` **giữ nguyên nghĩa "bookFound"** (title|authors|description). Không thêm alias `bookFound` (YAGNI); TS comment nói rõ. `needsEnrichment` = còn gap critical/high ở trạng thái MISSING/LOW_CONFIDENCE/CONFLICTED (categories thiếu **không** làm `needsEnrichment=true` vì supporting; nó vẫn nằm trong `missingFields`).
- Thêm giá trị `status: "SKIPPED"` (B5) — union TS được mở rộng; UI cũ coi mọi giá trị ≠ SUCCESS/DISABLED là "warning" nên không crash nhưng hiển thị sai ⇒ Task 10 xử lý.
- `metadataCoverage/fieldStatus/...` được thêm **cả khi flag tắt** (baseline eval); `retrieval` chỉ có khi flag bật.
- `confidence` (per-source completeness score cũ) và `confidence.overall` giữ nguyên công thức.

---

# F. Retrieval Algorithm (pseudocode bám code thật)

```python
async def _run_field_level_lookup(isbn13, isbn10, generate_summary):
    t0 = time.perf_counter(); deadline = t0 + ISBN_LOOKUP_TOTAL_BUDGET_SECONDS
    ledger = ProviderLedger(); provider_meta = {name: None for name in ISBN_SOURCE_ORDER}
    outcomes = {}                                     # TIMEOUT/ERROR như _providerOutcomes

    # Round 0 — INITIAL (đã có sẵn hàm)
    std = await _run_standard_lookups(isbn13, isbn10)             # Google ‖ OL ‖ [WC]
    absorb(std, phase="INITIAL")                                   # _unpack_standard + ledger.record

    def analyze():
        intel = _build_isbn_intelligence(provider_meta, statuses_from(ledger))
        return intel, analyze_field_coverage(intel)

    intel, cov = analyze(); initial_cov = cov["coverage"]; quality_before = intel["metadataQualityScore"]
    stop = None
    for round_index in range(MAX_ROUNDS):                          # 0=cheap, 1=expensive, 2=last_resort
        gaps = cov["worthCallingGaps"]
        if not gaps:                     stop = "COVERAGE_OK"; break
        plan = plan_targeted_retrieval(gaps, ledger, enabled_providers(), round_index,
                                       remaining=deadline - time.perf_counter())
        if not plan:                     continue if any later round could apply else (stop="NO_ELIGIBLE_PROVIDER"; break)
        results = await asyncio.gather(*(call_provider(p, isbn13, isbn10, timeout=min(cap(p), remaining))
                                         for p in plan), return_exceptions=True)   # 1 lần/provider
        absorb(results, phase="TARGETED", reasons=plan)            # lỗi 1 provider ≠ lỗi request
        intel, cov = analyze()
        if time.perf_counter() >= deadline: stop = "BUDGET_EXHAUSTED"; break
    else: stop = "MAX_ROUNDS"

    found = bool(intel.metadata.title or authors or description)   # cùng predicate cũ, nhưng trên intelligence
    # nếu không found: trả _manual_entry_response(...) + _providerMetadata/_providerOutcomes như hiện tại
    summary = await _generate_summary_vi_and_keywords(intel.metadata) if generate_summary and found …
    return legacy_shaped_result(intel.metadata, provider_meta, ledger, summary) | {"_providerMetadata": provider_meta,
            "_providerOutcomes": outcomes, "_retrievalTrace": {...}}
```

- `call_provider("fahasa")` = `_fetch_fahasa_provider` (DDGS+browser); `"tiki"/"vinabook"` = `_fetch_cheap_marketplace` tách từng hàm; `"webSearch"` = `_fetch_web_search_fallback(isbn13)`. **Không có provider nào bị gọi hai lần.**
- **Ca "không tìm thấy gì":** title/authors là critical ⇒ gap ⇒ chạy Round 1→3 ⇒ tương đương hành vi cũ (marketplace rồi web) ⇒ `found=False` ⇒ `_manual_entry_response` giữ workflow nhập tay.
- **Quy tắc dừng (tóm tắt):** dừng khi *không còn gap critical/high có provider khả thi* **hoặc** hết ngân sách **hoặc** đủ 3 round. Ngưỡng chất lượng tổng (`metadataQualityScore >= X`) **không** dùng làm điều kiện dừng riêng: score có thể cao nhưng thiếu `description` (1.5) — điều kiện chuẩn là *không còn worthCallingGaps*.
- **Ngân sách thời gian:** Round 0 giữ `BOOK_LOOKUP_TIMEOUT_SECONDS=15`. Mỗi provider nhận `min(timeout_riêng, remaining)`; planner bỏ provider có `PROVIDER_MIN_SECONDS > remaining` (Fahasa cần ≥ 20s vì đo thực ~26s; Tiki/Vinabook ≥ 3s; web ≥ 5s). Mặc định 45s ≤ trần xấu nhất hiện tại (~60s).
- **Không đổi tầng bao ngoài:** `enabled_providers()` = Tiki/Vinabook/Fahasa/web chỉ khi `ENABLE_MARKETPLACE_LOOKUP`; Fahasa còn dựa `ENABLE_FAHA_CLOAKBROWSER` như hiện tại; WorldCat theo `ENABLE_WORLDCAT_LOOKUP`.

---

# G. Error / Timeout Strategy

| Tình huống | Hành vi |
|---|---|
| Provider Round 0 lỗi/timeout | Ghi `TIMEOUT`/`ERROR` vào ledger, provider coi như "đã gọi, không có phiếu"; gap vẫn mở ⇒ chuyển sang round tiếp; **không** thử lại cùng provider |
| Provider targeted lỗi/timeout | Như trên; kết quả 1 provider không ảnh hưởng provider cùng round (`return_exceptions=True` + `wait_for` riêng) |
| Fahasa subprocess treo | Giữ `_run_fahasa_browser_worker` (SIGKILL process group) — không đổi |
| Hết ngân sách giữa chừng | Round hiện tại kết thúc theo timeout đã cắt ngắn; trả **partial metadata**, `stopReason=BUDGET_EXHAUSTED`, `success=True/found=True` nếu có title/authors |
| Toàn bộ provider lỗi | `found=False` ⇒ `_manual_entry_response` (nhập tay); không 500 |
| Exception không lường trước trong orchestrator | `try/except` bao quanh `_run_field_level_lookup`; log + **fallback sang nhánh legacy** (an toàn rollout) |
| Cache | Kết quả có provider `TIMEOUT/ERROR` hoặc `needsEnrichment=True` ⇒ TTL ngắn (mục H) |

---

# H. Caching Strategy

Hiện: `isbn_lookup_cache = SummaryCache(1000, 7d)`, key `isbn13:bool(summary)`, chỉ cache `found` (`cache.py:137`, `main.py:2405,2438`).

1. **Cache kết quả cuối, không cache provider riêng** (YAGNI): ledger sống trong một request. Thêm provider-level cache chỉ khi eval cho thấy provider call rate/rate-limit là vấn đề (có tín hiệu: `providerCalls` trong eval).
2. **Key thêm mode:** `f"{isbn13}:{bool(summary)}:{'fl1' if ENABLE_FIELD_LEVEL_ISBN_RETRIEVAL else 'legacy'}"` — bật/tắt flag không phục vụ payload sai shape. Đổi `_isbn_lookup_cache_key`; cập nhật test cache (5 test cũ vẫn xanh vì chỉ đếm số lần gọi).
3. **TTL theo chất lượng:** đủ (`needsEnrichment=False`, không provider `TIMEOUT/ERROR`) ⇒ 7 ngày như cũ; ngược lại ⇒ `ISBN_INCOMPLETE_CACHE_TTL_SECONDS` = 600s (10 phút, còn chống bấm lặp làm quá tải rate limit). Cần `SummaryCache.set(..., ttl_seconds=)`.
4. **Negative cache:** giữ quyết định hiện tại — không cache `found=False`.
5. **Sửa B8:** áp dụng cho cả nhánh legacy (TTL ngắn khi có provider lỗi) vì cùng hàm wrapper.
6. Enrich endpoint dùng lại lookup (cache) với `generateVietnameseSummary=False`; cache hit không sinh trace mới ⇒ `retrieval.cached=true` (thêm khi trả từ cache) để log/eval không đếm nhầm.

---

# I. Test Plan

File mới `test_isbn_coverage.py`, `test_isbn_targeted.py`, `test_isbn_field_level_lookup.py`; mở rộng `test_isbn_lookup_cache.py`, `test_enrich_book_after_isbn.py`, `test_eval_scoring.py`. Chạy: `cd services/ai-service && python -m unittest test_isbn_coverage test_isbn_targeted test_isbn_field_level_lookup test_isbn_lookup_cache test_enrich_book_after_isbn test_eval_scoring -v` (dùng venv `services/ai-service/.venv`).

| # | Scenario | Setup (mock) | Expected |
|---|---|---|---|
| 1 | Đủ metadata ngay từ đầu | Google + OL trả đủ 9 field, conf cao | 0 lần gọi `_fetch_tiki…`, `_fetch_vinabook…`, `_fetch_first_valid`, `_fetch_web_search_fallback`; `retrieval.rounds==0`, `stopReason=="COVERAGE_OK"`, sources marketplace = `SKIPPED` |
| 2 | **Regression chính:** có title+authors, thiếu description | Google `{title, authors}`; Vinabook có description | `found=True` **và** `_fetch_vinabook…` được gọi; `description` được điền; `fieldEvidence.description.selectedPhase=="TARGETED"` |
| 3 | Thiếu publisher/pageCount | Google `{title,authors}`; Tiki có publisher; Vinabook có publisher+pageCount | Tiki và Vinabook gọi **đúng 1 lần mỗi cái** (batch); `publisher`, `pageCount` điền; `_fetch_first_valid` (Fahasa) **không** gọi vì không còn gap |
| 4 | Low-confidence | Chỉ webSearch có publisher (0.55) | field `LOW_CONFIDENCE`; planner lên lịch provider chưa gọi; sau khi Vinabook trả cùng publisher ⇒ `agreementCount==2`, confidence tăng |
| 5 | Conflict | G="NXB A", Fahasa="NXB B" (B2) | `conflicts` chứa `publisher` với alternative đúng (trước fix: rỗng — viết test đỏ trước); `fieldStatus.publisher=="CONFLICTED"` |
| 6 | Targeted timeout | Google `{title,authors}`; Vinabook raise `asyncio.TimeoutError`; Tiki ok | trả 200 partial; `sources[vinabook].status=="TIMEOUT"`; dữ liệu Tiki vẫn có |
| 7 | Không tìm thấy gì | mọi provider `(None,0.0)` | `found=False`, `manualEntryRequired=True`, web search đã được thử (parity legacy) |
| 8 | Barcode mode | `isbn="8935…"` không hợp lệ + 13 số | `plan_targeted_retrieval` **không** gọi (assert mock); kết quả giữ title/authors (characterization test cho B7) |
| 9 | Cache | 2 lần lookup cùng ISBN | 2nd lần không gọi legacy/field-level; kết quả có `TIMEOUT` ⇒ TTL ngắn (dùng fake clock/`ttl_seconds`); đổi flag ⇒ key khác |
| 10 | Không gọi đắt thừa | Đủ critical+high, thiếu mỗi `categories` | Không provider nào được gọi (supporting không kích hoạt) |
| 11 | Ledger dedup | 3 gap cùng do Vinabook lấp | `vinabook` 1 lần gọi; `providerCalls` đúng |
| 12 | Ngân sách | `remaining=4s` | Fahasa không lên lịch (`PROVIDER_MIN_SECONDS`); `stopReason=="BUDGET_EXHAUSTED"` hoặc `NO_ELIGIBLE_PROVIDER` |
| 13 | Enrich grounding | lookup thiếu publisher | `aiSuggestions` không có key factual mới; Qwen prompt mock không yêu cầu publisher/pageCount; `qualityWarnings` có cảnh báo pageCount |
| 14 | Backward compat | So khoá response flag on/off | Mọi khoá trong Global Constraints còn tồn tại, cùng kiểu |
| 15 | `description` conflict không kích hoạt gọi | G và OL description khác nhau | không `CONFLICTED`, không gọi thêm |

**Test regression #2 (viết đầu tiên, phải đỏ trên code hiện tại):**
```python
async def test_partial_metadata_still_triggers_targeted_retrieval(self):
    google = ({"title": "Nhà Giả Kim", "authors": ["Paulo Coelho"], "categories": []}, 0.35)
    vina = ({"title": "Nhà Giả Kim", "authors": ["Paulo Coelho"], "publisher": "NXB Hội Nhà Văn",
             "description": "Mô tả đủ dài " * 10, "pageCount": 228, "sourceUrl": "https://vinabook.test/p"}, 0.9)
    with patch("main.ENABLE_FIELD_LEVEL_ISBN_RETRIEVAL", True), patch("main.ENABLE_MARKETPLACE_LOOKUP", True), \
         patch("main._run_standard_lookups", new=AsyncMock(return_value=[google, (None, 0.0)])), \
         patch("main._fetch_vinabook_by_isbn_api", new=AsyncMock(return_value=vina)) as vinabook, \
         patch("main._fetch_tiki_by_isbn_api", new=AsyncMock(return_value=(None, 0.0))):
        result = await lookup_book_by_isbn(IsbnLookupRequest(isbn="9786043259988"))
    self.assertTrue(result["found"])
    vinabook.assert_awaited_once()
    self.assertEqual(result["publisher"], "NXB Hội Nhà Văn")
    self.assertEqual(result["fieldEvidence"]["description"]["selectedPhase"], "TARGETED")
```
(ISBN mẫu phải qua `_normalize_and_validate_isbn`; dùng ISBN hợp lệ có checksum đúng khi implement.)

---

# J. Evaluation Plan

Mục tiêu chứng minh: *completeness tăng, accuracy không giảm, latency/provider-call trong kiểm soát*.

| Nhóm | Metric | Cách đo |
|---|---|---|
| Coverage | `coverage_before` (= `retrieval.initialCoverage`) vs `coverage_after`, `weightedRatio` | trace từng ISBN |
| Fill rate | publisher / description / pageCount / categories / publishedDate: tỷ lệ non-empty legacy vs field-level | `scoring.fill_rate` |
| Accuracy | title/authors/publisher/year match (đã có) + pageCount match (dataset mới) | `scoring` hiện có; **ràng buộc:** không giảm quá 1 điểm % so với legacy |
| Provider contribution | với mỗi field: nguồn được chọn (`selectedSource`) & phase | `fieldEvidence` |
| Chi phí | avg/max `retrieval.providerCalls`; số ca gọi Fahasa/web; % ca dừng `COVERAGE_OK` ở round 0 | trace |
| Latency | p50/p95 `processingTimeMs` theo nhóm (quốc tế / VN gap case) | trace |
| Chất lượng nguồn | tỷ lệ `TIMEOUT/ERROR` theo provider | `sources` |

**Tiêu chí bật mặc định (đề xuất, chốt sau khi xem số baseline):** coverage_after ≥ legacy + 10 điểm % trên nhóm gap-case; accuracy title/authors/publisher/year không giảm > 1 điểm %; avg providerCalls ≤ legacy; p95 latency ≤ 45s và không tăng > 25% so với legacy ở nhóm VN. Nếu trượt tiêu chí latency VN ⇒ thêm gợi ý eager-Fahasa theo tiền tố (D2). Báo cáo lưu ở `eval/reports/isbn_field_level_<timestamp>.md`. Eval gọi mạng thật (không CI) — giữ đúng triết lý README hiện có; độ tái lập cho luận văn nhờ chạy `--mode both` cùng phiên và ghi ngày/giờ/flag.

---

# K. Observability

Một dòng log JSON mỗi lookup (không key/secret, không body provider), thêm ở cuối `lookup_book_by_isbn` khi không phải cache hit:
```
isbn_lookup {"isbn":"978…","mode":"field-level","initialCoverage":"3/9","gaps":["publisher","description","pageCount"],
 "rounds":[{"i":0,"providers":["tiki","vinabook"],"recovered":{"tiki":["publisher","description"],"vinabook":["pageCount"]}}],
 "finalCoverage":"8/9","qualityBefore":0.41,"qualityAfter":0.83,"stopReason":"NO_ELIGIBLE_PROVIDER","providerCalls":4,"elapsedMs":3900}
```
Thêm Prometheus histogram/counter vào `metrics.py`: `isbn_lookup_duration_seconds{mode}`, `isbn_provider_calls_total{provider,phase,status}` (cùng style `Histogram` hiện có).

---

# L. Risks

| Rủi ro | Tác động | Giảm thiểu |
|---|---|---|
| Latency ca VN tăng (D2: marketplace không còn song song) | +1–3s ca có gap; ca cần Fahasa tổng ≈ Round0 + 26s | budget 45s, ledger, cổng đo ở mục J, phương án eager-Fahasa theo tiền tố; flag để rollback |
| Rate limit (Tiki/Vinabook/DDGS) | Bị chặn khi gọi nhiều | Mỗi provider ≤1 lần/request; chỉ gọi khi có gap critical/high; TTL ngắn chống bấm lặp; provider cache nếu số liệu cần |
| Scraper Fahasa/DDGS mong manh | Field không về | Lỗi không làm hỏng request; `SKIPPED/TIMEOUT` hiển thị đúng; parser giữ nguyên |
| Metadata sai do nguồn yếu | Ghi sai vào catalog | webSearch giữ reliability thấp + chỉ regex có nhãn; conflict giữ lại; staff review; Qwen không chọn factual |
| Conflict giả (NXB Trẻ vs Nhà xuất bản Trẻ; "2014-05-01" vs "May 2014") | Nhiễu UI/gọi thừa | `CONFLICTED` chỉ kích hoạt gọi khi còn provider chưa bỏ phiếu; Follow-up: so sánh theo khoá chuẩn hoá (bỏ "NXB", lấy năm) — **ngoài phạm vi** vì đổi `conflicts` hiện có |
| Cache cũ | Dữ liệu thiếu dính 7 ngày | TTL theo chất lượng; key theo mode |
| UI phức tạp | Librarian rối | Mặc định gập trong `ReviewDisclosure`; ngôn ngữ nghiệp vụ; 1 chip trên hero |
| Backward compat | Client cũ vỡ | Chỉ thêm field; `SKIPPED` là giá trị union mới nhưng UI cũ xử lý như "warning"; flag off = hành vi cũ + field coverage thêm |
| B7 (barcode xoá metadata) sửa sai | Phá barcode | Characterization test trước; sửa tối thiểu (trả `_providerMetadata`) |
| Language "vi" hard-code thắng Google | Sai ngôn ngữ | Hạ prior (Task 1) |
| Web search hứa quá | Kỳ vọng sai | Bảng capability đúng parser; test khẳng định webSearch không lên lịch cho description/pageCount |

Follow-ups (ngoài phạm vi, ghi lại): (1) chuẩn hoá khoá so sánh publisher/publishedDate; (2) `AUTO_ACCEPT_FIELDS` ở inventory nên để field LOW_CONFIDENCE/CONFLICTED ở `PENDING`; (3) `WorldCat Classify` xác minh còn sống — nếu không thì gỡ; (4) sửa comment sai `:1699`.

---

# M. Final Implementation Order (mỗi phase commit độc lập, flag tắt cho tới Phase 7)

**Task 0 — Characterization & pre-checks (không đổi hành vi).**
Files: Create `test_isbn_field_level_lookup.py` (khung), Modify `test_isbn_lookup_cache.py`.
- [ ] Viết test đặc trưng B7: `lookup_book_by_isbn(IsbnLookupRequest(isbn="<13 số không hợp lệ ISBN>"))` với `_fetch_all_marketplace` mock trả Fahasa có title ⇒ assert `result["title"]`. Chạy: `python -m unittest test_isbn_field_level_lookup -v`. Kỳ vọng: **FAIL nếu B7 đúng** (title None) ⇒ ghi kết quả vào commit message; nếu pass thì bỏ mục B7.
- [ ] Tìm timeout axios của `aiAPI` (`apps/web/src/services/api*`, `lib/`): ghi lại giá trị; nếu < 45s thì thêm vào "Migration" bước nâng timeout hoặc hạ `ISBN_LOOKUP_TOTAL_BUDGET_SECONDS`.
- [ ] Chạy baseline eval hiện tại: `python eval/eval_isbn_extraction.py` → lưu report làm số "legacy" tham chiếu.
- [ ] Commit: `test(ai-service): characterize barcode lookup and baseline`.

**Task 1 — Sửa bug evidence (B2) + prior language (B4).**
Files: Modify `main.py:1705`, `source_reliability.py`, `test_enrich_book_after_isbn.py`.
- [ ] Test đỏ: `{"googleBooks": {"publisher":"NXB A"}, "fahasa": {"publisher":"NXB B"}}` ⇒ `conflicts[0]["field"]=="publisher"`, `selectedSource=="fahasa"`, alternative = googleBooks.
- [ ] Sửa `alternatives` như D3; chạy toàn bộ `test_enrich_book_after_isbn` (test cũ `test_intelligence_prefers_google_and_reports_conflicts` phải vẫn xanh).
- [ ] Hạ `language` prior tiki/vinabook/webSearch (0.4) + test `reliability("tiki","language") < reliability("googleBooks","language")`.
- [ ] Commit: `fix(ai-service): report conflicts when selected source is not first`.

**Task 2 — `isbn_coverage.py` (coverage primitives).**
Files: Create `isbn_coverage.py`, `test_isbn_coverage.py`; Modify `main.py:1638-1647` (re-export).
Interfaces — Produces: `classify_field(field, evidence, confidence) -> {"status","reason"}`, `analyze_field_coverage(intelligence) -> dict` (D1).
- [ ] Test đỏ trước cho 4 trạng thái + tier + `totalFields==9` + `description` ngắn ⇒ LOW_CONFIDENCE + description khác nhau ⇒ không CONFLICTED + `categories` thiếu ⇒ không vào `worthCallingGaps`.
- [ ] Implement tối thiểu; chạy `python -m unittest test_isbn_coverage -v`; chạy lại `test_enrich_book_after_isbn` (import `main.ISBN_*` vẫn hoạt động).
- [ ] Test khẳng định `FIELD_TIERS` khớp `ISBN_QUALITY_WEIGHTS` (weight ≥2 ⇒ critical, 1–1.5 ⇒ high, 0.5 ⇒ supporting).
- [ ] Commit: `feat(ai-service): field coverage analyzer`.

**Task 3 — `isbn_targeted.py` (capability, planner, ledger).**
Files: Create `isbn_targeted.py`, `test_isbn_targeted.py`.
Consumes: `analyze_field_coverage()["worthCallingGaps"]`. Produces: `ProviderLedger`, `plan_targeted_retrieval(gaps, ledger, enabled, round_index, remaining_seconds) -> list[{"provider","reasons"}]`.
- [ ] Test đỏ: thiếu `description`+`pageCount`+`publisher` ⇒ round 0 chọn `["tiki","vinabook"]` (một entry/provider, reasons gộp), không chọn fahasa; round 1 (Tiki/Vinabook đã gọi) chọn `fahasa`; round 2 chọn `webSearch` **chỉ** khi còn `publisher`/`publishedDate`/`authors`/`title` mở; gap chỉ `description` ⇒ round 2 rỗng; provider đã có trong ledger không được chọn; `remaining_seconds=4` ⇒ không có fahasa; provider không enabled bị loại; gap chỉ `categories`/`thumbnail` ⇒ rỗng.
- [ ] Implement; chạy test; commit `feat(ai-service): targeted retrieval planner and ledger`.

**Task 4 — Tách provider marketplace (không đổi hành vi).**
Files: Modify `main.py:1444`.
- [ ] Test hiện có `test_marketplace_provider_timeout_does_not_block_other_sources` phải giữ xanh (trước & sau).
- [ ] Tách `_fetch_fahasa_provider`, `_fetch_cheap_marketplace`; `_fetch_all_marketplace` gọi lại chúng, giữ chữ ký trả về tuple 8 phần tử.
- [ ] Chạy `test_enrich_book_after_isbn`; commit `refactor(ai-service): split marketplace fetch per provider cost`.

**Task 5 — Orchestrator field-level (sau flag).**
Files: Modify `main.py` (config `:144-170`, `_run_field_level_lookup`, `_lookup_book_by_isbn_legacy:2231`), Test `test_isbn_field_level_lookup.py` (test #1,2,3,6,7,10,11,12).
- [ ] Viết test #2 (đoạn code ở mục I) — đỏ vì flag chưa tồn tại; các test còn lại theo bảng.
- [ ] Implement theo pseudocode mục F; `try/except` fallback về nhánh legacy; barcode branch giữ nguyên.
- [ ] Chạy toàn bộ `python -m unittest discover -p "test_*.py" -v` trong `services/ai-service` để bắt vỡ test cũ.
- [ ] Commit `feat(ai-service): field-level ISBN retrieval behind ENABLE_FIELD_LEVEL_ISBN_RETRIEVAL`.

**Task 6 — Contract additive + source statuses.**
Files: Modify `main.py` (`lookup_book_by_isbn`, `_build_source_statuses`), `test_enrich_book_after_isbn.py`, `test_isbn_field_level_lookup.py` (#14).
- [ ] Test: `SKIPPED`, `phase`, `reasons`, per-provider `durationMs`, `metadataCoverage` có cả khi flag tắt; khoá cũ không mất; `test_provider_error_outcome_is_not_reported_as_not_found` vẫn xanh.
- [ ] Implement; commit `feat(ai-service): additive coverage fields and source phases`.

**Task 7 — Enrich guard.**
Files: Modify `main.py:2589`; Test `test_enrich_book_after_isbn.py` (#13).
- [ ] Test đỏ ⇒ thêm cảnh báo từ `missingFields`; xác nhận không truyền field factual cho Qwen; commit `feat(ai-service): surface residual gaps in enrich warnings`.

**Task 8 — Cache.**
Files: Modify `cache.py`, `main.py:2405,2438`, `test_isbn_lookup_cache.py` (#9).
- [ ] Test: `ttl_seconds` riêng hết hạn đúng; key khác theo mode; kết quả có `TIMEOUT` ⇒ TTL ngắn; kết quả đủ ⇒ 7 ngày; 5 test cũ vẫn xanh.
- [ ] Implement; commit `feat(ai-service): quality-aware ISBN cache TTL`.

**Task 9 (tuỳ chọn) — Parser bổ sung field từ response đã có.**
Files: Modify `main.py` (`_fetch_tiki_by_isbn_api`, `_fetch_vinabook_by_isbn_api`, `_parse_vinabook_options`), `isbn_targeted.py` (`PROVIDER_CAPABILITY`), tests + fixtures `tests/fixtures/tiki_detail.json`, `vinabook_product.json`.
- [ ] Lưu response thật (curl một ISBN VN) làm fixture; **chỉ** thêm field nếu có trong response (Tiki `specifications`: số trang/ngày xuất bản; `breadcrumbs`→categories lọc gốc chung "Sách…"; Vinabook `type`/`tags`→categories). Không suy đoán key.
- [ ] Cập nhật capability + test; commit `feat(ai-service): extract pageCount/categories from marketplace responses`.

**Task 10 — Frontend.**
Files: Modify `apps/web/src/services/ai.ts`, `.../ai-import/utils.ts`, `isbn-intelligence-panel.tsx`, `metadata-found-hero.tsx`, `lib/i18n.tsx`, (kiểm tra) `isbn-lookup-progress.tsx`.
- [ ] Cập nhật type (D6) → `cd apps/web && npx tsc --noEmit` xanh.
- [ ] Panel coverage + hero chip + `SKIPPED` badge neutral; ẩn khi không có `metadataCoverage`.
- [ ] Chạy preview (`preview_start`), tra một ISBN với backend flag bật/tắt; xác nhận UI cũ không đổi khi thiếu field mới; chụp màn hình.
- [ ] Xác minh inventory: `POST /api/.../reconciliation` (draft) nhận payload có `metadataCoverage` không lỗi.
- [ ] Commit `feat(web): show metadata completeness in ISBN intelligence panel`.

**Task 11 — Eval + observability.**
Files: Modify `eval/eval_isbn_extraction.py`, `eval/scoring.py`, `eval/isbn_dataset.json`, `eval/README.md`, `test_eval_scoring.py`, `metrics.py`, `main.py` (log JSON).
- [ ] Test thuần cho `fill_rate`, `aggregate_field_level_scores`, `compare_modes` (dữ liệu giả, không mạng).
- [ ] Thêm ≥15 gap-case vào dataset; `--mode both`; báo cáo so sánh.
- [ ] Chạy `python eval/eval_isbn_extraction.py --mode both`; đính báo cáo; đối chiếu tiêu chí mục J.
- [ ] Commit `feat(ai-service): field-level eval and metrics`.

**Task 12 — Rollout.**
- [ ] Bật `ENABLE_FIELD_LEVEL_ISBN_RETRIEVAL=true` trong `.env`/`docker-compose.yml` (dev) → dùng thử; nếu đạt tiêu chí J ⇒ đổi default trong code sang `true`; sau 1 release ổn định, xoá nhánh legacy trong `_lookup_book_by_isbn_legacy` (giữ barcode branch) và flag.
- [ ] Cập nhật `docs/SERVICES/AI_SERVICE.md` (đã nhắc `fieldEvidence`…).

---

# Self-review

**1. Google có `title` nhưng thiếu `publisher`, `description`, `categories`, `pageCount` — plan có tiếp tục tìm đúng các field đó không?**
Có, với giới hạn trung thực: `publisher`/`description`/`pageCount` thuộc critical/high ⇒ `worthCallingGaps` ⇒ Round 1 gọi Tiki+Vinabook (mỗi bên 1 lần, batch), Round 2 gọi Fahasa nếu còn thiếu (`pageCount` chỉ Vinabook/Fahasa lấp được), Round 3 web chỉ cho `publisher`/`publishedDate`. `categories` là supporting và **không provider nào hiện có thể cung cấp** (B3) ⇒ không gọi gì thêm, ghi `missingFields`, để Qwen gợi ý + staff duyệt; Task 9 là con đường tuỳ chọn nếu fixture thật cho thấy Tiki/Vinabook có dữ liệu. Regression test #2 kiểm chứng đúng kịch bản này.

**2. Metadata đã đầy đủ và confidence tốt — có tránh gọi marketplace/browser/web không?**
Có: marketplace không còn chạy ở Round 0; `worthCallingGaps` rỗng ⇒ dừng `COVERAGE_OK` ngay sau Google/OL; test #1 và #10 khẳng định 0 lần gọi Tiki/Vinabook/Fahasa/web, kể cả khi chỉ thiếu `categories`/`thumbnail`. Đánh đổi (D2) là +1–3s cho ca có gap, được đo ở mục J.

**Spec coverage:** mục 3 (coverage) → Task 2; 4 (trạng thái) → Task 2; 5–7 (targeted/dedup/web) → Task 3, 5; 8 (found vs complete) → Task 6; 9–10 (evidence/conflict) → Task 1, 5; 11 (Qwen) → Task 7; 12 (cache) → Task 8; 13 (status) → Task 6; 14 (UI) → Task 10; 15–16 (latency/stop) → mục F, Task 5; 17 (barcode) → Task 0, 5; 18 (compat) → Task 6; 19 (test) → mục I; 20 (eval) → Task 11; 21 (log) → Task 11; 23 (module) → D1–D2; 25 (flag) → Task 12.

**Placeholder scan:** Không có "TBD/TODO". Hai chỗ cố ý để quyết định bằng dữ liệu, có tiêu chí rõ: ngưỡng `LOW_CONFIDENCE_THRESHOLD` (hiệu chỉnh bằng eval) và giá trị timeout axios (Task 0 xác minh).

**Type consistency:** `analyze_field_coverage` → `worthCallingGaps` (Task 2) là input `plan_targeted_retrieval` (Task 3); `ProviderLedger` (Task 3) dùng bởi `_run_field_level_lookup` và `_build_source_statuses` (Task 5/6); tên `selectedPhase`, `stopReason`, `SKIPPED` nhất quán giữa mục E, D6, I.
