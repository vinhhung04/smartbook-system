"""Figures for the SmartBook reorder-decision evaluation.

Reads ONLY the machine-readable results written by
`node services/analytics-service/eval/run-all.js` (thesis/data/*.json) and
writes PNGs to thesis/figures/. No number is typed in this file.

USAGE (repo root):
    python -m pip install -r thesis/scripts/requirements.txt
    python thesis/scripts/plot_reorder_evaluation.py
"""

from __future__ import annotations

import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
FIGURES = ROOT / "figures"

# Categorical slots in fixed order (validated palette, light surface); the
# NO_REORDER reference is a neutral gray so it never reads as a competitor.
SURFACE = "#fcfcfb"
TEXT = "#0b0b0b"
TEXT_SECONDARY = "#52514e"
GRID = "#e4e3df"
SLOTS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"]
REFERENCE_GRAY = "#9a9893"

POLICY_ORDER = ["NO_REORDER", "REORDER_POINT", "MA30_FIXED_LT", "SMARTBOOK", "SMARTBOOK_BUDGET_MATCHED"]
POLICY_COLOR = {
    "NO_REORDER": REFERENCE_GRAY,
    "REORDER_POINT": SLOTS[0],
    "MA30_FIXED_LT": SLOTS[1],
    "SMARTBOOK": SLOTS[2],
    "SMARTBOOK_BUDGET_MATCHED": SLOTS[3],
}
POLICY_LABEL = {
    "NO_REORDER": "NO_REORDER (tham chiếu)",
    "REORDER_POINT": "REORDER_POINT",
    "MA30_FIXED_LT": "MA30_FIXED_LT",
    "SMARTBOOK": "SMARTBOOK",
    "SMARTBOOK_BUDGET_MATCHED": "SMARTBOOK (ngân sách = baseline)",
}
MODEL_LABEL = {
    "NAIVE_LAST_VALUE": "Naive",
    "MOVING_AVERAGE_7": "MA7",
    "MOVING_AVERAGE_30": "MA30",
    "CURRENT_EWMA_TREND": "EWMA+trend\n(production)",
    "CROSTON": "Croston",
    "SBA": "SBA",
    "TSB": "TSB",
}

plt.rcParams.update({
    "figure.facecolor": SURFACE,
    "axes.facecolor": SURFACE,
    "savefig.facecolor": SURFACE,
    "axes.edgecolor": GRID,
    "axes.labelcolor": TEXT_SECONDARY,
    "axes.titlecolor": TEXT,
    "axes.titlesize": 12,
    "axes.titleweight": "bold",
    "axes.labelsize": 10,
    "xtick.color": TEXT_SECONDARY,
    "ytick.color": TEXT_SECONDARY,
    "xtick.labelsize": 9,
    "ytick.labelsize": 9,
    "legend.fontsize": 9,
    "legend.frameon": False,
    "font.family": "DejaVu Sans",
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.grid": True,
    "axes.grid.axis": "y",
    "grid.color": GRID,
    "grid.linewidth": 0.8,
    "axes.axisbelow": True,
})


def load(name: str) -> dict:
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def save(fig, name: str) -> None:
    fig.savefig(FIGURES / name, dpi=200, bbox_inches="tight")
    plt.close(fig)
    print(f"[plot] wrote thesis/figures/{name}")


def grouped_bars(ax, groups, series, values, colors, labels, fmt, width=0.8, percent_axis=False):
    """values[s][g] -> bar of series s in group g; a label above every bar (relief for low-contrast slots)."""
    n = len(series)
    bar = width / n
    x = np.arange(len(groups))
    top = max((v for row in values for v in row if v is not None), default=0)
    for i, s in enumerate(series):
        offsets = x - width / 2 + bar * (i + 0.5)
        heights = [v if v is not None else 0 for v in values[i]]
        ax.bar(offsets, heights, bar * 0.92, color=colors[i], label=labels[i], edgecolor=SURFACE, linewidth=1)
        for xo, v in zip(offsets, values[i]):
            if v is not None:
                ax.text(xo, v + top * 0.01, fmt(v), ha="center", va="bottom", fontsize=7, color=TEXT_SECONDARY, rotation=90)
    ax.set_xticks(x, groups)
    if percent_axis:  # a share never exceeds 100%: headroom for labels only, no tick above 100
        ax.set_ylim(0, 112)
        ax.set_yticks(range(0, 101, 20))
    else:
        ax.set_ylim(0, top * 1.22 if top else 1)


# ── forecast ─────────────────────────────────────────────────────────────────

