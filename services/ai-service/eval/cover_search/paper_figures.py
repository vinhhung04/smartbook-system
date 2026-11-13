"""Column-width figures (3.4 in, Vietnamese labels, >= 7 pt text) for the
paper. Every value comes from results_main_test/metrics.json or the
predictions.jsonl files; nothing is typed in.

    python paper_figures.py --runs E2_clip_all,E13_text_all --metrics results_main_test --out figures
"""
from __future__ import annotations

import argparse
import collections
import json

from common import DOCS_DIR, setup_environment

setup_environment(load_secrets=False)

import matplotlib  # noqa: E402

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

from dataset_loader import load_dataset  # noqa: E402
from generate_report import load_predictions  # noqa: E402

W = 3.4
METHODS = ["ocr_only", "clip_only", "hybrid"]
LABEL = {"ocr_only": "OCR-only", "clip_only": "CLIP-only", "hybrid": "Hybrid"}
COLOR = {"ocr_only": "#B45309", "clip_only": "#2F5597", "hybrid": "#1F3864"}
TRANSFORM_VI = {"jpeg_q20": "JPEG q20", "low_light": "Thiếu sáng", "low_contrast": "Giảm tương phản",
                "rot_p4": "Xoay +4°", "rot_m4": "Xoay −4°", "perspective": "Phối cảnh", "mild_crop": "Cắt nhẹ",
                "gaussian_blur": "Làm mờ Gauss", "occlusion": "Che 20 %"}

plt.rcParams.update({"font.family": "Times New Roman", "font.size": 7.5, "axes.titlesize": 8,
                     "axes.labelsize": 7.5, "xtick.labelsize": 7, "ytick.labelsize": 7, "legend.fontsize": 7,
                     "axes.spines.top": False, "axes.spines.right": False})


def vn(x: float, d: int = 2) -> str:
    return f"{x:.{d}f}".replace(".", ",")


def _comma(fig):
    from matplotlib.ticker import FuncFormatter
    fmt = FuncFormatter(lambda v, _: (f"{v:g}").replace(".", ","))
    def numeric(labels):
        texts = [t.get_text() for t in labels if t.get_text()]
        return bool(texts) and all(t.replace("−", "-").replace(".", "", 1).lstrip("-").replace("$", "").replace("\\mathdefault{", "").replace("}", "").replace("^", "").replace("{", "").isdigit() for t in texts)
    for ax in fig.axes:
        if ax.get_xscale() == "log" or numeric(ax.get_xticklabels()):
            ax.xaxis.set_major_formatter(fmt)
        if ax.get_yscale() == "linear" and numeric(ax.get_yticklabels()):
            ax.yaxis.set_major_formatter(fmt)


