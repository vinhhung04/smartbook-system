# NLU Phase 1 benchmark - phasef_candidate_hybrid_run3_c1

- {"label": "phasef_candidate_hybrid_run3_c1", "mode": "hybrid", "split": "test", "now": "2026-10-26T10:00:00+07:00", "dataset_sha256": "421a0d589eb7c965be047bdb3d8fba8f38010dbd06ce098039965c719b07f1ad", "run_at": "2026-11-13T12:53:04+07:00", "wall_s": 40.5, "concurrency": 1}

| metric | value |
|---|---|
| intent (capability set exact) | 0.866 (71/82) |
| capability P / R / F1 | 0.988 / 0.884 / 0.933 |
| tool P / R / F1 | 0.978 / 0.884 / 0.929 |
| analysis type | 0.941 (16/17) |
| entity fields | 0.974 (38/39) |
| context resolution | 0.905 (19/21) |
| multi-intent coverage (mean / full) | 0.812 / 0.750 (6/8) |
| clarification recall | 1.000 (6/6) |
| false clarification | 0.000 (0/90) |
| abstention | 1.000 (6/6) |
| security/action violations | 0 |
| planner errors | 0 |
| planning ms p50 / p95 | 0.8 / 2353.9 |
| routed planning ms p50 / p95 | 1975.1 / 2785.2 |
| LLM calls (total / per turn / routed turns) | 15 / 0.139 / 23 |
| tokens prompt / completion | 12658 / 2305 |
| cost USD | 0.000633 |

| group | intent exact | caps F1 | tools F1 |
|---|---|---|---|
| ambiguous | n/a | None | None |
| context | 0.905 (19/21) | 0.958 | 0.958 |
| cwi | 0.917 (11/12) | 0.96 | 0.923 |
| informal | 0.923 (12/13) | 0.96 | 0.96 |
| multi_intent | 0.625 (5/8) | 0.857 | 0.857 |
| paraphrase | 0.714 (10/14) | 0.846 | 0.846 |
| security | n/a | None | None |
| simple | 1.000 (14/14) | 1.0 | 1.0 |

## Failures

- `paraphrase-043#0` Độc giả thích đọc cuốn nào nhất? — gold ['top_borrowed'] pred [] tools []  fallback:HTTPStatusError
- `paraphrase-048#0` Kho có đủ sách để phục vụ tháng tới không? — gold ['warehouse_risk'] pred [] tools []  fallback:HTTPStatusError
- `paraphrase-053#0` Có cuốn nào bị giữ chỗ mà không ai đến lấy không? — gold ['reservation'] pred [] tools []  fallback:HTTPStatusError
- `paraphrase-054#0` Bức tranh chung về kho sách hiện giờ thế nào? — gold ['warehouse_risk'] pred [] tools []  fallback:HTTPStatusError
- `multi_intent-076#0` Cho tôi biết sách tồn đọng lâu và những sách đang thiếu — gold ['aging', 'warehouse_risk'] pred [] tools []  fallback:HTTPStatusError
- `multi_intent-077#0` Chi nhánh Đà Nẵng đang thiếu gì, và lượt mượn ở đó có tăng không? — gold ['borrow_trend', 'warehouse_risk'] pred ['borrow_trend'] tools ['compare_borrow_periods']  rules
- `multi_intent-087#0` Phiếu quá hạn nhiều không và cần nhắc trả những phiếu nào trước? — gold ['overdue'] pred ['overdue', 'priority'] tools ['rank_priority_tasks', 'get_overdue_summary']  merged:+caps[priority]
- `context-089#3` Nếu chỉ ưu tiên những sách được mượn nhiều thì sao? — gold ['top_borrowed', 'warehouse_risk'] pred ['top_borrowed'] tools ['get_top_books'] {'wh': False} rules
- `context-089#4` Giải thích ngắn gọn hơn. — gold ['top_borrowed', 'warehouse_risk'] pred ['top_borrowed'] tools ['get_top_books']  rules
- `informal-111#0` can uu tien gi trc — gold ['priority'] pred [] tools []  fallback:HTTPStatusError
- `cwi-155#0` Nếu độc giả mượn nhiều gấp đôi thì kho có đủ không? — gold ['top_borrowed', 'warehouse_risk'] pred ['top_borrowed'] tools ['get_top_books']  rules
