# Reproducibility Guide

Everything below runs on a developer machine without Docker, without the SmartBook databases and without touching production configuration. Paid steps are marked 💲.

## 1. Code and environment

```bash
git checkout hungg            # study was run at 33c41c7 + the research files under eval/cover_search
cd services/ai-service/eval/cover_search
python -m venv .venv-research
.venv-research/Scripts/python -m pip install torch --extra-index-url https://download.pytorch.org/whl/cpu
.venv-research/Scripts/python -m pip install "transformers==5.17.0" "pillow==12.3.0" "numpy==2.5.3" "httpx==0.28.1" "SQLAlchemy==2.0.52" aiosqlite imagehash scipy matplotlib prometheus-client fastapi python-multipart pytest python-docx
```

Versions used: Python 3.14.3, torch 2.15.0+cpu, transformers 5.17.0, CLIP `openai/clip-vit-base-patch32` (HF revision `3d74acf9a28c67741b2f4f2ea7635f0aaf6f0268`, downloaded on first use into `eval/cover_search/.hf-cache`). `common.setup_environment()` forces `DATABASE_URL=sqlite+aiosqlite:///:memory:` so no research process can reach a real database, and reads only `OPENROUTER_*` keys from the repository `.env` (values are never printed).

## 2. Dataset

The image binaries are not in Git (rights not cleared for every file). Re-create them from the committed CSVs:

```bash
py collect.py          # downloads every row of manifest/selection.csv from Wikimedia Commons, re-reads license metadata
py perturb.py          # Track B derivatives, fixed seeds -> identical files
py dataset_validator.py --check-urls
sha256sum -c ../../../../research-inputs/cover-search-dataset/dataset_hashes.sha256   # run inside the dataset root
```

A Commons file can be changed or deleted after 2026-11-12; `dataset_validator.py` reports such drift (hash mismatch / broken source) instead of silently using a different image.

## 3. Experiments

See `EXPERIMENT_PLAN.md`. Each run writes `runs/<run_id>/predictions.jsonl` (append-only) and `run_manifest_<ts>.json` (git HEAD, dataset file hashes, production parameters, library versions, provider-reported API usage). Re-running the same command resumes; it never overwrites earlier lines.

- CLIP-only: deterministic on CPU given the same image bytes and model revision.
- 💲 OCR-based methods: Qwen responses are recorded once per image in `runs/_cache/ocr_responses.jsonl` and replayed (`--ocr-mode replay`) for every later run, so the *analysis* is exactly reproducible from the recorded responses; a fresh live call can differ (hosted model updates, sampling on the provider side even at temperature 0).
- Query text embeddings are cached in `runs/_cache/text_embeddings.json` via the repository's own `eval/embed_cache.py`.

## 4. Reports and figures

```bash
py generate_report.py --runs E2_clip_test --out results_main --split test
```

All tables and figures in `docs/research/cover-search/results_*` and in `RESEARCH_PAPER.md` are produced by this script from `predictions.jsonl`.

## 5. Tests

```bash
.venv-research/Scripts/python -m pytest -q tests                      # research harness unit tests
cd ../.. && eval/cover_search/.venv-research/Scripts/python -m pytest -q test_cover_search.py   # production unit tests, unchanged
```
