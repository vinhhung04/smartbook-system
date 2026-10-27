# NLU Phase 1 benchmark - baseline_det

- {"label": "baseline_det", "mode": "det", "split": "all", "now": "2026-10-26T10:00:00+07:00", "dataset_sha256": "e5715b3ff91c7e630b84813b4a8acad24f6ca8690c1829632192625a0a2f4cdc", "run_at": "2026-10-26T14:44:04+07:00", "wall_s": 0.2, "concurrency": 3}

| metric | value |
|---|---|
| intent (capability set exact) | 0.723 (128/177) |
| capability P / R / F1 | 0.988 / 0.748 / 0.851 |
| tool P / R / F1 | 0.983 / 0.752 / 0.852 |
| analysis type | 0.944 (34/36) |
| entity fields | 0.867 (72/83) |
| context resolution | 0.703 (26/37) |
| multi-intent coverage (mean / full) | 0.772 / 0.667 (20/30) |
| clarification recall | 0.909 (10/11) |
| false clarification | 0.026 (5/192) |
| abstention | 0.933 (14/15) |
| security/action violations | 0 |
| planner errors | 0 |
| planning ms p50 / p95 | 0.7 / 1.1 |
| routed planning ms p50 / p95 | None / None |
| LLM calls (total / per turn / routed turns) | 0 / 0.0 / 0 |
| tokens prompt / completion | 0 / 0 |
| cost USD | 0 |

| group | intent exact | caps F1 | tools F1 |
|---|---|---|---|
| ambiguous | 0.000 (0/1) | 0.0 | 0.0 |
| context | 0.838 (31/37) | 0.923 | 0.923 |
| cwi | 0.923 (24/26) | 0.963 | 0.948 |
| informal | 0.840 (21/25) | 0.917 | 0.917 |
| multi_intent | 0.633 (19/30) | 0.849 | 0.86 |
| paraphrase | 0.250 (8/32) | 0.409 | 0.409 |
| security | n/a | None | None |
| simple | 0.962 (25/26) | 0.962 | 0.964 |

## Failures

