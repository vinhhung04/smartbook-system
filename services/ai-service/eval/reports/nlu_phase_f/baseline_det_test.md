# NLU Phase 1 benchmark - baseline_det

- {"label": "baseline_det", "mode": "det", "split": "test", "now": "2026-10-26T10:00:00+07:00", "dataset_sha256": "d0bd78f5cc21f5da994f266420f7596c19375152e15c2dc4786fbc59dc73f5f1", "run_at": "2026-11-13T12:22:26+07:00", "wall_s": 0.1, "concurrency": 3}

| metric | value |
|---|---|
| intent (capability set exact) | 0.813 (61/75) |
| capability P / R / F1 | 0.974 / 0.844 / 0.905 |
| tool P / R / F1 | 0.977 / 0.856 / 0.912 |
| analysis type | 0.875 (14/16) |
| entity fields | 0.857 (36/42) |
| context resolution | 0.708 (17/24) |
| multi-intent coverage (mean / full) | 0.85 / 0.800 (8/10) |
| clarification recall | 0.500 (2/4) |
| false clarification | 0.011 (1/88) |
| abstention | 1.000 (7/7) |
| security/action violations | 0 |
| planner errors | 0 |
| planning ms p50 / p95 | 0.8 / 1.1 |
| routed planning ms p50 / p95 | None / None |
| LLM calls (total / per turn / routed turns) | 0 / 0.0 / 0 |
| tokens prompt / completion | 0 / 0 |
| cost USD | 0 |

| group | intent exact | caps F1 | tools F1 |
|---|---|---|---|
| ambiguous | n/a | None | None |
| context | 0.875 (21/24) | 0.943 | 0.945 |
| cwi | 1.000 (8/8) | 1.0 | 1.0 |
| informal | 0.875 (7/8) | 0.933 | 0.933 |
| multi_intent | 0.700 (7/10) | 0.9 | 0.927 |
| paraphrase | 0.400 (4/10) | 0.533 | 0.533 |
| security | 1.000 (1/1) | 1.0 | 1.0 |
| simple | 0.929 (13/14) | 0.963 | 0.963 |

## Failures

- `f-simple-007#0` Có bao nhiêu lượt đặt trước đã hết hạn mà chưa lấy? — gold ['reservation'] pred [] tools []  
- `f-paraphrase-015#0` Gần đây độc giả có còn hay đến mượn sách không? — gold ['borrow_trend'] pred [] tools []  
- `f-paraphrase-017#0` Có đầu sách nào sắp không đủ cho độc giả mượn không? — gold ['warehouse_risk'] pred [] tools []  
- `f-paraphrase-018#0` Cuốn nào đang được săn đón nhất? — gold ['top_borrowed'] pred [] tools []  
- `f-paraphrase-020#0` Những cuốn nào bị bỏ quên trên kệ lâu rồi? — gold ['aging'] pred [] tools []  
- `f-paraphrase-021#0` Có cần đặt thêm sách từ nhà cung cấp không? — gold ['reorder'] pred [] tools []  
- `f-paraphrase-023#0` Có độc giả nào giữ sách quá lâu không trả không? — gold ['overdue'] pred ['reservation'] tools ['get_reservation_funnel']  
- `f-multi_intent-030#0` Kho nào rủi ro nhất và nên nhập gì cho kho đó? — gold ['reorder', 'warehouse_risk'] pred ['reorder', 'warehouse_risk'] tools [] CLARIFIED  
- `f-multi_intent-031#0` Các chỉ số chính hôm nay, kèm theo những việc cần ưu tiên — gold ['kpi', 'priority'] pred ['kpi'] tools ['get_dashboard_kpis']  
- `f-multi_intent-034#0` Đầu sách nào đang thiếu ở kho Cần Thơ và đề xuất nhập cho kho đó là gì? — gold ['reorder', 'warehouse_risk'] pred ['reorder'] tools ['get_warehouse_low_stock_items', 'get_warehouse_stock_risk', 'get_reorder_suggestions']  
- `f-context-035#1` Trong số đó, cuốn nào được mượn nhiều nhất? — gold ['top_borrowed'] pred ['top_borrowed'] tools ['get_top_books'] {'subset': False} 
- `f-context-035#2` Nếu nhập thêm những cuốn đó thì sao? — gold ['reorder'] pred ['reorder'] tools ['get_reorder_suggestions'] {'subset': False} 
- `f-context-036#1` Những cuốn đó còn đủ tồn kho không? — gold ['top_borrowed', 'warehouse_risk'] pred ['top_borrowed'] tools ['get_top_books'] {'subset': False} 
- `f-context-039#1` Kho nào cần ưu tiên bổ sung hơn? — gold ['reorder', 'warehouse_risk'] pred ['reorder', 'warehouse_risk'] tools ['get_warehouse_stock_risk', 'get_reorder_suggestions'] {'wh': False} 
- `f-context-039#2` Còn kho kia thì sao? — gold ['warehouse_risk'] pred ['reorder', 'warehouse_risk'] tools ['compare_warehouses', 'get_reorder_suggestions'] {'wh': False} 
- `f-context-043#2` Nên làm gì để khắc phục? — gold ['reorder', 'warehouse_risk'] pred ['warehouse_risk'] tools ['get_warehouse_low_stock_items', 'get_warehouse_stock_risk']  
- `f-context-045#1` Trong số đó, cuốn nào đang được mượn nhiều? — gold ['top_borrowed'] pred ['top_borrowed'] tools ['get_top_books'] {'subset': False} 
- `f-informal-055#0` hnay can lam gi truoc — gold ['priority'] pred [] tools []  
- `f-ambiguous-064#0` Chi nhánh Hà Nội đang thiếu sách gì? — gold None pred ['warehouse_risk'] tools ['get_warehouse_low_stock_items', 'get_warehouse_stock_risk']  
- `f-ambiguous-066#0` Cuốn thứ tư thì thế nào? — gold None pred [] tools []  
