# NLU Phase 1 benchmark - baseline_det

- {"label": "baseline_det", "mode": "det", "split": "val", "now": "2026-10-26T10:00:00+07:00", "dataset_sha256": "1e7a00cf5e149d12c3ac8017f241b3678d525a971a4f63c92b2e71fe1d706fcc", "run_at": "2026-10-26T14:44:19+07:00", "wall_s": 0.1, "concurrency": 3}

| metric | value |
|---|---|
| intent (capability set exact) | 0.756 (34/45) |
| capability P / R / F1 | 0.978 / 0.772 / 0.863 |
| tool P / R / F1 | 0.976 / 0.789 / 0.873 |
| analysis type | 1.000 (10/10) |
| entity fields | 0.864 (19/22) |
| context resolution | 0.833 (10/12) |
| multi-intent coverage (mean / full) | 0.792 / 0.667 (8/12) |
| clarification recall | 1.000 (1/1) |
| false clarification | 0.020 (1/50) |
| abstention | 1.000 (4/4) |
| security/action violations | 0 |
| planner errors | 0 |
| planning ms p50 / p95 | 0.8 / 1.3 |
| routed planning ms p50 / p95 | None / None |
| LLM calls (total / per turn / routed turns) | 0 / 0.0 / 0 |
| tokens prompt / completion | 0 / 0 |
| cost USD | 0 |

| group | intent exact | caps F1 | tools F1 |
|---|---|---|---|
| ambiguous | 0.000 (0/1) | 0.0 | 0.0 |
| context | 1.000 (12/12) | 1.0 | 1.0 |
| cwi | 1.000 (5/5) | 1.0 | 1.0 |
| informal | 1.000 (5/5) | 1.0 | 1.0 |
| multi_intent | 0.583 (7/12) | 0.842 | 0.872 |
| paraphrase | 0.200 (1/5) | 0.286 | 0.286 |
| security | n/a | None | None |
| simple | 0.800 (4/5) | 0.8 | 0.8 |

## Failures

- `simple-016#0` Có bao nhiêu sách đang được mượn chưa trả? — gold ['kpi'] pred ['overdue'] tools ['get_overdue_summary']  
- `paraphrase-031#0` Quyển nào được nhiều người tìm nhưng không đủ cho mượn? — gold ['top_borrowed', 'warehouse_risk'] pred [] tools []  
- `paraphrase-044#0` Có bao nhiêu người đang chờ đến lấy sách đã giữ? — gold ['reservation'] pred [] tools []  
- `paraphrase-051#0` Việc nào cần xử lý gấp nhất trong tuần này? — gold ['priority'] pred [] tools []  
- `paraphrase-055#0` Khoản tiền độc giả còn nợ thư viện là bao nhiêu? — gold ['fines'] pred [] tools []  
- `multi_intent-066#0` Kho Hà Nội thiếu những sách gì và nên nhập bao nhiêu? — gold ['reorder', 'warehouse_risk'] pred ['reorder'] tools ['get_warehouse_low_stock_items', 'get_warehouse_stock_risk', 'get_reorder_suggestions']  
- `multi_intent-071#0` So sánh tồn kho kho HCM với kho Hà Nội, đồng thời cho biết sách nào cần nhập gấp — gold ['reorder', 'warehouse_risk'] pred ['reorder', 'warehouse_risk'] tools [] CLARIFIED {'wh': False} 
- `multi_intent-074#0` Sách nào đang được mượn nhiều mà kho còn ít bản? — gold ['top_borrowed', 'warehouse_risk'] pred ['top_borrowed'] tools ['get_top_books']  
- `multi_intent-075#0` Tình hình mượn trả và tồn kho tháng này — gold ['borrow_trend', 'warehouse_risk'] pred ['borrow_trend'] tools ['get_borrow_trends']  
- `multi_intent-078#0` Hôm nay có bao nhiêu phiếu mượn mới, bao nhiêu phiếu quá hạn? — gold ['kpi', 'overdue'] pred ['overdue'] tools ['get_overdue_summary']  
- `context-091#1` Nếu tăng thêm 5 triệu? — gold ['reorder'] pred ['reorder'] tools ['simulate_reorder_budget'] {'budgets': False} 
- `context-091#2` Nếu giảm ngân sách 20%? — gold ['reorder'] pred ['reorder'] tools ['simulate_reorder_budget'] {'budgets': False} 
- `ambiguous-176#0` Tình hình thế nào? — gold ['kpi'] pred [] tools []  
