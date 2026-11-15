# Research Protocol — CLIP + Vision-Language OCR Fusion for Book-Cover Retrieval

Version 1.0 — written and frozen **before** any main-experiment query was run (2026-11-12). Any later change is appended to §10 with its reason; results produced under an earlier version are never rewritten.

## 1. Research questions (fixed; not changed in response to results)

- **RQ1** How accurately can CLIP-based visual retrieval identify books from book-cover images?
- **RQ2** Does vision-language OCR improve retrieval compared with visual-only and OCR-only approaches?
- **RQ3** How robust is the multimodal approach under different image-quality conditions?
- **RQ4** What is the trade-off between retrieval accuracy, inference latency and API cost?

## 2. Hypotheses (directional, stated before results)

| ID | Hypothesis | Test |
|---|---|---|
| H1 | CLIP-only Recall@1 on Track A same-edition queries is lower than on Track B (controlled perturbations of the gallery image), because Track B queries share the gallery scan. | Descriptive comparison of the two tracks (different query sets → no paired test). |
| H2 | Hybrid Recall@1 ≥ CLIP-only Recall@1 on Track A. | Paired: ΔRecall@1 with book-level cluster-bootstrap 95% CI; exact McNemar (descriptive). |
| H3 | On Track A `different_cover_same_work` queries, OCR-only outperforms CLIP-only (the visual signal should not transfer across cover designs). | Stratum comparison, descriptive (expected small n). |
| H4 | Hybrid Recall@1 ≥ OCR-only Recall@1 on Track A. | As H2. |
| H5 | On Track B, Recall@1 of CLIP-only degrades most under occlusion and mild crop, least under JPEG compression and brightness change. | Per-transform Recall@1, descriptive. |
| H6 | End-to-end latency of the OCR-based methods is dominated by the vision API call, ≥ 5× the CLIP image-embedding time on CPU. | p50/p95 latency components. |

## 3. Methods compared (all = production code, `routes_cover_search.find_book_by_cover`)

| Method | Definition (only this differs) |
|---|---|
| A — OCR-only | `_match_visual` returns no visual matches. Qwen vision → `{title, author}` → `_score_and_rank_books` (semantic + keyword + RRF) → `_merge_candidates` → gates. |
| B — CLIP-only | `_run_cover_ocr` returns no text. CLIP ViT-B/32 embedding → cosine vs gallery → 0.80 visual gate → `_merge_candidates` → gates. |
| C — Hybrid | Unmodified endpoint: both branches, weighted fusion (0.6 visual / 0.4 OCR when both fire). |

Frozen parameters = production defaults (PHASE_0 §3): CLIP `openai/clip-vit-base-patch32`; vision `qwen/qwen3.7-flash`, temperature 0, max_tokens 200, timeout 20 s; embedding `qwen/qwen3-embedding-8b@768`; visual gate 0.80; confidence gate 0.5; visual weight 0.6; top-5. **No parameter is tuned in this study**; the dev split is used only to shake down the harness (pilot), never to choose weights or thresholds.

Fairness: identical query set, catalog snapshot (one catalog = all included gallery editions; candidate universe identical for every method), ground truth and correctness rule. OCR-only and Hybrid consume the **same recorded vision response** per query image (one paid call per image), so their comparison is paired on identical OCR text.

Known, declared deviation from production: the OCR branch's keyword search runs on the repository's `InMemoryVectorStore` (token-substring overlap) instead of Postgres `plainto_tsquery`+`unaccent`; semantic search, RRF and every gate are production code. The catalog and gallery are served in-process instead of over the Gateway / inventory-service.

## 4. Data and splits

