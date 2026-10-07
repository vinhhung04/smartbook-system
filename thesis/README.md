# Thesis evaluation artefacts — reorder decision support

Everything in `data/`, `tables/` and `figures/` is **generated**; do not edit by hand.
All results are computed on the SYNTHETIC behavioural dataset
(`docs/SYNTHETIC_BEHAVIOR_DATASET.md`), not on real users. Method, metric definitions,
results and limitations: `docs/ANALYSIS/REORDER_DECISION_EVALUATION.md`.

## Reproduce (from the repo root, no database needed)

```bash
cd services/analytics-service && node eval/run-all.js && cd ../..
```

```bash
python -m pip install -r thesis/scripts/requirements.txt
```

```bash
python thesis/scripts/plot_reorder_evaluation.py
```

Same seed ⇒ byte-identical JSON/CSV. Other population: `SIMULATION_SEED=123 node eval/run-all.js`
(also `CUSTOMER_COUNT`, `SIMULATION_MONTHS`, `SIMULATION_END`). Tests:
`cd services/analytics-service && npm test`.

Lead time on real purchase-order history (the repo seed only has 1 PO ⇒ `INSUFFICIENT_DATA`):

```bash
cd services/analytics-service && node eval/run-all.js --deliveries path/to/deliveries.json
```

```bash
cd services/analytics-service && INVENTORY_DATABASE_URL=postgres://user:pass@host:5432/inventory_db node eval/run-all.js --lead-time-from-db
```

## Contents

| File | What |
| --- | --- |
| `data/forecast_model_results.json`, `tables/forecast_model_results.csv` | MAE/RMSE/WAPE/MAPE/bias per model, horizons 7 and 14 days |
| `tables/forecast_model_by_demand_class.csv` | same, split by Syntetos–Boylan demand class |
| `data/reorder_policy_results.json`, `tables/reorder_policy_results.csv` | business metrics per scenario × policy (full and steady-state window) |
| `data/reorder_ablation_results.json`, `tables/reorder_ablation_results.csv` | SmartBook ablation |
| `tables/reorder_policy_per_variant_base.csv` | per-title metrics, BASE scenario |
| `data/inventory_timeline_example.json`, `tables/inventory_timeline_example.csv` | daily virtual-inventory trace of the highest-demand title |
| `data/lead_time_results.json`, `tables/lead_time_results.csv` | lead-time backtest (status + metrics, or `INSUFFICIENT_DATA`) |
| `figures/*.png` | charts for the report (`lead_time_mae.png` only when lead-time status is `OK`) |

Code: `services/analytics-service/eval/` (pipeline), `services/analytics-service/src/utils/`
(production functions it reuses), `thesis/scripts/plot_reorder_evaluation.py` (figures).
