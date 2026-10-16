"""Copilot 3.2 structured decision verification - offline evaluation.

    python services/ai-service/eval/eval_decision_verification.py

Detectors compared on the same items:
  v3.1  copilot_faithfulness (labels + validate), i.e. what shipped in 3.1
  v3.2  v3.1 + copilot_verification (structured claims vs the evidence sheet)

Sets, reported separately (never pooled):
  REAL31     the 63 first drafts + hand labels of the 3.1 evaluation. 3.2 was
             DEVELOPED against them (its 7 missed contradictions are 3.2's
             regression tests) - so 3.2 numbers here are development numbers.
  MUTATED31  the 154 single-error mutations of 3.1 (eval_faithfulness.py),
             not used while writing 3.2.
  HELDOUT32  eval/decision_verification_heldout.json: 70 answers written by
             the rule author on 2026-10-16 BEFORE copilot_verification.py
             (sha256 recorded in docs/ANALYSIS/AI_COPILOT_3_2_DECISION_VERIFICATION.md);
             the same person then wrote the rules (single annotator).
  LIVE32     optional (--live): first drafts collected live after 3.2 was
             deployed, for questions written for 3.2, with hand labels
             (eval/decision_verification_live_labels.json).

Item-level metrics: an item is "flagged" when the detector reports at least
one problem (CONTRADICTED/UNSUPPORTED; for v3.1 any finding). Precision =
flagged items that really had an error / flagged items; recall = error items
flagged / error items; FPR = clean items flagged / clean items. Critical
detection = items with a critical error where the detector produced a
blocking/critical finding. Class-level counts are in the JSON report.
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
from collections import Counter

EVAL_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(EVAL_DIR))
sys.path.insert(0, EVAL_DIR)

import copilot_faithfulness as cf  # noqa: E402
import copilot_verification as cv  # noqa: E402
import eval_faithfulness as ef  # noqa: E402

# 3.2 category -> 3.1 issue type (to score against the 3.1 labels)
TO_31 = {
    "COUNT": cf.CONTRADICTION, "MONEY": cf.CONTRADICTION, "PERCENT": cf.CONTRADICTION, "BUDGET": cf.CONTRADICTION,
    "PERIOD": cf.CONTRADICTION, "TREND": cf.CONTRADICTION, "ENTITY": cf.CONTRADICTION, "RECOMMENDATION": cf.CONTRADICTION,
    "COVERAGE": cf.CONTRADICTION, "MISSING_DATA": cf.CONTRADICTION, "ASSESSMENT": cf.CONTRADICTION,
    "RANKING": cf.RANKING_INCONSISTENCY, "SCOPE": cf.SCOPE_CONFUSION, "CAUSALITY": cf.UNSUPPORTED_CAUSAL,
    "OPTIMALITY": cf.UNSUPPORTED_RECOMMENDATION, "OVERCLAIM": cf.REASONING_OVERCLAIM, "ASSUMPTION": cf.REASONING_OVERCLAIM,
    "CONSTRAINT": cf.REASONING_OVERCLAIM, "FORECAST": cf.REASONING_OVERCLAIM, "LABEL": cf.INTERNAL_LABEL,
    "CHART": cf.EXPLANATION_CHART_MISMATCH,
}
# 3.1 issue type -> 3.2 category (to score 3.1 against the 3.2 classes)
FROM_31 = dict(cv._FROM_31)
CRITICAL_31 = cf.BLOCKING


def run_v31(answer: str, data: dict, explanation, visualizations) -> tuple[set, bool, float]:
    t0 = time.perf_counter()
    ctx = cf.build_context(data, explanation, visualizations)
    cleaned, labels = cf.strip_internal_labels(answer)
    issues = labels + cf.validate(cleaned, ctx)
    ms = (time.perf_counter() - t0) * 1000
    return {i.type for i in issues}, any(i.blocking for i in issues), ms


def run_v32(answer: str, data: dict, explanation, visualizations) -> tuple[set, bool, float]:
    t0 = time.perf_counter()
    ctx = cf.build_context(data, explanation, visualizations)
    sheet = cv.build_sheet(data, explanation, visualizations)
    cleaned, labels = cf.strip_internal_labels(answer)
    report = cv.verify(cleaned, sheet, labels + cf.validate(cleaned, ctx))
    ms = (time.perf_counter() - t0) * 1000
    return {c.category for c in report.problems}, bool(report.critical), ms


def score(items: list[dict], detector, space: str) -> dict:
    """space='31': compare 3.1 issue types; space='32': compare 3.2 categories."""
    tp = fp = fn = tn = 0
    crit_items = crit_hit = 0
    per_class = {}
    latencies = []
    for it in items:
        found, critical_found, ms = detector(it["answer"], it["data"], it.get("explanation"), it.get("visualizations"))
        latencies.append(ms)
        if detector is run_v31 and space == "32":
            found = {FROM_31.get(t, t) for t in found}
        if detector is run_v32 and space == "31":
            found = {TO_31.get(t, t) for t in found}
        expected = set(it["expected"])
        flagged = bool(found)
        if expected and flagged:
            tp += 1
        elif expected:
            fn += 1
        elif flagged:
            fp += 1
        else:
            tn += 1
        if it.get("critical"):
            crit_items += 1
            crit_hit += bool(critical_found)
        for cls in expected | found:
            c = per_class.setdefault(cls, Counter())
            c["tp" if cls in expected and cls in found else "fn" if cls in expected else "fp"] += 1
        it.setdefault("found", {})[detector.__name__] = sorted(found)
    lat = sorted(latencies)
    return {
        "items": len(items), "with_errors": tp + fn, "clean": fp + tn,
        "precision": round(tp / (tp + fp), 3) if tp + fp else None,
        "recall": round(tp / (tp + fn), 3) if tp + fn else None,
        "recall_frac": f"{tp}/{tp + fn}",
        "fpr_clean": round(fp / (fp + tn), 3) if fp + tn else None, "fpr_frac": f"{fp}/{fp + tn}",
        "critical_detection": f"{crit_hit}/{crit_items}" if crit_items else None,
        "latency_ms": {"p50": round(statistics.median(lat), 3), "p95": round(lat[int(0.95 * (len(lat) - 1))], 3)} if lat else {},
        "per_class": {k: dict(v) for k, v in sorted(per_class.items())},
    }


def load_real31(rows: list[dict], labels: dict) -> list[dict]:
    out = []
    for r in rows:
        key = f"{r['case']}#{r['turn']}"
        if r.get("status") != 200 or key not in labels or not r.get("draft_answer"):
            continue
        expected = set(labels[key])
        out.append({"key": key, "answer": r["draft_answer"], "data": r.get("data") or {}, "explanation": r.get("explanation"),
                    "visualizations": r.get("visualizations") or [], "expected": expected,
                    "critical": bool(expected & CRITICAL_31)})
    return out


def load_mutated31(real: list[dict]) -> list[dict]:
    out, variant = [], Counter()
    for it in real:
        if it["expected"]:
            continue
        ctx = ef.context_for({"data": it["data"], "explanation": it["explanation"], "visualizations": it["visualizations"]})
        for kind in ef.MUTATIONS:
            if ef.applicable(kind, ctx):
                out.append({"key": f"{it['key']}+{kind}", "answer": ef.mutate(it["answer"], kind, variant[kind], ctx),
                            "data": it["data"], "explanation": it["explanation"], "visualizations": it["visualizations"],
                            "expected": {kind}, "critical": kind in CRITICAL_31})
                variant[kind] += 1
    return out


def load_heldout(path: str, rows: list[dict]) -> list[dict]:
    with open(path, encoding="utf-8") as fh:
        doc = json.load(fh)
    by_key = {f"{r['case']}#{r['turn']}": r for r in rows}
    out = []
    for it in doc["items"]:
        base = by_key.get(it.get("base")) if it.get("base") else None
        data = it.get("data") if it.get("data") is not None else (base or {}).get("data") or {}
        out.append({"key": it["id"], "answer": it["answer"], "data": data,
                    "explanation": (base or {}).get("explanation"), "visualizations": (base or {}).get("visualizations") or [],
                    "expected": set(it["expected"]), "critical": bool(it.get("critical"))})
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--answers", default=os.path.join(EVAL_DIR, "faithfulness_answers_live.json"))
    parser.add_argument("--labels", default=os.path.join(EVAL_DIR, "faithfulness_labels.json"))
    parser.add_argument("--heldout", default=os.path.join(EVAL_DIR, "decision_verification_heldout.json"))
    parser.add_argument("--live", default="", help="live 3.2 collection (collect_faithfulness_answers.py --cases v32)")
    parser.add_argument("--live-labels", default=os.path.join(EVAL_DIR, "decision_verification_live_labels.json"))
    parser.add_argument("--out", default=os.path.join(EVAL_DIR, "reports", "decision_verification_eval.json"))
    args = parser.parse_args()
    with open(args.answers, encoding="utf-8") as fh:
        rows = json.load(fh)["rows"]
    with open(args.labels, encoding="utf-8") as fh:
        labels = json.load(fh)["labels"]

    real = load_real31(rows, labels)
    sets = {"REAL31": (real, "31"), "MUTATED31": (load_mutated31(real), "31"),
            "HELDOUT32": (load_heldout(args.heldout, rows), "32")}
    if args.live:
        with open(args.live, encoding="utf-8") as fh:
            live_rows = json.load(fh)["rows"]
        with open(args.live_labels, encoding="utf-8") as fh:
            live_labels = json.load(fh)
        lab = live_labels["labels"]
        items = []
        for r in live_rows:
            key = f"{r['case']}#{r['turn']}"
            if r.get("status") != 200 or key not in lab or not r.get("draft_answer"):
                continue
            items.append({"key": key, "answer": r["draft_answer"], "data": r.get("data") or {},
                          "explanation": r.get("explanation"), "visualizations": r.get("visualizations") or [],
                          "expected": set(lab[key]["expected"]), "critical": bool(lab[key].get("critical"))})
        sets["LIVE32"] = (items, "32")
    report = {"sizes": {k: len(v[0]) for k, v in sets.items()}}
    for name, (items, space) in sets.items():
        report[name] = {"v3_1": score(items, run_v31, space), "v3_2": score(items, run_v32, space)}
        report[name]["disagreements"] = [
            {"key": it["key"], "expected": sorted(it["expected"]), "v3_1": it["found"].get("run_v31"), "v3_2": it["found"].get("run_v32")}
            for it in items if bool(it["expected"]) != bool(it["found"].get("run_v32"))
            or (it["expected"] and not set(it["found"].get("run_v32") or []) & it["expected"])]
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=1, default=sorted)
    print(json.dumps(report["sizes"]))
    for name in sets:
        for version in ("v3_1", "v3_2"):
            s = report[name][version]
            print(f"{name:10} {version} P={s['precision']} R={s['recall']} ({s['recall_frac']}) FPR={s['fpr_clean']} "
                  f"({s['fpr_frac']}) critical={s['critical_detection']} latency={s['latency_ms']}")
    print("report:", args.out)


if __name__ == "__main__":
    main()
