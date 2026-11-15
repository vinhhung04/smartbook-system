# Experiment Plan

Implements `RESEARCH_PROTOCOL.md` v1.0. All commands run from `services/ai-service/eval/cover_search/` with the research venv (`.venv-research/Scripts/python.exe`, abbreviated `py`).

| ID | Purpose | Command | Paid API? | Output |
|---|---|---|---|---|
| E0 | Dataset + ground-truth validation | `py dataset_validator.py --check-urls` | No | `reports/validation_results.json`, `dataset_hashes.sha256`, `DATASET_VALIDATION_REPORT.md` |
| P | Pilot (dev split) — harness shake-down, real OCR on ≤ 5 queries | `py run_experiment.py --run-id PILOT_clip --methods clip_only --split dev --clip-diagnostic` then `py run_experiment.py --run-id PILOT_text --methods ocr_only,hybrid --split dev --tracks A --ocr-mode live --max-live-ocr 5 --limit 5` | ≤ 5 vision + ≤ 6 embedding calls | `runs/PILOT_*` |
| E2 | CLIP-only, all tracks (test split) | `py run_experiment.py --run-id E2_clip_test --methods clip_only --split test --clip-diagnostic` | No | `runs/E2_clip_test` |
| E1 + E3 | OCR-only and Hybrid (test split) | `py run_experiment.py --run-id E13_text_test --methods ocr_only,hybrid --split test --ocr-mode live --max-live-ocr <approved N>` | **Yes — only after budget approval** | `runs/E13_text_test` |
| E4 | Robustness | Track B rows of E1–E3 (`--tracks B`) and Track A by `image_condition` | E2 part free; E1/E3 part paid | strata tables |
| E5 | Out-of-catalog | OOC rows of E1–E3 (`--tracks OOC`) | E2 part free | abstention table |
| E6 | Latency & cost | `py latency_benchmark.py --images 30 --cold-runs 3`; `py cost_analysis.py --planned-calls <N>` | No (reads recorded usage) | `runs/E6_latency_*`, cost JSON |
| R | Report | `py generate_report.py --runs <ids> --out results_<name> --split test` | No | `docs/research/cover-search/results_*` |

Execution order: E0 → P → E2 → E6 (local) → [budget gate] → E1/E3 → E4/E5 paid parts → R.

Stopping rules: a run stops before the next paid call once `--max-live-ocr` is reached; results already written stay (append-only); a re-run resumes from the last written (query, method).
