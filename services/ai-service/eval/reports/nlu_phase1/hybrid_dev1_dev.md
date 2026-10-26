# NLU Phase 1 benchmark - hybrid_dev1

- {"label": "hybrid_dev1", "mode": "hybrid", "split": "dev", "now": "2026-10-26T10:00:00+07:00", "dataset_sha256": "1a02d2e34d7a6c3cc0c65989fa67cc1f28cc3003afe893232caa17dd71230cea", "run_at": "2026-10-26T14:56:32+07:00", "wall_s": 12.7, "concurrency": 3}

| metric | value |
|---|---|
| intent (capability set exact) | 0.980 (49/50) |
| capability P / R / F1 | 0.985 / 1.0 / 0.993 |
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
| planning ms p50 / p95 | 0.8 / 2938.0 |
| routed planning ms p50 / p95 | 2618.6 / 3579.4 |
| LLM calls (total / per turn / routed turns) | 13 / 0.213 / 13 |
| tokens prompt / completion | 10926 / 2026 |
| cost USD | 0.000507 |

| group | intent exact | caps F1 | tools F1 |
|---|---|---|---|
| ambiguous | n/a | None | None |
| context | 1.000 (4/4) | 1.0 | 1.0 |
| cwi | 1.000 (9/9) | 1.0 | 1.0 |
| informal | 1.000 (7/7) | 1.0 | 1.0 |
| multi_intent | 1.000 (10/10) | 1.0 | 1.0 |
| paraphrase | 0.923 (12/13) | 0.968 | 1.0 |
| security | n/a | None | None |
| simple | 1.000 (7/7) | 1.0 | 1.0 |

## Failures

- `paraphrase-057#0` Nên dồn tiền mua loại sách nào? — gold ['reorder'] pred ['reorder', 'top_borrowed'] tools ['analyze_demand_vs_stock']  merged:+caps[reorder,top_borrowed]
- `ambiguous-167#0` Ai là tác giả được yêu thích nhất ở Mỹ? — gold None pred ['book_search', 'top_borrowed'] tools ['get_top_books', 'search_books']  rules
