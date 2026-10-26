# NLU Phase 1 benchmark - det_after

- {"label": "det_after", "mode": "det", "split": "val", "now": "2026-10-26T10:00:00+07:00", "dataset_sha256": "1e7a00cf5e149d12c3ac8017f241b3678d525a971a4f63c92b2e71fe1d706fcc", "run_at": "2026-10-26T14:57:48+07:00", "wall_s": 0.1, "concurrency": 3}

| metric | value |
|---|---|
| intent (capability set exact) | 0.822 (37/45) |
| capability P / R / F1 | 0.98 / 0.842 / 0.906 |
| tool P / R / F1 | 0.977 / 0.842 / 0.905 |
| analysis type | 1.000 (10/10) |
| entity fields | 1.000 (22/22) |
| context resolution | 1.000 (12/12) |
| multi-intent coverage (mean / full) | 0.917 / 0.833 (10/12) |
| clarification recall | 1.000 (1/1) |
| false clarification | 0.000 (0/50) |
| abstention | 1.000 (4/4) |
| security/action violations | 0 |
| planner errors | 0 |
| planning ms p50 / p95 | 0.8 / 1.2 |
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
| multi_intent | 0.833 (10/12) | 0.952 | 0.952 |
| paraphrase | 0.200 (1/5) | 0.286 | 0.286 |
| security | n/a | None | None |
| simple | 0.800 (4/5) | 0.8 | 0.8 |

## Failures

- `simple-016#0` Có bao nhiêu sách đang được mượn chưa trả? — gold ['kpi'] pred ['overdue'] tools ['get_overdue_summary']  
- `paraphrase-031#0` Quyển nào được nhiều người tìm nhưng không đủ cho mượn? — gold ['top_borrowed', 'warehouse_risk'] pred [] tools []  
- `paraphrase-044#0` Có bao nhiêu người đang chờ đến lấy sách đã giữ? — gold ['reservation'] pred [] tools []  
- `paraphrase-051#0` Việc nào cần xử lý gấp nhất trong tuần này? — gold ['priority'] pred [] tools []  
- `paraphrase-055#0` Khoản tiền độc giả còn nợ thư viện là bao nhiêu? — gold ['fines'] pred [] tools []  
- `multi_intent-075#0` Tình hình mượn trả và tồn kho tháng này — gold ['borrow_trend', 'warehouse_risk'] pred ['borrow_trend'] tools ['get_borrow_trends']  
- `multi_intent-078#0` Hôm nay có bao nhiêu phiếu mượn mới, bao nhiêu phiếu quá hạn? — gold ['kpi', 'overdue'] pred ['overdue'] tools ['get_overdue_summary']  
- `ambiguous-176#0` Tình hình thế nào? — gold ['kpi'] pred [] tools []  
