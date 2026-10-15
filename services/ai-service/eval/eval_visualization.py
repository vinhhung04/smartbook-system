"""AI Copilot 3.0 visualization eval on visualization_dataset.json.

Two modes, one scorer:

  offline (default) - deterministic, no network, no LLM: the real planner
      (copilot_plan.build_plan) and visualization engine run on the dataset's
      fixture tool results, with the chart follow-up logic of main.py
      (snapshot reuse for "đổi sang biểu đồ cột", explain on the snapshot).
          python services/ai-service/eval/eval_visualization.py

  live - the same questions against the running stack through the gateway
      (real data, real LLM, real permissions); fixture-only cases are skipped.
          python services/ai-service/eval/eval_visualization.py --mode live \
              --gateway http://localhost:3000 --password <demo password>

Metrics (per turn, then rate over the turns where they apply):
- selection accuracy   primary visualization type (or none / KPI only / no
                       chart / asked back) equals the gold expectation;
- tool accuracy        planned tools equal the gold tools (multiset);
- schema validity      every spec re-validates (JSON round trip) against
                       copilot_visualization.Visualization, within limits;
- data fidelity        share of numeric chart/table cells and KPI values that
                       exist in the turn's tool data or equal an independent
                       recomputation here (totals, averages, % change);
- null fidelity        expected missing cells stay null (never 0);
- tool-source consistency  each spec's source tools were called this turn
                       (or are the reused snapshot's tools);
- follow-up consistency    mode (retype / render / explain / scope) as gold,
                       and "same rows" redraws keep the previous rows exactly;
- chart/explanation faithfulness  no consistency_issues(), and the trend
                       direction / riskier warehouse of the chart is the one
                       the explanation (offline) or the answer (live) states;
- usefulness           no chart for single-number questions, <= 4 specs, no
                       duplicates, no 1-point charts, required notes/limits
                       shown (missing data, permissions, partial data);
- latency overhead     wall time of build_visualizations per turn (offline),
                       end-to-end turn latency split by LLM / no-LLM turns (live).
A rate is only claimed over the turns it was measured on; nothing is assumed.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import statistics
import sys
import time
import uuid
from collections import Counter, defaultdict
from datetime import datetime

EVAL_DIR = os.path.dirname(os.path.abspath(__file__))
SERVICE_DIR = os.path.dirname(EVAL_DIR)
sys.path.insert(0, SERVICE_DIR)

import copilot_visualization as cv  # noqa: E402
from copilot_explain import build_explanation  # noqa: E402
from copilot_plan import VN_TZ, build_plan, next_state  # noqa: E402

CHARTS = {"line", "bar", "area", "pie"}


# ── helpers ──────────────────────────────────────────────────────────────────

def numbers(obj) -> set[float]:
    out: set[float] = set()
    if isinstance(obj, dict):
        for v in obj.values():
            out |= numbers(v)
    elif isinstance(obj, list):
        for v in obj:
            out |= numbers(v)
    elif isinstance(obj, (int, float)) and not isinstance(obj, bool) and math.isfinite(obj):
        out.add(round(float(obj), 2))
    return out


def recomputed(collected: dict) -> set[float]:
    """Independent recomputation of the derived KPI values the engine may show
    (not calling the engine): series totals, max, mean of complete months,
    first->last complete-month change. Complete = not the first/last bucket
    of a monthly series (the planner's rolling windows start/end mid-month)."""
    out: set[float] = set()
    for key, result in collected.items():
        if key.startswith("get_overdue_summary") and isinstance(result, dict):
            days = [r.get("overdue_days") for r in result.get("items") or [] if isinstance(r, dict)]
            days = [d for d in days if isinstance(d, (int, float))]
            out |= {float(sum(1 for d in days if lo <= d <= hi)) for lo, hi in ((1, 7), (8, 30), (31, 90), (91, 10 ** 6))}
        if not key.startswith("get_borrow_trends") or not isinstance(result, list):
            continue
        for field in ("loans", "returns", "reservations"):
            vals = [r.get(field) for r in result if isinstance(r, dict)]
            vals = [v for v in vals if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)]
            if not vals:
                continue
            out |= {round(float(sum(vals)), 2), round(float(max(vals)), 2)}
            monthly = bool(result) and len(str(result[0].get("date", ""))) == 7
            for inner in ([vals[1:-1], vals[1:], vals[:-1], vals] if monthly else [vals[:-1], vals]):
                if inner:
                    out.add(round(sum(inner) / len(inner), 1))
                if len(inner) >= 2 and inner[0]:
                    out.add(round((inner[-1] - inner[0]) / inner[0] * 100, 1))
    return out


