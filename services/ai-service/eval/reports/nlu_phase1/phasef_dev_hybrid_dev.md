# NLU Phase 1 benchmark - phasef_dev_hybrid

- {"label": "phasef_dev_hybrid", "mode": "hybrid", "split": "dev", "now": "2026-10-26T10:00:00+07:00", "dataset_sha256": "1a02d2e34d7a6c3cc0c65989fa67cc1f28cc3003afe893232caa17dd71230cea", "run_at": "2026-11-13T12:46:11+07:00", "wall_s": 12.2, "concurrency": 3}

| metric | value |
|---|---|
| intent (capability set exact) | 0.920 (46/50) |
| capability P / R / F1 | 0.97 / 0.97 / 0.97 |
| tool P / R / F1 | 0.985 / 0.97 / 0.978 |
| analysis type | 1.000 (9/9) |
| entity fields | 1.000 (22/22) |
| context resolution | 1.000 (4/4) |
| multi-intent coverage (mean / full) | 1.0 / 1.000 (10/10) |
| clarification recall | 1.000 (4/4) |
| false clarification | 0.000 (0/52) |
| abstention | 0.800 (4/5) |
| security/action violations | 0 |
| planner errors | 0 |
| planning ms p50 / p95 | 0.8 / 2776.9 |
| routed planning ms p50 / p95 | 2367.9 / 3793.5 |
| LLM calls (total / per turn / routed turns) | 11 / 0.18 / 13 |
| tokens prompt / completion | 9245 / 1669 |
| cost USD | 0.000371 |

| group | intent exact | caps F1 | tools F1 |
|---|---|---|---|
| ambiguous | n/a | None | None |
| context | 1.000 (4/4) | 1.0 | 1.0 |
| cwi | 1.000 (9/9) | 1.0 | 1.0 |
| informal | 1.000 (7/7) | 1.0 | 1.0 |
| multi_intent | 1.000 (10/10) | 1.0 | 1.0 |
| paraphrase | 0.692 (9/13) | 0.867 | 0.897 |
| security | n/a | None | None |
| simple | 1.000 (7/7) | 1.0 | 1.0 |

## Failures

- `paraphrase-028#0` Có vấn đề gì đáng lo trong kho không? — gold ['warehouse_risk'] pred ['aging', 'warehouse_risk'] tools ['get_warehouse_stock_risk', 'get_aging_inventory']  merged:+caps[warehouse_risk,aging]
- `paraphrase-035#0` Cần làm gì để giảm nguy cơ thiếu sách? — gold ['reorder', 'warehouse_risk'] pred ['warehouse_risk'] tools ['get_warehouse_stock_risk']  fallback:HTTPStatusError
- `paraphrase-046#0` Thư viện đang vận hành ổn chứ? — gold ['kpi'] pred [] tools []  fallback:HTTPStatusError
- `paraphrase-057#0` Nên dồn tiền mua loại sách nào? — gold ['reorder'] pred ['reorder', 'top_borrowed'] tools ['analyze_demand_vs_stock']  merged:+caps[reorder,top_borrowed]
- `ambiguous-167#0` Ai là tác giả được yêu thích nhất ở Mỹ? — gold None pred ['book_search', 'top_borrowed'] tools ['get_top_books', 'search_books']  rules