def save(fig, path):
    fig.canvas.draw()
    _comma(fig)
    fig.tight_layout(pad=0.3)
    fig.savefig(path, dpi=300)
    plt.close(fig)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runs", required=True)
    parser.add_argument("--metrics", default="results_main_test")
    parser.add_argument("--out", default="figures")
    args = parser.parse_args()
    out = DOCS_DIR / args.out
    out.mkdir(parents=True, exist_ok=True)
    report = json.loads((DOCS_DIR / args.metrics / "metrics.json").read_text(encoding="utf-8"))
    ds = load_dataset()
    queries = {q["query_id"]: q for q in ds.queries}
    preds = [p for p in load_predictions(args.runs.split(",")) if queries[p["query_id"]]["split"] == report["split"]]

    # dataset distribution
    inc = ds.included_catalog()
    assets = ds.assets_by_id
    fig, axes = plt.subplots(1, 3, figsize=(W, 1.6))
    g = collections.Counter("QT" if r["language_group"] == "INTERNATIONAL" else ("VN-HN" if r["script"] != "Latin" else "VN") for r in inc)
    t = collections.Counter({"A": "A", "B": "B", "OOC": "OOC"}[q["query_track"]] for q in ds.included_queries())
    v = collections.Counter({"yes": "rõ", "partial": "một\nphần", "no": "không"}[assets[r["gallery_asset_id"]]["title_visible"]] for r in inc)
    for ax, data, title, col, log in ((axes[0], g, "Sách catalog", "#2F5597", False),
                                      (axes[1], {k: t[k] for k in ("A", "OOC", "B")}, "Truy vấn (log)", "#1F3864", True),
                                      (axes[2], {k: v[k] for k in ("rõ", "một\nphần", "không")}, "Đọc được tiêu đề", "#B45309", False)):
        bars = ax.bar(list(data), list(data.values()), color=col, width=0.7)
        ax.set_title(title)
        if log:
            ax.set_yscale("log")
        for b in bars:
            ax.annotate(str(int(b.get_height())), (b.get_x() + b.get_width() / 2, b.get_height()), ha="center", va="bottom", fontsize=6.5)
        ax.margins(y=0.18)
    save(fig, out / "paper_dataset.png")

    # Recall@1 with CI
    fig, ax = plt.subplots(figsize=(W, 1.9))
    width = 0.26
    for i, m in enumerate(METHODS):
        xs, ys, lo, hi = [], [], [], []
        for j, tr in enumerate(("A", "B")):
            r = report["tracks"][tr][m]["recall_at_1"]
            xs.append(j + (i - 1) * width); ys.append(r["mean"]); lo.append(r["mean"] - r["ci_low"]); hi.append(r["ci_high"] - r["mean"])
        ax.bar(xs, ys, width, yerr=[lo, hi], capsize=2, color=COLOR[m], label=LABEL[m], error_kw={"elinewidth": 0.7})
        for x, y in zip(xs, ys):
            ax.text(x, 0.04, vn(y), ha="center", fontsize=6.5, color="white", fontweight="bold", rotation=90)
    ax.set_xticks([0, 1]); ax.set_xticklabels(["Track A – ảnh độc lập", "Track B – biến đổi có kiểm soát"])
    ax.set_ylim(0, 1.05); ax.set_ylabel("Recall@1")
    ax.legend(ncol=3, frameon=False, loc="lower center", bbox_to_anchor=(0.5, 1.0))
    save(fig, out / "paper_recall1.png")

    # robustness, horizontal grouped bars
    tb = report["tracks"]["B"]
    order = ["jpeg_q20", "low_light", "low_contrast", "rot_p4", "rot_m4", "perspective", "mild_crop", "gaussian_blur", "occlusion"]
    fig, ax = plt.subplots(figsize=(W, 2.9))
    h = 0.27
    for i, m in enumerate(METHODS):
        vals = [tb[m]["strata"]["transform"][k]["recall_at_1"]["mean"] for k in order]
        ax.barh([y + (i - 1) * h for y in range(len(order))], vals, h, color=COLOR[m], label=LABEL[m])
    ax.set_yticks(range(len(order))); ax.set_yticklabels([TRANSFORM_VI[k] for k in order])
    ax.invert_yaxis(); ax.set_xlim(0.7, 1.0); ax.set_xlabel("Recall@1 (trục bắt đầu từ 0,70)")
    ax.legend(ncol=3, frameon=False, loc="lower center", bbox_to_anchor=(0.45, 1.0))
    save(fig, out / "paper_robustness.png")

    # confidence separability
    fig, ax = plt.subplots(figsize=(W, 1.9))
    import random
    rng = random.Random(1)
    for i, m in enumerate(METHODS):
        ok = [p["response"]["candidates"][0]["confidence"] for p in preds if p["method"] == m and p["query_track"] == "A" and p["rank"] == 1]
        fa = [p["response"]["candidates"][0]["confidence"] for p in preds if p["method"] == m and p["query_track"] == "OOC" and p["response"]["match_found"]]
        ax.scatter([i - 0.12 + rng.uniform(-0.07, 0.07) for _ in ok], ok, s=9, color="#1F3864", label="Đúng hạng 1 (Track A)" if i == 0 else None)
        ax.scatter([i + 0.12 + rng.uniform(-0.07, 0.07) for _ in fa], fa, s=9, marker="x", color="#B45309", label="Nhận nhầm OOC" if i == 0 else None)
    ax.axhline(0.5, color="#475569", lw=0.7, ls="--"); ax.text(2.42, 0.5, "ngưỡng\n0,5", fontsize=6.5, ha="left", va="center")
    ax.axhline(0.8, color="#475569", lw=0.7, ls=":"); ax.text(2.42, 0.8, "cổng\nảnh 0,80", fontsize=6.5, ha="left", va="center")
    ax.set_xlim(-0.4, 2.85)
    ax.set_xticks(range(3)); ax.set_xticklabels([LABEL[m] for m in METHODS]); ax.set_ylabel("Độ tin cậy top-1")
    ax.set_ylim(0.45, 1.03); ax.legend(ncol=2, frameon=False, loc="lower center", bbox_to_anchor=(0.5, 1.0))
    save(fig, out / "paper_confidence.png")

    # latency
    fig, ax = plt.subplots(figsize=(W, 1.8))
    data, labels = [], []
    for m in METHODS:
        rows = [p for p in preds if p["method"] == m and p["query_track"] in ("A", "B")]
        if m == "hybrid":
            vals = [max(p["vision"]["api_latency_ms"], p.get("clip_branch_ms") or 0.0)
                    + max(0.0, p["wall_ms"] - max(p.get("ocr_branch_ms") or 0.0, p.get("clip_branch_ms") or 0.0))
                    for p in rows if p.get("vision") and p["vision"].get("api_latency_ms") is not None]
            labels.append("Hybrid\n(tái dựng)")
        else:
            vals = [p["wall_ms"] for p in rows]
            labels.append(LABEL[m] + "\n(đo tại endpoint)")
        data.append([x / 1000 for x in vals])
    ax.boxplot(data, tick_labels=labels, vert=False, widths=0.5, flierprops={"markersize": 2})
    ax.set_xscale("log"); ax.set_xlabel("Độ trễ (giây, thang log)")
    save(fig, out / "paper_latency.png")

    # outcome distribution
    order_o = ["CORRECT_TOP1", "CORRECT_TOP5", "INCORRECT", "NO_RESULT"]
    vi_o = {"CORRECT_TOP1": "Đúng hạng 1", "CORRECT_TOP5": "Đúng hạng 2–5", "INCORRECT": "Sai sách", "NO_RESULT": "Không kết quả"}
    pal = {"CORRECT_TOP1": "#1F3864", "CORRECT_TOP5": "#2F5597", "INCORRECT": "#B45309", "NO_RESULT": "#94A3B8"}
    rows = [(t_, m) for t_ in ("A", "B") for m in METHODS]
    fig, ax = plt.subplots(figsize=(W, 1.9))
    left = [0.0] * len(rows)
    for o in order_o:
        w_ = [report["tracks"][t_][m]["outcomes"].get(o, 0) / report["tracks"][t_][m]["n"] for t_, m in rows]
        ax.barh(range(len(rows)), w_, left=left, color=pal[o], label=vi_o[o], height=0.7)
        left = [a + b for a, b in zip(left, w_)]
    ax.set_yticks(range(len(rows))); ax.set_yticklabels([f"{t_} · {LABEL[m]}" for t_, m in rows]); ax.invert_yaxis()
    ax.set_xlabel("Tỷ lệ truy vấn"); ax.set_xlim(0, 1)
    ax.legend(ncol=4, frameon=False, loc="lower center", bbox_to_anchor=(0.4, 1.0), handlelength=1, columnspacing=0.8)
    save(fig, out / "paper_outcomes.png")
    print("wrote", sorted(p.name for p in out.glob("paper_*.png")))


if __name__ == "__main__":
    main()
