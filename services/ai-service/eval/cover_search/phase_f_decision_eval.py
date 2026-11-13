"""Phase F multimodal benchmark (offline, no API call).

Re-scores the production hybrid predictions already recorded by the cover-search
research harness (runs/E13_text_all + runs/E2_clip_all, method "hybrid", the
endpoint's own fused candidates) under two policies:

  baseline   the existing /find-book-by-cover behaviour: any candidate -> the top
             one is presented as the match
  phase_f    vision_context.decide(): IDENTIFIED / AMBIGUOUS / NO_MATCH

Ground truth, splits and rights: research-inputs/cover-search-dataset
(ground_truth.csv, rights review in docs/research/cover-search). The decision
rule was set on the dev split; this script reports dev and test separately.

Limitation: the Phase F conversation path re-encodes the photo (EXIF dropped,
<= 1600 px JPEG) before OCR/CLIP; the recorded predictions used the original
bytes, so this measures the decision layer on the same fused candidates, not a
fresh end-to-end run.

    python eval/cover_search/phase_f_decision_eval.py
"""
from __future__ import annotations

import csv
import json
import os
import sys
import unicodedata
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
AI = HERE.parents[1]
ROOT = AI.parents[1]
sys.path.insert(0, str(AI))
import vision_context  # noqa: E402

GT = ROOT / "research-inputs" / "cover-search-dataset" / "ground_truth" / "ground_truth.csv"
RUNS = [HERE / "runs" / "E13_text_all" / "predictions.jsonl", HERE / "runs" / "E2_clip_all" / "predictions.jsonl"]
OUT = AI / "eval" / "reports" / "phase_f_multimodal.json"


def norm(text: str | None) -> str:
    text = unicodedata.normalize("NFD", (text or "").lower())
    text = "".join(c for c in text if unicodedata.category(c) != "Mn").replace("đ", "d")
    return " ".join("".join(c if c.isalnum() else " " for c in text).split())


def load() -> tuple[dict, list[dict]]:
    gt = {r["query_id"]: r for r in csv.DictReader(open(GT, encoding="utf-8")) if r.get("status") == "INCLUDED"}
    rows, seen = [], set()
    for path in RUNS:
        for line in open(path, encoding="utf-8"):
            r = json.loads(line)
            if r["method"] != "hybrid" or r["query_id"] not in gt or r["query_id"] in seen:
                continue
            seen.add(r["query_id"])
            rows.append(r)
    return gt, rows


