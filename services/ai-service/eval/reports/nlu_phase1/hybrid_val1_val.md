# NLU Phase 1 benchmark - hybrid_val1

- {"label": "hybrid_val1", "mode": "hybrid", "split": "val", "now": "2026-10-26T10:00:00+07:00", "dataset_sha256": "1e7a00cf5e149d12c3ac8017f241b3678d525a971a4f63c92b2e71fe1d706fcc", "run_at": "2026-10-26T14:56:51+07:00", "wall_s": 8.2, "concurrency": 3}

| metric | value |
|---|---|
| intent (capability set exact) | 0.889 (40/45) |
| capability P / R / F1 | 0.981 / 0.895 / 0.936 |
| tool P / R / F1 | 0.979 / 0.912 / 0.944 |
| analysis type | 1.000 (10/10) |
| entity fields | 0.955 (21/22) |
| context resolution | 1.000 (12/12) |
| multi-intent coverage (mean / full) | 0.833 / 0.750 (9/12) |
| clarification recall | 1.000 (1/1) |
| false clarification | 0.020 (1/50) |
| abstention | 1.000 (4/4) |
| security/action violations | 0 |
| planner errors | 0 |
| planning ms p50 / p95 | 0.9 / 2783.0 |
| routed planning ms p50 / p95 | 2594.2 / 3510.5 |
| LLM calls (total / per turn / routed turns) | 8 / 0.145 / 8 |
| tokens prompt / completion | 6740 / 1244 |
| cost USD | 0.000328 |

| group | intent exact | caps F1 | tools F1 |
|---|---|---|---|
| ambiguous | 1.000 (1/1) | 1.0 | 1.0 |
| context | 1.000 (12/12) | 1.0 | 1.0 |
| cwi | 1.000 (5/5) | 1.0 | 1.0 |
| informal | 1.000 (5/5) | 1.0 | 1.0 |
| multi_intent | 0.667 (8/12) | 0.872 | 0.9 |
| paraphrase | 1.000 (5/5) | 1.0 | 1.0 |
| security | n/a | None | None |
| simple | 0.800 (4/5) | 0.8 | 0.8 |

## Failures

- `simple-016#0` Có bao nhiêu sách đang được mượn chưa trả? — gold ['kpi'] pred ['overdue'] tools ['get_overdue_summary']  rules
- `multi_intent-066#0` Kho Hà Nội thiếu những sách gì và nên nhập bao nhiêu? — gold ['reorder', 'warehouse_risk'] pred ['reorder'] tools ['get_warehouse_low_stock_items', 'get_warehouse_stock_risk', 'get_reorder_suggestions']  rules
- `multi_intent-071#0` So sánh tồn kho kho HCM với kho Hà Nội, đồng thời cho biết sách nào cần nhập gấp — gold ['reorder', 'warehouse_risk'] pred ['reorder', 'warehouse_risk'] tools [] CLARIFIED {'wh': False} rules
- `multi_intent-075#0` Tình hình mượn trả và tồn kho tháng này — gold ['borrow_trend', 'warehouse_risk'] pred ['borrow_trend'] tools ['get_borrow_trends']  rules
- `multi_intent-078#0` Hôm nay có bao nhiêu phiếu mượn mới, bao nhiêu phiếu quá hạn? — gold ['kpi', 'overdue'] pred ['overdue'] tools ['get_overdue_summary']  rules
