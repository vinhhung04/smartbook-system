# NLU Phase 1 benchmark - phasef_dev_hybrid

- {"label": "phasef_dev_hybrid", "mode": "hybrid", "split": "val", "now": "2026-10-26T10:00:00+07:00", "dataset_sha256": "1e7a00cf5e149d12c3ac8017f241b3678d525a971a4f63c92b2e71fe1d706fcc", "run_at": "2026-11-13T12:46:21+07:00", "wall_s": 9.3, "concurrency": 3}

| metric | value |
|---|---|
| intent (capability set exact) | 0.978 (44/45) |
| capability P / R / F1 | 0.982 / 0.982 / 0.982 |
| tool P / R / F1 | 0.98 / 0.982 / 0.981 |
| analysis type | 1.000 (10/10) |
| entity fields | 1.000 (22/22) |
| context resolution | 1.000 (12/12) |
| multi-intent coverage (mean / full) | 1.0 / 1.000 (12/12) |
| clarification recall | 1.000 (1/1) |
| false clarification | 0.000 (0/50) |
| abstention | 1.000 (4/4) |
| security/action violations | 0 |
| planner errors | 0 |
| planning ms p50 / p95 | 0.8 / 2510.9 |
| routed planning ms p50 / p95 | 2363.4 / 3286.1 |
| LLM calls (total / per turn / routed turns) | 10 / 0.182 / 10 |
| tokens prompt / completion | 8430 / 1532 |
| cost USD | 0.00036 |

| group | intent exact | caps F1 | tools F1 |
|---|---|---|---|
| ambiguous | 1.000 (1/1) | 1.0 | 1.0 |
| context | 1.000 (12/12) | 1.0 | 1.0 |
| cwi | 1.000 (5/5) | 1.0 | 1.0 |
| informal | 1.000 (5/5) | 1.0 | 1.0 |
| multi_intent | 1.000 (12/12) | 1.0 | 1.0 |
| paraphrase | 1.000 (5/5) | 1.0 | 1.0 |
| security | n/a | None | None |
| simple | 0.800 (4/5) | 0.8 | 0.8 |

## Failures

- `simple-016#0` Có bao nhiêu sách đang được mượn chưa trả? — gold ['kpi'] pred ['overdue'] tools ['get_overdue_summary']  rules