def spec_cells(spec: dict) -> list:
    keys = [f["key"] for f in spec.get("series") or [] if f.get("kind") not in ("text", "date", "rank")]
    return [row.get(k) for row in spec.get("data") or [] for k in keys]


def primary_type(specs: list[dict]) -> str | None:
    return next((s["type"] for s in specs if s["type"] != "kpi"), None)


def pct(values: list[bool]) -> str:
    return f"{sum(values)}/{len(values)} = {sum(values) / len(values) * 100:.1f}%" if values else "n/a"


def quantiles(values: list[float]) -> dict:
    if not values:
        return {}
    ordered = sorted(values)
    p95 = ordered[min(len(ordered) - 1, int(round(0.95 * (len(ordered) - 1))))]
    return {"n": len(values), "p50": round(statistics.median(ordered), 2), "p95": round(p95, 2), "max": round(ordered[-1], 2)}


# ── scoring one turn ─────────────────────────────────────────────────────────

def score_turn(expect: dict, *, specs: list[dict], notes: list[str], collected: dict, planned_tools: list[str],
               clarification: bool, mode: str | None, explanation: dict | None, prev_specs: list[dict] | None,
               snapshot_tools: list[str], answer: str = "", live: bool = False) -> dict:
    checks: dict[str, bool] = {}
    # selection
    if expect.get("clarification"):
        checks["selection"] = clarification and not specs
    elif expect.get("no_viz"):
        checks["selection"] = not specs
    elif expect.get("no_chart"):
        checks["selection"] = not any(s["type"] in CHARTS for s in specs)
    elif "primary" in expect:
        checks["selection"] = primary_type(specs) == expect["primary"]
    if expect.get("types_include"):
        types = {s["type"] for s in specs}
        checks["selection"] = checks.get("selection", True) and set(expect["types_include"]) <= types
    if expect.get("kpi"):
        checks["selection"] = checks.get("selection", True) and any(s["type"] == "kpi" for s in specs)
    if "clarification" in expect or not expect.get("clarification"):
        checks["clarification"] = clarification == bool(expect.get("clarification"))
    if expect.get("tools") and not live:
        checks["tools"] = Counter(planned_tools) == Counter(expect["tools"])
    elif expect.get("tools") and live:
        checks["tools"] = set(expect["tools"]) <= set(planned_tools)
    # schema
    schema_ok = len(specs) <= cv.MAX_VISUALIZATIONS and len({s["id"] for s in specs}) == len(specs)
    for s in specs:
        try:
            cv.Visualization(**json.loads(json.dumps(s, allow_nan=False)))
        except Exception:  # noqa: BLE001 - any failure is a schema failure
            schema_ok = False
    if specs:
        checks["schema"] = schema_ok
    # data fidelity
    allowed = numbers(collected) | recomputed(collected)
    for prev in prev_specs or []:
        allowed |= numbers(prev.get("data")) | numbers(prev.get("kpis"))
    cells = [c for s in specs for c in spec_cells(s) if c is not None]
    kpis = [k["value"] for s in specs for k in s.get("kpis") or [] if k.get("value") is not None]
    verified = [round(float(v), 2) in allowed or round(float(v), 1) in allowed for v in cells + kpis]
    fidelity = (sum(verified), len(verified))
    # null fidelity
    if expect.get("null_cells") is not None:
        nulls = sum(1 for s in specs for c in spec_cells(s) if c is None)
        checks["null_fidelity"] = nulls >= expect["null_cells"]
    # source consistency
    if specs:
        called = set(planned_tools) | set(snapshot_tools)
        checks["source"] = all(set(s["source"]["tools"]) <= called for s in specs)
    # follow-up
    if expect.get("mode") or expect.get("period") or expect.get("same_rows"):
        ok = (mode == expect.get("mode")) if "mode" in expect else mode is None
        if expect.get("same_rows") and prev_specs is not None:
            cur = next((s for s in specs if s["type"] != "kpi"), None)
            prev = next((p for p in prev_specs if cur and p["title"] == cur["title"]), None)
            ok = ok and cur is not None and prev is not None and cur["data"] == prev["data"]
        checks["followup"] = ok
    # faithfulness (chart <-> explanation/answer)
    faith = []
    if specs and explanation:
        faith.append(not cv.consistency_issues(specs, explanation))
    summary = {k: v for s in specs for k, v in (s.get("summary") or {}).items()}
    if not live:
        if expect.get("direction"):
            faith.append(summary.get("direction") == expect["direction"])
            if explanation and explanation.get("mode") != "lookup":
                faith.append(expect["direction"] in (explanation.get("headline") or "") or expect["direction"] == "đi ngang")
        if expect.get("riskiest"):
            faith.append(summary.get("riskiest") == expect["riskiest"])
            if explanation:
                faith.append(expect["riskiest"] in json.dumps(explanation, ensure_ascii=False))
        if expect.get("tie"):
            faith.append(summary.get("riskiest") is None)
    else:
        lead = (answer or "").split("\n")[0].lower()
        if summary.get("direction") in ("tăng", "giảm"):
            opposite = "giảm" if summary["direction"] == "tăng" else "tăng"
            faith.append(summary["direction"] in lead or opposite not in lead)
        if summary.get("riskiest"):
            plain = "".join(ch for ch in (answer or "") if ch not in "*_`")  # "Kho **HCM Chinh**" names it too
            faith.append(str(summary["riskiest"]).lower() in plain.lower())
    if faith:
        checks["faithfulness"] = all(faith)
    # usefulness
    # A chart must compare at least two marks: two points, or one group of
    # two or more series (one budget scenario: budget vs approved cost).
    useful = len(specs) <= cv.MAX_VISUALIZATIONS and all(
        len(s.get("data") or []) >= 2 or len(s.get("series") or []) >= 2 for s in specs if s["type"] in CHARTS)
    if not live:
        if expect.get("partial"):
            useful = useful and any(s.get("is_partial") for s in specs)
        if expect.get("rows"):
            useful = useful and any(len(s["data"]) == expect["rows"] for s in specs if s["type"] in CHARTS)
        if expect.get("granularity") == "month":
            useful = useful and any(len(str(r.get("period", ""))) == 7 for s in specs for r in s.get("data") or [])
        if expect.get("unit"):
            useful = useful and any({f["unit"] for f in s["series"]} == {expect["unit"]} for s in specs if s["type"] in CHARTS)
        if expect.get("budget_slider"):
            useful = useful and any((s.get("interactions") or {}).get("budget") for s in specs)
        if expect.get("limit_contains"):
            useful = useful and any(expect["limit_contains"] in x for s in specs for x in s.get("limitations") or [])
    if expect.get("note_contains"):
        text = " ".join(notes) + " " + (answer or "")
        useful = useful and expect["note_contains"].lower() in text.lower()
    if expect.get("options_suffix") is not None:
        useful = useful and clarification
    checks["usefulness"] = useful
    return {"checks": checks, "fidelity": fidelity}


