# NLU Phase 1 benchmark - det_after

- {"label": "det_after", "mode": "det", "split": "dev", "now": "2026-10-26T10:00:00+07:00", "dataset_sha256": "1a02d2e34d7a6c3cc0c65989fa67cc1f28cc3003afe893232caa17dd71230cea", "run_at": "2026-10-26T14:57:47+07:00", "wall_s": 0.1, "concurrency": 3}

| metric | value |
|---|---|
| intent (capability set exact) | 0.800 (40/50) |
| capability P / R / F1 | 1.0 / 0.833 / 0.909 |
| tool P / R / F1 | 1.0 / 0.833 / 0.909 |
| analysis type | 1.000 (9/9) |
| entity fields | 1.000 (22/22) |
| context resolution | 1.000 (4/4) |
| multi-intent coverage (mean / full) | 0.967 / 0.900 (9/10) |
| clarification recall | 1.000 (4/4) |
| false clarification | 0.000 (0/52) |
| abstention | 0.800 (4/5) |
| security/action violations | 0 |
| planner errors | 0 |
| planning ms p50 / p95 | 0.8 / 1.4 |
| routed planning ms p50 / p95 | None / None |
| LLM calls (total / per turn / routed turns) | 0 / 0.0 / 0 |
| tokens prompt / completion | 0 / 0 |
| cost USD | 0 |

| group | intent exact | caps F1 | tools F1 |
|---|---|---|---|
| ambiguous | n/a | None | None |
| context | 1.000 (4/4) | 1.0 | 1.0 |
| cwi | 1.000 (9/9) | 1.0 | 1.0 |
| informal | 0.857 (6/7) | 0.923 | 0.923 |
| multi_intent | 0.900 (9/10) | 0.979 | 0.979 |
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
- `informal-110#0` tinh hinh sach sao roi — gold ['kpi'] pred [] tools []  
- `ambiguous-167#0` Ai là tác giả được yêu thích nhất ở Mỹ? — gold None pred ['book_search', 'top_borrowed'] tools ['get_top_books', 'search_books']  
