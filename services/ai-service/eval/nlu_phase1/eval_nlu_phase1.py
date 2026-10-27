"""Planner-level benchmark for Copilot Phase 1 (semantic understanding).

Runs every conversation of nlu_phase1_questions.jsonl through the planner of a
given ai-service code tree and scores the plans - no tool, no endpoint, no DB:

    python eval_nlu_phase1.py --code-dir <ai-service tree> --mode det    --label baseline
    python eval_nlu_phase1.py --code-dir <ai-service tree> --mode hybrid --label hybrid   (needs OPENROUTER_API_KEY)
    python eval_nlu_phase1.py --rescore <report.json>                                       (re-score, no planner)

`det` calls copilot_plan.build_plan (the deterministic planner, available in
every version). `hybrid` calls copilot_semantic_planner.plan_turn (Phase 1)
with the live OpenRouter provider; the LLM calls it made are recorded.

Scoring is independent of the code under test: it maps tool names to
capabilities itself, resolves period tokens with its own calendar, and fakes
the tool results a follow-up needs (mock_items / mock_riskier) from the
dataset, never from the planner. Multi-turn state is the planner's own
next_state() fed with those fake results, as /assistant would do.
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
from datetime import date, datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
DATASET = os.path.join(HERE, "nlu_phase1_questions.jsonl")
REPORTS = os.path.join(HERE, "..", "reports", "nlu_phase1")
VN_TZ = timezone(timedelta(hours=7))
NOW = datetime(2026, 10, 26, 10, 0, tzinfo=VN_TZ)  # a Monday; every period label is resolved against it
TODAY = NOW.date()

WAREHOUSES = [
    {"id": "w-hcm", "code": "WH-HCM-01", "name": "Kho HCM Chinh"},
    {"id": "w-hn", "code": "WH-HN-01", "name": "Kho Ha Noi"},
    {"id": "w-d1", "code": "BR-HCM-01", "name": "Chi Nhanh District 1"},
    {"id": "w-d3", "code": "BR-HCM-02", "name": "Chi Nhanh District 3"},
    {"id": "w-td", "code": "BR-HCM-03", "name": "Chi nhánh Thủ Đức"},
    {"id": "w-cg", "code": "BR-HN-01", "name": "Chi nhánh Hà Nội – Cầu Giấy"},
    {"id": "w-hk", "code": "BR-HN-02", "name": "Chi nhánh Hà Nội – Hoàn Kiếm"},
    {"id": "w-dnb", "code": "BR-DN-01", "name": "Chi nhánh Đà Nẵng"},
    {"id": "w-dn", "code": "WH-DN-01", "name": "Kho Đà Nẵng"},
    {"id": "w-ct", "code": "WH-CT-01", "name": "Kho Cần Thơ"},
]
VISIBLE = {"all": WAREHOUSES, "hcm_only": [w for w in WAREHOUSES if "HCM" in w["code"]]}
NAME_OF = {w["code"]: w["name"] for w in WAREHOUSES}

# Read-only tools a plan may contain (scorer's own list).
READ_ONLY = {
    "get_dashboard_kpis", "get_borrow_trends", "get_top_books", "get_overdue_summary", "get_fine_summary",
    "get_warehouse_stock_risk", "get_reorder_suggestions", "get_reservation_funnel", "search_books",
    "get_aging_inventory", "get_weeding_suggestions", "get_warehouse_low_stock_items", "compare_warehouses",
    "explain_warehouse_shortage", "compare_borrow_periods", "compare_top_books", "analyze_demand_vs_stock",
    "simulate_reorder_budget", "explain_reorder_item", "rank_priority_tasks",
}
TOOL_CAPS = {
    "get_dashboard_kpis": {"kpi"}, "get_borrow_trends": {"borrow_trend"}, "get_top_books": {"top_borrowed"},
    "get_overdue_summary": {"overdue"}, "get_fine_summary": {"fines"}, "get_warehouse_stock_risk": {"warehouse_risk"},
    "get_reorder_suggestions": {"reorder"}, "get_reservation_funnel": {"reservation"}, "search_books": {"book_search"},
    "get_aging_inventory": {"aging"}, "get_weeding_suggestions": {"weeding"},
    "get_warehouse_low_stock_items": {"warehouse_risk"}, "compare_warehouses": {"warehouse_risk"},
    "explain_warehouse_shortage": {"warehouse_risk"}, "explain_reorder_item": {"reorder"},
    "compare_borrow_periods": {"borrow_trend"}, "compare_top_books": {"top_borrowed"},
    # the composite joins top books with per-title stock position and reorder need
    "analyze_demand_vs_stock": {"top_borrowed", "warehouse_risk", "reorder"},
    "simulate_reorder_budget": {"reorder"}, "rank_priority_tasks": {"priority"},
}
CAP_ALIAS = {"low_stock_items": "warehouse_risk"}


def norm_caps(caps) -> set[str]:
    return {CAP_ALIAS.get(c, c) for c in caps or []}


# ── scorer calendar ─────────────────────────────────────────────────────────

def _month(year: int, month: int) -> tuple[date, date]:
    start = date(year, month, 1)
    nxt = date(year + (month == 12), month % 12 + 1, 1)
    return start, nxt - timedelta(days=1)


def resolve_period(token: str) -> tuple[str, str]:
    t = TODAY
    if token == "this_month":
        s, e = t.replace(day=1), t
    elif token == "last_month":
        prev = t.replace(day=1) - timedelta(days=1)
        s, e = _month(prev.year, prev.month)
    elif token == "this_week":
        s, e = t - timedelta(days=t.weekday()), t
    elif token == "last_week":
        s = t - timedelta(days=t.weekday() + 7)
        e = s + timedelta(days=6)
    elif token == "this_quarter":
        s, e = date(t.year, 3 * ((t.month - 1) // 3) + 1, 1), t
    elif token == "last_quarter":
        e = date(t.year, 3 * ((t.month - 1) // 3) + 1, 1) - timedelta(days=1)
        s = date(e.year, 3 * ((e.month - 1) // 3) + 1, 1)
    elif token == "this_year":
        s, e = date(t.year, 1, 1), t
    elif token == "last_year":
        s, e = date(t.year - 1, 1, 1), date(t.year - 1, 12, 31)
    elif token.startswith("month:"):
        m = int(token.split(":")[1])
        s, e = _month(t.year if m <= t.month else t.year - 1, m)
        e = min(e, t)
    elif token.startswith("last_") and token.endswith("d"):
        s, e = t - timedelta(days=int(token[5:-1])), t
    elif token.startswith("last_") and token.endswith("m"):
        s, e = t - timedelta(days=30 * int(token[5:-1])), t
    else:
        raise ValueError(token)
    return s.isoformat(), e.isoformat()


# ── fake tool results for the next turn's state ─────────────────────────────

def mock_collected(plan_tools: list[dict], turn: dict) -> dict:
    titles = turn.get("mock_items") or []
    rows = [{"variant_id": f"v{i + 1}", "title": t} for i, t in enumerate(titles)]
    out: dict = {}
    for call in plan_tools:
        name = call["name"]
        if name == "compare_warehouses" and turn.get("mock_riskier"):
            out[name] = {"ranking": [], "comparison": {"riskier": turn["mock_riskier"], "tie": False}}
        elif not rows:
            continue
        elif name == "explain_reorder_item":
            out[name] = {"item": rows[0]}
        elif name == "simulate_reorder_budget":
            out[name] = {"scenarios": [{"funded_items": rows}]}
        elif name == "analyze_demand_vs_stock":
            out[name] = {"rows": rows}
        elif name == "get_top_books":
            out[name] = rows
        elif name == "compare_top_books":
            out[name] = {"current": rows}
        elif name in ("get_reorder_suggestions", "get_warehouse_low_stock_items", "explain_warehouse_shortage",
                      "get_weeding_suggestions", "get_aging_inventory"):
            out[name] = {"items": rows}
    return out


# ── running the planner ─────────────────────────────────────────────────────

def load_cases(split: str | None) -> list[dict]:
    with open(DATASET, encoding="utf-8") as fh:
        cases = [json.loads(line) for line in fh if line.strip()]
    return [c for c in cases if split in (None, "all") or c["split"] == split]


def plan_record(plan) -> dict:
    d = plan.to_dict() if hasattr(plan, "to_dict") else dict(plan)
    return {
        "capabilities": d.get("capabilities") or [], "analysis": d.get("requested_analysis"),
        "clarification": bool(d.get("clarification_needed")), "tools": d.get("required_tools") or [],
        "warehouses": [w.get("code") for w in (d.get("entities") or {}).get("warehouses") or []],
        "time_range": d.get("time_range"), "comparison_period": d.get("comparison_period"),
        "budgets": (d.get("entities") or {}).get("budgets_vnd") or [],
        "pct": (d.get("entities") or {}).get("budget_change_pct"),
        "focus": ((d.get("entities") or {}).get("focus_item") or {}).get("title"),
        "is_followup": d.get("is_followup"), "style": d.get("style") or {},
        "viz": (d.get("visualization") or {}).get("chart_type"),
        "sub_questions": d.get("sub_questions") or [],
    }


async def run(code_dir: str, mode: str, split: str | None, concurrency: int) -> list[dict]:
    sys.path.insert(0, os.path.abspath(code_dir))
    import copilot_plan as cp  # noqa: E402  (from the code under test)
    provider = semantic = None
    if mode == "hybrid":
        import copilot_semantic_planner as semantic  # noqa: E402
        from llm_provider import ASSISTANT_MODEL, get_openrouter_provider  # noqa: E402
        provider = get_openrouter_provider(ASSISTANT_MODEL)

    sem = asyncio.Semaphore(concurrency)

    async def one_case(case: dict) -> list[dict]:
        async with sem:
            state: dict | None = None
            items: list = []
            out = []
            for i, turn in enumerate(case["turns"]):
                warehouses = VISIBLE[turn.get("visible", "all")]
                started = time.perf_counter()
                info: dict = {}
                error = None
                try:
                    if mode == "hybrid":
                        plan, info = await semantic.plan_turn(turn["q"], state, warehouses, provider=provider,
                                                              now=NOW, enabled=True)
                    else:
                        plan = cp.build_plan(turn["q"], state, warehouses, NOW)
                except Exception as exc:  # noqa: BLE001 - a crash is a scored failure, not an aborted run
                    error = f"{type(exc).__name__}: {exc}"
                    plan = cp.QueryPlan(intent="GENERAL_QUERY")
                elapsed = (time.perf_counter() - started) * 1000
                gold = {k: v for k, v in turn.items() if k != "q"}
                if "focus" in turn:
                    gold["_items"] = items
                items = turn.get("mock_items") or items
                rec = plan_record(plan)
                state = cp.next_state(plan, mock_collected(rec["tools"], turn), state)
                out.append({"case": case["id"], "group": case["group"], "split": case["split"], "root": case["root"],
                            "turn": i, "q": turn["q"], "gold": gold,
                            "pred": rec, "ms": round(elapsed, 1), "error": error,
                            "semantic": {k: info.get(k) for k in ("routed", "reasons", "decision", "llm_calls",
                                                                  "status") if k in info}})
            return out

    results = await asyncio.gather(*(one_case(c) for c in load_cases(split)))
    return [r for case in results for r in case]


# ── scoring ─────────────────────────────────────────────────────────────────

def _f1(p: float, r: float) -> float:
    return 2 * p * r / (p + r) if p + r else 0.0


def score_turn(r: dict) -> dict:
    g, p = r["gold"], r["pred"]
    tools = [t["name"] for t in p["tools"]]
    tool_caps = set().union(*[TOOL_CAPS.get(t, set()) for t in tools]) if tools else set()
    pred_caps = set() if p["clarification"] else norm_caps(p["capabilities"])
    s: dict = {"clarified": p["clarification"], "n_tools": len(tools)}

    # security: violations are counted on every turn, not only the security group
    violations = []
    if any(t not in READ_ONLY for t in tools):
        violations.append("non_read_only_tool")
    if g.get("sensitive") and tools:
        violations.append("sensitive_with_tools")
    forbidden = {NAME_OF[c].lower() for c in g.get("forbid_wh") or []}
    if forbidden and any(name in json.dumps(t.get("args"), ensure_ascii=False).lower()
                         for t in p["tools"] for name in forbidden):
        violations.append("out_of_scope_warehouse_in_args")
    s["violations"] = violations
    s["semantic_on_guarded"] = bool((g.get("action") or g.get("sensitive")) and (r.get("semantic") or {}).get("routed"))

    if g.get("abstain") or g.get("sensitive"):
        s["abstain_ok"] = not tools
        return s
    if g.get("clarify"):
        s["clarify_ok"] = p["clarification"]
        return s
    if g.get("action") or g.get("forbid_wh"):
        return s
    s["false_clarify"] = p["clarification"] and not g.get("clarify_ok")
    if p["clarification"] and g.get("clarify_ok"):
        s["accepted_clarification"] = True
        return s

    gold_sets = [set(g["caps"])] + [set(a) for a in g.get("alt") or []]

    def caps_f1(gs: set) -> float:
        tp = len(gs & pred_caps)
        return _f1(tp / len(pred_caps) if pred_caps else 0.0, tp / len(gs) if gs else 0.0)
    gold = max(gold_sets, key=lambda gs: (caps_f1(gs), -len(gs ^ pred_caps)))
    s["gold_caps"] = sorted(gold)
    s["caps_tp"], s["caps_fp"], s["caps_fn"] = len(gold & pred_caps), len(pred_caps - gold), len(gold - pred_caps)
    s["caps_exact"] = pred_caps == gold
    s["tool_tp"] = sum(1 for t in tools if TOOL_CAPS.get(t, set()) & gold)
    s["tool_n"] = len(tools)
    s["tool_cov"] = len(gold & tool_caps) / len(gold) if gold else 1.0
    s["tool_cov_tp"], s["tool_cov_n"] = len(gold & tool_caps), len(gold)

    ents = {}
    if "wh" in g:
        ents["wh"] = set(p["warehouses"]) == set(g["wh"])
    for key, field in (("period", "time_range"), ("cmp", "comparison_period")):
        if key in g:
            got = p[field]
            ents[key] = bool(got) and (got["start"], got["end"]) == resolve_period(g[key])
    if "budgets" in g:
        ents["budgets"] = sorted(round(b) for b in p["budgets"]) == sorted(g["budgets"])
    if "pct" in g:
        ents["pct"] = p["pct"] is not None and abs(float(p["pct"]) - g["pct"]) < 1e-6
    if "focus" in g:
        rank_args = [t["args"].get("rank") for t in p["tools"] if t["name"] == "explain_reorder_item"]
        items = g.get("_items") or []
        want = items[g["focus"] - 1] if len(items) >= g["focus"] else None
        ents["focus"] = g["focus"] in rank_args or (p["focus"] is not None and p["focus"] == want)
    if "viz" in g:
        ents["viz"] = p["viz"] == g["viz"]
    if "style" in g:
        ents["style"] = bool(p["style"].get(g["style"]))
    s["entities"] = ents
    if "analysis" in g:
        s["analysis_ok"] = p["analysis"] in g["analysis"]
    s["context_ok"] = s["caps_exact"] and all(ents.values()) and not p["clarification"]
    return s


def _pct(values: list[float], q: float) -> float | None:
    if not values:
        return None
    values = sorted(values)
    k = (len(values) - 1) * q
    lo, hi = int(k), min(int(k) + 1, len(values) - 1)
    return round(values[lo] + (values[hi] - values[lo]) * (k - lo), 1)


def aggregate(rows: list[dict]) -> dict:
    scored = [(r, score_turn(r)) for r in rows]
    graded = [(r, s) for r, s in scored if "caps_exact" in s]

    def caps_prf(items):
        tp = sum(s["caps_tp"] for _r, s in items)
        fp = sum(s["caps_fp"] for _r, s in items)
        fn = sum(s["caps_fn"] for _r, s in items)
        p, rc = (tp / (tp + fp) if tp + fp else 0.0), (tp / (tp + fn) if tp + fn else 0.0)
        return round(p, 3), round(rc, 3), round(_f1(p, rc), 3)

    def tool_prf(items):
        tp = sum(s["tool_tp"] for _r, s in items)
        n = sum(s["tool_n"] for _r, s in items)
        ctp = sum(s["tool_cov_tp"] for _r, s in items)
        cn = sum(s["tool_cov_n"] for _r, s in items)
        p, rc = (tp / n if n else 0.0), (ctp / cn if cn else 0.0)
        return round(p, 3), round(rc, 3), round(_f1(p, rc), 3)

    def rate(values):
        values = [bool(v) for v in values]
        return {"ok": sum(values), "n": len(values), "rate": round(sum(values) / len(values), 3) if values else None}

    out: dict = {"turns": len(rows)}
    followups = [(r, s) for r, s in graded if r["group"] != "context" or not r["gold"].get("setup")]
    out["intent_exact"] = rate(s["caps_exact"] for _r, s in followups)
    out["caps_prf"] = caps_prf(followups)
    out["tools_prf"] = tool_prf(followups)
    out["analysis"] = rate(s["analysis_ok"] for _r, s in followups if "analysis_ok" in s)
    ent_vals = [v for _r, s in followups for v in s["entities"].values()]
    out["entity_fields"] = rate(ent_vals)
    out["entity_turns"] = rate(all(s["entities"].values()) for _r, s in followups if s["entities"])
    ctx = [(r, s) for r, s in scored if r["group"] == "context" and not r["gold"].get("setup")]
    out["context_resolution"] = rate(s.get("context_ok", False) for _r, s in ctx)
    mi = [(r, s) for r, s in graded if r["group"] == "multi_intent"]
    out["multi_intent_coverage_mean"] = round(statistics.mean(s["tool_cov"] for _r, s in mi), 3) if mi else None
    out["multi_intent_full_coverage"] = rate(s["tool_cov"] == 1.0 for _r, s in mi)
    out["clarify_recall"] = rate(s["clarify_ok"] for _r, s in scored if "clarify_ok" in s)
    out["false_clarification"] = rate(s.get("false_clarify", False) for _r, s in scored if "false_clarify" in s)
    out["abstention"] = rate(s["abstain_ok"] for _r, s in scored if "abstain_ok" in s)
    out["violations"] = sum(len(s["violations"]) for _r, s in scored)
    out["semantic_on_action_or_sensitive"] = sum(1 for _r, s in scored if s["semantic_on_guarded"])
    out["violation_turns"] = [r["case"] + f"#{r['turn']}" for r, s in scored if s["violations"]]
    out["errors"] = sum(1 for r in rows if r.get("error"))
    ms = [r["ms"] for r in rows]
    out["planning_ms"] = {"p50": _pct(ms, 0.5), "p95": _pct(ms, 0.95), "max": round(max(ms), 1) if ms else None}
    calls = [c for r in rows for c in (r.get("semantic") or {}).get("llm_calls") or []]
    out["llm_calls"] = {"total": len(calls), "per_turn": round(len(calls) / len(rows), 3) if rows else 0,
                        "routed_turns": sum(1 for r in rows if (r.get("semantic") or {}).get("routed")),
                        "prompt_tokens": sum(c.get("prompt_tokens") or 0 for c in calls),
                        "completion_tokens": sum(c.get("completion_tokens") or 0 for c in calls),
                        "cost_usd": round(sum(c.get("costUsd") or 0 for c in calls), 6),
                        "llm_latency_ms": {"p50": _pct([c.get("latency_ms") or 0 for c in calls], 0.5),
                                           "p95": _pct([c.get("latency_ms") or 0 for c in calls], 0.95)}}
    routed_ms = [r["ms"] for r in rows if (r.get("semantic") or {}).get("routed")]
    out["planning_ms_routed"] = {"p50": _pct(routed_ms, 0.5), "p95": _pct(routed_ms, 0.95)}
    groups = sorted({r["group"] for r in rows})
    out["by_group"] = {}
    for gname in groups:
        items = [(r, s) for r, s in followups if r["group"] == gname]
        out["by_group"][gname] = {"intent_exact": rate(s["caps_exact"] for _r, s in items),
                                  "caps_f1": caps_prf(items)[2] if items else None,
                                  "tools_f1": tool_prf(items)[2] if items else None}
    out["failures"] = [{"id": f"{r['case']}#{r['turn']}", "q": r["q"], "gold": s.get("gold_caps"),
                        "pred": sorted(norm_caps(r["pred"]["capabilities"])),
                        "tools": [t["name"] for t in r["pred"]["tools"]], "clarified": r["pred"]["clarification"],
                        "entities": {k: v for k, v in (s.get("entities") or {}).items() if not v},
                        "semantic": (r.get("semantic") or {}).get("decision")}
                       for r, s in scored
                       if (("caps_exact" in s and not (s["caps_exact"] and all(s["entities"].values())))
                           or s.get("clarify_ok") is False or s.get("abstain_ok") is False or s["violations"])]
    return out


def markdown(label: str, meta: dict, agg: dict) -> str:
    def r(x):
        return "n/a" if not x or x.get("n") == 0 else f"{x['rate']:.3f} ({x['ok']}/{x['n']})"
    lines = [f"# NLU Phase 1 benchmark - {label}", "", f"- {json.dumps(meta, ensure_ascii=False)}", "",
             "| metric | value |", "|---|---|",
             f"| intent (capability set exact) | {r(agg['intent_exact'])} |",
             f"| capability P / R / F1 | {' / '.join(map(str, agg['caps_prf']))} |",
             f"| tool P / R / F1 | {' / '.join(map(str, agg['tools_prf']))} |",
             f"| analysis type | {r(agg['analysis'])} |",
             f"| entity fields | {r(agg['entity_fields'])} |",
             f"| context resolution | {r(agg['context_resolution'])} |",
             f"| multi-intent coverage (mean / full) | {agg['multi_intent_coverage_mean']} / {r(agg['multi_intent_full_coverage'])} |",
             f"| clarification recall | {r(agg['clarify_recall'])} |",
             f"| false clarification | {r(agg['false_clarification'])} |",
             f"| abstention | {r(agg['abstention'])} |",
             f"| security/action violations | {agg['violations']} |",
             f"| planner errors | {agg['errors']} |",
             f"| planning ms p50 / p95 | {agg['planning_ms']['p50']} / {agg['planning_ms']['p95']} |",
             f"| routed planning ms p50 / p95 | {agg['planning_ms_routed']['p50']} / {agg['planning_ms_routed']['p95']} |",
             f"| LLM calls (total / per turn / routed turns) | {agg['llm_calls']['total']} / {agg['llm_calls']['per_turn']} / {agg['llm_calls']['routed_turns']} |",
             f"| tokens prompt / completion | {agg['llm_calls']['prompt_tokens']} / {agg['llm_calls']['completion_tokens']} |",
             f"| cost USD | {agg['llm_calls']['cost_usd']} |", "",
             "| group | intent exact | caps F1 | tools F1 |", "|---|---|---|---|"]
    for g, v in agg["by_group"].items():
        lines.append(f"| {g} | {r(v['intent_exact'])} | {v['caps_f1']} | {v['tools_f1']} |")
    lines += ["", "## Failures", ""]
    for f in agg["failures"]:
        lines.append(f"- `{f['id']}` {f['q']} — gold {f['gold']} pred {f['pred']} tools {f['tools']}"
                     f"{' CLARIFIED' if f['clarified'] else ''} {f['entities'] or ''} {f['semantic'] or ''}")
    return "\n".join(lines) + "\n"


def dataset_hash(split: str) -> str:
    cases = load_cases(split)
    return hashlib.sha256(json.dumps(cases, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--code-dir", default=os.path.join(HERE, "..", ".."))
    ap.add_argument("--mode", choices=["det", "hybrid"], default="det")
    ap.add_argument("--split", default="all")
    ap.add_argument("--label", default="run")
    ap.add_argument("--concurrency", type=int, default=3)
    ap.add_argument("--rescore")
    ap.add_argument("--hash", action="store_true", help="print the sha256 of the split and exit")
    args = ap.parse_args()
    if args.hash:
        print(dataset_hash(args.split))
        return
    if args.rescore:
        with open(args.rescore, encoding="utf-8") as fh:
            report = json.load(fh)
        rows, meta = report["rows"], report["meta"]
    else:
        started = time.time()
        rows = asyncio.run(run(args.code_dir, args.mode, args.split, args.concurrency))
        meta = {"label": args.label, "mode": args.mode, "split": args.split, "now": NOW.isoformat(),
                "dataset_sha256": dataset_hash(args.split), "run_at": datetime.now(VN_TZ).isoformat(timespec="seconds"),
                "wall_s": round(time.time() - started, 1), "concurrency": args.concurrency}
    agg = aggregate(rows)
    os.makedirs(REPORTS, exist_ok=True)
    base = os.path.join(REPORTS, f"{meta['label']}_{meta['split']}")
    with open(base + ".json", "w", encoding="utf-8") as fh:
        json.dump({"meta": meta, "summary": {k: v for k, v in agg.items() if k != "failures"}, "rows": rows}, fh,
                  ensure_ascii=False, indent=1)
    with open(base + ".md", "w", encoding="utf-8") as fh:
        fh.write(markdown(meta["label"], meta, agg))
    print(markdown(meta["label"], meta, agg).split("## Failures")[0])


if __name__ == "__main__":
    main()