def plot_forecast(metric: str, title: str, filename: str) -> None:
    forecast = load("forecast_model_results.json")
    models = forecast["protocol"]["models"]
    horizons = forecast["horizons"]
    values = [[next(m[metric] for m in h["overall"] if m["model"] == model) for model in models] for h in horizons]
    fig, ax = plt.subplots(figsize=(10, 5))
    grouped_bars(
        ax, [MODEL_LABEL.get(m, m) for m in models], [h["horizon_days"] for h in horizons], values,
        SLOTS[: len(horizons)], [f"Horizon {h['horizon_days']} ngày" for h in horizons], lambda v: f"{v:.4f}",
    )
    ax.set_title(title, loc="left")
    ax.set_ylabel(f"{metric.upper()} (lượt mượn / ngày / variant)")
    ax.set_xlabel("Mô hình dự báo")
    ax.legend(loc="upper right", ncols=len(horizons))
    fig.text(0.0, -0.08, f"Rolling-origin backtest, {forecast['variants_with_demand']} variant, cửa sổ {forecast['protocol']['window_days']} ngày. Dữ liệu tổng hợp (synthetic).", fontsize=8, color=TEXT_SECONDARY)
    save(fig, filename)


# ── reorder policies ─────────────────────────────────────────────────────────

def plot_policy_metric(metric: str, title: str, ylabel: str, fmt, filename: str, scale: float = 1.0, percent_axis: bool = False) -> None:
    results = load("reorder_policy_results.json")
    scenarios = [s["id"] for s in results["scenarios"]]
    policies = [p for p in POLICY_ORDER if any(r["policy"] == p for r in results["policies"])]

    def value(scenario, policy, window):
        row = next(r for r in results["policies"] if r["scenario"] == scenario and r["policy"] == policy)
        v = row[window][metric]
        return None if v is None else v * scale

    fig, axes = plt.subplots(1, 2, figsize=(13, 5), sharey=True)
    for ax, (window, label) in zip(axes, [("metrics", "Toàn cửa sổ chấm điểm"), ("steady_state_metrics", "Cửa sổ ổn định (sau lead time tối đa)")]):
        grouped_bars(
            ax, scenarios, policies, [[value(s, p, window) for s in scenarios] for p in policies],
            [POLICY_COLOR[p] for p in policies], [POLICY_LABEL[p] for p in policies], fmt, percent_axis=percent_axis,
        )
        ax.set_title(label, loc="left", fontsize=11)
        ax.set_xlabel("Kịch bản")
    axes[0].set_ylabel(ylabel)
    if not percent_axis:
        top = max(axes[0].get_ylim()[1], axes[1].get_ylim()[1])
        for ax in axes:
            ax.set_ylim(0, top)
    handles, labels = axes[0].get_legend_handles_labels()
    fig.legend(handles, labels, loc="upper center", ncols=len(policies), bbox_to_anchor=(0.5, 1.0))
    fig.suptitle(title, x=0.01, y=1.08, ha="left", fontsize=13, fontweight="bold", color=TEXT)
    p = results["protocol"]
    fig.text(0.01, -0.03, f"Backtest kho ảo {p['scoring_start']} → {p['scoring_end_exclusive']}, {p['variants']} variant, xem xét mỗi {p['review_period_days']} ngày. Dữ liệu tổng hợp (synthetic).", fontsize=8, color=TEXT_SECONDARY)
    save(fig, filename)


def plot_ablation() -> None:
    results = load("reorder_ablation_results.json")
    scenarios = [s["id"] for s in results["scenarios"]]
    rows = results["ablation"]
    variants = []
    for r in rows:
        key = (r["variant"], r["budget_constrained"])
        if key not in variants:
            variants.append(key)
    names = [v.replace("SMARTBOOK_", "").replace("_", "\n", 1) + ("\n(ngân sách)" if b else "") for v, b in variants]

    def value(scenario, key, metric):
        return next(r["metrics"][metric] for r in rows if r["scenario"] == scenario and (r["variant"], r["budget_constrained"]) == key)

    panels = [
        ("fill_rate", "Fill rate (%)", 100, lambda v: f"{v:.2f}"),
        ("stockout_days", "Stockout days (variant-ngày)", 1, lambda v: f"{v:.0f}"),
        ("average_inventory", "Tồn kho trung bình (bản)", 1, lambda v: f"{v:.0f}"),
        ("procurement_cost", "Chi phí mua (triệu VND)", 1e-6, lambda v: f"{v:.0f}"),
    ]
    fig, axes = plt.subplots(2, 2, figsize=(15, 10))
    for ax, (metric, label, scale, fmt) in zip(axes.flat, panels):
        grouped_bars(
            ax, names, scenarios, [[value(s, k, metric) * scale for k in variants] for s in scenarios],
            SLOTS[: len(scenarios)], scenarios, fmt, percent_axis=metric == "fill_rate",
        )
        ax.set_title(label, loc="left", fontsize=11)
        ax.set_ylabel(label)
        ax.tick_params(axis="x", labelsize=8)
    handles, labels = axes[0, 0].get_legend_handles_labels()
    fig.legend(handles, labels, loc="upper center", ncols=len(scenarios), bbox_to_anchor=(0.5, 1.0), title="Kịch bản")
    fig.suptitle("Ablation SmartBook: tác động của từng thành phần (toàn cửa sổ chấm điểm)", x=0.01, y=1.05, ha="left", fontsize=13, fontweight="bold", color=TEXT)
    fig.tight_layout()
    save(fig, "reorder_ablation.png")


