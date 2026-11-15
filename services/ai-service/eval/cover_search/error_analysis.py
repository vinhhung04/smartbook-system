"""Per-query error listing for ERROR_ANALYSIS.md: every non-top-1 query with
what was returned instead, the visual / OCR evidence, the un-gated CLIP rank of
the right book (diagnostic) and an automatic error category. Successes are
sampled too (first N by query id, not hand-picked).

    python error_analysis.py --runs E2_clip_test --out results_main
"""
from __future__ import annotations

import argparse
import collections
import json

from common import DOCS_DIR, setup_environment

setup_environment(load_secrets=False)

from dataset_loader import load_dataset  # noqa: E402
from generate_report import load_predictions  # noqa: E402


def categorize(p: dict, q: dict, catalog_by_book: dict) -> str:
    if p["failure_flags"]:
        return "MODEL/API FAILURE: " + ",".join(p["failure_flags"])
    resp = p["response"] or {}
    cands = resp.get("candidates") or []
    if q["expected_outcome"] == "NO_MATCH":
        return "FALSE_ACCEPT" if cands else "OK"
    if p["rank"] == 1:
        return "OK"
    diag = p.get("diagnostic_raw_clip") or []
    raw_rank = next((i for i, d in enumerate(diag, 1) if d["book_id"] == q["ground_truth_book_id"]), None)
    raw_score = next((d["score"] for d in diag if d["book_id"] == q["ground_truth_book_id"]), None)
    if not cands:
        if p["method"] != "ocr_only" and raw_rank == 1:
            return "GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80)"
        if p["method"] == "ocr_only" and not (resp.get("signals") or {}).get("ocr_extracted"):
            return "OCR_NO_TEXT"
        return "NO_RESULT"
    top = cands[0]
    top_book = catalog_by_book.get(top["id"], {})
    gt_book = catalog_by_book.get(q["ground_truth_book_id"], {})
    if top_book.get("author") and top_book.get("author") == gt_book.get("author"):
        return "SAME_AUTHOR_CONFUSION"
    if q.get("relation_to_gallery") == "different_edition_same_work":
        return "CROSS_EDITION_MISS"
    if p["rank"]:
        return "CORRECT_BUT_NOT_TOP1"
    return "WRONG_BOOK"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runs", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--split", default="test")
    parser.add_argument("--success-samples", type=int, default=5)
    args = parser.parse_args()

    ds = load_dataset()
    queries = {q["query_id"]: q for q in ds.queries}
    catalog_by_book = {}
    for row in ds.catalog:
        catalog_by_book.setdefault(row["book_id"], row)
    preds = [p for p in load_predictions(args.runs.split(","))
             if args.split == "all" or queries[p["query_id"]]["split"] == args.split]
    rows, counts = [], collections.Counter()
    for p in sorted(preds, key=lambda x: (x["method"], x["query_id"])):
        q = queries[p["query_id"]]
        cat = categorize(p, q, catalog_by_book)
        counts[(p["method"], p["query_track"], cat)] += 1
        cands = (p["response"] or {}).get("candidates") or []
        rows.append({
            "method": p["method"], "track": p["query_track"], "query_id": p["query_id"], "category": cat,
            "gt": f"{q['ground_truth_book_id']} {catalog_by_book.get(q['ground_truth_book_id'], {}).get('title', '(out of catalog)')}",
            "condition": q.get("transform_name") or q.get("image_condition"), "relation": q.get("relation_to_gallery"),
            "returned": [f"{c['id']}:{c['confidence']}:{'+'.join(e['signal'] for e in c['evidence'])}" for c in cands[:3]],
            "ocr": (p["response"] or {}).get("signals", {}).get("ocr_extracted"),
            "raw_clip_top3": (p.get("diagnostic_raw_clip") or [])[:3],
        })
    out = DOCS_DIR / args.out
    out.mkdir(parents=True, exist_ok=True)
    (out / "per_query_errors.json").write_text(json.dumps(rows, indent=1, ensure_ascii=False), encoding="utf-8")
    lines = ["# Error categories (automatic)", "", "| Method | Track | Category | Count |", "|---|---|---|---|"]
    for (m, t, c), n in sorted(counts.items()):
        lines.append(f"| {m} | {t} | {c} | {n} |")
    lines += ["", "## Non-OK queries", "", "| Method | Track | Query | Category | Ground truth | Condition | Returned (id:conf:signals) | OCR | raw CLIP top-3 |", "|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        if r["category"] != "OK":
            lines.append(f"| {r['method']} | {r['track']} | {r['query_id']} | {r['category']} | {r['gt']} | {r['condition']} | {'; '.join(r['returned'])} | {r['ocr'] or ''} | "
                         + ", ".join(f"{d['book_id']}:{d['score']}" for d in r["raw_clip_top3"]) + " |")
    lines += ["", f"## Success samples (first {args.success_samples} per method/track by query id)", ""]
    seen = collections.Counter()
    for r in rows:
        if r["category"] == "OK" and seen[(r["method"], r["track"])] < args.success_samples:
            seen[(r["method"], r["track"])] += 1
            lines.append(f"- {r['method']} / {r['track']} / {r['query_id']}: {r['gt']} ← {'; '.join(r['returned'][:1])} (condition {r['condition']})")
    (out / "errors.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {out / 'errors.md'}")


if __name__ == "__main__":
    main()
