# Book OCR benchmark - 2026-10-23 09:13 UTC

Dataset `eval\book_ocr_eval\smoke_dataset.json` · 3 books · 3 run(s) per book · ISBN lookup off · prompt book-ocr-v2 · **REPLAY** of `eval\reports\book_ocr_20261023_091159.json` (stored model answers replayed through the OCR 2.0 pipeline, no new model call)

| Model | Scans ok | JSON valid | ISBN exact | Title exact | Title normalized | Authors | Publisher | Year | Manual correction (click / type) | Invalid ISBN | Latency mean / p50 / p95 (ms) | Tokens in / out | Cost / book |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| qwen/qwen3.7-flash@1600px | 9/9 | 100.0% | – | 66.7% | 100.0% | 100.0% | 100.0% | – | 81.8% (72.7% / 9.1%) | – | 8110 / 7917 / 9254 | 1818 / 380 | $0.000116 |
| qwen/qwen3.7-flash@2048px | 9/9 | 100.0% | – | 66.7% | 100.0% | 100.0% | 100.0% | – | 81.8% (72.7% / 9.1%) | – | 8065 / 8109 / 8924 | 1818 / 381 | $0.000117 |

Three layers (micro over scored fields): raw = model answer before validation, reading = after validation, autofill = filled without a click.

| Model | Layer | Precision | Recall | F1 | Hallucination | Coverage |
|---|---|---|---|---|---|---|
| qwen/qwen3.7-flash@1600px | raw | 88.2% | 100.0% | 93.8% | 2.9% | 100.0% |
| qwen/qwen3.7-flash@1600px | reading | 88.2% | 100.0% | 93.8% | 2.9% | 100.0% |
| qwen/qwen3.7-flash@1600px | autofill | 100.0% | 18.2% | 30.8% | 0.0% | 18.2% |
| qwen/qwen3.7-flash@2048px | raw | 90.9% | 100.0% | 95.2% | 0.0% | 100.0% |
| qwen/qwen3.7-flash@2048px | reading | 90.9% | 100.0% | 95.2% | 0.0% | 100.0% |
| qwen/qwen3.7-flash@2048px | autofill | 100.0% | 18.2% | 30.8% | 0.0% | 18.2% |

Per-field (reading) precision / recall:

- qwen/qwen3.7-flash@1600px: title 66.7%/100.0%, subtitle 0.0%/–, authors 100.0%/100.0%, translators 100.0%/100.0%, publisher 100.0%/100.0%, publishedYear –/–, isbn13 –/–, pageCount –/–
- qwen/qwen3.7-flash@2048px: title 66.7%/100.0%, subtitle –/–, authors 100.0%/100.0%, translators 100.0%/100.0%, publisher 100.0%/100.0%, publishedYear –/–, isbn13 –/–, pageCount –/–