- Catalog/gallery: one front-cover image per included edition (Wikimedia Commons, rights recorded per file).
- **Track A** (primary, real-world-like): queries are *different files* (independent scans or photographs) of a catalog work's cover; strata `same_edition_independent_image` and `different_cover_same_work`.
- **Track B** (robustness): 9 controlled perturbations of every gallery image (`perturb.py`, fixed seeds). Labelled `CONTROLLED_IMAGE_PERTURBATION`; never reported as real photographs; never pooled with Track A.
- **OOC** (E5): front covers of works not in the catalog.
- Split: by `book_id` (all images of a book in one split), deterministic hash `sha256("split|"+book_id)` → first ~15% of books (stratified by language group) = `dev`, rest = `test`. Main results = `test`.

## 5. Correctness rule and outcomes

- Correct = the ground-truth **book id** appears in the returned candidate list; rank = its 1-based position. Edition-level top-1 correctness reported as secondary.
- Outcomes per (query, method): `CORRECT_TOP1`, `CORRECT_TOP5`, `INCORRECT` (answered, GT absent), `NO_RESULT` (`match_found=false`), and for OOC `CORRECT_REJECTION` / `FALSE_ACCEPT`.
- Failure flags reported separately and **never used to drop a query**: `TIMEOUT`, `API_FAILURE`, `MODEL_FAILURE_OCR_INVALID_JSON`, `MODEL_FAILURE_CLIP`, `ENDPOINT_ERROR`. A failed query counts as a miss in the retrieval metrics.

## 6. Metrics

Primary: Recall@1, Recall@5, MRR (book level; MRR uses rank ≤ 5, 0 otherwise).
Secondary: OCR title exact-match (raw NFC), normalized title exact-match, fuzzy title (SequenceMatcher ≥ 0.85 on normalized strings), author exact (normalized) / fuzzy; no-match precision/recall/F1 (positive = abstain), false-positive rate on OOC, false-abstention rate on in-catalog Track A queries; p50/p95 latency (endpoint wall time, CLIP embed time, vision API latency); cost per query from OpenRouter's reported `usage.cost`.
Normalization (matching key only; raw values kept): NFKD, remove combining marks, `đ→d`, casefold, `&→and`, drop punctuation, collapse spaces, drop leading English article. OCR-accuracy excludes queries whose `title_visible = no`.

## 7. Statistics

Book-level cluster bootstrap (10,000 resamples, seed 20261112) for every 95% CI, including paired differences. Exact McNemar on query-level discordant pairs, reported with the caveat that queries sharing a book are not independent. Cohen's h for Recall@1 differences. Track B perturbations of one image are explicitly non-independent (same cluster). With small strata only descriptive statistics are reported.

## 8. Experiments

E0 dataset validation · E1 OCR-only · E2 CLIP-only · E3 Hybrid · E4 robustness (Track B by transform; Track A by condition) · E5 out-of-catalog · E6 latency & cost (cold start = fresh process model load + first embedding; warm = steady-state per-query).

## 9. API budget rule

No OpenRouter budget is configured in the repository. Therefore: pilot ≤ 5 paid vision queries (+ one batched catalog-embedding call and ≤ 5 query-embedding calls), measure provider-reported cost, estimate the main-experiment cost, and run the paid parts of E1/E3/E5 only after the user approves a budget. CLIP-only runs locally and is not budget-limited. No simulated Qwen responses are ever used as results.

## 10. Change log

- v1.0 (2026-11-12): initial frozen protocol.

- v1.1 (2026-11-12, before any main-experiment query): Track A stratum label renamed `different_edition_same_work` → `different_cover_same_work`, because annotation found dust-jacket vs cloth-binding pairs of one edition that are not "different editions"; definition otherwise unchanged.
- v1.2 (2026-11-12, decided on the 5-query dev pilot, before any test-split OCR query): the OCR branch keyword search uses `pg_fts_emulation.PgSemanticsInMemoryStore` (every query lexeme required, unaccent + lowercase, as production `plainto_tsquery('simple', unaccent(q))`) instead of the repository `InMemoryVectorStore` (any-token overlap). The pilot showed the latter inflates RRF scores of same-author/same-series books (e.g. other Oz titles at 0.976) and changes Hybrid rankings, i.e. it misrepresents production. Pilot run v1 is kept unmodified in `runs/PILOT_text_dev/`.
