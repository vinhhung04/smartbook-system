# Book OCR benchmark - 2026-10-23 09:13 UTC

Dataset `eval\book_ocr_eval\smoke_dataset.json` · 3 books · 3 run(s) per book · ISBN lookup off · prompt book-ocr-v2 · **REPLAY** of `eval\reports\book_ocr_20261023_134306.json` (stored model answers replayed through the OCR 1.0 pipeline of commit 076c729, no new model call)

| Model | Scans ok | JSON valid | ISBN exact | Title exact | Title normalized | Authors | Publisher | Year | Manual correction (click / type) | Invalid ISBN | Latency mean / p50 / p95 (ms) | Tokens in / out | Cost / book |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| qwen/qwen3.7-flash | 9/9 | 100.0% | – | 66.7% | 100.0% | 100.0% | 100.0% | – | 9.1% (0.0% / 9.1%) | – | 8648 / 8295 / 11586 | 1818 / 392 | $0.000116 |

Three layers (micro over scored fields): raw = model answer before validation, reading = after validation, autofill = filled without a click.

| Model | Layer | Precision | Recall | F1 | Hallucination | Coverage |
|---|---|---|---|---|---|---|
| qwen/qwen3.7-flash | raw | 90.9% | 100.0% | 95.2% | 0.0% | 100.0% |
| qwen/qwen3.7-flash | reading | 90.9% | 100.0% | 95.2% | 0.0% | 100.0% |
| qwen/qwen3.7-flash | autofill | 90.9% | 100.0% | 95.2% | 0.0% | 100.0% |

Per-field (reading) precision / recall:

- qwen/qwen3.7-flash: title 66.7%/100.0%, subtitle –/–, authors 100.0%/100.0%, translators 100.0%/100.0%, publisher 100.0%/100.0%, publishedYear –/–, isbn13 –/–, pageCount –/–
