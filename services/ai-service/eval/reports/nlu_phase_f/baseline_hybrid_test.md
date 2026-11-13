# NLU Phase 1 benchmark - baseline_hybrid

- {"label": "baseline_hybrid", "mode": "hybrid", "split": "test", "now": "2026-10-26T10:00:00+07:00", "dataset_sha256": "d0bd78f5cc21f5da994f266420f7596c19375152e15c2dc4786fbc59dc73f5f1", "run_at": "2026-11-13T12:23:06+07:00", "wall_s": 16.0, "concurrency": 3}

| metric | value |
|---|---|
| intent (capability set exact) | 0.933 (70/75) |
| capability P / R / F1 | 0.966 / 0.956 / 0.961 |
| tool P / R / F1 | 0.968 / 0.944 / 0.956 |
| analysis type | 0.875 (14/16) |
| entity fields | 0.857 (36/42) |
| context resolution | 0.750 (18/24) |
| multi-intent coverage (mean / full) | 0.85 / 0.800 (8/10) |
| clarification recall | 0.750 (3/4) |
| false clarification | 0.011 (1/88) |
| abstention | 1.000 (7/7) |
| security/action violations | 0 |
| planner errors | 0 |
| planning ms p50 / p95 | 0.7 / 2880.0 |
| routed planning ms p50 / p95 | 2740.0 / 3512.6 |
| LLM calls (total / per turn / routed turns) | 17 / 0.162 / 17 |
| tokens prompt / completion | 14397 / 2594 |
| cost USD | 0.0006 |

| group | intent exact | caps F1 | tools F1 |
|---|---|---|---|
| ambiguous | n/a | None | None |
| context | 0.917 (22/24) | 0.962 | 0.962 |
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
- `f-context-035#1` Trong số đó, cuốn nào được mượn nhiều nhất? — gold ['top_borrowed'] pred ['top_borrowed'] tools ['get_top_books'] {'subset': False} rules
- `f-context-035#2` Nếu nhập thêm những cuốn đó thì sao? — gold ['reorder'] pred ['reorder'] tools ['get_reorder_suggestions'] {'subset': False} rules
- `f-context-036#1` Những cuốn đó còn đủ tồn kho không? — gold ['top_borrowed', 'warehouse_risk'] pred ['top_borrowed'] tools ['get_top_books'] {'subset': False} rules
- `f-context-039#1` Kho nào cần ưu tiên bổ sung hơn? — gold ['reorder', 'warehouse_risk'] pred ['reorder', 'warehouse_risk'] tools ['get_warehouse_stock_risk', 'get_reorder_suggestions'] {'wh': False} rules
- `f-context-039#2` Còn kho kia thì sao? — gold ['warehouse_risk'] pred ['reorder', 'warehouse_risk'] tools ['compare_warehouses', 'get_reorder_suggestions'] {'wh': False} rules
- `f-context-045#1` Trong số đó, cuốn nào đang được mượn nhiều? — gold ['top_borrowed'] pred ['top_borrowed'] tools ['get_top_books'] {'subset': False} rules
- `f-ambiguous-064#0` Chi nhánh Hà Nội đang thiếu sách gì? — gold None pred ['warehouse_risk'] tools ['get_warehouse_low_stock_items', 'get_warehouse_stock_risk']  rules