# ── offline ──────────────────────────────────────────────────────────────────

def _fixture(case: dict, turn_no: int, key: str, ds: dict):
    for name in (f"turn{turn_no}:{key}", key, f"turn{turn_no}:{key.split('#')[0]}", key.split("#")[0]):
        if name in case["fixtures"]:
            return ds["fixtures"][case["fixtures"][name]]
    base = key.split("#")[0]
    return ds["fixtures"].get(ds["default_fixtures"].get(base, ""), {"error": f"no fixture for {base}"})


def run_offline(ds: dict) -> list[dict]:
    now = datetime.fromisoformat(ds["now"]).astimezone(VN_TZ)
    rows = []
    for case in ds["cases"]:
        state, prev = None, None
        for n, turn in enumerate(case["turns"], start=1):
            plan = build_plan(turn["q"], state, ds["warehouses"], now)
            mode = (plan.visualization or {}).get("mode")
            planned = [t["name"] for t in plan.required_tools]
            notes: list[str] = []
            snapshot_tools: list[str] = []
            t0 = time.perf_counter()
            if plan.clarification_needed:
                collected, specs = {}, []
            elif mode and prev is not None:
                # main.py: the snapshot of the previous turn, no new tool calls
                collected, snapshot_tools, planned = prev["collected"], prev["tools"], []
                specs = []
                if mode == "retype" and prev["specs"]:
                    specs, note = cv.apply_chart_type(prev["specs"], plan.visualization["chart_type"])
                    notes = [note] if note else []
                if not specs:
                    specs, notes = cv.build_visualizations(plan, collected, now)
            else:
                collected = {}
                for name in planned:
                    key = name if name not in collected else f"{name}#2"
                    collected[key] = _fixture(case, n, key, ds)
                specs, notes = cv.build_visualizations(plan, collected, now)
            viz_ms = (time.perf_counter() - t0) * 1000
            explanation = build_explanation(plan, collected) if not plan.clarification_needed else None
            scored = score_turn(turn["expect"], specs=specs, notes=notes, collected=collected, planned_tools=planned,
                                clarification=plan.clarification_needed, mode=mode, explanation=explanation,
                                prev_specs=prev["specs"] if prev else None, snapshot_tools=snapshot_tools)
            rows.append({"case": case["id"], "category": case["category"], "turn": n, "q": turn["q"], "viz_ms": viz_ms,
                         "types": [s["type"] for s in specs], "notes": notes, **scored})
            if not plan.clarification_needed:
                state = next_state(plan, collected, state, specs)
                prev = {"collected": collected, "specs": specs, "tools": [k.split("#")[0] for k in collected]}
    return rows


