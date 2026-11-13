"""Aggregate predictions from one or more runs into metrics, paired statistics,
error tables and figures. Every number written here is computed from
predictions.jsonl lines; nothing is typed in by hand.

    python generate_report.py --runs E_main_clip,E_main_text --out results_main

Writes docs/research/cover-search/<out>/{metrics.json, tables.md, figures/*.png}.
"""
from __future__ import annotations

import argparse
import collections
import json
import math
from pathlib import Path

from common import DOCS_DIR, RUNS_DIR, setup_environment

setup_environment(load_secrets=False)

import retrieval_metrics as rm  # noqa: E402
import statistical_analysis as sa  # noqa: E402
from dataset_loader import load_dataset  # noqa: E402

METHOD_LABEL = {"ocr_only": "OCR-only", "clip_only": "CLIP-only", "hybrid": "Hybrid"}
METHODS = ["ocr_only", "clip_only", "hybrid"]


def load_predictions(run_ids: list[str]) -> list[dict]:
    rows = {}
    for run_id in run_ids:
        path = RUNS_DIR / run_id / "predictions.jsonl"
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                row = json.loads(line)
                row["run_id"] = run_id
                rows[(row["query_id"], row["method"])] = row  # later runs never overwrite earlier ones
    return list(rows.values())


def _fmt(value, digits=3):
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return "–"
    return f"{value:.{digits}f}"


def retrieval_block(rows: list[dict], queries: dict[str, dict]) -> dict:
    ranks = [r["rank"] for r in rows]
    clusters = [queries[r["query_id"]]["ground_truth_book_id"] for r in rows]
    r1 = [1.0 if k == 1 else 0.0 for k in ranks]
    r5 = [1.0 if k is not None and k <= 5 else 0.0 for k in ranks]
    rr = [1.0 / k if k else 0.0 for k in ranks]
    outcomes = collections.Counter(r["outcome"] for r in rows)
    flags = collections.Counter(f for r in rows for f in r.get("failure_flags", []))
    return {
        "n": len(rows), "books": len(set(clusters)),
        "recall_at_1": sa.cluster_bootstrap_ci(r1, clusters),
        "recall_at_5": sa.cluster_bootstrap_ci(r5, clusters),
        "mrr": sa.cluster_bootstrap_ci(rr, clusters),
        "edition_top1_accuracy": sum(1 for r in rows if r.get("top1_edition_correct")) / len(rows) if rows else float("nan"),
        "outcomes": dict(outcomes), "failure_flags": dict(flags),
    }


def latency_block(rows: list[dict]) -> dict:
    def pct(values):
        values = [v for v in values if v is not None]
        return {"n": len(values), "p50": rm.percentile(values, 50), "p95": rm.percentile(values, 95),
                "mean": sum(values) / len(values) if values else float("nan")}
    vision = [r["vision"] for r in rows if r.get("vision")]

    def reconstructed(r):
        # Hybrid replays the recorded OCR response, so its wall time lacks the
        # network call. The production endpoint runs OCR and CLIP concurrently:
        # e2e ~= max(recorded OCR API latency, CLIP branch) + post-processing.
        v = r.get("vision") or {}
        if r["method"] != "hybrid" or v.get("api_latency_ms") is None:
            return None
        branches = max(r.get("ocr_branch_ms") or 0.0, r.get("clip_branch_ms") or 0.0)
        post = max(0.0, r["wall_ms"] - branches)
        return max(v["api_latency_ms"], r.get("clip_branch_ms") or 0.0) + post
    return {
        "reconstructed_e2e_ms_hybrid": pct([reconstructed(r) for r in rows]),
        "endpoint_wall_ms": pct([r["wall_ms"] for r in rows]),
        "clip_embed_ms": pct([r.get("clip_embed_ms") for r in rows]),
        "ocr_api_latency_ms": pct([v.get("api_latency_ms") for v in vision]),
        "ocr_served_from": dict(collections.Counter(v.get("served_from") for v in vision)),
    }