def plot_lead_time() -> None:
    results = load("lead_time_results.json")
    target = FIGURES / "lead_time_mae.png"
    if results["status"] != "OK":
        if target.exists():
            target.unlink()  # never leave a stale chart behind
        print(f"[plot] lead_time_mae.png skipped: {results['status']} ({results['deliveries']} deliveries, {results['paired_samples']} paired samples)")
        return
    methods = [m for m in results["methods"] if m["paired"]]
    fig, ax = plt.subplots(figsize=(8, 4.5))
    grouped_bars(ax, [m["method"] for m in methods], ["paired"], [[m["paired"]["mae"] for m in methods]], [SLOTS[0]], ["MAE (so sánh cặp)"], lambda v: f"{v:.2f}")
    ax.set_title("Sai số dự đoán lead time nhà cung cấp", loc="left")
    ax.set_ylabel("MAE (ngày)")
    ax.legend(loc="upper right")
    fig.text(0.0, -0.03, f"{results['paired_samples']} lần giao, nguồn {results['source']}.", fontsize=8, color=TEXT_SECONDARY)
    save(fig, "lead_time_mae.png")


def plot_timeline() -> None:
    data = load("inventory_timeline_example.json")
    shown = [p for p in ["REORDER_POINT", "MA30_FIXED_LT", "SMARTBOOK"] if p in data["policies"]]
    fig, axes = plt.subplots(len(shown), 1, figsize=(13, 3.4 * len(shown)), sharex=True, sharey=True)
    for ax, policy in zip(np.atleast_1d(axes), shown):
        days = data["policies"][policy]
        x = np.arange(len(days))
        ax.bar(x, [d["demand"] for d in days], 0.8, color="#c9c7c1", label="Nhu cầu thực tế / ngày")
        ax.bar(x, [d["unmet"] for d in days], 0.8, color="#e34948", label="Nhu cầu không đáp ứng")
        ax.step(x, [d["owned_end"] for d in days], where="post", color=POLICY_COLOR[policy], linewidth=2, label="Số bản sở hữu")
        ax.step(x, [d["available_end"] for d in days], where="post", color=TEXT_SECONDARY, linewidth=1.2, linestyle="--", label="Bản trên kệ cuối ngày")
        orders = [(i, d["ordered_qty"]) for i, d in enumerate(days) if d["ordered_qty"] > 0]
        receipts = [(i, d["received_qty"]) for i, d in enumerate(days) if d["received_qty"] > 0]
        owned = [d["owned_end"] for d in days]
        if orders:
            ax.scatter([i for i, _ in orders], [owned[i] for i, _ in orders], marker="v", s=40, color=TEXT, zorder=5, label="Đặt hàng (PO)")
        if receipts:
            ax.scatter([i for i, _ in receipts], [owned[i] for i, _ in receipts], marker="^", s=40, color=POLICY_COLOR[policy], edgecolor=TEXT, zorder=5, label="Hàng về")
        ax.set_title(f"{policy}", loc="left", fontsize=11)
        ax.set_ylabel("Số bản / lượt mượn")
        ax.legend(loc="upper left", ncols=3, fontsize=8)
    ticks = list(range(0, len(days), 30))
    np.atleast_1d(axes)[-1].set_xticks(ticks, [days[i]["date"] for i in ticks], rotation=45)
    np.atleast_1d(axes)[-1].set_xlabel("Ngày (kịch bản BASE)")
    fig.suptitle(f"Diễn biến tồn kho ảo — \"{data['title']}\" ({data['selection_rule']})", x=0.01, ha="left", fontsize=13, fontweight="bold", color=TEXT)
    fig.tight_layout()
    save(fig, "inventory_timeline_example.png")


def main() -> None:
    FIGURES.mkdir(parents=True, exist_ok=True)
    plot_forecast("mae", "So sánh MAE của các mô hình dự báo nhu cầu", "forecast_mae_comparison.png")
    plot_forecast("rmse", "So sánh RMSE của các mô hình dự báo nhu cầu", "forecast_rmse_comparison.png")
    plot_policy_metric("fill_rate", "Fill rate theo chính sách nhập kho", "Fill rate (%)", lambda v: f"{v:.2f}", "reorder_fill_rate.png", scale=100, percent_axis=True)
    plot_policy_metric("stockout_days", "Số ngày hết sách (variant-ngày có nhu cầu không đáp ứng)", "Stockout days", lambda v: f"{v:.0f}", "reorder_stockout_days.png")
    plot_policy_metric("average_inventory", "Tồn kho trung bình (tổng số bản sở hữu của danh mục)", "Số bản", lambda v: f"{v:.0f}", "reorder_average_inventory.png")
    plot_policy_metric("procurement_cost", "Chi phí mua sách", "Triệu VND", lambda v: f"{v:.0f}", "reorder_procurement_cost.png", scale=1e-6)
    plot_ablation()
    plot_lead_time()
    plot_timeline()


if __name__ == "__main__":
    main()
