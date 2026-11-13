# Results Analysis

All numbers are computed by `generate_report.py`, `fusion_diagnostics.py`, `error_analysis.py`, `latency_benchmark.py` and `cost_analysis.py` from `services/ai-service/eval/cover_search/runs/{E2_clip_all,E13_text_all,E6_latency_*}`; tables: `results_main_test/tables.md` (main, **test split**), `results_all_splits/tables.md` (dev + test, supplementary); machine-readable: `results_main_test/metrics.json`, `fusion_diagnostics.json`, `per_query_errors.json`, `cost.json`, `latency_clip_cold_warm.json`. 95 % CIs = book-level cluster bootstrap (10,000 resamples). Production parameters unchanged; protocol v1.2.

## 1. Main results (test split)

| Track | Method | n (books) | Recall@1 [95 % CI] | Recall@5 | MRR | No result | Incorrect |
|---|---|---|---|---|---|---|---|
| A (independent images) | OCR-only | 25 (21) | **0.960** [0.857, 1.000] | 0.960 | 0.960 | 1 | 0 |
| | CLIP-only | 25 (21) | 0.440 [0.276, 0.619] | 0.440 | 0.440 | 12 | 2 |
| | Hybrid | 25 (21) | 0.920 [0.793, 1.000] | 0.920 | 0.920 | 1 | 1 |
| B (controlled perturbations) | OCR-only | 1,143 (127) | 0.894 [0.843, 0.938] | 0.895 | 0.894 | 82 | 38 |
| | CLIP-only | 1,143 (127) | **0.944** [0.927, 0.959] | 0.949 | 0.946 | 49 | 9 |
| | Hybrid | 1,143 (127) | 0.923 [0.882, 0.958] | **0.961** | 0.935 | 5 | 40 |

Paired differences (Hybrid − single method, same queries):

| Track | Comparison | ΔRecall@1 [95 % CI] | ΔRecall@5 [95 % CI] | McNemar (b10/b01, p, descriptive) | Cohen's h |
|---|---|---|---|---|---|
| A | Hybrid − CLIP-only | **+0.480** [0.286, 0.655] | +0.480 | 0/12, p = 0.0005 | 1.12 |
| A | Hybrid − OCR-only | −0.040 [−0.143, 0.000] | −0.040 | 1/0, p = 1.0 | −0.17 |
| B | Hybrid − CLIP-only | −0.021 [−0.067, 0.018] | +0.011 [−0.023, 0.040] | 74/50, p = 0.038 | −0.09 |
| B | Hybrid − OCR-only | +0.029 [−0.027, 0.087] | **+0.066** [0.013, 0.122] | 64/97, p = 0.011 | 0.10 |

## 2. Research questions

**RQ1 — How accurately does CLIP identify books from covers?** It depends almost entirely on whether the query shows the *same cover design* as the catalog image.
- Controlled perturbations of the catalog image (Track B): Recall@1 0.944; the un-gated cosine ranking (diagnostic, not a method) would reach 0.979 — 40 of the 64 misses are the correct book ranked first by cosine but removed by the 0.80 gate.
- Independent images of the same edition (Track A, same-edition stratum): Recall@1 0.786 (11/14).
- A different cover of the same work (other edition, jacket vs. binding): **0.000** (0/11), as expected for an image-only signal.
- Overall Track A: 0.440; un-gated 0.680. The fixed 0.80 gate is the dominant error source for CLIP-only on real images (6 of 14 Track A misses are gate rejections of a correct top-1; the rejected correct-book cosines were 0.68–0.75).

**RQ2 — Does VLM OCR improve retrieval over visual-only and OCR-only?**
- Over CLIP-only: **yes, strongly on independent images** (Track A +0.48 Recall@1, CI excludes 0); not on Track B, where the query is a perturbed copy of the catalog image (−0.021, CI includes 0).
- Over OCR-only: **no evidence of improvement at rank 1** (Track A −0.04, Track B +0.029, both CIs include 0). Hybrid improves Recall@5 on Track B (+0.066) because visual evidence keeps the correct book in the list when OCR returns no text (82 OCR-only "no text" cases → 5 Hybrid "no result").
- Hybrid is *not* the best of both: in Track B it lost 74 queries CLIP-only answered correctly and 64 that OCR-only answered correctly. `fusion_diagnostics.py` found **61** queries where the correct book carried both signals, the weighted average 0.6·v + 0.4·o fell below a competitor that had only one signal, and the correct book lost rank 1 (49 of them Hán-Nôm covers, see §3).

**RQ3 — Robustness to image quality.** Track B Recall@1 per perturbation (test, n = 127 each):

| Perturbation | OCR-only | CLIP-only | Hybrid |
|---|---|---|---|
| JPEG q20 | 0.921 | 0.992 | 0.945 |
| Low light (×0.45) | 0.906 | 1.000 | 0.929 |
| Low contrast (×0.5) | 0.913 | 1.000 | 0.921 |
| Rotation +4° / −4° | 0.913 / 0.921 | 0.961 / 0.945 | 0.945 / 0.929 |
| Perspective (≤ 8 % corners) | 0.913 | 0.961 | 0.929 |
| Mild crop (3–8 % per side) | 0.890 | 0.937 | 0.945 |
| Gaussian blur (0.4 % of long side) | 0.890 | 0.906 | 0.906 |
| Occlusion (20 % area) | 0.780 | 0.795 | **0.858** |