def ocr_accuracy(rows: list[dict], queries: dict[str, dict]) -> dict:
    import routes_cover_search as rcs
    scored = []
    for r in rows:
        q = queries[r["query_id"]]
        if q["expected_outcome"] != "MATCH" or q.get("title_visible") == "no" or not r.get("vision"):
            continue
        raw = r["vision"].get("raw") or {}
        title = rcs._clean_ocr_value(raw.get("title"))
        author = rcs._clean_ocr_value(raw.get("author"))
        scored.append({"query_id": r["query_id"], "language_group": q["language_group"],
                       "title_gt": q["title"], "title_ocr": title, "author_gt": q["author"], "author_ocr": author,
                       **{f"title_{k}": v for k, v in rm.title_scores(q["title"], title).items()},
                       **{f"author_{k}": v for k, v in rm.author_scores(q["author"], author).items()}})

    def rate(items, key):
        values = [i[key] for i in items if i[key] is not None]
        return {"rate": sum(values) / len(values) if values else float("nan"), "n": len(values)}
    out = {}
    for group in ("ALL", "VIETNAMESE", "INTERNATIONAL"):
        items = scored if group == "ALL" else [i for i in scored if i["language_group"] == group]
        out[group] = {key: rate(items, key) for key in (
            "title_exact_raw", "title_exact_normalized", "title_fuzzy", "author_exact_normalized", "author_fuzzy")}
    out["per_query"] = scored
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runs", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--split", default="test", choices=["dev", "test", "all"])
    args = parser.parse_args()

    dataset = load_dataset()
    queries = {q["query_id"]: q for q in dataset.queries}
    preds = [p for p in load_predictions(args.runs.split(","))
             if args.split == "all" or queries[p["query_id"]]["split"] == args.split]
    out_dir = DOCS_DIR / args.out
    (out_dir / "figures").mkdir(parents=True, exist_ok=True)

    report: dict = {"runs": args.runs.split(","), "split": args.split, "tracks": {}}
    by = collections.defaultdict(list)
    for p in preds:
        by[(p["query_track"], p["method"])].append(p)

    for track in ("A", "B"):
        track_report = {}
        for method in METHODS:
            rows = by.get((track, method), [])
            if not rows:
                continue
            block = retrieval_block(rows, queries)
            block["latency"] = latency_block(rows)
            strata = {}
            fields = ("language_group", "relation_to_gallery", "image_condition", "script") if track == "A" else ("language_group", "script")
            for field in fields:
                groups = collections.defaultdict(list)
                for r in rows:
                    groups[queries[r["query_id"]].get(field) or "–"].append(r)
                strata[field] = {k: retrieval_block(v, queries) for k, v in sorted(groups.items())}
            if track == "B":
                groups = collections.defaultdict(list)
                for r in rows:
                    groups[queries[r["query_id"]].get("transform_name") or "–"].append(r)
                strata["transform"] = {k: retrieval_block(v, queries) for k, v in sorted(groups.items())}
            block["strata"] = strata
            if method == "clip_only":
                raw = [r for r in rows if r.get("diagnostic_raw_clip")]
                if raw:
                    def raw_rank(r):
                        return next((i for i, d in enumerate(r["diagnostic_raw_clip"], 1) if d["book_id"] == queries[r["query_id"]]["ground_truth_book_id"]), None)
                    ranks = [raw_rank(r) for r in raw]
                    clusters = [queries[r["query_id"]]["ground_truth_book_id"] for r in raw]
                    block["diagnostic_ungated_clip"] = {
                        "recall_at_1": sa.cluster_bootstrap_ci([1.0 if k == 1 else 0.0 for k in ranks], clusters),
                        "recall_at_5": sa.cluster_bootstrap_ci([1.0 if k and k <= 5 else 0.0 for k in ranks], clusters),
                        "correct_top1_rejected_by_gate": sum(1 for r, k in zip(raw, ranks) if k == 1 and r["rank"] is None),
                    }
            track_report[method] = block
        # paired comparisons on the common query set
        pairs = {}
        for a, b in (("clip_only", "hybrid"), ("ocr_only", "hybrid"), ("ocr_only", "clip_only")):
            ra = {r["query_id"]: r for r in by.get((track, a), [])}
            rb = {r["query_id"]: r for r in by.get((track, b), [])}
            common = sorted(set(ra) & set(rb))
            if not common:
                continue
            clusters = [queries[q]["ground_truth_book_id"] for q in common]
            a1 = [ra[q]["rank"] == 1 for q in common]
            b1 = [rb[q]["rank"] == 1 for q in common]
            a5 = [ra[q]["rank"] is not None and ra[q]["rank"] <= 5 for q in common]
            b5 = [rb[q]["rank"] is not None and rb[q]["rank"] <= 5 for q in common]
            arr = [1 / ra[q]["rank"] if ra[q]["rank"] else 0.0 for q in common]
            brr = [1 / rb[q]["rank"] if rb[q]["rank"] else 0.0 for q in common]
            pairs[f"{a}_vs_{b}"] = {
                "n": len(common), "books": len(set(clusters)),
                "recall_at_1_diff": sa.paired_difference_ci([float(x) for x in a1], [float(x) for x in b1], clusters),
                "recall_at_5_diff": sa.paired_difference_ci([float(x) for x in a5], [float(x) for x in b5], clusters),
                "mrr_diff": sa.paired_difference_ci(arr, brr, clusters),
                "mcnemar_recall_at_1": sa.mcnemar_exact(a1, b1),
                "cohens_h_recall_at_1": sa.cohens_h(sum(a1) / len(a1), sum(b1) / len(b1)),
            }
        track_report["paired"] = pairs
        report["tracks"][track] = track_report

    # E5 out-of-catalog
    ooc = {}
    for method in METHODS:
        ooc_rows = by.get(("OOC", method), [])
        in_rows = by.get(("A", method), [])
        if ooc_rows:
            ooc[method] = {
                **rm.abstention_metrics([r["response"] and r["response"]["match_found"] for r in in_rows],
                                        [r["response"] and r["response"]["match_found"] for r in ooc_rows]),
                "n_ooc": len(ooc_rows), "n_in_catalog_trackA": len(in_rows),
                "top_false_accept_confidences": sorted(
                    [r["response"]["candidates"][0]["confidence"] for r in ooc_rows
                     if r["response"] and r["response"]["candidates"]], reverse=True)[:10],
            }
    report["out_of_catalog"] = ooc

    ocr_rows = [p for p in preds if p["method"] == "ocr_only" and p["query_track"] in ("A", "B")]
    if ocr_rows:
        report["ocr_accuracy"] = {t: ocr_accuracy([r for r in ocr_rows if r["query_track"] == t], queries) for t in ("A", "B")}

    costs = [p["vision"]["cost_usd"] for p in preds if p["method"] == "ocr_only" and p.get("vision") and p["vision"].get("cost_usd") is not None]
    report["vision_cost_usd"] = {"calls_with_cost": len(costs), "total": sum(costs),
                                 "mean_per_call": sum(costs) / len(costs) if costs else float("nan")}

    (out_dir / "metrics.json").write_text(json.dumps(report, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    write_tables(report, out_dir)
    write_figures(report, preds, queries, out_dir / "figures")
    write_dataset_figure(dataset, out_dir / "figures")
    print(f"wrote {out_dir}")


def write_tables(report: dict, out_dir: Path) -> None:
    lines = [f"# Results tables (split = {report['split']}, runs = {', '.join(report['runs'])})", "",
             "Generated by `generate_report.py` from `predictions.jsonl`. 95% CIs: book-level cluster bootstrap (10,000 resamples, seed 20261112).", ""]
    for track, title in (("A", "Track A — independent online images"), ("B", "Track B — controlled image perturbations")):
        tr = report["tracks"].get(track) or {}
        if not any(m in tr for m in METHODS):
            continue
        lines += [f"## {title}", "", "| Method | n (books) | Recall@1 [95% CI] | Recall@5 [95% CI] | MRR [95% CI] | No result | Incorrect | p50 / p95 endpoint ms |",
                  "|---|---|---|---|---|---|---|---|"]
        for m in METHODS:
            if m not in tr:
                continue
            b = tr[m]
            ci = lambda x: f"{_fmt(x['mean'])} [{_fmt(x['ci_low'])}, {_fmt(x['ci_high'])}]"  # noqa: E731
            lat = b["latency"]["endpoint_wall_ms"]
            lines.append(f"| {METHOD_LABEL[m]} | {b['n']} ({b['books']}) | {ci(b['recall_at_1'])} | {ci(b['recall_at_5'])} | {ci(b['mrr'])} | "
                         f"{b['outcomes'].get('NO_RESULT', 0)} | {b['outcomes'].get('INCORRECT', 0)} | {_fmt(lat['p50'], 0)} / {_fmt(lat['p95'], 0)} |")
        lines.append("")
        if "clip_only" in tr and tr["clip_only"].get("diagnostic_ungated_clip"):
            d = tr["clip_only"]["diagnostic_ungated_clip"]
            lines += [f"Diagnostic (not a method): un-gated CLIP ranking Recall@1 = {_fmt(d['recall_at_1']['mean'])} [{_fmt(d['recall_at_1']['ci_low'])}, {_fmt(d['recall_at_1']['ci_high'])}], "
                      f"Recall@5 = {_fmt(d['recall_at_5']['mean'])}; correct book ranked first by cosine but removed by the 0.80 gate: {d['correct_top1_rejected_by_gate']} queries.", ""]
        if "hybrid" in tr:
            rl = tr["hybrid"]["latency"]["reconstructed_e2e_ms_hybrid"]
            if rl["n"]:
                lines += [f"Hybrid end-to-end latency reconstructed from recorded OCR API latency: p50 {_fmt(rl['p50'], 0)} ms, p95 {_fmt(rl['p95'], 0)} ms (n={rl['n']}).", ""]
        for field in ("language_group", "relation_to_gallery", "transform", "image_condition", "script"):
            present = [m for m in METHODS if m in tr and field in tr[m]["strata"] and len(tr[m]["strata"][field]) > 1]
            if not present:
                continue
            keys = sorted({k for m in present for k in tr[m]["strata"][field]})
            lines += [f"### By {field} (Recall@1 / Recall@5, n)", "", "| " + field + " | " + " | ".join(METHOD_LABEL[m] for m in present) + " |",
                      "|---|" + "---|" * len(present)]
            for k in keys:
                cells = []
                for m in present:
                    s = tr[m]["strata"][field].get(k)
                    cells.append("–" if not s else f"{_fmt(s['recall_at_1']['mean'])} / {_fmt(s['recall_at_5']['mean'])} (n={s['n']})")
                lines.append(f"| {k} | " + " | ".join(cells) + " |")
            lines.append("")
        if tr.get("paired"):
            lines += ["### Paired comparisons (B − A on common queries)", "",
                      "| Pair | n | ΔRecall@1 [95% CI] | ΔRecall@5 [95% CI] | ΔMRR [95% CI] | McNemar b10/b01, p | Cohen's h |", "|---|---|---|---|---|---|---|"]
            for name, p in tr["paired"].items():
                d = lambda x: f"{_fmt(x['diff_mean'])} [{_fmt(x['ci_low'])}, {_fmt(x['ci_high'])}]"  # noqa: E731
                mc = p["mcnemar_recall_at_1"]
                lines.append(f"| {name} | {p['n']} | {d(p['recall_at_1_diff'])} | {d(p['recall_at_5_diff'])} | {d(p['mrr_diff'])} | "
                             f"{mc['b10']}/{mc['b01']}, {_fmt(mc['p_value'], 4)} | {_fmt(p['cohens_h_recall_at_1'])} |")
            lines.append("")
    if report.get("out_of_catalog"):
        lines += ["## E5 — Out-of-catalog rejection (positive class = abstain)", "",
                  "| Method | OOC n | In-catalog n | No-match P | No-match R | No-match F1 | FPR (false accept) | False abstention |", "|---|---|---|---|---|---|---|---|"]
        for m, o in report["out_of_catalog"].items():
            lines.append(f"| {METHOD_LABEL[m]} | {o['n_ooc']} | {o['n_in_catalog_trackA']} | {_fmt(o['no_match_precision'])} | {_fmt(o['no_match_recall'])} | "
                         f"{_fmt(o['no_match_f1'])} | {_fmt(o['false_positive_rate'])} | {_fmt(o['false_abstention_rate'])} |")
        lines.append("")
    if report.get("ocr_accuracy"):
        lines += ["## OCR field accuracy (Qwen vision, title-visible MATCH queries)", "",
                  "| Track | Group | n | Title exact (raw) | Title exact (normalized) | Title fuzzy ≥0.85 | Author exact (norm.) | Author fuzzy |", "|---|---|---|---|---|---|---|---|"]
        for track, acc in report["ocr_accuracy"].items():
            for group in ("ALL", "VIETNAMESE", "INTERNATIONAL"):
                a = acc[group]
                if not a["title_exact_raw"]["n"]:
                    continue
                lines.append(f"| {track} | {group} | {a['title_exact_raw']['n']} | {_fmt(a['title_exact_raw']['rate'])} | {_fmt(a['title_exact_normalized']['rate'])} | "
                             f"{_fmt(a['title_fuzzy']['rate'])} | {_fmt(a['author_exact_normalized']['rate'])} | {_fmt(a['author_fuzzy']['rate'])} |")
        lines.append("")
    (out_dir / "tables.md").write_text("\n".join(lines), encoding="utf-8")


def write_figures(report: dict, preds: list[dict], queries: dict, fig_dir: Path) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    plt.rcParams.update({"font.family": "Arial", "font.size": 10})
    colors = {"ocr_only": "#B45309", "clip_only": "#2F5597", "hybrid": "#1F3864"}

    for metric, label in (("recall_at_1", "Recall@1"), ("recall_at_5", "Recall@5"), ("mrr", "MRR")):
        fig, ax = plt.subplots(figsize=(6.3, 3.4))
        tracks = [t for t in ("A", "B") if report["tracks"].get(t)]
        width = 0.26
        for i, m in enumerate(METHODS):
            xs, ys, lo, hi = [], [], [], []
            for j, t in enumerate(tracks):
                b = report["tracks"][t].get(m)
                if not b:
                    continue
                v = b[metric]
                xs.append(j + (i - 1) * width); ys.append(v["mean"])
                lo.append(v["mean"] - v["ci_low"]); hi.append(v["ci_high"] - v["mean"])
            if xs:
                ax.bar(xs, ys, width, yerr=[lo, hi], capsize=3, color=colors[m], label=METHOD_LABEL[m])
                for x, y in zip(xs, ys):
                    ax.text(x, 0.04, f"{y:.2f}", ha="center", fontsize=8, color="white", fontweight="bold")
        ax.set_xticks(range(len(tracks)))
        ax.set_xticklabels([{"A": "Track A (independent images)", "B": "Track B (controlled perturbations)"}[t] for t in tracks])
        ax.set_ylim(0, 1.05); ax.set_ylabel(label)
        ax.legend(frameon=False, fontsize=8, loc="lower center", bbox_to_anchor=(0.5, 1.0), ncol=3)
        ax.spines[["top", "right"]].set_visible(False)
        fig.tight_layout(); fig.savefig(fig_dir / f"{metric}_comparison.png", dpi=200); plt.close(fig)

    tb = report["tracks"].get("B") or {}
    if tb:
        fig, ax = plt.subplots(figsize=(6.3, 3.4))
        transforms = sorted({k for m in METHODS if m in tb for k in tb[m]["strata"].get("transform", {})})
        width = 0.26
        for i, m in enumerate(METHODS):
            if m not in tb:
                continue
            vals = [tb[m]["strata"]["transform"].get(t, {}).get("recall_at_1", {}).get("mean", float("nan")) for t in transforms]
            ax.bar([x + (i - 1) * width for x in range(len(transforms))], vals, width, color=colors[m], label=METHOD_LABEL[m])
        ax.set_xticks(range(len(transforms))); ax.set_xticklabels(transforms, rotation=30, ha="right", fontsize=8)
        ax.set_ylim(0, 1.05); ax.set_ylabel("Recall@1")
        ax.legend(frameon=False, fontsize=8, ncol=3, loc="lower center", bbox_to_anchor=(0.5, 1.0))
        ax.spines[["top", "right"]].set_visible(False)
        fig.tight_layout(); fig.savefig(fig_dir / "robustness_by_transform.png", dpi=200); plt.close(fig)

    fig, ax = plt.subplots(figsize=(6.3, 3.0))
    data, labels = [], []
    for m in METHODS:
        rows = [p for p in preds if p["method"] == m and p["query_track"] in ("A", "B")]
        if m == "hybrid":
            # OCR replayed from the recorded call: reconstruct the concurrent end-to-end time
            v = [max(p["vision"]["api_latency_ms"], p.get("clip_branch_ms") or 0.0)
                 + max(0.0, p["wall_ms"] - max(p.get("ocr_branch_ms") or 0.0, p.get("clip_branch_ms") or 0.0))
                 for p in rows if p.get("vision") and p["vision"].get("api_latency_ms") is not None]
            label = "Hybrid\n(reconstructed e2e)"
        else:
            v = [p["wall_ms"] for p in rows]
            label = METHOD_LABEL[m] + "\n(endpoint, measured)"
        if v:
            data.append(v); labels.append(label)
    if data:
        ax.boxplot(data, tick_labels=labels, showfliers=True)
        ax.set_ylabel("Latency (ms)"); ax.set_yscale("log"); ax.spines[["top", "right"]].set_visible(False)
        fig.tight_layout(); fig.savefig(fig_dir / "latency.png", dpi=200)
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(6.3, 3.0))
    order = ["CORRECT_TOP1", "CORRECT_TOP5", "INCORRECT", "NO_RESULT"]
    palette = {"CORRECT_TOP1": "#1F3864", "CORRECT_TOP5": "#2F5597", "INCORRECT": "#B45309", "NO_RESULT": "#94A3B8"}
    rows = [(t, m) for t in ("A", "B") for m in METHODS if report["tracks"].get(t, {}).get(m)]
    left = [0.0] * len(rows)
    for outcome in order:
        widths = []
        for t, m in rows:
            b = report["tracks"][t][m]
            widths.append(b["outcomes"].get(outcome, 0) / b["n"])
        ax.barh(range(len(rows)), widths, left=left, color=palette[outcome], label=outcome)
        left = [l + w for l, w in zip(left, widths)]
    ax.set_yticks(range(len(rows))); ax.set_yticklabels([f"{t} · {METHOD_LABEL[m]}" for t, m in rows], fontsize=8)
    ax.set_xlabel("Share of queries"); ax.legend(frameon=False, fontsize=7, ncol=4, loc="upper center", bbox_to_anchor=(0.5, -0.25))
    ax.spines[["top", "right"]].set_visible(False)
    fig.tight_layout(); fig.savefig(fig_dir / "error_distribution.png", dpi=200); plt.close(fig)


def write_dataset_figure(dataset, fig_dir: Path) -> None:
    """Dataset distribution, computed from the dataset CSVs (all splits)."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    included = dataset.included_catalog()
    assets = dataset.assets_by_id
    fig, axes = plt.subplots(1, 3, figsize=(7.2, 2.6))
    groups = collections.Counter({"INTERNATIONAL": "Intl.", "VIETNAMESE": "VN"}[r["language_group"]]
                                 + (" Hán-Nôm" if r["script"] != "Latin" else " Latin") for r in included)
    axes[0].bar(list(groups), list(groups.values()), color="#2F5597")
    axes[0].set_title("Catalog books", fontsize=9)
    tracks = collections.Counter({"A": "Track A", "B": "Track B", "OOC": "OOC"}[q["query_track"]] for q in dataset.included_queries())
    axes[1].bar(list(tracks), list(tracks.values()), color="#1F3864")
    axes[1].set_yscale("log"); axes[1].set_title("Queries (log scale)", fontsize=9)
    vis = collections.Counter(assets[r["gallery_asset_id"]].get("title_visible", "?") for r in included)
    axes[2].bar([f"title {k}" for k in vis], list(vis.values()), color="#B45309")
    axes[2].set_title("Gallery cover legibility", fontsize=9)
    for ax in axes:
        ax.tick_params(labelsize=7); ax.spines[["top", "right"]].set_visible(False)
        for patch in ax.patches:
            ax.annotate(str(int(patch.get_height())), (patch.get_x() + patch.get_width() / 2, patch.get_height()), ha="center", va="bottom", fontsize=7)
    fig.tight_layout(); fig.savefig(fig_dir / "dataset_distribution.png", dpi=200); plt.close(fig)


if __name__ == "__main__":
    main()
