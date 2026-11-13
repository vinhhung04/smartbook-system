# Experiment Execution Log (UTC, 2026-11-11/12)

| Time | Step | Result |
|---|---|---|
| ~20:10 | Phase 0 audit, branch `hungg` @ 33c41c7 | production files unchanged throughout (`production_files_dirty` empty in every run manifest) |
| 20:30–21:55 | Phase 1 collection (Wikidata SPARQL, Commons API, upload.wikimedia.org) | en.wikipedia 429 → switched to SPARQL; media server 429 "robot policy" → **stopped**, resumed after owner approved repo URL in User-Agent; 274 files, 0 failures |
| ~21:58 | Annotation, build_dataset, perturb (1,386 derivatives), rights_review | 154 books, 1,459 queries |
| 22:01 | E0 `dataset_validator.py --check-urls` | 0 BLOCKING, 0 broken URLs |
| 22:03–22:12 | E2 `run_experiment.py --run-id E2_clip_all --methods clip_only --split all --clip-diagnostic` | 1,459/1,459, 0 failures, cost 0 |
| 22:12–22:13 | Pilot `PILOT_text_dev` (5 live Qwen calls) | 0.00033 USD; harness keyword-store defect found |
| 22:15 | Pilot v2 (replay, pg_fts_emulation) | protocol v1.2 frozen |
| 22:17–23:30 | E1+E3 `E13_text_all --methods ocr_only,hybrid --split all --ocr-mode live --max-cost-usd 1.0` | 1,454 live calls, 1 invalid JSON, 0 timeouts; 0.0672 USD vision + 0.00006 USD embeddings |
| 23:32 | E6 `latency_benchmark.py --images 40 --cold-runs 3` | CLIP warm p50 79 ms, cold ≈ 15 s |
| 23:35– | `generate_report.py`, `error_analysis.py`, `fusion_diagnostics.py`, `cost_analysis.py` | `results_main_test/`, `results_all_splits/` |
| after | Paper: `RESEARCH_PAPER.md` → `build_paper_docx.py` (template NHD82_NCKH_demo16.docx) → Word → PDF (5 pages) | `Research_Paper.docx/.pdf` |

Total provider-reported API spend: **0.0676 USD** (cap 1 USD). Nothing was re-run over existing results; every run directory is append-only.
