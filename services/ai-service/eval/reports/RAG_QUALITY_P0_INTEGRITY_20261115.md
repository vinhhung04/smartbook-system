# Phase 0 — Benchmark integrity (2026-11-15)

Chi tiết, quyết định và rollback: `docs/AI/RAG_QUALITY_ROADMAP.md`, mục Phase 0.

| | BOOK_METADATA | INTERNAL_DOC |
|---|---|---|
| Case (rag_dataset) | 107 | 119 |
| Trusted | 73 (24 có đáp án, 49 không) | 119 |
| UNREACHABLE / PARTIAL | 30 / 2 | 0 / 0 |
| STALE no-answer | bm-093, bm-094, bm-096 | — |
| Nhãn đáng ngờ | bm-036, bm-037, bm-038 | — |

Baseline (HEAD, trusted): BOOK Ans R@5 0,936, MRR 0,964, FPR 0,102 · DOC Ans R@5 0,962, MRR 0,943, FPR 0,30, FNR 0.
Supplement s1 baseline: Ans R@5 0,889 (trusted), TITLE R@1 0,90, ISBN near-miss FPR 1,0.

Lượt chạy: `rag_20261114_232142_p0-baseline.md`, `rag_20261114_232421_p0-supplement-baseline.md` (+ `rag_metrics_*`, `rag_manifest_*`).
Integrity offline: `python eval/rag_integrity.py --report`.