# ── live ─────────────────────────────────────────────────────────────────────

def run_live(ds: dict, gateway: str, password: str, only: set[str] | None, delay: float = 4.5) -> list[dict]:
    import httpx

    tokens: dict[str, str] = {}

    def token(user: str) -> str:
        if user not in tokens:
            r = httpx.post(f"{gateway}/auth/login", json={"identifier": user, "password": password}, timeout=30)
            r.raise_for_status()
            tokens[user] = r.json()["token"]
        return tokens[user]

    def ask(user: str, message: str, cid: str, stream: bool) -> tuple[dict, float]:
        # ai-service allows 15 requests/minute and 100/hour per IP: pace, and on
        # a 429 wait and retry rather than scoring the turn as a failure.
        for attempt in range(6):
            time.sleep(delay)
            try:
                return _ask(user, message, cid, stream)
            except RateLimited:
                time.sleep(60)
        raise RuntimeError("still rate limited after retries")

    class RateLimited(Exception):
        pass

    def _ask(user: str, message: str, cid: str, stream: bool) -> tuple[dict, float]:
        headers = {"Authorization": f"Bearer {token(user)}"}
        t0 = time.perf_counter()
        if stream:
            with httpx.stream("POST", f"{gateway}/ai/assistant/stream", json={"message": message, "conversation_id": cid},
                              headers=headers, timeout=300) as r:
                if r.status_code == 429:
                    raise RateLimited()
                r.raise_for_status()
                body = "".join(r.iter_text())
            done = [e for e in body.split("\n\n") if e.startswith("event: done")][0]
            return json.loads(done.split("data: ", 1)[1]), time.perf_counter() - t0
        r = httpx.post(f"{gateway}/ai/assistant", json={"message": message, "conversation_id": cid}, headers=headers, timeout=300)
        if r.status_code == 429:
            raise RateLimited()
        r.raise_for_status()
        return r.json(), time.perf_counter() - t0

    rows = []
    for i, case in enumerate(ds["cases"]):
        if not case.get("live", True) or (only and case["id"] not in only):
            continue
        cid, prev = str(uuid.uuid4()), None
        for n, turn in enumerate(case["turns"], start=1):
            stream = i % 2 == 1  # half the cases through /assistant/stream: same schema expected
            try:
                body, seconds = ask(case["user"], turn["q"], cid, stream)
            except Exception as exc:  # noqa: BLE001 - recorded as a failed turn
                rows.append({"case": case["id"], "category": case["category"], "turn": n, "q": turn["q"], "error": str(exc),
                             "checks": {"selection": False}, "fidelity": (0, 0)})
                continue
            plan = body.get("plan") or {}
            mode = (plan.get("visualization") or {}).get("mode")
            specs = body.get("visualizations") or []
            planned = [t["name"] for t in plan.get("required_tools") or []] or [t["name"] for t in body.get("tools_used") or []]
            snapshot_tools = [t["name"] for t in body.get("tools_used") or []]
            scored = score_turn(turn["expect"], specs=specs, notes=body.get("visualization_notes") or [],
                                collected=body.get("data") or {}, planned_tools=planned,
                                clarification=bool(plan.get("clarification_needed")), mode=mode,
                                explanation=body.get("explanation"), prev_specs=prev, snapshot_tools=snapshot_tools,
                                answer=body.get("answer") or "", live=True)
            llm = bool((body.get("debug") or {}).get("llm_calls"))
            rows.append({"case": case["id"], "category": case["category"], "turn": n, "q": turn["q"], "seconds": seconds,
                         "llm": llm, "stream": stream, "types": [s["type"] for s in specs],
                         "notes": body.get("visualization_notes") or [], "answer": (body.get("answer") or "")[:400], **scored})
            prev = specs
    return rows


