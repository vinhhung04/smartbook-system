"""Tables and figures: SmartBook's budget allocation vs the 8 ways a library really spends
a purchasing budget (evaluation of 26/11/2026).

"SmartBook" here is the allocation running in production since commit a13df1f
(SB_NOFLOOR_PROTECT in the eval files). The earlier SmartBook version is deliberately left out.

Reads ONLY the result files written by `services/analytics-service/eval/budget-improvement.js`
and `eval/budget-realistic.js` (thesis/data/budget_*_results.json); writes
    thesis/tables/budget_eval_*.csv
    thesis/figures/budget_eval_*.png
    docs/reports/BUDGET_ALLOCATION_TABLES_FIGURES.md  (Vietnamese tables + captions for the report)
No result number is typed in this file.

USAGE (repo root):
    python thesis/scripts/budget_allocation_report.py
"""

from __future__ import annotations

import csv
import json
import statistics
from pathlib import Path

import matplotlib
import matplotlib.ticker

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DATA, TABLES, FIGURES = ROOT / "data", ROOT / "tables", ROOT / "figures"
DOC = ROOT.parent / "docs" / "reports" / "BUDGET_ALLOCATION_TABLES_FIGURES.md"

SB = "SB_NOFLOOR_PROTECT"  # the production allocation; the eval files keep its candidate name
SCENARIOS = ["BASE", "SUPPLIER_DELAY", "LEAN_START"]
SCENARIO_VI = {"BASE": "Bình thường", "SUPPLIER_DELAY": "Giao chậm", "LEAN_START": "Tồn đầu một nửa",
               "REAL_HALF": "Một nửa số bản thật", "REAL_SINGLE": "1 bản mỗi đầu sách"}
LIBRARY_VI = {"public": "Công cộng", "univ": "Đại học"}
RULE_VI = {"POPULAR_FIRST": "mượn nhiều trước", "HOLDS_FIRST": "đặt giữ trước",
           "CATEGORY_SHARE": "chia theo thể loại", "ONE_EACH": "mỗi đầu sách một bản"}
QTY_VI = {"REORDER_POINT": "Điểm đặt hàng lại (5/10)", "MA30_FIXED_LT": "TB 30 ngày + tồn an toàn"}

# Same surface/ink as plot_reorder_evaluation.py. One highlight hue for SmartBook, the 8 baselines in
# neutral ink, the best baseline in blue (pair validated with the dataviz validator, light mode).
SURFACE, TEXT, TEXT_SECONDARY, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#e4e3df"
C_SB, C_BEST, C_OTHER = "#1baf7a", "#2a78d6", "#9a9893"
plt.rcParams.update({"font.family": "Arial", "font.size": 11, "axes.edgecolor": GRID,
                     "axes.labelcolor": TEXT_SECONDARY, "xtick.color": TEXT_SECONDARY,
                     "ytick.color": TEXT_SECONDARY, "figure.facecolor": SURFACE, "axes.facecolor": SURFACE})


def vn(x: float, digits: int = 2) -> str:
    return f"{x:,.{digits}f}".replace(",", " ").replace(".", ",").replace(" ", ".")


def pct(x: float, digits: int = 2) -> str:
    return vn(100 * x, digits) + "%"


def signed(x: float, digits: int = 2) -> str:
    return ("+" if x >= 0 else "−") + vn(abs(x), digits)


def mult(m: float) -> str:
    return "× " + vn(m, 2).rstrip("0").rstrip(",")


def policy_vi(name: str) -> str:
    if name == SB:
        return "SmartBook"
    qty, rule = name.split("/")
    return f"{QTY_VI[qty]} + {RULE_VI[rule]}"


def write_csv(name: str, header: list[str], rows: list[list]) -> None:
    with open(TABLES / name, "w", newline="", encoding="utf-8") as f:
        csv.writer(f).writerows([header, *rows])


def md_table(header: list[str], rows: list[list[str]]) -> str:
    out = ["| " + " | ".join(header) + " |", "|" + "|".join("---" for _ in header) + "|"]
    return "\n".join(out + ["| " + " | ".join(r) + " |" for r in rows])


