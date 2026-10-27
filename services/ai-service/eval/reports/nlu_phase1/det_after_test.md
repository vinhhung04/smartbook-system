# NLU Phase 1 benchmark - det_after

- {"label": "det_after", "mode": "det", "split": "test", "now": "2026-10-26T10:00:00+07:00", "dataset_sha256": "421a0d589eb7c965be047bdb3d8fba8f38010dbd06ce098039965c719b07f1ad", "run_at": "2026-10-26T14:58:30+07:00", "wall_s": 0.1, "concurrency": 3}

| metric | value |
|---|---|
| intent (capability set exact) | 0.744 (61/82) |
| capability P / R / F1 | 1.0 / 0.768 / 0.869 |
| tool P / R / F1 | 0.988 / 0.768 / 0.864 |
| analysis type | 0.941 (16/17) |
| entity fields | 0.974 (38/39) |
| context resolution | 0.762 (16/21) |
| multi-intent coverage (mean / full) | 0.812 / 0.750 (6/8) |
| clarification recall | 0.833 (5/6) |
| false clarification | 0.011 (1/90) |
| abstention | 1.000 (6/6) |
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
| context | 0.762 (16/21) | 0.894 | 0.894 |
| cwi | 0.917 (11/12) | 0.96 | 0.923 |
| informal | 0.846 (11/13) | 0.917 | 0.917 |
| multi_intent | 0.750 (6/8) | 0.889 | 0.889 |
| paraphrase | 0.214 (3/14) | 0.353 | 0.353 |
| security | n/a | None | None |
| simple | 1.000 (14/14) | 1.0 | 1.0 |

## Failures

- `paraphrase-032#0` Tôi nên quan tâm điều gì nhất hôm nay? — gold ['priority'] pred [] tools []  
- `paraphrase-037#0` Độc giả có hay trả sách muộn không? — gold ['overdue'] pred [] tools []  
- `paraphrase-040#0` Có đầu sách nào nằm im lâu quá không? — gold ['aging'] pred [] tools []  
- `paraphrase-042#0` Mọi người dạo này có mượn sách nhiều hơn không? — gold ['borrow_trend'] pred [] tools [] CLARIFIED  
- `paraphrase-043#0` Độc giả thích đọc cuốn nào nhất? — gold ['top_borrowed'] pred [] tools []  
- `paraphrase-048#0` Kho có đủ sách để phục vụ tháng tới không? — gold ['warehouse_risk'] pred [] tools []  
- `paraphrase-050#0` Sách nào có nguy cơ hết trước khi kịp nhập về? — gold ['reorder'] pred [] tools []  
- `paraphrase-052#0` Nhu cầu đọc sách của độc giả đang đi lên hay đi xuống? — gold ['borrow_trend'] pred [] tools []  
- `paraphrase-053#0` Có cuốn nào bị giữ chỗ mà không ai đến lấy không? — gold ['reservation'] pred [] tools []  
- `paraphrase-054#0` Bức tranh chung về kho sách hiện giờ thế nào? — gold ['warehouse_risk'] pred [] tools []  
- `paraphrase-056#0` Những cuốn nào ít ai đụng tới? — gold ['aging'] pred [] tools []  
- `multi_intent-076#0` Cho tôi biết sách tồn đọng lâu và những sách đang thiếu — gold ['aging', 'warehouse_risk'] pred [] tools []  
- `multi_intent-077#0` Chi nhánh Đà Nẵng đang thiếu gì, và lượt mượn ở đó có tăng không? — gold ['borrow_trend', 'warehouse_risk'] pred ['borrow_trend'] tools ['compare_borrow_periods']  
- `context-089#3` Nếu chỉ ưu tiên những sách được mượn nhiều thì sao? — gold ['top_borrowed', 'warehouse_risk'] pred ['top_borrowed'] tools ['get_top_books'] {'wh': False} 
- `context-089#4` Giải thích ngắn gọn hơn. — gold ['top_borrowed', 'warehouse_risk'] pred ['top_borrowed'] tools ['get_top_books']  
- `context-098#2` Cần làm gì để cải thiện? — gold ['reorder', 'warehouse_risk'] pred ['warehouse_risk'] tools ['get_warehouse_low_stock_items', 'get_warehouse_stock_risk']  
- `context-099#1` Trong số đó cuốn nào sắp hết? — gold ['top_borrowed', 'warehouse_risk'] pred ['warehouse_risk'] tools ['get_warehouse_stock_risk']  
- `context-099#2` Cuốn thứ ba thì sao? — gold ['top_borrowed', 'warehouse_risk'] pred ['warehouse_risk'] tools ['get_warehouse_stock_risk']  
- `informal-111#0` can uu tien gi trc — gold ['priority'] pred [] tools []  
- `informal-128#0` thg nay phat dc bn tien — gold ['fines'] pred [] tools []  
- `cwi-155#0` Nếu độc giả mượn nhiều gấp đôi thì kho có đủ không? — gold ['top_borrowed', 'warehouse_risk'] pred ['top_borrowed'] tools ['get_top_books']  
- `ambiguous-165#0` Chi nhánh Hà Nội có thiếu sách không? — gold None pred ['warehouse_risk'] tools ['get_warehouse_low_stock_items', 'get_warehouse_stock_risk']  
