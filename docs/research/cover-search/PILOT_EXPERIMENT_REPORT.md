# Pilot Experiment Report

Status: **COMPLETED**. Split: `dev` only (27 books). Runs: `runs/PILOT_text_dev/` (v1, live Qwen calls), `runs/PILOT_text_dev_v2/` (v2, replay of the same 5 recorded responses), and the dev part of `runs/E2_clip_all/` (CLIP-only, free).

## 1. What was checked

| Item | How | Result |
|---|---|---|
| Image loading | 1,459 query images + 154 gallery images through the production endpoint (`find_book_by_cover`) | all decoded; 0 endpoint errors |
| CLIP embeddings | production `cover_embeddings.embed_image` | 154/154 gallery + all queries embedded, 512-d, L2 norm 1.0, 0 failures |
| OCR response | 5 live calls to `qwen/qwen3.7-flash` (Track A dev queries Q-EN-0014/0016/0017/0020/0026) | 5/5 valid JSON; titles and authors read correctly (case differs: "The CLANSMAN", "THOMAS DIXON JR") |
| Text matching | production `_score_and_rank_books` | **defect in the harness found — see §2** |
| Fusion ranking | production `_merge_candidates` | behaves as audited (weighted average only when both signals fire; 0.80 / 0.5 gates) |
| Ground truth | correct book ids returned for all 5 pilot queries in v2 | consistent |
| Latency | provider-reported Qwen latency 2.2–5.2 s per call; CLIP query embedding ≈ 0.2 s warm (CPU) | recorded per call |
| API cost | OpenRouter `usage.cost` | **0.00033045 USD for 5 calls** (mean 6.6 × 10⁻⁵ USD; 446–2,574 prompt tokens, 23–33 completion tokens) + 1.6 × 10⁻⁵ USD for text embeddings |
| Error handling | budget cap, replay mode, failure flags | cap enforced before each paid call; replay returns recorded JSON; no failures occurred to classify |

## 2. Harness defect found and fixed (protocol v1.2)

In v1 the OCR branch's keyword search ran on the repository's `InMemoryVectorStore`, which scores any token-substring overlap. With the OCR query *"The Lost King of Oz Ruth Plumly Thompson"* every other Ruth Plumly Thompson / Oz book matched on "the", "of", "oz" and the author tokens, appeared in *both* RRF lists and received normalized OCR scores of 0.976–0.984. In Hybrid this pushed the correct book from rank 1 to rank 5 (Q-EN-0014) and rank 2 (Q-EN-0017, Q-EN-0026), because the correct book's fused score 0.6·v + 0.4·1.0 fell below the OCR-only score of its competitors.

Production uses Postgres `plainto_tsquery('simple', unaccent(q))`, which requires **every** query word. A research store (`pg_fts_emulation.PgSemanticsInMemoryStore`, unit-tested) now reproduces that AND semantics; semantic search, RRF and all gates remain production code. Replaying the same 5 recorded Qwen responses (v2, no new paid calls):

| Query | v1 OCR-only | v1 Hybrid | v2 OCR-only | v2 Hybrid |
|---|---|---|---|---|
| Q-EN-0014 Lost King of Oz | 1 | 5 | 1 | 1 (0.885, visual+ocr) |
| Q-EN-0016 The Clansman | 1 | 1 | 1 | 1 (1.0, ocr only — visual 0.78 < gate) |
| Q-EN-0017 The Clansman | 1 | 2 | 1 | 1 (0.97, visual+ocr) |
| Q-EN-0020 Scarlet Sister Mary | 1 | 1 | 1 | 1 (1.0, ocr only) |
| Q-EN-0026 Country of the Pointed Firs | 1 | 2 | 1 | 1 (0.914, visual+ocr) |

The change was decided on the dev split only, before any test-split OCR query, and is logged in `RESEARCH_PROTOCOL.md` §10. v1 results are kept unmodified as evidence. The phenomenon itself — **adding agreeing visual evidence can lower a book below text-only competitors** — is a property of production fusion (PHASE_0 §4.1) and is examined in the main experiment; v1 only exaggerated how often it triggers.

## 3. Budget decision

The repository has no configured budget; the repository owner approved a hard cap of **1 USD** cumulative provider-reported spend. Estimate for OCR on every remaining query (1,454 calls): **≈ 0.096 USD** (range 0.026–0.118 USD from the min/max pilot call) — an estimate, not an actual cost. The main run (`E13_text_all`) runs with `--max-cost-usd 1.0`.

## 4. Protocol state after the pilot

Frozen as v1.2. No fusion weight, threshold or prompt was changed; nothing was tuned on any split.