- `simple-016#0` Có bao nhiêu sách đang được mượn chưa trả? — gold ['kpi'] pred ['overdue'] tools ['get_overdue_summary']  
- `paraphrase-027#0` Dạo này thư viện hoạt động ra sao? — gold ['kpi'] pred [] tools []  
- `paraphrase-028#0` Có vấn đề gì đáng lo trong kho không? — gold ['warehouse_risk'] pred [] tools []  
- `paraphrase-029#0` Tình hình sách gần đây có ổn không? — gold ['kpi'] pred [] tools []  
- `paraphrase-031#0` Quyển nào được nhiều người tìm nhưng không đủ cho mượn? — gold ['top_borrowed', 'warehouse_risk'] pred [] tools []  
- `paraphrase-032#0` Tôi nên quan tâm điều gì nhất hôm nay? — gold ['priority'] pred [] tools []  
- `paraphrase-033#0` Liệu lượng sách hiện tại có đáp ứng được nhu cầu không? — gold ['top_borrowed', 'warehouse_risk'] pred [] tools []  
- `paraphrase-035#0` Cần làm gì để giảm nguy cơ thiếu sách? — gold ['reorder', 'warehouse_risk'] pred ['warehouse_risk'] tools ['get_warehouse_stock_risk']  
- `paraphrase-037#0` Độc giả có hay trả sách muộn không? — gold ['overdue'] pred [] tools []  
- `paraphrase-040#0` Có đầu sách nào nằm im lâu quá không? — gold ['aging'] pred [] tools []  
- `paraphrase-042#0` Mọi người dạo này có mượn sách nhiều hơn không? — gold ['borrow_trend'] pred [] tools [] CLARIFIED  
- `paraphrase-043#0` Độc giả thích đọc cuốn nào nhất? — gold ['top_borrowed'] pred [] tools []  
- `paraphrase-044#0` Có bao nhiêu người đang chờ đến lấy sách đã giữ? — gold ['reservation'] pred [] tools []  
- `paraphrase-046#0` Thư viện đang vận hành ổn chứ? — gold ['kpi'] pred [] tools []  
- `paraphrase-047#0` Có ai mượn sách mà quên trả không? — gold ['overdue'] pred [] tools []  
- `paraphrase-048#0` Kho có đủ sách để phục vụ tháng tới không? — gold ['warehouse_risk'] pred [] tools []  
- `paraphrase-049#0` Lượng sách đang cho mượn có tăng lên so với tháng trước không? — gold ['borrow_trend'] pred [] tools [] CLARIFIED  
- `paraphrase-050#0` Sách nào có nguy cơ hết trước khi kịp nhập về? — gold ['reorder'] pred [] tools []  
- `paraphrase-051#0` Việc nào cần xử lý gấp nhất trong tuần này? — gold ['priority'] pred [] tools []  
- `paraphrase-052#0` Nhu cầu đọc sách của độc giả đang đi lên hay đi xuống? — gold ['borrow_trend'] pred [] tools []  
- `paraphrase-053#0` Có cuốn nào bị giữ chỗ mà không ai đến lấy không? — gold ['reservation'] pred [] tools []  
- `paraphrase-054#0` Bức tranh chung về kho sách hiện giờ thế nào? — gold ['warehouse_risk'] pred [] tools []  
- `paraphrase-055#0` Khoản tiền độc giả còn nợ thư viện là bao nhiêu? — gold ['fines'] pred [] tools []  
- `paraphrase-056#0` Những cuốn nào ít ai đụng tới? — gold ['aging'] pred [] tools []  
- `paraphrase-057#0` Nên dồn tiền mua loại sách nào? — gold ['reorder'] pred [] tools []  
- `multi_intent-060#0` Tháng này lượt mượn tăng hay giảm, những đầu sách nào được quan tâm nhiều nhất và cần nhập thêm không? — gold ['borrow_trend', 'reorder', 'top_borrowed'] pred ['borrow_trend', 'reorder'] tools ['compare_borrow_periods', 'get_reorder_suggestions']  
- `multi_intent-066#0` Kho Hà Nội thiếu những sách gì và nên nhập bao nhiêu? — gold ['reorder', 'warehouse_risk'] pred ['reorder'] tools ['get_warehouse_low_stock_items', 'get_warehouse_stock_risk', 'get_reorder_suggestions']  
- `multi_intent-071#0` So sánh tồn kho kho HCM với kho Hà Nội, đồng thời cho biết sách nào cần nhập gấp — gold ['reorder', 'warehouse_risk'] pred ['reorder', 'warehouse_risk'] tools [] CLARIFIED {'wh': False} 
- `multi_intent-074#0` Sách nào đang được mượn nhiều mà kho còn ít bản? — gold ['top_borrowed', 'warehouse_risk'] pred ['top_borrowed'] tools ['get_top_books']  
- `multi_intent-075#0` Tình hình mượn trả và tồn kho tháng này — gold ['borrow_trend', 'warehouse_risk'] pred ['borrow_trend'] tools ['get_borrow_trends']  
- `multi_intent-076#0` Cho tôi biết sách tồn đọng lâu và những sách đang thiếu — gold ['aging', 'warehouse_risk'] pred [] tools []  
- `multi_intent-077#0` Chi nhánh Đà Nẵng đang thiếu gì, và lượt mượn ở đó có tăng không? — gold ['borrow_trend', 'warehouse_risk'] pred ['borrow_trend'] tools ['compare_borrow_periods']  
- `multi_intent-078#0` Hôm nay có bao nhiêu phiếu mượn mới, bao nhiêu phiếu quá hạn? — gold ['kpi', 'overdue'] pred ['overdue'] tools ['get_overdue_summary']  
- `multi_intent-079#0` Nhập thêm sách gì với ngân sách 15 triệu, và những sách đó có đang được mượn nhiều không? — gold ['reorder', 'top_borrowed'] pred ['reorder', 'top_borrowed'] tools [] CLARIFIED {'budgets': False} 
- `multi_intent-084#0` Sách nào nằm kho trên 90 ngày, sách nào nên thanh lý và kho nào đang thiếu hàng? — gold ['aging', 'warehouse_risk', 'weeding'] pred ['aging', 'warehouse_risk', 'weeding'] tools [] CLARIFIED  
- `multi_intent-086#0` Mượn nhiều nhất quý này là sách nào, còn bao nhiêu bản trong kho? — gold ['top_borrowed', 'warehouse_risk'] pred ['top_borrowed'] tools ['get_top_books']  
- `context-089#1` Kho nào đáng lo hơn? — gold ['warehouse_risk'] pred ['warehouse_risk'] tools ['get_warehouse_stock_risk'] {'wh': False} 
- `context-089#3` Nếu chỉ ưu tiên những sách được mượn nhiều thì sao? — gold ['top_borrowed', 'warehouse_risk'] pred ['top_borrowed'] tools ['get_top_books'] {'wh': False} 
- `context-089#4` Giải thích ngắn gọn hơn. — gold ['top_borrowed', 'warehouse_risk'] pred ['top_borrowed'] tools ['get_top_books']  
- `context-091#1` Nếu tăng thêm 5 triệu? — gold ['reorder'] pred ['reorder'] tools ['simulate_reorder_budget'] {'budgets': False} 
- `context-091#2` Nếu giảm ngân sách 20%? — gold ['reorder'] pred ['reorder'] tools ['simulate_reorder_budget'] {'budgets': False} 
- `context-094#1` Kho nào thiếu nhiều hơn? — gold ['warehouse_risk'] pred ['warehouse_risk'] tools ['get_warehouse_stock_risk'] {'wh': False} 
- `context-094#2` Kho còn lại thì sao? — gold ['warehouse_risk'] pred [] tools [] {'wh': False} 
- `context-098#2` Cần làm gì để cải thiện? — gold ['reorder', 'warehouse_risk'] pred ['warehouse_risk'] tools ['get_warehouse_low_stock_items', 'get_warehouse_stock_risk']  
- `context-099#1` Trong số đó cuốn nào sắp hết? — gold ['top_borrowed', 'warehouse_risk'] pred ['warehouse_risk'] tools ['get_warehouse_stock_risk']  
- `context-099#2` Cuốn thứ ba thì sao? — gold ['top_borrowed', 'warehouse_risk'] pred ['warehouse_risk'] tools ['get_warehouse_stock_risk']  
- `context-103#2` So sánh hai kho này — gold ['warehouse_risk'] pred ['warehouse_risk'] tools ['get_warehouse_low_stock_items', 'get_warehouse_stock_risk'] {'wh': False} 
- `informal-106#0` thang nay muon co giam ko — gold ['borrow_trend'] pred [] tools []  
- `informal-110#0` tinh hinh sach sao roi — gold ['kpi'] pred [] tools []  
- `informal-111#0` can uu tien gi trc — gold ['priority'] pred [] tools []  
- `informal-115#0` kho dn con it sach ko — gold ['warehouse_risk'] pred ['warehouse_risk'] tools ['get_warehouse_stock_risk'] {'wh': False} 
- `informal-128#0` thg nay phat dc bn tien — gold ['fines'] pred [] tools []  
- `cwi-152#0` Mức ngân sách nào giúp giảm rủi ro thiếu sách nhiều nhất trong 3 phương án 5, 15, 30 triệu? — gold ['reorder'] pred ['reorder', 'warehouse_risk'] tools ['get_warehouse_stock_risk', 'simulate_reorder_budget'] {'budgets': False} 
- `cwi-155#0` Nếu độc giả mượn nhiều gấp đôi thì kho có đủ không? — gold ['top_borrowed', 'warehouse_risk'] pred ['top_borrowed'] tools ['get_top_books']  
- `ambiguous-165#0` Chi nhánh Hà Nội có thiếu sách không? — gold None pred ['warehouse_risk'] tools ['get_warehouse_low_stock_items', 'get_warehouse_stock_risk']  
- `ambiguous-167#0` Ai là tác giả được yêu thích nhất ở Mỹ? — gold None pred ['book_search', 'top_borrowed'] tools ['get_top_books', 'search_books']  
- `ambiguous-176#0` Tình hình thế nào? — gold ['kpi'] pred [] tools []  
