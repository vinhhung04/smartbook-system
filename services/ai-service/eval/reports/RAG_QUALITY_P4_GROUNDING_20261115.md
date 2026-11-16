# Phase 4 — Answer grounding and citations (2026-11-15)

Chi tiết, quyết định và rollback: `docs/AI/RAG_QUALITY_ROADMAP.md`, mục Phase 4.

| Lượt | PASS/FAIL/UNV | False refusal | Cit. precision / completeness | Evidence compl. (live) |
|---|---|---:|---|---:|
| `chat_answers_20261114_235359` (trước) | 30/2/1 | 0,000 | 0,633 / 0,80 | 0,95 |
| `chat_answers_20261115_020850` | 28/4/1 | 0,062 | 0,649 / 0,75 | 0,90 |
| `chat_answers_20261115_021650` | 30/3/0 | 0,000 | 0,633 / 0,75 | 0,95 |
| `chat_answers_20261115_022532` (ship) | 28/4/1 | 0,000 | 0,667 / 0,80 | 0,95 |

Citation attribution thử 3 biến thể, không đạt tiêu chí, không ship. Mục tiêu precision ≥ 0,80 / completeness ≥ 0,90: **chưa đạt**.