def main() -> None:
    imp = json.load(open(DATA / "budget_improvement_results.json", encoding="utf-8"))
    protocol = json.load(open(DATA / "budget_realistic_results.json", encoding="utf-8"))["protocol"]
    meta = json.load(open(DATA / "budget_realistic_results.json", encoding="utf-8"))["real_meta"]
    baselines = protocol["baselines"]
    test = {(t["scenario"], t["multiplier"]): t for t in imp["test"] if t["data"] == "synthetic"}
    mults = sorted({m for (_, m) in test})
    md: list[str] = []

    # mean fill per policy, test seeds, budget x1
    fills: dict[tuple[str, str], list[float]] = {}
    for r in imp["test_rows"]:
        if r["data"] == "synthetic" and r["multiplier"] == 1 and (r["policy"] == SB or r["policy"] in baselines):
            fills.setdefault((r["scenario"], r["policy"]), []).append(r["fill_rate"])
    mean_fill = {k: statistics.mean(v) for k, v in fills.items()}
    assert all(len(v) == 8 for v in fills.values()), "expected 8 test seeds per cell"

    # ── Bảng 1: SmartBook and all 8 baselines, budget x1
    order = [SB] + sorted(baselines, key=lambda p: -mean_fill[("BASE", p)])
    rows_md, rows_csv = [], []
    for p in order:
        rank = [1 + sorted((mean_fill[(sc, q)] for q in order), reverse=True).index(mean_fill[(sc, p)]) for sc in SCENARIOS]
        cells = [f"{pct(mean_fill[(sc, p)])} ({r})" for sc, r in zip(SCENARIOS, rank)]
        name = policy_vi(p)
        rows_md.append([f"**{name}**" if p == SB else name, *cells])
        rows_csv.append([p, *(mean_fill[(sc, p)] for sc in SCENARIOS)])
    write_csv("budget_eval_x1_all_policies.csv", ["policy", *SCENARIOS], rows_csv)
    md += ["### Bảng 1. Mức đáp ứng nhu cầu của SmartBook và tám cách chi ngân sách thực tế (8 hạt giống kiểm định 20261401–08, ngân sách × 1)", "",
           md_table(["Cách phân bổ ngân sách", *(f"{SCENARIO_VI[sc]} (hạng)" for sc in SCENARIOS)], rows_md), "",
           "Mỗi ô là mức đáp ứng trung bình trên 8 hạt giống; số trong ngoặc là thứ hạng trong 9 cách ở kịch bản đó. "
           "Tám cách chi thực tế ghép hai quy tắc tính số lượng (điểm đặt hàng lại tối thiểu 5, tối đa 10; trung bình 30 ngày cộng tồn an toàn) "
           "với bốn quy tắc chi tiền khi thiếu ngân sách. Mọi cách dùng cùng nhu cầu, cùng tồn đầu kỳ, cùng đơn giá và cùng ngân sách mỗi kỳ.", ""]

    # ── Bảng 2: SmartBook vs the best baseline, budget x1, paired over seeds
    rows_md, rows_csv = [], []
    for sc in SCENARIOS:
        t = test[(sc, 1)]
        vb = t["vs_best"]
        rows_csv.append([sc, t["best_baseline"], t["fill"]["candidate"], t["fill"]["best"], vb["fill_pp"]["mean"], vb["fill_pp"]["low"],
                         vb["fill_pp"]["high"], vb["wins"], vb["unmet_reduction_pct"]["mean"], vb["unmet_reduction_pct"]["low"],
                         vb["unmet_reduction_pct"]["high"], vb["stockout_days"]["mean"], vb["cost_ratio_pct"]["mean"]])
        rows_md.append([SCENARIO_VI[sc], policy_vi(t["best_baseline"]), pct(t["fill"]["candidate"]), pct(t["fill"]["best"]),
                        f"{signed(vb['fill_pp']['mean'])} [{vn(vb['fill_pp']['low'])}; {vn(vb['fill_pp']['high'])}]",
                        f"{vb['wins']}/{vb['runs']}",
                        f"{vn(vb['unmet_reduction_pct']['mean'], 1)}% [{vn(vb['unmet_reduction_pct']['low'], 1)}; {vn(vb['unmet_reduction_pct']['high'], 1)}]",
                        signed(vb["stockout_days"]["mean"], 0), vn(vb["cost_ratio_pct"]["mean"], 1) + "%"])
    write_csv("budget_eval_x1_vs_best.csv",
              ["scenario", "best_baseline", "smartbook_fill", "best_fill", "diff_pp", "ci_low", "ci_high", "wins",
               "unmet_reduction_pct", "unmet_low", "unmet_high", "stockout_days_diff", "cost_ratio_pct"], rows_csv)
    claim = imp["claim"]
    md += ["### Bảng 2. SmartBook so với cách chi tốt nhất, ngân sách × 1 (8 hạt giống kiểm định, so sánh ghép cặp)", "",
           md_table(["Kịch bản", "Cách chi tốt nhất", "SmartBook", "Cách chi tốt nhất (mức đáp ứng)", "Chênh lệch (điểm %, KTC 95%)",
                     "Số lần SmartBook cao hơn", "Giảm lượt không được phục vụ (KTC 95%)", "Chênh ngày hết sách", "Chi phí so với cách chi tốt nhất"], rows_md), "",
           f"Giả thuyết ghi trước khi chạy (SmartBook cao hơn cách chi tốt nhất ở mọi hạt giống × kịch bản, ngân sách × 1): "
           f"{claim['wins']}/{claim['runs']} lần chạy, được xác nhận. Cách chi tốt nhất được chọn sau khi đã có kết quả nên có lợi cho phía so sánh. "
           "Chi phí trên 100% nghĩa là SmartBook tiêu nhiều hơn: ở ngân sách × 1 cách chi tốt nhất không tiêu hết ngân sách, "
           "nên một phần lợi thế của SmartBook đến từ việc dùng hết ngân sách được cấp. Chênh ngày hết sách âm là ít ngày hết sách hơn.", ""]

    # ── Bảng 3: every budget level
    rows_md, rows_csv = [], []
    wins = runs = 0
    for sc in SCENARIOS:
        for m in mults:
            t = test[(sc, m)]
            vb = t["vs_best"]
            wins += vb["wins"]; runs += vb["runs"]
            rows_csv.append([sc, m, t["best_baseline"], t["fill"]["candidate"], t["fill"]["best"], vb["fill_pp"]["mean"], vb["wins"],
                             vb["unmet_reduction_pct"]["mean"], vb["stockout_days"]["mean"], vb["cost_ratio_pct"]["mean"]])
            rows_md.append([SCENARIO_VI[sc], mult(m), pct(t["fill"]["candidate"]), pct(t["fill"]["best"]), signed(vb["fill_pp"]["mean"]),
                            f"{vb['wins']}/{vb['runs']}", vn(vb["unmet_reduction_pct"]["mean"], 1) + "%", signed(vb["stockout_days"]["mean"], 0),
                            vn(vb["cost_ratio_pct"]["mean"], 1) + "%"])
    write_csv("budget_eval_all_budgets.csv", ["scenario", "multiplier", "best_baseline", "smartbook_fill", "best_fill", "diff_pp", "wins",
                                             "unmet_reduction_pct", "stockout_days_diff", "cost_ratio_pct"], rows_csv)
    common_best = max({t["best_baseline"] for t in test.values()}, key=lambda b: sum(t["best_baseline"] == b for t in test.values()))
    odd = "; ".join(f"{SCENARIO_VI[sc]} {mult(m)}: {policy_vi(t['best_baseline'])}" for (sc, m), t in test.items() if t["best_baseline"] != common_best)
    md += ["### Bảng 3. SmartBook so với cách chi tốt nhất ở mọi mức ngân sách (8 hạt giống kiểm định; mỗi dòng là trung bình 8 lần chạy)", "",
           md_table(["Kịch bản", "Ngân sách mỗi kỳ", "SmartBook", "Cách chi tốt nhất", "Chênh lệch (điểm %)", "Số lần SmartBook cao hơn",
                     "Giảm lượt không được phục vụ", "Chênh ngày hết sách", "Chi phí so với cách chi tốt nhất"], rows_md), "",
           f"Ngân sách × 1 là mức tham chiếu (chi phí của cách chi rẻ hơn khi không giới hạn, chia đều cho các kỳ). Cách chi tốt nhất được chọn "
           f"riêng cho từng dòng: {policy_vi(common_best)}" + (f", trừ {odd}" if odd else "") + ". "
           f"Tổng cộng SmartBook cao hơn cách chi tốt nhất ở {wins}/{runs} lần chạy. Ngân sách × 0,5 là so sánh rõ nhất vì mọi cách đều "
           "tiêu gần hết ngân sách (chi phí xấp xỉ 100%).", ""]

    # ── Bảng 4: real loans
    rows_md, rows_csv = [], []
    for t in sorted(imp["real"], key=lambda x: (x["data"] != "public", x["scenario"], x["multiplier"])):
        vb = t["vs_best"]
        rows_csv.append([t["data"], t["scenario"], t["multiplier"], t["best_baseline"], t["fill"]["candidate"], t["fill"]["best"],
                         vb["fill_pp"]["mean"], vb["unmet_reduction_pct"]["mean"]])
        rows_md.append([LIBRARY_VI[t["data"]], SCENARIO_VI[t["scenario"]], mult(t["multiplier"]), pct(t["fill"]["candidate"]),
                        pct(t["fill"]["best"]), signed(vb["fill_pp"]["mean"]), vn(vb["unmet_reduction_pct"]["mean"], 1) + "%"])
    write_csv("budget_eval_real_loans.csv", ["library", "scenario", "multiplier", "best_baseline", "smartbook_fill", "best_fill",
                                             "diff_pp", "unmet_reduction_pct"], rows_csv)
    real_best = sorted({policy_vi(t["best_baseline"]) for t in imp["real"]})
    md += ["### Bảng 4. SmartBook so với cách chi tốt nhất trên lượt mượn thật của hai thư viện Indonesia (mỗi dòng một lần chạy, không có khoảng tin cậy)", "",
           md_table(["Thư viện", "Số bản ban đầu", "Ngân sách mỗi kỳ", "SmartBook", "Cách chi tốt nhất", "Chênh lệch (điểm %)",
                     "Giảm lượt không được phục vụ"], rows_md), "",
           f"Cách chi tốt nhất trên dữ liệu thật: {', '.join(real_best)}. Dữ liệu: Mendeley doi:{meta['public']['doi']} (CC BY 4.0). "
           f"Thư viện công cộng: {vn(meta['public']['kept_loans'], 0)}/{vn(meta['public']['loans'], 0)} lượt mượn (đầu sách có ít nhất "
           f"{meta['public']['min_loans']} lượt), {vn(meta['public']['titles'], 0)} đầu sách, {vn(meta['public']['days'], 0)} ngày; "
           f"thư viện đại học: {vn(meta['univ']['loans'], 0)} lượt mượn, {vn(meta['univ']['titles'], 0)} đầu sách, {vn(meta['univ']['days'], 0)} ngày. "
           f"Đơn giá {vn(protocol['unit_cost_real_vnd'], 0)} đồng/bản và số bản ban đầu là giả định; dữ liệu chỉ có lượt mượn đã được phục vụ "
           "nên nhu cầu bị đánh giá thấp.", ""]

    # ── Hình 1: dot plot, SmartBook against the 8 baselines, one panel per scenario
    fig, axes = plt.subplots(1, 3, figsize=(10, 4.2), dpi=300, sharey=True)
    ylabels = [policy_vi(p) for p in order]
    for ax, sc in zip(axes, SCENARIOS):
        best = test[(sc, 1)]["best_baseline"]
        for i, p in enumerate(order):
            v = 100 * mean_fill[(sc, p)]
            color = C_SB if p == SB else C_BEST if p == best else C_OTHER
            ax.scatter(v, i, s=70 if p in (SB, best) else 45, color=color, edgecolor=SURFACE, lw=1.2, zorder=3)
            if p in (SB, best):
                ax.annotate(vn(v), (v, i), xytext=(8, 0), textcoords="offset points", ha="left", va="center", fontsize=9, color=TEXT)
        lo = min(100 * mean_fill[(sc, p)] for p in order)
        ax.set_xlim(lo - 1, 100)
        ax.xaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda x, _: vn(x, 1).rstrip("0").rstrip(",")))
        ax.set_title(SCENARIO_VI[sc], color=TEXT, fontsize=11)
        ax.grid(axis="x", color=GRID, lw=0.8); ax.set_axisbelow(True)
        ax.tick_params(axis="y", length=0)
        for s in ("top", "right", "left"):
            ax.spines[s].set_visible(False)
        ax.set_xlabel("Mức đáp ứng (%)", fontsize=9)
    axes[0].set_yticks(range(len(order)), ylabels, fontsize=9)
    axes[0].get_yticklabels()[0].set_color(TEXT); axes[0].get_yticklabels()[0].set_fontweight("bold")
    axes[0].invert_yaxis()
    handles = [plt.Line2D([], [], ls="", marker="o", color=C_SB, ms=8, label="SmartBook"),
               plt.Line2D([], [], ls="", marker="o", color=C_BEST, ms=8, label="Cách chi tốt nhất của kịch bản"),
               plt.Line2D([], [], ls="", marker="o", color=C_OTHER, ms=7, label="Các cách chi còn lại")]
    fig.legend(handles=handles, loc="lower center", ncol=3, frameon=False, fontsize=9.5)
    fig.tight_layout(rect=(0, 0.07, 1, 1))
    fig.savefig(FIGURES / "budget_eval_x1_all_policies.png", facecolor=SURFACE)
    plt.close(fig)

    # ── Hình 2: fill rate by budget level, SmartBook vs the best baseline
    fig, axes = plt.subplots(1, 3, figsize=(9.5, 3.4), dpi=300)
    for ax, sc in zip(axes, SCENARIOS):
        for key, color, label, hollow in (("best", C_BEST, "Cách chi tốt nhất", True), ("candidate", C_SB, "SmartBook", False)):
            ys = [100 * test[(sc, m)]["fill"][key] for m in mults]
            ax.plot(mults, ys, color=color, lw=2, marker="o", ms=7, mfc=SURFACE if hollow else color,
                    mec=color if hollow else SURFACE, mew=2 if hollow else 1.2, label=label)
        ax.set_title(SCENARIO_VI[sc], color=TEXT, fontsize=11)
        ax.set_xticks(mults, ["×" + vn(m, 2).rstrip("0").rstrip(",") for m in mults], fontsize=9)
        ax.grid(axis="y", color=GRID, lw=0.8); ax.set_axisbelow(True)
        for s in ("top", "right"):
            ax.spines[s].set_visible(False)
        ax.set_xlabel("Ngân sách mỗi kỳ (× mức tham chiếu)", fontsize=9)
    axes[0].set_ylabel("Mức đáp ứng nhu cầu (%)")
    h, l = axes[0].get_legend_handles_labels()
    fig.legend(h, l, loc="lower center", ncol=2, frameon=False, fontsize=9.5, bbox_to_anchor=(0.5, -0.01))
    fig.tight_layout(rect=(0, 0.08, 1, 1))
    fig.savefig(FIGURES / "budget_eval_fill_by_budget.png", facecolor=SURFACE)
    plt.close(fig)

    md += ["### Hình đề xuất", "",
           "- `thesis/figures/budget_eval_x1_all_policies.png` — Hình 7.x. Mức đáp ứng nhu cầu của SmartBook và tám cách chi ngân sách thực tế "
           "ở ngân sách × 1 (trung bình 8 hạt giống kiểm định, dữ liệu tổng hợp). Trục ngang của ba ô có thang khác nhau. Số liệu: Bảng 1.",
           "- `thesis/figures/budget_eval_fill_by_budget.png` — Hình 7.y. Mức đáp ứng nhu cầu của SmartBook và cách chi tốt nhất theo mức ngân sách "
           "(8 hạt giống kiểm định, dữ liệu tổng hợp). Trục dọc của ba ô có thang khác nhau. Số liệu: Bảng 3.", ""]

    header = ["# Bảng và hình: phân bổ ngân sách của SmartBook so với cách chi ngân sách thực tế (đánh giá ngày 26/11/2026)", "",
              "Sinh tự động bởi `python thesis/scripts/budget_allocation_report.py` từ `thesis/data/budget_improvement_results.json` và "
              "`thesis/data/budget_realistic_results.json`; không sửa tay. SmartBook là cách phân bổ đang chạy trong hệ thống từ commit a13df1f "
              "(tên trong file kết quả: SB_NOFLOOR_PROTECT). Phương pháp, giao thức và giới hạn: `docs/reports/BUDGET_ALLOCATION_THESIS_SOURCE.md`.", ""]
    DOC.write_text("\n".join(header + md), encoding="utf-8")
    print("wrote", DOC.relative_to(ROOT.parent))


if __name__ == "__main__":
    main()