def score(gt: dict, rows: list[dict], split: str) -> dict:
    rows = [r for r in rows if gt[r["query_id"]]["split"] == split]
    inside = [r for r in rows if gt[r["query_id"]]["expected_outcome"] == "MATCH"]
    ooc = [r for r in rows if gt[r["query_id"]]["expected_outcome"] == "NO_MATCH"]

    def correct_top1(r):
        return r["outcome"] == "CORRECT_TOP1"

    def correct_in_list(r):
        return r["outcome"] in ("CORRECT_TOP1", "CORRECT_TOP5")

    decisions = {r["query_id"]: vision_context.decide(r["response"].get("candidates") or [])[0] for r in rows}
    ident_in = [r for r in inside if decisions[r["query_id"]] == "IDENTIFIED"]
    amb_in = [r for r in inside if decisions[r["query_id"]] == "AMBIGUOUS"]
    accepted_base_in = [r for r in inside if r["response"].get("candidates")]
    ranks = [r.get("rank") for r in inside]
    mrr = sum(1 / rk for rk in ranks if isinstance(rk, int) and rk > 0) / len(inside) if inside else None

    # OCR quality on in-collection queries whose title is visible on the cover
    ocr_rows = [r for r in inside if gt[r["query_id"]].get("title_visible") == "yes"]
    ocr_read = [((r["response"].get("signals") or {}).get("ocr_extracted") or {}) for r in ocr_rows]
    title_exact = sum(1 for r, o in zip(ocr_rows, ocr_read) if norm(o.get("title")) == norm(gt[r["query_id"]]["title"]))
    author_ok = sum(1 for r, o in zip(ocr_rows, ocr_read)
                    if gt[r["query_id"]]["author"] and norm(gt[r["query_id"]]["author"]) in norm(o.get("author"))
                    or (gt[r["query_id"]]["author"] and norm(o.get("author")) and norm(o.get("author")) in norm(gt[r["query_id"]]["author"])))
    with_author = sum(1 for r in ocr_rows if gt[r["query_id"]]["author"])
    costs = [((r.get("vision") or {}).get("cost_usd")) for r in rows if (r.get("vision") or {}).get("served_from") == "live"]
    costs = [c for c in costs if isinstance(c, (int, float))]
    walls = sorted(r["wall_ms"] for r in rows if isinstance(r.get("wall_ms"), (int, float)))

    def pct(xs, q):
        return round(xs[min(len(xs) - 1, int(q * len(xs)))], 1) if xs else None

    return {
        "split": split, "queries": len(rows), "in_collection": len(inside), "out_of_collection": len(ooc),
        "top1_accuracy": round(sum(map(correct_top1, inside)) / len(inside), 3) if inside else None,
        "top5_accuracy": round(sum(map(correct_in_list, inside)) / len(inside), 3) if inside else None,
        "mrr": round(mrr, 3) if mrr is not None else None,
        "baseline": {
            "presented_as_match_in_collection": len(accepted_base_in),
            "presented_match_correct": sum(map(correct_top1, accepted_base_in)),
            "false_positive_rate_ooc": round(sum(1 for r in ooc if r["response"].get("candidates")) / len(ooc), 3) if ooc else None,
            "abstention_accuracy_ooc": round(sum(1 for r in ooc if not r["response"].get("candidates")) / len(ooc), 3) if ooc else None,
        },
        "phase_f": {
            "decisions_in_collection": dict(Counter(decisions[r["query_id"]] for r in inside)),
            "decisions_ooc": dict(Counter(decisions[r["query_id"]] for r in ooc)),
            "identified_precision": round(sum(map(correct_top1, ident_in)) / len(ident_in), 3) if ident_in else None,
            "identified_coverage": round(len(ident_in) / len(inside), 3) if inside else None,
            "ambiguous_with_correct_candidate": f"{sum(map(correct_in_list, amb_in))}/{len(amb_in)}",
            "false_positive_rate_ooc": round(sum(1 for r in ooc if decisions[r["query_id"]] == "IDENTIFIED") / len(ooc), 3) if ooc else None,
            "abstention_accuracy_ooc_strict_no_match": round(sum(1 for r in ooc if decisions[r["query_id"]] == "NO_MATCH") / len(ooc), 3) if ooc else None,
            "not_identified_ooc": round(sum(1 for r in ooc if decisions[r["query_id"]] != "IDENTIFIED") / len(ooc), 3) if ooc else None,
        },
        "ocr": {"title_visible_queries": len(ocr_rows),
                "title_exact_match": round(title_exact / len(ocr_rows), 3) if ocr_rows else None,
                "author_match": round(author_ok / with_author, 3) if with_author else None,
                "isbn_accuracy": "not measured: the OCR prompt reads title/author only"},
        "latency_ms_wall": {"p50": pct(walls, 0.5), "p95": pct(walls, 0.95)},
        "vision_cost_usd": {"calls": len(costs), "mean": round(sum(costs) / len(costs), 7) if costs else None},
    }


def main() -> None:
    gt, rows = load()
    report = {"source_runs": [str(p.relative_to(AI)) for p in RUNS], "policy": "vision_context.decide",
              "thresholds": {"TEXT_STRONG": vision_context.TEXT_STRONG, "VISUAL_MARGIN": vision_context.VISUAL_MARGIN},
              "dev": score(gt, rows, "dev"), "test": score(gt, rows, "test")}
    os.makedirs(OUT.parent, exist_ok=True)
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
