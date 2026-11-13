# NLU Phase 1 benchmark - phasef_candidate_backoff_run2

- {"label": "phasef_candidate_backoff_run2", "mode": "hybrid", "split": "test", "now": "2026-10-26T10:00:00+07:00", "dataset_sha256": "421a0d589eb7c965be047bdb3d8fba8f38010dbd06ce098039965c719b07f1ad", "run_at": "2026-11-13T13:47:23+07:00", "wall_s": 25.2, "concurrency": 3}

| metric | value |
|---|---|
| intent (capability set exact) | 0.927 (76/82) |
| capability P / R / F1 | 0.989 / 0.948 / 0.968 |
| tool P / R / F1 | 0.98 / 0.948 / 0.963 |
| analysis type | 0.941 (16/17) |
| entity fields | 0.974 (38/39) |
| context resolution | 0.905 (19/21) |
| multi-intent coverage (mean / full) | 0.938 / 0.875 (7/8) |
| clarification recall | 1.000 (6/6) |
| false clarification | 0.000 (0/90) |
| abstention | 1.000 (6/6) |
| security/action violations | 0 |
| planner errors | 0 |
| planning ms p50 / p95 | 1.0 / 3548.3 |
| routed planning ms p50 / p95 | 2917.6 / 4118.0 |
| LLM calls (total / per turn / routed turns) | 20 / 0.185 / 23 |
| tokens prompt / completion | 16846 / 3083 |
| cost USD | 0.000768 |

| group | intent exact | caps F1 | tools F1 |
|---|---|---|---|
| ambiguous | n/a | None | None |
| context | 0.905 (19/21) | 0.958 | 0.958 |
| cwi | 0.917 (11/12) | 0.96 | 0.923 |
| informal | 1.000 (13/13) | 1.0 | 1.0 |
| multi_intent | 0.750 (6/8) | 0.933 | 0.933 |
| paraphrase | 0.929 (13/14) | 0.968 | 0.968 |
| security | n/a | None | None |
| simple | 1.000 (14/14) | 1.0 | 1.0 |

## Failures

- `paraphrase-054#0` Bức tranh chung về kho sách hiện giờ thế nào? — gold ['warehouse_risk'] pred [] tools []  fallback:HTTPStatusError
- `multi_intent-077#0` Chi nhánh Đà Nẵng đang thiếu gì, và lượt mượn ở đó có tăng không? — gold ['borrow_trend', 'warehouse_risk'] pred ['borrow_trend'] tools ['compare_borrow_periods']  rules
- `multi_intent-087#0` Phiếu quá hạn nhiều không và cần nhắc trả những phiếu nào trước? — gold ['overdue'] pred ['overdue', 'priority'] tools ['rank_priority_tasks', 'get_overdue_summary']  merged:+caps[priority]
- `context-089#3` Nếu chỉ ưu tiên những sách được mượn nhiều thì sao? — gold ['top_borrowed', 'warehouse_risk'] pred ['top_borrowed'] tools ['get_top_books'] {'wh': False} rules
- `context-089#4` Giải thích ngắn gọn hơn. — gold ['top_borrowed', 'warehouse_risk'] pred ['top_borrowed'] tools ['get_top_books']  rules
- `cwi-155#0` Nếu độc giả mượn nhiều gấp đôi thì kho có đủ không? — gold ['top_borrowed', 'warehouse_risk'] pred ['top_borrowed'] tools ['get_top_books']  rules
