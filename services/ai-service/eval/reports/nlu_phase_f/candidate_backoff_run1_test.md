# NLU Phase 1 benchmark - candidate_backoff_run1

- {"label": "candidate_backoff_run1", "mode": "hybrid", "split": "test", "now": "2026-10-26T10:00:00+07:00", "dataset_sha256": "d0bd78f5cc21f5da994f266420f7596c19375152e15c2dc4786fbc59dc73f5f1", "run_at": "2026-11-13T13:46:11+07:00", "wall_s": 19.8, "concurrency": 3}

| metric | value |
|---|---|
| intent (capability set exact) | 0.933 (70/75) |
| capability P / R / F1 | 0.966 / 0.956 / 0.961 |
| tool P / R / F1 | 0.969 / 0.944 / 0.956 |
| analysis type | 0.875 (14/16) |
| entity fields | 1.000 (42/42) |
| context resolution | 0.917 (22/24) |
| multi-intent coverage (mean / full) | 0.85 / 0.800 (8/10) |
| clarification recall | 1.000 (4/4) |
| false clarification | 0.011 (1/88) |
| abstention | 1.000 (7/7) |
| security/action violations | 0 |
| planner errors | 0 |
| planning ms p50 / p95 | 1.1 / 3300.5 |
| routed planning ms p50 / p95 | 2726.2 / 4545.1 |
| LLM calls (total / per turn / routed turns) | 17 / 0.162 / 17 |
| tokens prompt / completion | 14397 / 2695 |
| cost USD | 0.000659 |

| group | intent exact | caps F1 | tools F1 |
|---|---|---|---|
| ambiguous | n/a | None | None |
| context | 0.917 (22/24) | 0.962 | 0.963 |
| cwi | 1.000 (8/8) | 1.0 | 1.0 |
| informal | 1.000 (8/8) | 1.0 | 1.0 |
| multi_intent | 0.900 (9/10) | 0.952 | 0.927 |
| paraphrase | 0.800 (8/10) | 0.87 | 0.87 |
| security | 1.000 (1/1) | 1.0 | 1.0 |
| simple | 1.000 (14/14) | 1.0 | 1.0 |

## Failures

- `f-paraphrase-021#0` Có cần đặt thêm sách từ nhà cung cấp không? — gold ['reorder'] pred ['reorder', 'warehouse_risk'] tools ['get_warehouse_stock_risk', 'get_reorder_suggestions']  merged:+caps[reorder,warehouse_risk]
- `f-paraphrase-023#0` Có độc giả nào giữ sách quá lâu không trả không? — gold ['overdue'] pred ['reservation'] tools ['get_reservation_funnel']  rules
- `f-multi_intent-030#0` Kho nào rủi ro nhất và nên nhập gì cho kho đó? — gold ['reorder', 'warehouse_risk'] pred ['reorder', 'warehouse_risk'] tools [] CLARIFIED  rules
- `f-context-036#1` Những cuốn đó còn đủ tồn kho không? — gold ['top_borrowed', 'warehouse_risk'] pred ['top_borrowed'] tools ['get_top_books']  rules
- `f-context-039#2` Còn kho kia thì sao? — gold ['warehouse_risk'] pred ['reorder', 'warehouse_risk'] tools ['get_warehouse_low_stock_items', 'get_warehouse_stock_risk', 'get_reorder_suggestions']  rules
