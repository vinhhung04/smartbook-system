"""Copilot 3.3 independent evaluation (copilot33_questions.json).

    python eval/copilot33_eval.py hash                       # canonical sha256 of the frozen test split
    python eval/copilot33_eval.py view  --answers A --split dev --out view.md
    python eval/copilot33_eval.py detect --answers A --out D [--semantic on|off] [--extract]
    python eval/copilot33_eval.py score --detections D --labels L [--split test]
    python eval/copilot33_eval.py final --answers A --labels F [--split test]

Protocol (docs/ANALYSIS/AI_COPILOT_3_3_EVALUATION.md): questions written and
the test split hashed before any 3.3 change; drafts collected live from the
deployed 3.2 pipeline; labels written from the draft + tool data only, never
from a detector's output; rules written from dev, tuned on val; the test split
is labelled after the code is frozen and scored once.

`detect` runs the CURRENT working tree's checks on every first draft. The 3.2
numbers come from running the same command in a checkout of badad94 (the 3.2
commit), so both versions are scored on identical drafts by identical code.
With --semantic on, the Layer 2 extraction (one LLM call per draft) is read
from eval/.cache/semantic_claims.json; --extract fills missing entries by
calling OpenRouter (needs OPENROUTER_API_KEY), so a re-run is reproducible
offline.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import statistics
import sys
import time
from collections import Counter

EVAL_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(EVAL_DIR))

QUESTIONS = os.path.join(EVAL_DIR, "copilot33_questions.json")
CACHE = os.path.join(EVAL_DIR, ".cache", "semantic_claims.json")


def _questions() -> list[dict]:
    with open(QUESTIONS, encoding="utf-8") as fh:
        return json.load(fh)["cases"]


def test_hash() -> str:
    test = sorted((c for c in _questions() if c["split"] == "test"), key=lambda c: c["id"])
    canon = json.dumps(test, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(canon.encode()).hexdigest()


def _rows(path: str, split: str | None = None) -> list[dict]:
    with open(path, encoding="utf-8") as fh:
        rows = json.load(fh)["rows"]
    splits = {c["id"]: c["split"] for c in _questions()}
    out = []
    for r in rows:
        r["split"] = r.get("split") or splits.get(r["case"])
        if split and r["split"] not in split.split(","):
            continue
        out.append(r)
    return out


def _key(r: dict) -> str:
    return f"{r['case']}#{r['turn']}"


# ── view (for labelling) ─────────────────────────────────────────────────────

_NOISE = {"book_id", "variant_id", "isbn", "author", "category", "reason", "reasoning", "data_confidence", "warehouse_id",
          "customer_id", "loan_id", "id", "description", "summary_vi", "on_hand_qty", "avg_daily_demand", "demand_pace",
          "daily_trend", "demand_volatility", "demand_score", "seasonal_event", "lead_time_samples", "score", "warehouse_code"}


def _slim(value, depth=0):
    if isinstance(value, dict):
        return {k: _slim(v, depth + 1) for k, v in value.items() if k not in _NOISE}
    if isinstance(value, list):
        keep = 10 if depth < 2 else 6
        return [_slim(v, depth + 1) for v in value[:keep]] + ([f"...+{len(value) - keep}"] if len(value) > keep else [])
    return value


def _compact(data: dict) -> str:
    """Tool data as compact JSON lines, ids/prose dropped and long lists cut
    (labelling aid only)."""
    lines = []
    for name, result in (data or {}).items():
        text = json.dumps(_slim(result), ensure_ascii=False, default=str)
        lines.append(f"- **{name}**: `{text[:3500]}`")
    return "\n".join(lines) or "- (no tool data)"


def view(args) -> None:
    out = []
    for r in _rows(args.answers, args.split):
        out.append(f"## {_key(r)} [{r.get('split')}] — {r.get('q')}\n")
        if r.get("status") != 200:
            out.append(f"HTTP {r.get('status')}\n")
            continue
        out.append("**Draft:**\n\n" + (r.get("draft_answer") or "") + "\n")
        if args.final and (r.get("answer") or "") != (r.get("draft_answer") or ""):
            out.append("**Final:**\n\n" + (r.get("answer") or "") + "\n")
        out.append("**Data:**\n" + _compact(r.get("data")) + "\n")
    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write("\n".join(out))
    print("wrote", args.out)


# ── detect ───────────────────────────────────────────────────────────────────

def _load_cache() -> dict:
    try:
        with open(CACHE, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def _save_cache(cache: dict) -> None:
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    with open(CACHE, "w", encoding="utf-8") as fh:
        json.dump(cache, fh, ensure_ascii=False, indent=1)


def detect(args) -> None:
    import copilot_faithfulness as cf
    import copilot_verification as cv
    semantic = None
    if args.semantic == "on":
        import copilot_claims as semantic  # noqa: F401 - only in the 3.3 tree
    cache = _load_cache() if semantic else {}
    provider = None
    out = {"code": "working tree", "semantic": args.semantic, "items": {}}
    by_turn = {(r["case"], r["turn"]): r for r in _rows(args.answers)}
    for r in _rows(args.answers, args.split):
        if r.get("status") != 200 or not r.get("draft_answer"):
            continue
        for which in ("draft", "final") if args.final else ("draft",):
            answer = r["draft_answer"] if which == "draft" else (r.get("answer") or "")
            data, explanation, viz = r.get("data") or {}, r.get("explanation"), r.get("visualizations") or []
            t0 = time.perf_counter()
            ctx = cf.build_context(data, explanation, viz)
            sheet = cv.build_sheet(data, explanation, viz)
            cleaned, labels = cf.strip_internal_labels(answer)
            if "context" in cv.verify.__code__.co_varnames:
                # the question + the earlier turns' answers (what main.py passes)
                context = "\n".join([r.get("q") or ""] + [(by_turn.get((r["case"], t)) or {}).get("answer") or ""
                                                           for t in range(r["turn"])])
                report = cv.verify(cleaned, sheet, labels + cf.validate(cleaned, ctx), context=context)
            else:
                report = cv.verify(cleaned, sheet, labels + cf.validate(cleaned, ctx))
            ms = (time.perf_counter() - t0) * 1000
            llm = None
            if semantic:
                run_tag = "" if args.run == 1 else f"run{args.run}|"
                ck = hashlib.sha256(f"{semantic.PROMPT_VERSION}|{run_tag}{cleaned}".encode()).hexdigest()[:24]
                if ck not in cache and args.extract:
                    if provider is None:
                        from llm_provider import get_openrouter_provider, ASSISTANT_MODEL
                        provider = get_openrouter_provider(ASSISTANT_MODEL)
                    t1 = time.perf_counter()
                    claims, usage = asyncio.run(semantic.extract(cleaned, sheet, data, provider))
                    cache[ck] = {"claims": claims, "usage": usage, "latency_ms": round((time.perf_counter() - t1) * 1000)}
                    _save_cache(cache)
                if ck in cache:
                    t2 = time.perf_counter()
                    extra = semantic.validate(cache[ck]["claims"], cleaned, sheet, data)
                    report = cv.merge(report, extra)
                    ms += (time.perf_counter() - t2) * 1000
                    llm = {"latency_ms": cache[ck].get("latency_ms"), "usage": cache[ck].get("usage")}
            item = {
                "found": sorted({c.category for c in report.problems}),
                "critical": bool(report.critical),
                "claims": [c.public() for c in report.problems][:8],
                "ms": round(ms, 3),
            }
            if hasattr(cv, "blocking_basis"):
                item["blocking_basis"] = cv.blocking_basis(report)
            if llm:
                item["llm"] = llm
            out["items"][f"{_key(r)}:{which}"] = item
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
    print("wrote", args.out, len(out["items"]), "items")


# ── score ────────────────────────────────────────────────────────────────────

def _labels(path: str) -> dict:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)["labels"]


def score_items(items: dict, labels: dict, split: str | None, which: str = "draft") -> dict:
    splits = {c["id"]: c["split"] for c in _questions()}
    tp = fp = fn = tn = 0
    crit = crit_hit = 0
    per_class: dict = {}
    lat = []
    misses, false_alarms = [], []
    for key, lab in labels.items():
        if split and splits.get(key.split("#")[0]) not in split.split(","):
            continue
        det = items.get(f"{key}:{which}")
        if det is None:
            continue
        expected, found = set(lab["expected"]), set(det["found"])
        lat.append(det["ms"])
        if expected and found:
            tp += 1
        elif expected:
            fn += 1
            misses.append(key)
        elif found:
            fp += 1
            false_alarms.append({"key": key, "found": sorted(found)})
        else:
            tn += 1
        if lab.get("critical"):
            crit += 1
            crit_hit += bool(det["critical"])
        for cls in expected | found:
            c = per_class.setdefault(cls, Counter())
            c["tp" if cls in expected and cls in found else "fn" if cls in expected else "fp"] += 1
    lat.sort()
    return {
        "items": tp + fp + fn + tn, "with_errors": tp + fn, "clean": fp + tn,
        "precision": round(tp / (tp + fp), 3) if tp + fp else None,
        "recall": round(tp / (tp + fn), 3) if tp + fn else None, "recall_frac": f"{tp}/{tp + fn}",
        "fpr": round(fp / (fp + tn), 3) if fp + tn else None, "fpr_frac": f"{fp}/{fp + tn}",
        "critical_detection": f"{crit_hit}/{crit}",
        "latency_ms": {"p50": round(statistics.median(lat), 2), "p95": round(lat[int(0.95 * (len(lat) - 1))], 2)} if lat else {},
        "per_class": {k: dict(v) for k, v in sorted(per_class.items())},
        "misses": misses, "false_alarms": false_alarms,
    }


def score(args) -> None:
    with open(args.detections, encoding="utf-8") as fh:
        det = json.load(fh)["items"]
    result = score_items(det, _labels(args.labels), args.split)
    print(json.dumps({k: v for k, v in result.items() if k not in ("per_class",)}, ensure_ascii=False, indent=1))
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump(result, fh, ensure_ascii=False, indent=1)


def final(args) -> None:
    """Final-answer outcome of one live run: answers the user received that
    still carried a semantic error, statuses, blocked-without-cause, retries,
    LLM calls, tokens and latency."""
    labels = _labels(args.labels)
    rows = [r for r in _rows(args.answers, args.split) if r.get("status") == 200]
    with_err = [k for k, v in labels.items() if v["expected"]]
    critical = [k for k, v in labels.items() if v.get("critical")]
    statuses = Counter((r.get("verification") or {}).get("status") for r in rows)
    secs = sorted(r["seconds"] for r in rows)
    calls = [r.get("llm_calls") or 0 for r in rows]
    prompt = sum(sum((u.get("prompt_tokens") or 0) for u in (r.get("llm_usage") or [])) for r in rows)
    completion = sum(sum((u.get("completion_tokens") or 0) for u in (r.get("llm_usage") or [])) for r in rows)
    cost = sum(sum((u.get("costUsd") or u.get("cost_usd") or 0) for u in (r.get("llm_usage") or [])) for r in rows)
    keys = {_key(r) for r in rows}
    out = {
        "turns": len(rows), "labelled": len([k for k in labels if k in keys]),
        "final_with_errors": f"{len([k for k in with_err if k in keys])}/{len(rows)}",
        "final_critical": f"{len([k for k in critical if k in keys])}/{len(rows)}",
        "final_accuracy": round(1 - len([k for k in with_err if k in keys]) / len(rows), 3) if rows else None,
        "statuses": dict(statuses),
        "blocked_without_critical_draft": [k for k, v in labels.items() if k in keys and v.get("blocked_without_cause")],
        "retry_rate": round(sum(1 for r in rows if (r.get("verification") or {}).get("retried")) / len(rows), 3) if rows else None,
        "llm_calls_mean": round(statistics.mean(calls), 2) if calls else None,
        "tokens": {"prompt": prompt, "completion": completion, "per_turn": round((prompt + completion) / len(rows)) if rows else None},
        "cost_usd": round(cost, 4),
        "latency_s": {"p50": round(statistics.median(secs), 2), "p95": round(secs[int(0.95 * (len(secs) - 1))], 2)} if secs else {},
        "pending_actions": sum(1 for r in rows if r.get("pending_action")),
    }
    print(json.dumps(out, ensure_ascii=False, indent=1))
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump(out, fh, ensure_ascii=False, indent=1)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("hash")
    p = sub.add_parser("view")
    p.add_argument("--answers", required=True)
    p.add_argument("--split", default=None)
    p.add_argument("--final", action="store_true")
    p.add_argument("--out", required=True)
    p = sub.add_parser("detect")
    p.add_argument("--answers", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--semantic", choices=["on", "off"], default="off")
    p.add_argument("--extract", action="store_true")
    p.add_argument("--run", type=int, default=1, help="independent extraction run (separate cache entries)")
    p.add_argument("--final", action="store_true", help="also check the final answers")
    p.add_argument("--split", default=None, help="comma-separated splits (default: all)")
    p = sub.add_parser("score")
    p.add_argument("--detections", required=True)
    p.add_argument("--labels", required=True)
    p.add_argument("--split", default=None)
    p.add_argument("--out", default="")
    p = sub.add_parser("final")
    p.add_argument("--answers", required=True)
    p.add_argument("--labels", required=True)
    p.add_argument("--split", default=None)
    p.add_argument("--out", default="")
    args = parser.parse_args()
    if args.cmd == "hash":
        print(test_hash())
    else:
        {"view": view, "detect": detect, "score": score, "final": final}[args.cmd](args)


if __name__ == "__main__":
    main()
