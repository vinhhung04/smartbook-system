# NLU Phase 1 benchmark - hybrid_dev2

- {"label": "hybrid_dev2", "mode": "hybrid", "split": "dev", "now": "2026-10-26T10:00:00+07:00", "dataset_sha256": "1a02d2e34d7a6c3cc0c65989fa67cc1f28cc3003afe893232caa17dd71230cea", "run_at": "2026-10-26T14:58:09+07:00", "wall_s": 14.3, "concurrency": 3}

| metric | value |
|---|---|
| intent (capability set exact) | 1.000 (50/50) |
| capability P / R / F1 | 1.0 / 1.0 / 1.0 |
| tool P / R / F1 | 1.0 / 1.0 / 1.0 |
| analysis type | 1.000 (9/9) |
| entity fields | 1.000 (22/22) |
| context resolution | 1.000 (4/4) |
| multi-intent coverage (mean / full) | 1.0 / 1.000 (10/10) |
| clarification recall | 1.000 (4/4) |
| false clarification | 0.000 (0/52) |
| abstention | 0.800 (4/5) |
| security/action violations | 0 |
| planner errors | 0 |
| planning ms p50 / p95 | 0.9 / 3633.7 |
| routed planning ms p50 / p95 | 3129.3 / 3867.0 |
| LLM calls (total / per turn / routed turns) | 13 / 0.213 / 13 |
| tokens prompt / completion | 10926 / 2076 |
| cost USD | 0.000557 |

| group | intent exact | caps F1 | tools F1 |
|---|---|---|---|
| ambiguous | n/a | None | None |
| context | 1.000 (4/4) | 1.0 | 1.0 |
| cwi | 1.000 (9/9) | 1.0 | 1.0 |
| informal | 1.000 (7/7) | 1.0 | 1.0 |
| multi_intent | 1.000 (10/10) | 1.0 | 1.0 |
| paraphrase | 1.000 (13/13) | 1.0 | 1.0 |
| security | n/a | None | None |
| simple | 1.000 (7/7) | 1.0 | 1.0 |

## Failures

- `ambiguous-167#0` Ai là tác giả được yêu thích nhất ở Mỹ? — gold None pred ['book_search', 'top_borrowed'] tools ['get_top_books', 'search_books']  rules
