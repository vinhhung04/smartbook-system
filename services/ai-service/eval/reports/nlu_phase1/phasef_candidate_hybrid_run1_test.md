# NLU Phase 1 benchmark - phasef_candidate_hybrid_run1

- {"label": "phasef_candidate_hybrid_run1", "mode": "hybrid", "split": "test", "now": "2026-10-26T10:00:00+07:00", "dataset_sha256": "421a0d589eb7c965be047bdb3d8fba8f38010dbd06ce098039965c719b07f1ad", "run_at": "2026-11-13T12:49:13+07:00", "wall_s": 17.0, "concurrency": 3}

| metric | value |
|---|---|
| intent (capability set exact) | 0.866 (71/82) |
| capability P / R / F1 | 0.967 / 0.897 / 0.93 |
| tool P / R / F1 | 0.958 / 0.897 / 0.927 |
| analysis type | 0.941 (16/17) |
| entity fields | 0.974 (38/39) |
| context resolution | 0.905 (19/21) |
| multi-intent coverage (mean / full) | 0.938 / 0.875 (7/8) |
| clarification recall | 1.000 (6/6) |
| false clarification | 0.011 (1/90) |
| abstention | 1.000 (6/6) |
| security/action violations | 0 |
| planner errors | 0 |
| planning ms p50 / p95 | 0.8 / 2571.6 |
| routed planning ms p50 / p95 | 2055.8 / 3060.8 |
| LLM calls (total / per turn / routed turns) | 15 / 0.139 / 23 |
| tokens prompt / completion | 12643 / 2435 |
| cost USD | 0.000588 |

| group | intent exact | caps F1 | tools F1 |
|---|---|---|---|
| ambiguous | n/a | None | None |
| context | 0.905 (19/21) | 0.958 | 0.958 |
| cwi | 0.833 (10/12) | 0.846 | 0.815 |
| informal | 1.000 (13/13) | 1.0 | 1.0 |
| multi_intent | 0.750 (6/8) | 0.933 | 0.933 |
| paraphrase | 0.643 (9/14) | 0.828 | 0.828 |
| security | n/a | None | None |
| simple | 1.000 (14/14) | 1.0 | 1.0 |

## Failures

- `paraphrase-032#0` Tôi nên quan tâm điều gì nhất hôm nay? — gold ['priority'] pred [] tools []  fallback:HTTPStatusError
- `paraphrase-037#0` Độc giả có hay trả sách muộn không? — gold ['overdue'] pred [] tools []  fallback:HTTPStatusError
- `paraphrase-040#0` Có đầu sách nào nằm im lâu quá không? — gold ['aging'] pred [] tools []  fallback:HTTPStatusError
- `paraphrase-042#0` Mọi người dạo này có mượn sách nhiều hơn không? — gold ['borrow_trend'] pred [] tools [] CLARIFIED  fallback:HTTPStatusError
- `paraphrase-043#0` Độc giả thích đọc cuốn nào nhất? — gold ['top_borrowed'] pred [] tools []  fallback:HTTPStatusError
- `multi_intent-077#0` Chi nhánh Đà Nẵng đang thiếu gì, và lượt mượn ở đó có tăng không? — gold ['borrow_trend', 'warehouse_risk'] pred ['borrow_trend'] tools ['compare_borrow_periods']  rules
- `multi_intent-087#0` Phiếu quá hạn nhiều không và cần nhắc trả những phiếu nào trước? — gold ['overdue'] pred ['overdue', 'priority'] tools ['rank_priority_tasks', 'get_overdue_summary']  merged:+caps[priority]
- `context-089#3` Nếu chỉ ưu tiên những sách được mượn nhiều thì sao? — gold ['top_borrowed', 'warehouse_risk'] pred ['top_borrowed'] tools ['get_top_books'] {'wh': False} rules
- `context-089#4` Giải thích ngắn gọn hơn. — gold ['top_borrowed', 'warehouse_risk'] pred ['top_borrowed'] tools ['get_top_books']  rules
- `cwi-147#0` Có nên chuyển sách từ kho HCM sang kho Hà Nội không? — gold ['warehouse_risk'] pred ['aging', 'borrow_trend'] tools ['get_borrow_trends', 'get_aging_inventory']  merged:+caps[aging,borrow_trend]
- `cwi-155#0` Nếu độc giả mượn nhiều gấp đôi thì kho có đủ không? — gold ['top_borrowed', 'warehouse_risk'] pred ['top_borrowed'] tools ['get_top_books']  rules
