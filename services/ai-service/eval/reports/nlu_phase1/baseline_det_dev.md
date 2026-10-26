# NLU Phase 1 benchmark - baseline_det

- {"label": "baseline_det", "mode": "det", "split": "dev", "now": "2026-10-26T10:00:00+07:00", "dataset_sha256": "1a02d2e34d7a6c3cc0c65989fa67cc1f28cc3003afe893232caa17dd71230cea", "run_at": "2026-10-26T14:44:18+07:00", "wall_s": 0.1, "concurrency": 3}

| metric | value |
|---|---|
| intent (capability set exact) | 0.700 (35/50) |
| capability P / R / F1 | 0.98 / 0.727 / 0.835 |
| tool P / R / F1 | 0.981 / 0.727 / 0.835 |
| analysis type | 0.889 (8/9) |
| entity fields | 0.864 (19/22) |
| context resolution | 0.750 (3/4) |
| multi-intent coverage (mean / full) | 0.717 / 0.600 (6/10) |
| clarification recall | 1.000 (4/4) |
| false clarification | 0.038 (2/52) |
| abstention | 0.800 (4/5) |
| security/action violations | 0 |
| planner errors | 0 |
| planning ms p50 / p95 | 0.8 / 1.2 |
| routed planning ms p50 / p95 | None / None |
| LLM calls (total / per turn / routed turns) | 0 / 0.0 / 0 |
| tokens prompt / completion | 0 / 0 |
| cost USD | 0 |

| group | intent exact | caps F1 | tools F1 |
|---|---|---|---|
| ambiguous | n/a | None | None |
| context | 1.000 (4/4) | 1.0 | 1.0 |
| cwi | 0.889 (8/9) | 0.947 | 0.957 |
| informal | 0.714 (5/7) | 0.833 | 0.833 |
| multi_intent | 0.600 (6/10) | 0.829 | 0.829 |
| paraphrase | 0.385 (5/13) | 0.571 | 0.571 |
| security | n/a | None | None |
| simple | 1.000 (7/7) | 1.0 | 1.0 |

## Failures

- `paraphrase-027#0` Dạo này thư viện hoạt động ra sao? — gold ['kpi'] pred [] tools []  
- `paraphrase-028#0` Có vấn đề gì đáng lo trong kho không? — gold ['warehouse_risk'] pred [] tools []  
- `paraphrase-029#0` Tình hình sách gần đây có ổn không? — gold ['kpi'] pred [] tools []  
- `paraphrase-033#0` Liệu lượng sách hiện tại có đáp ứng được nhu cầu không? — gold ['top_borrowed', 'warehouse_risk'] pred [] tools []  
- `paraphrase-035#0` Cần làm gì để giảm nguy cơ thiếu sách? — gold ['reorder', 'warehouse_risk'] pred ['warehouse_risk'] tools ['get_warehouse_stock_risk']  
- `paraphrase-046#0` Thư viện đang vận hành ổn chứ? — gold ['kpi'] pred [] tools []  
- `paraphrase-047#0` Có ai mượn sách mà quên trả không? — gold ['overdue'] pred [] tools []  
- `paraphrase-057#0` Nên dồn tiền mua loại sách nào? — gold ['reorder'] pred [] tools []  
- `multi_intent-060#0` Tháng này lượt mượn tăng hay giảm, những đầu sách nào được quan tâm nhiều nhất và cần nhập thêm không? — gold ['borrow_trend', 'reorder', 'top_borrowed'] pred ['borrow_trend', 'reorder'] tools ['compare_borrow_periods', 'get_reorder_suggestions']  
- `multi_intent-079#0` Nhập thêm sách gì với ngân sách 15 triệu, và những sách đó có đang được mượn nhiều không? — gold ['reorder', 'top_borrowed'] pred ['reorder', 'top_borrowed'] tools [] CLARIFIED {'budgets': False} 
- `multi_intent-084#0` Sách nào nằm kho trên 90 ngày, sách nào nên thanh lý và kho nào đang thiếu hàng? — gold ['aging', 'warehouse_risk', 'weeding'] pred ['aging', 'warehouse_risk', 'weeding'] tools [] CLARIFIED  
- `multi_intent-086#0` Mượn nhiều nhất quý này là sách nào, còn bao nhiêu bản trong kho? — gold ['top_borrowed', 'warehouse_risk'] pred ['top_borrowed'] tools ['get_top_books']  
- `context-103#2` So sánh hai kho này — gold ['warehouse_risk'] pred ['warehouse_risk'] tools ['get_warehouse_low_stock_items', 'get_warehouse_stock_risk'] {'wh': False} 
- `informal-106#0` thang nay muon co giam ko — gold ['borrow_trend'] pred [] tools []  
- `informal-110#0` tinh hinh sach sao roi — gold ['kpi'] pred [] tools []  
- `cwi-152#0` Mức ngân sách nào giúp giảm rủi ro thiếu sách nhiều nhất trong 3 phương án 5, 15, 30 triệu? — gold ['reorder'] pred ['reorder', 'warehouse_risk'] tools ['get_warehouse_stock_risk', 'simulate_reorder_budget'] {'budgets': False} 
- `ambiguous-167#0` Ai là tác giả được yêu thích nhất ở Mỹ? — gold None pred ['book_search', 'top_borrowed'] tools ['get_top_books', 'search_books']  
