"""Diagnostics of the production fusion rule on the recorded Hybrid responses
(no new model calls). Counts, per track/split:

- paired outcome changes between Hybrid and each single-signal method;
- non-monotonic demotions: the correct book carries BOTH signals, its fused
  score 0.6*v + 0.4*o is below max(v, o), and a candidate with a single signal
  is ranked above it (the rule penalised agreeing evidence);
- the confidence of the top candidate for correct answers vs out-of-catalog
  false accepts (is any threshold able to separate them?).

    python fusion_diagnostics.py --runs E2_clip_all,E13_text_all --out results_main_test --split test
"""
from __future__ import annotations

import argparse
import collections
import json

from common import DOCS_DIR, setup_environment

setup_environment(load_secrets=False)

from dataset_loader import load_dataset  # noqa: E402
from generate_report import load_predictions  # noqa: E402
import retrieval_metrics as rm  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runs", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--split", default="test")
    args = parser.parse_args()
    ds = load_dataset()
    queries = {q["query_id"]: q for q in ds.queries}
    preds = [p for p in load_predictions(args.runs.split(","))
             if args.split == "all" or queries[p["query_id"]]["split"] == args.split]
    by = {(p["query_id"], p["method"]): p for p in preds}
    out: dict = {}
    for track in ("A", "B"):
        qids = sorted({p["query_id"] for p in preds if p["query_track"] == track})
        changes = collections.Counter()
        demotions = []
        for q in qids:
            h, c, o = by.get((q, "hybrid")), by.get((q, "clip_only")), by.get((q, "ocr_only"))
            if not (h and c and o):
                continue
            h1, c1, o1 = h["rank"] == 1, c["rank"] == 1, o["rank"] == 1
            changes[f"clip {'✓' if c1 else '✗'} → hybrid {'✓' if h1 else '✗'}"] += 1
            changes[f"ocr {'✓' if o1 else '✗'} → hybrid {'✓' if h1 else '✗'}"] += 1
            if not c1 and not o1 and h1:
                changes["hybrid ✓ while both single methods ✗"] += 1
            cands = h["response"]["candidates"]
            gt = queries[q]["ground_truth_book_id"]
            correct = next((x for x in cands if x["id"] == gt), None)
            # the correct book may be cut by the top-5 limit; reconstruct its fused score from the two single runs
            v = next((e["score"] for x in c["response"]["candidates"] if x["id"] == gt for e in x["evidence"] if e["signal"] == "visual"), None)
            t = next((e["score"] for x in o["response"]["candidates"] if x["id"] == gt for e in x["evidence"] if e["signal"] == "ocr_text"), None)
            if v is not None and t is not None and not h1:
                fused = round(0.6 * v + 0.4 * t, 3)
                top = cands[0] if cands else None
                if top and top["id"] != gt and len(top["evidence"]) == 1 and top["confidence"] > fused and max(v, t) >= top["confidence"]:
                    demotions.append({"query_id": q, "visual": v, "ocr": t, "fused": fused,
                                      "outranked_by": top["id"], "outranker_conf": top["confidence"],
                                      "outranker_signal": top["evidence"][0]["signal"],
                                      "correct_in_top5": correct is not None,
                                      "script": queries[q]["script"], "condition": queries[q].get("transform_name") or queries[q].get("image_condition")})
        out[track] = {"queries": len(qids), "outcome_changes": dict(changes),
                      "non_monotonic_demotions": len(demotions),
                      "demotions_by_script": dict(collections.Counter(d["script"] for d in demotions)),
                      "demotion_examples": demotions[:15]}
    # separability of confidences: correct top-1 answers vs out-of-catalog false accepts
    sep = {}
    for method in ("ocr_only", "clip_only", "hybrid"):
        correct = [p["response"]["candidates"][0]["confidence"] for p in preds
                   if p["method"] == method and p["query_track"] == "A" and p["rank"] == 1]
        false_acc = [p["response"]["candidates"][0]["confidence"] for p in preds
                     if p["method"] == method and p["query_track"] == "OOC" and p["response"]["match_found"]]
        sep[method] = {"correct_top1_conf": {"n": len(correct), "min": min(correct, default=None), "p50": rm.percentile(correct, 50)},
                       "ooc_false_accept_conf": {"n": len(false_acc), "max": max(false_acc, default=None), "p50": rm.percentile(false_acc, 50),
                                                 "values": sorted(false_acc, reverse=True)}}
    out["confidence_separability_trackA_vs_OOC"] = sep
    path = DOCS_DIR / args.out / "fusion_diagnostics.json"
    path.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({k: (v if k.startswith("conf") else {kk: vv for kk, vv in v.items() if kk != "demotion_examples"}) for k, v in out.items()}, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
