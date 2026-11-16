# Phase 1 — Retrieval quality (2026-11-15)

Chi tiết, quyết định và rollback: `docs/AI/RAG_QUALITY_ROADMAP.md`, mục Phase 1.

| INTERNAL_DOC | trước | sau |
|---|---:|---:|
| Ans R@1 / R@5 / MRR | 0,924 / 0,962 / 0,943 | 0,924 / 0,962 / 0,943 |
| No-answer acc / FPR / FNR | 0,70 / 0,30 / 0,00 | 0,775 / 0,225 / 0,00 |

BOOK_METADATA không đổi. Keyword `terms` mode bị bác bỏ (`rag_20261114_232505_exp-terms-main.md`, `rag_20261114_232458_exp-terms-supp.md`).
Calibration: `calibration_20261114_232736.md` (val/test hash split). Sau: `rag_20261115_*_final2-main.md`.
Thay đổi: `min_focus_coverage = 0,01` (không trùng từ nội dung nào) cho INTERNAL_DOC.