Occlusion is the hardest condition for every method and the only one where Hybrid clearly exceeds both single methods; photometric changes (JPEG, brightness, contrast) barely affect CLIP. By script, CLIP is equally robust on Hán-Nôm covers (0.972), OCR-only drops to 0.694 there and Hybrid collapses to **0.139** (fusion demotion, §3). On Latin-script covers Hybrid is the best method (0.976 vs 0.942 CLIP, 0.908 OCR). On real independent images (Track A) the photographs (n = 4) were all retrieved by OCR-only and Hybrid; CLIP-only got 1 of 4.

**RQ4 — Accuracy / latency / cost trade-off.**

| | OCR-only | CLIP-only | Hybrid |
|---|---|---|---|
| Endpoint latency, measured (Track B test, p50 / p95) | 2,303 / 6,054 ms (live Qwen + live query embedding) | 191 / 300 ms | — |
| Hybrid end-to-end, reconstructed (OCR ∥ CLIP) | — | — | 2,068 / 3,025 ms |
| Qwen vision API latency (provider, p50 / p95) | 2,033 / 2,990 ms | — | same call |
| CLIP image embedding, warm (CPU, i7-11800H) | — | p50 79 ms, p95 160 ms (`latency_benchmark.py`, n = 40) | |
| CLIP cold start (fresh process, model load + first image) | — | p50 15.1 s, max 18.2 s (n = 3) | |
| Provider-reported cost | 4.6 × 10⁻⁵ USD per query (mean of 1,459 calls; 1,431 prompt + 26 completion tokens) | 0 (local) | same as OCR-only (one call) |

Total provider-reported spend of the whole study: **0.0675 USD** for 1,459 vision calls + ≈ 0.0001 USD for text embeddings, against an approved cap of 1 USD. At these prices 1,000 cover searches cost ≈ 0.046 USD. The OCR call is ~25× slower than a warm CLIP embedding and determines Hybrid latency; CLIP-only is the only option under ~0.3 s.

## 3. Open-set behaviour (E5)

| Method | False-accept rate on 27 test out-of-catalog covers | False abstention on 25 in-catalog Track A queries | No-match F1 |
|---|---|---|---|
| OCR-only | **1.000** (27/27) | 0.040 | undefined (no abstention) |
| CLIP-only | 0.111 (3/27; cos 0.822–0.841) | 0.480 | 0.762 |
| Hybrid | **1.000** (27/27) | 0.040 | undefined |

Any legible out-of-catalog title produces an answer in OCR-only and Hybrid. Cause (confirmed on every case): the semantic branch always returns the nearest catalog book; a book ranked first by only one of the two text branches gets a normalized RRF score of exactly 0.5, which equals the acceptance threshold `COVER_SEARCH_MIN_CONFIDENCE = 0.5` (`>=`). All 27 OCR-only false accepts score 0.5 — and so do some *correct* OCR answers (minimum correct confidence 0.5), so no threshold on this score separates them. The retrieval-confidence module that the chat assistant uses for abstention (`retrieval_confidence.py`) is computed inside `_score_and_rank_books_with_confidence` but discarded by the `_score_and_rank_books` wrapper the cover search calls. Hard negatives were mapped to plausible neighbours (*The Blue Castle* → *Anne of Green Gables*, *The Missing Chums* → *The House on the Cliff*, *The Last Trail* → *Riders of the Purple Sage*), which a user could easily accept.

## 4. Hypotheses (pre-registered in RESEARCH_PROTOCOL.md §2)

| ID | Verdict | Evidence |
|---|---|---|
| H1 CLIP lower on Track A same-edition than on Track B | **Supported** (descriptive) | 0.786 vs 0.944 |
| H2 Hybrid ≥ CLIP-only on Track A | **Supported** | +0.48 [0.29, 0.66] |
| H3 OCR-only > CLIP-only on different-cover queries | **Supported** (small n) | 0.909 vs 0.000 (n = 11) |
| H4 Hybrid ≥ OCR-only on Track A | **Not supported** | −0.04 [−0.14, 0.00]; no query where Hybrid beat OCR-only |
| H5 CLIP degrades most under occlusion and crop, least under JPEG/brightness | **Partly supported** | occlusion worst (0.795), JPEG/brightness/contrast best (0.99–1.00); blur (0.906) was worse than crop (0.937) |
| H6 OCR methods' latency dominated by the API, ≥ 5× CLIP embedding | **Supported** | 2.0 s vs 0.08 s warm (≈ 25×) |

## 5. Supplementary: all splits

`results_all_splits/tables.md` (dev + test; 37 Track A, 1,386 Track B, 36 OOC queries) shows the same ordering: Track A Recall@1 OCR-only 0.973 [0.909, 1.000], Hybrid 0.946 [0.857, 1.000], CLIP-only 0.486 [0.333, 0.649] — see the file for exact values and CIs. The dev split was used only for the 5-query pilot; no parameter was tuned on it.
