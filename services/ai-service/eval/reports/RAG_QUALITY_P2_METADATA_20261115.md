# Phase 2 — Metadata-aware retrieval (2026-11-15)

Chi tiết, quyết định và rollback: `docs/AI/RAG_QUALITY_ROADMAP.md`, mục Phase 2.

| Supplement s2 (trusted) | trước | sau |
|---|---:|---:|
| Ans R@1 / R@5 / MRR | 0,674 / 0,870 / 0,897 | 0,709 / 0,905 / 0,931 |
| TITLE R@1 | 0,90 | 1,00 |
| ISBN near-miss FPR | 1,00 | 0,00 |
| Category R@5 | 0,079 | 0,079 (soft filter gỡ bỏ) |

rag_dataset trusted: không đổi. Lượt chạy: `rag_20261114_233125_p2-before.md`, `rag_20261115_020418_final-supp.md`, `rag_20261115_020414_final-main.md`.