# ── report ───────────────────────────────────────────────────────────────────

METRICS = ["selection", "clarification", "tools", "schema", "null_fidelity", "source", "followup", "faithfulness", "usefulness"]


def report(rows: list[dict], mode: str) -> dict:
    out: dict = {"mode": mode, "turns": len(rows), "cases": len({r["case"] for r in rows}), "metrics": {}, "by_category": {}}
    for m in METRICS:
        vals = [r["checks"][m] for r in rows if m in r["checks"]]
        out["metrics"][m] = {"passed": sum(vals), "total": len(vals), "rate": round(sum(vals) / len(vals) * 100, 1) if vals else None}
    ok, total = sum(r["fidelity"][0] for r in rows), sum(r["fidelity"][1] for r in rows)
    out["metrics"]["data_fidelity_cells"] = {"passed": ok, "total": total, "rate": round(ok / total * 100, 2) if total else None}
    by_cat = defaultdict(list)
    for r in rows:
        by_cat[r["category"]].append(all(r["checks"].values()))
    out["by_category"] = {c: {"passed": sum(v), "total": len(v)} for c, v in sorted(by_cat.items())}
    out["all_checks_passed_turns"] = sum(all(r["checks"].values()) for r in rows)
    if mode == "offline":
        out["latency_viz_build_ms"] = quantiles([r["viz_ms"] for r in rows])
    else:
        out["latency_turn_s_llm"] = quantiles([r["seconds"] for r in rows if r.get("llm")])
        out["latency_turn_s_no_llm"] = quantiles([r["seconds"] for r in rows if "seconds" in r and not r.get("llm")])
    out["failures"] = [{"case": r["case"], "turn": r["turn"], "q": r["q"], "failed": [k for k, v in r["checks"].items() if not v],
                        "types": r.get("types"), "notes": r.get("notes"), **({"error": r["error"]} if "error" in r else {})}
                       for r in rows if not all(r["checks"].values())]
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--mode", choices=["offline", "live"], default="offline")
    parser.add_argument("--dataset", default=os.path.join(EVAL_DIR, "visualization_dataset.json"))
    parser.add_argument("--gateway", default=os.getenv("EVAL_GATEWAY_URL", "http://localhost:3000"))
    parser.add_argument("--password", default=os.getenv("EVAL_PASSWORD", ""))
    parser.add_argument("--cases", default="", help="comma-separated case ids (live)")
    parser.add_argument("--label", default="")
    parser.add_argument("--delay", type=float, default=4.5, help="seconds between live requests (rate limit)")
    args = parser.parse_args()
    with open(args.dataset, encoding="utf-8") as fh:
        ds = json.load(fh)
    if args.mode == "offline":
        rows = run_offline(ds)
    else:
        if not args.password:
            sys.exit("--password (or EVAL_PASSWORD) is required for --mode live")
        rows = run_live(ds, args.gateway.rstrip("/"), args.password, set(filter(None, args.cases.split(","))) or None, args.delay)
    result = report(rows, args.mode)
    print(f"\n== Visualization eval ({args.mode}) - {result['cases']} cases / {result['turns']} turns ==")
    for m, v in result["metrics"].items():
        if v["total"]:
            print(f"  {m:22} {v['passed']}/{v['total']} = {v['rate']}%")
    print("  by category:", ", ".join(f"{c} {v['passed']}/{v['total']}" for c, v in result["by_category"].items()))
    for key in ("latency_viz_build_ms", "latency_turn_s_llm", "latency_turn_s_no_llm"):
        if result.get(key):
            print(f"  {key}: {result[key]}")
    for f in result["failures"]:
        print("  FAIL", f)
    os.makedirs(os.path.join(EVAL_DIR, "reports"), exist_ok=True)
    name = f"visualization_{args.mode}{'_' + args.label if args.label else ''}.json"
    with open(os.path.join(EVAL_DIR, "reports", name), "w", encoding="utf-8") as fh:
        json.dump({"summary": result, "turns": rows}, fh, ensure_ascii=False, indent=1, default=str)
    print(f"  report: eval/reports/{name}")


if __name__ == "__main__":
    main()
