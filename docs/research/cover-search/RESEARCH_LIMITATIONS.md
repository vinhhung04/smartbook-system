# Research Limitations and Threats to Validity

## Construct validity

1. **Queries are not smartphone photographs.** Track A queries are independent online scans/photographs made by other contributors (23 same-edition, 14 different-cover); only 6 are camera photos. Track B queries are synthetic perturbations of the gallery image itself and share its pixels, so Track B overestimates real-world performance (H1 tests exactly this gap). Conclusions about real users photographing books in a library are therefore **not** supported by this study.
2. **Historical covers.** 152 of 154 catalog editions predate ISBN; most are 1850–1930 cloth bindings or dust jackets. Modern retail covers (photographic, dense typography, barcodes) are under-represented (7 post-1930 US covers, a handful of modern Vietnamese covers).
3. **No ISBN signal.** Production gives an ISBN substring hit a fixed score of 1.0. No cover here prints an ISBN, so this strong path is never exercised.
4. **Catalog text is minimal** (title, author; no description/summary), whereas production indexes `description` and `summary_vi` too. Semantic matching may behave differently with richer catalog text.

## Internal validity

5. **Keyword branch is emulated, not Postgres.** The OCR text ranking uses production semantic search, RRF and gates, but its full-text branch runs on `pg_fts_emulation.PgSemanticsInMemoryStore` (AND semantics of `plainto_tsquery('simple', unaccent(q))`; `ts_rank` approximated by term frequency; parser approximated). Ordering among several documents that all contain every query word may differ from Postgres. The pilot showed that the repository's default in-memory store (any-token overlap) would have distorted Hybrid results; the emulation removes that distortion but is still an emulation.
6. **Data sources stubbed.** Catalog (`/api/books`) and gallery (`ai_cover_embeddings` via inventory-service) are served in-process. Network latency of those calls, gallery-sync cost and any data drift are excluded from latency figures.
7. **Hybrid latency is reconstructed.** OCR-only makes the live Qwen call; Hybrid replays the same recorded response (same text → paired comparison, half the cost). Hybrid end-to-end latency is reconstructed as max(recorded OCR API latency, CLIP branch) + post-processing, assuming the production `asyncio.gather` concurrency.
8. **Single annotator** (an AI research agent) for identity, edition relation, legibility and rights review; no inter-annotator agreement. Edition sameness for Track A relied on visual comparison plus file descriptions.
9. **Hosted model drift.** `qwen/qwen3.7-flash` is a hosted endpoint; OpenRouter may route to updated snapshots. Recorded responses make the *analysis* reproducible, not the *model output*.

## External validity / statistics

10. **Small Track A** (37 queries, 29 books; 25 queries / 21 books in the test split) gives wide confidence intervals; differences of < ~20 percentage points between methods on Track A are not resolvable.
11. **Vietnamese under-representation**: 40 catalog books (9 Hán-Nôm), 8 Vietnamese negatives and only 2 Vietnamese Track A queries. Vietnamese-specific conclusions rest mainly on Track B and must be read as robustness to perturbation, not as real-world Vietnamese retrieval.
12. **Clustered queries**: 9 perturbations per gallery image and up to 5 Track A queries per book; book-level cluster bootstrap is used, McNemar p-values are descriptive only.
13. **Single configuration**: production parameters were evaluated as deployed; no alternative weights/thresholds were tuned, so the study cannot say what the best configuration is — only how the deployed one behaves.

## Rights

14. 207 of 227 included original images rest on a source-page claim (`SOURCE_CLAIM_ONLY`), mostly US-only public domain. Images are not redistributed; anyone reproducing the study re-downloads them from Wikimedia Commons and should re-check the licence pages.
