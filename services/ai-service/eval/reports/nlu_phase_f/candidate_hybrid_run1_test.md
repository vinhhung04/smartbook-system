# NLU Phase 1 benchmark - candidate_hybrid_run1

- {"label": "candidate_hybrid_run1", "mode": "hybrid", "split": "test", "now": "2026-10-26T10:00:00+07:00", "dataset_sha256": "d0bd78f5cc21f5da994f266420f7596c19375152e15c2dc4786fbc59dc73f5f1", "run_at": "2026-11-13T12:48:42+07:00", "wall_s": 15.3, "concurrency": 3}

| metric | value |
|---|---|
| intent (capability set exact) | 0.893 (67/75) |
| capability P / R / F1 | 0.965 / 0.921 / 0.943 |
| tool P / R / F1 | 0.967 / 0.91 / 0.938 |
| analysis type | 0.875 (14/16) |
| entity fields | 1.000 (42/42) |
| context resolution | 0.917 (22/24) |
| multi-intent coverage (mean / full) | 0.85 / 0.800 (8/10) |
| clarification recall | 1.000 (4/4) |
| false clarification | 0.011 (1/88) |
| abstention | 1.000 (7/7) |
| security/action violations | 0 |
| planner errors | 0 |
| planning ms p50 / p95 | 0.8 / 2500.4 |
| routed planning ms p50 / p95 | 2342.2 / 2888.0 |
| LLM calls (total / per turn / routed turns) | 14 / 0.133 / 17 |
| tokens prompt / completion | 11872 / 2056 |
| cost USD | 0.000485 |

| group | intent exact | caps F1 | tools F1 |
|---|---|---|---|
| ambiguous | n/a | None | None |
| context | 0.917 (22/24) | 0.962 | 0.963 |
| cwi | 1.000 (8/8) | 1.0 | 1.0 |
| informal | 1.000 (8/8) | 1.0 | 1.0 |
| multi_intent | 0.900 (9/10) | 0.952 | 0.927 |
| paraphrase | 0.600 (6/10) | 0.737 | 0.737 |
| security | 1.000 (1/1) | 1.0 | 1.0 |
| simple | 0.929 (13/14) | 0.963 | 0.963 |

## Failures

- `f-simple-007#0` Có bao nhiêu lượt đặt trước đã hết hạn mà chưa lấy? — gold ['reservation'] pred [] tools []  fallback:HTTPStatusError
- `f-paraphrase-015#0` Gần đây độc giả có còn hay đến mượn sách không? — gold ['borrow_trend'] pred [] tools []  fallback:HTTPStatusError
- `f-paraphrase-017#0` Có đầu sách nào sắp không đủ cho độc giả mượn không? — gold ['warehouse_risk'] pred [] tools []  fallback:HTTPStatusError
- `f-paraphrase-021#0` Có cần đặt thêm sách từ nhà cung cấp không? — gold ['reorder'] pred ['reorder', 'warehouse_risk'] tools ['get_warehouse_stock_risk', 'get_reorder_suggestions']  merged:+caps[reorder,warehouse_risk]
- `f-paraphrase-023#0` Có độc giả nào giữ sách quá lâu không trả không? — gold ['overdue'] pred ['reservation'] tools ['get_reservation_funnel']  rules
- `f-multi_intent-030#0` Kho nào rủi ro nhất và nên nhập gì cho kho đó? — gold ['reorder', 'warehouse_risk'] pred ['reorder', 'warehouse_risk'] tools [] CLARIFIED  rules
- `f-context-036#1` Những cuốn đó còn đủ tồn kho không? — gold ['top_borrowed', 'warehouse_risk'] pred ['top_borrowed'] tools ['get_top_books']  rules
- `f-context-039#2` Còn kho kia thì sao? — gold ['warehouse_risk'] pred ['reorder', 'warehouse_risk'] tools ['get_warehouse_low_stock_items', 'get_warehouse_stock_risk', 'get_reorder_suggestions']  rules
