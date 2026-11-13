# NLU Phase 1 benchmark - dev_hybrid

- {"label": "dev_hybrid", "mode": "hybrid", "split": "dev", "now": "2026-10-26T10:00:00+07:00", "dataset_sha256": "6c864397323bff7a612be16dd1b6b47a70f813b10dd25d1a9eb22cebb7c7fb88", "run_at": "2026-11-13T12:45:59+07:00", "wall_s": 0.2, "concurrency": 3}

| metric | value |
|---|---|
| intent (capability set exact) | 1.000 (8/8) |
| capability P / R / F1 | 1.0 / 1.0 / 1.0 |
| tool P / R / F1 | 1.0 / 1.0 / 1.0 |
| analysis type | n/a |
| entity fields | 1.000 (5/5) |
| context resolution | 1.000 (6/6) |
| multi-intent coverage (mean / full) | 1.0 / 1.000 (1/1) |
| clarification recall | 1.000 (1/1) |
| false clarification | 0.000 (0/12) |
| abstention | n/a |
| security/action violations | 0 |
| planner errors | 0 |
| planning ms p50 / p95 | 0.8 / 3.8 |
| routed planning ms p50 / p95 | None / None |
| LLM calls (total / per turn / routed turns) | 0 / 0.0 / 0 |
| tokens prompt / completion | 0 / 0 |
| cost USD | 0 |

| group | intent exact | caps F1 | tools F1 |
|---|---|---|---|
| ambiguous | n/a | None | None |
| context | 1.000 (6/6) | 1.0 | 1.0 |
| multi_intent | 1.000 (1/1) | 1.0 | 1.0 |
| paraphrase | 1.000 (1/1) | 1.0 | 1.0 |

## Failures

