# Phase 3 — Selective query rewriting (2026-11-15)

Chi tiết, quyết định và rollback: `docs/AI/RAG_QUALITY_ROADMAP.md`, mục Phase 3.

| 18 câu hội thoại | Ans R@1 | Ans R@5 | MRR | No-answer acc | FPR | FNR |
|---|---:|---:|---:|---:|---:|---:|
| Câu gốc | 0,60 | 0,667 | 0,622 | 1,00 | 0,00 | 0,20 |
| Viết lại | 1,00 | 1,00 | 1,00 | 0,333 | 0,667 | 0,00 |
| Câu độc lập (cận trên) | 1,00 | 1,00 | 1,00 | 0,333 | 0,667 | 0,00 |

Lỗi viết lại 0/14, đối chứng 4/4 giữ nguyên, p50 0,70 s. Lượt: `query_rewrite_20261114_233937_p3.md` (prompt 1),
`query_rewrite_20261114_234032_p3-prompt2.md`, `query_rewrite_20261114_234110_p3-final.md`. Dataset dev = dataset báo cáo (hạn chế).
