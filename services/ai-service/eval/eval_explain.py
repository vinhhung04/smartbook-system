"""Explainable AI 2.0 eval: quality of the copilot's ANSWERS (not its tool
choice, which eval_copilot.py measures) on explain_dataset.json.

Same in-process harness as eval_copilot.py (real /assistant and
/assistant/stream coroutines of a given code tree, live data, live LLM,
limiter patched out, throwaway SQLite conversations), so a baseline tree and
the upgraded tree are graded by one scorer:

    docker run --rm --network smartbook-system_default --env-file .env \
      -v <code tree>:/code -v services/ai-service/eval:/evalh smartbook-system-ai-service \
      python /evalh/eval_explain.py --code-dir /code --label after

Reference answers: each dataset turn names GOLD derivations; a derivation reads
the tool data of that same turn (e.g. "riskiest_wh" = the first warehouse under
the fixed risk rule), so the reference always matches the live data the
answer was written from. A turn whose tools did not fetch the data a gold fact
needs scores that fact as missing.

Metrics (all text heuristics, identical for both trees - see README §5):
- relevance: the lead gold fact appears in the opening ~250 characters;
- evidence coverage: share of gold facts the answer cites;
- numerical accuracy: answers whose numbers all exist in the tool data
  (rag.unverified_numbers of the tree under test), and numeric gold recall;
- faithfulness: no overclaiming wording (this scorer's own lists, negation-
  aware) and causal answers hedged;
- readability: length per mode, words per sentence, repeated numbers, filler;
- actionability: advice turns name the option, say "nên/đề xuất" and give a
  next step or risk;
- style adherence for multi-turn "kỹ hơn / ngắn gọn / dễ hiểu / vì sao không";
- missing data / no permission / ambiguity handling;
- duplication between the answer text and the recommendation cards;
- streaming vs non-streaming consistency on a subset;
- explanation payload checks (only meaningful for trees that return one).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
import unicodedata
import uuid
from datetime import datetime, timezone

import httpx

EVAL_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, EVAL_DIR)
import eval_copilot as ec  # noqa: E402 - shares the harness (load_code, login, call_*)

ANALYTIC_MODES = {"analysis", "comparison", "causal", "decision", "what_if", "ranking"}
STREAM_SUBSET = ["an-01", "cp-01", "cp-02", "ca-01", "de-01", "de-02", "wi-01", "wi-03", "lk-02", "na-01"]


def norm(text: str | None) -> str:
    # Markdown emphasis ("Kho **HCM Chinh**") must not split a name.
    text = re.sub(r"[*_`]+", "", text or "")
    text = unicodedata.normalize("NFD", text.lower().replace("đ", "d"))
    return re.sub(r"\s+", " ", "".join(ch for ch in text if unicodedata.category(ch) != "Mn")).strip()


# ── gold derivations ─────────────────────────────────────────────────────────

def _tool(data: dict, name: str):
    for key, value in (data or {}).items():
        if key.split("#")[0] == name and not (isinstance(value, dict) and value.get("error")):
            return value
    return None


def _at(obj, *path):
    for p in path:
        if isinstance(p, int):
            if not isinstance(obj, list) or len(obj) <= p:
                return None
            obj = obj[p]
        else:
            if not isinstance(obj, dict):
                return None
            obj = obj.get(p)
    return obj


def _first(*values):
    return next((v for v in values if v is not None), None)


def _risk_rows(d: dict) -> list[dict]:
    ranking = _at(_tool(d, "compare_warehouses"), "ranking")
    if ranking:
        return ranking
    rows = _tool(d, "get_warehouse_stock_risk")
    if isinstance(rows, list):
        return sorted([r for r in rows if isinstance(r, dict)], key=lambda r: (
            -(r.get("out_of_stock_variants") or 0), -(r.get("low_stock_variants") or 0), r.get("total_available_qty") or 0))
    return []


def _reorder_items(d: dict) -> list[dict]:
    r = _tool(d, "get_reorder_suggestions")
    items = [x for x in (_at(r, "items") or []) if isinstance(x, dict)]
    if isinstance(r, dict) and r.get("budget"):
        items = [x for x in items if x.get("within_budget")]
    return items


def _scenario(d: dict, index: int):
    return _at(_tool(d, "simulate_reorder_budget"), "scenarios", index)


def _shortage(d: dict):
    return _tool(d, "explain_warehouse_shortage")


def _loans(d: dict, key: str):
    return _at(_tool(d, "compare_borrow_periods"), "metrics", "loans", key)


def _abs(value):
    return abs(value) if isinstance(value, (int, float)) else value


GOLD = {
    "kpi_titles": lambda d: _at(_tool(d, "get_dashboard_kpis"), "total_titles"),
    "kpi_overdue": lambda d: _at(_tool(d, "get_dashboard_kpis"), "overdue_loans"),
    "kpi_active_loans": lambda d: _at(_tool(d, "get_dashboard_kpis"), "active_loans"),
    "overdue_total": lambda d: _first(_at(_tool(d, "get_overdue_summary"), "total_overdue_loans"),
                                      _at(_tool(d, "get_dashboard_kpis"), "overdue_loans")),
    "overdue_avg": lambda d: _at(_tool(d, "get_overdue_summary"), "average_overdue_days"),
    "top1_title": lambda d: _first(_at(_tool(d, "get_top_books"), 0, "title"), _at(_tool(d, "compare_top_books"), "current", 0, "title")),
    "top1_count": lambda d: _first(_at(_tool(d, "get_top_books"), 0, "borrow_count"),
                                   _at(_tool(d, "compare_top_books"), "current", 0, "borrow_count")),
    "fines_unpaid": lambda d: _first(_at(_tool(d, "get_fine_summary"), "total_unpaid"),
                                     _at(_tool(d, "get_dashboard_kpis"), "unpaid_fine_amount")),
    "reservation_rate": lambda d: _first(_at(_tool(d, "get_reservation_funnel"), "conversion_rate"),
                                         _at(_tool(d, "get_dashboard_kpis"), "reservation_conversion_rate")),
    "reservation_total": lambda d: _at(_tool(d, "get_reservation_funnel"), "total"),
    "riskiest_wh": lambda d: _at(_risk_rows(d), 0, "warehouse_name"),
    "riskiest_wh_oos": lambda d: _at(_risk_rows(d), 0, "out_of_stock_variants"),
    "second_wh_oos": lambda d: _at(_risk_rows(d), 1, "out_of_stock_variants"),
    "hcm_low_oos": lambda d: _first(_at(_tool(d, "get_warehouse_low_stock_items"), "out_of_stock_count"),
                                    _at(_shortage(d), "summary", "out_of_stock_items")),
    "loans_current": lambda d: _loans(d, "current"),
    "loans_previous": lambda d: _loans(d, "previous"),
    "loans_per_day_change": lambda d: _abs(_loans(d, "per_day_change_pct")),
    "top_current_leader": lambda d: _at(_tool(d, "compare_top_books"), "current", 0, "title"),
    "shortage_low": lambda d: _first(_at(_shortage(d), "summary", "low_stock_items"),
                                     _at(_tool(d, "get_warehouse_low_stock_items"), "total_items")),
    "shortage_top_demand_title": lambda d: _at(sorted([x for x in _at(_shortage(d), "items") or []
                                                       if (x.get("borrow_count") or 0) > 0],
                                                      key=lambda x: -(x.get("borrow_count") or 0)), 0, "title"),
    "item_available": lambda d: _at(_tool(d, "explain_reorder_item"), "item", "available_qty"),
    "item_reorder_qty": lambda d: _at(_tool(d, "explain_reorder_item"), "item", "suggested_reorder_qty"),
    "reorder_first_title": lambda d: _first(_at(_reorder_items(d), 0, "title"),
                                            _at(_tool(d, "explain_reorder_item"), "item", "title")),
    "reorder_first_available": lambda d: _first(_at(_reorder_items(d), 0, "available_qty"),
                                                _at(_tool(d, "explain_reorder_item"), "item", "available_qty")),
    "reorder_second_title": lambda d: _at(_reorder_items(d), 1, "title"),
    "demand_first_title": lambda d: _at(_tool(d, "analyze_demand_vs_stock"), "rows", 0, "title"),
    "demand_flagged": lambda d: _at(_tool(d, "analyze_demand_vs_stock"), "counts", "flagged"),
    "priority_first_value": lambda d: _at(_tool(d, "rank_priority_tasks"), "tasks", 0, "value"),
    "weeding_total": lambda d: _first(_at(_tool(d, "get_weeding_suggestions"), "summary", "total_items")),
    "sim_need_cost": lambda d: _at(_tool(d, "simulate_reorder_budget"), "full_need", "estimated_total_cost"),
    "sim_funded_cost": lambda d: _first(_at(_scenario(d, 0), "funded_cost"),
                                        _at(_tool(d, "get_reorder_suggestions"), "budget", "funded_cost")),
    "sim_funded_lines": lambda d: _at(_scenario(d, 0), "funded_lines"),
    "sim_unfunded_high": lambda d: _at(_scenario(d, 0), "unfunded_high_priority"),
    "sim_second_funded_cost": lambda d: _at(_scenario(d, 1), "funded_cost"),
    "sim_second_unfunded_high": lambda d: _at(_scenario(d, 1), "unfunded_high_priority"),
}


def gold_value(name: str, data: dict):
    try:
        return GOLD[name](data or {})
    except Exception:  # noqa: BLE001 - an odd payload only means "not derivable"
        return None


_NUM_TOKEN = re.compile(r"\d[\d.,]*\d|\d")


def answer_numbers(text: str) -> list[float]:
    out = []
    for token in _NUM_TOKEN.findall(text or ""):
        for candidate in (token.replace(",", ""), token.replace(".", "").replace(",", ".")):
            try:
                out.append(float(candidate))
            except ValueError:
                pass
    return out


def fact_in(value, text: str) -> bool:
    if value is None:
        return False
    if isinstance(value, bool):
        return False
    if isinstance(value, (int, float)):
        target = abs(float(value))
        tolerance = max(0.01 * target, 0.051)
        return any(abs(n - target) <= tolerance for n in answer_numbers(text))
    return norm(str(value)) in norm(text)


# ── wording checks (this scorer's own lists) ─────────────────────────────────

_NEG = re.compile(r"\b(khong|chua|chang|kho)\b")
_CLAUSE = re.compile(r"[.;:!?\n,]")
OVERCLAIM = {
    "causal": re.compile(r"(chu yeu (la )?do|nguyen nhan (chinh|chu yeu)|chinh la do|\bla do\b|bat nguon tu|\bgay ra\b|dan den)"),
    "certainty": re.compile(r"\b(?<!muc )(?<!do )(chac chan|ro rang la|hien nhien)\b"),
    "optimal": re.compile(r"(toi uu(?! hoa)|tot nhat)"),
    "full_coverage": re.compile(r"(dap ung (toan bo|day du|du|het|100%)|giai quyet (hoan toan|triet de))"),
}
_QUALIFIED = re.compile(r"(duoc liet ke|trong danh sach|duoc tinh|dong dau)")
HEDGES = ["co the", "di kem", "tuong quan", "du lieu cho thay", "chua du", "chua the khang dinh", "lien quan",
          "nhieu kha nang", "chua chung minh", "khong khang dinh", "chua khang dinh", "yeu to"]
FILLER = re.compile(r"(duoi day la|hy vong|neu ban can them|ban co muon|hay cho toi biet neu|rat vui duoc)")
ADVICE = re.compile(r"\b(nen|de xuat|uu tien|khuyen nghi)\b")
NEXT_STEP = re.compile(r"(buoc tiep theo|tiep theo|rui ro|luu y|xac nhan|lap phieu|can nhac|theo doi|lien he)")
PLAIN = re.compile(r"(tuc la|nghia la|hieu don gian|noi cach khac|vi du|nhu kieu)")
NO_ACCESS = ["quyen", "chua lay duoc", "khong lay duoc", "khong co du lieu", "khong truy cap"]
NOT_FOUND = re.compile(r"(khong nam trong|khong co trong|khong tim thay|chua co trong|khong co sach|khong co cuon)")
CLARIFY = re.compile(r"(kho nao|sach nao|noi dung nao|chi so nao|ban muon|cu the hon|lam ro)")


def hits(pattern: re.Pattern, text: str, qualified: re.Pattern | None = None) -> list[str]:
    out = []
    for m in pattern.finditer(text):
        clause = _CLAUSE.split(text[max(0, m.start() - 45):m.start()])[-1]
        if _NEG.search(clause):
            continue
        if qualified and qualified.search(text[m.end():m.end() + 70]):
            continue
        out.append(m.group(0))
    return out


def coverage_incomplete(data: dict) -> bool:
    sim = _tool(data, "simulate_reorder_budget")
    if isinstance(sim, dict):
        return bool(sim.get("items_not_listed")) or any(
            (s.get("unfunded_high_priority") or 0) > 0 for s in sim.get("scenarios") or [] if isinstance(s, dict))
    reorder = _tool(data, "get_reorder_suggestions")
    return isinstance(reorder, dict) and bool(reorder.get("budget"))


def overclaims(answer: str, mode: str | None, data: dict) -> list[str]:
    text = norm(answer)
    found = []
    if mode == "causal":
        found += hits(OVERCLAIM["causal"], text)
    if mode in ("causal", "what_if"):
        found += hits(OVERCLAIM["certainty"], text)
    if mode in ("decision", "what_if", "ranking"):
        found += hits(OVERCLAIM["optimal"], text)
    if coverage_incomplete(data):
        found += hits(OVERCLAIM["full_coverage"], text, _QUALIFIED)
    return found


def sentences(text: str) -> list[str]:
    return [s for s in re.split(r"[.!?\n]+", text or "") if len(s.split()) >= 2]


def dup_number_rate(text: str) -> float | None:
    tokens = [t for t in _NUM_TOKEN.findall(text or "") if len(t.replace(".", "").replace(",", "")) >= 2]
    if not tokens:
        return None
    return (len(tokens) - len(set(tokens))) / len(tokens)


def card_duplication(answer: str, recommendations: list | None) -> float | None:
    values = []
    for rec in recommendations or []:
        for metric in rec.get("metrics") or []:
            v = metric.get("value")
            if isinstance(v, (int, float)) and not isinstance(v, bool) and abs(v) >= 10:
                values.append(v)
    if not values:
        return None
    return sum(1 for v in values if fact_in(v, answer)) / len(values)


# ── per turn ─────────────────────────────────────────────────────────────────

def score_turn(turn: dict, res: dict, prev: dict | None, mods, context: dict | None = None) -> dict:
    """`context`: tool data of the earlier turns of the conversation - a
    follow-up answered from history (no new tool call) is graded against the
    data it was actually written from."""
    answer = res.get("answer") or ""
    data = {**(context or {}), **(res.get("data") or {})}
    mode = turn.get("mode")
    lead_ok = lead_gold = None
    if turn.get("lead"):
        lead_gold = gold_value(turn["lead"], data)
        lead_ok = fact_in(lead_gold, norm(answer)[:250])
    facts = {name: gold_value(name, data) for name in turn.get("facts") or []}
    covered = {name: fact_in(value, answer) for name, value in facts.items()}
    numeric = {n: c for n, c in covered.items() if isinstance(facts[n], (int, float)) and not isinstance(facts[n], bool)}
    n_nums, n_unverified = ec.grounded_numbers(mods, answer, data, turn["q"], res.get("evidence"))
    text = norm(answer)
    sents = sentences(answer)
    oc = overclaims(answer, mode, data)
    row = {
        "q": turn["q"], "mode": mode, "status": res.get("status"), "latency_s": res.get("latency_s"),
        "tools": [c["name"] if isinstance(c, dict) else c.name for c in res.get("tools_used") or []],
        "chars": len(answer), "words_per_sentence": (sum(len(s.split()) for s in sents) / len(sents)) if sents else None,
        "dup_numbers": dup_number_rate(answer), "filler": bool(FILLER.search(text)),
        "technical_fields": bool(ec.TECHNICAL_FIELDS.search(answer)),
        "lead_ok": lead_ok, "lead_gold": lead_gold, "facts": {n: {"gold": facts[n], "cited": covered[n]} for n in facts},
        "coverage": (sum(covered.values()) / len(covered)) if covered else None,
        "numeric_recall": (sum(numeric.values()) / len(numeric)) if numeric else None,
        "numbers": n_nums, "unverified_numbers": n_unverified,
        "overclaims": oc,
        "hedged": any(h in text for h in HEDGES) if turn.get("hedge") else None,
        "card_dup": card_duplication(answer, res.get("recommendations")),
        "llm_calls": len(((res.get("debug") or {}).get("llm_calls")) or []),
        "answer": answer,
    }
    if turn.get("advice"):
        option_named = any(covered.values()) if covered else True
        row["actionable"] = bool(ADVICE.search(text)) and option_named and bool(NEXT_STEP.search(text))
    if prev is not None:
        prev_len = len(prev.get("answer") or "")
        if turn.get("brief"):
            row["style_ok"] = len(answer) <= 450 and len(answer) < prev_len
        if turn.get("deep"):
            row["style_ok"] = len(answer) > prev_len
        if turn.get("plain"):
            row["style_ok"] = bool(PLAIN.search(text))
        if turn.get("why_not"):
            row["style_ok"] = bool(covered) and any(covered.values())
    if turn.get("no_access"):
        row["no_access_ok"] = any(m in text for m in NO_ACCESS) and n_unverified == 0
    if turn.get("not_found"):
        row["not_found_ok"] = bool(NOT_FOUND.search(text))
    if turn.get("clarify"):
        row["clarify_ok"] = "?" in answer and bool(CLARIFY.search(text)) and not row["tools"]
    expl = res.get("explanation")
    plan = res.get("plan") or {}
    row["has_explanation_field"] = "explanation" in res
    row["plan_mode"] = plan.get("answer_mode")
    if isinstance(expl, dict):
        claims = expl.get("claims") or []
        backed = [c for c in claims if c.get("kind") in ("FACT", "INFERENCE")]
        row["explanation"] = {
            "claims": len(claims), "kinds": sorted({c.get("kind") for c in claims}),
            "evidence_backed": (sum(1 for c in backed if c.get("evidence")) / len(backed)) if backed else None,
            "inference_has_certainty": all(c.get("certainty") for c in claims if c.get("kind") == "INFERENCE"),
            "has_unknown": any(c.get("kind") == "UNKNOWN" for c in claims),
            "language_flags": expl.get("language_flags") or [],
            "headline": expl.get("headline"),
        }
    return row


async def run_case(mods, case: dict, tokens: dict, sem: asyncio.Semaphore) -> list[dict]:
    async with sem:
        cid = str(uuid.uuid4())
        rows, prev, context = [], None, {}
        for idx, turn in enumerate(case["turns"]):
            res = await ec.call_assistant(mods, tokens[case["role"]], turn["q"], cid)
            row = score_turn(turn, res, prev, mods, context)
            context.update(res.get("data") or {})
            row.update({"case_id": case["id"], "category": case["category"], "turn": idx})
            rows.append(row)
            prev = res
        print(f"  {case['id']}: " + " | ".join(f"{r['status']} {','.join(r['tools']) or '-'} {r['latency_s']}s"
                                               for r in rows), flush=True)
        return rows


async def stream_consistency(mods, cases: list[dict], tokens: dict) -> list[dict]:
    out = []
    by_id = {c["id"]: c for c in cases}
    for case_id in STREAM_SUBSET:
        case = by_id.get(case_id)
        if not case:
            continue
        turn = case["turns"][0]
        a = await ec.call_assistant(mods, tokens[case["role"]], turn["q"], str(uuid.uuid4()))
        s = await ec.call_stream(mods, tokens[case["role"]], turn["q"], str(uuid.uuid4()))
        tools = [sorted({c["name"] if isinstance(c, dict) else c.name for c in r.get("tools_used") or []}) for r in (a, s)]
        keys = [set(a) - {"latency_s", "status", "debug"}, set(s) - {"latency_s", "status", "debug", "token_events"}]
        cov = []
        for r in (a, s):
            facts = [gold_value(n, r.get("data") or {}) for n in turn.get("facts") or []]
            cov.append(round(sum(fact_in(v, r.get("answer") or "") for v in facts) / len(facts), 3) if facts else None)
        expl = [r.get("explanation") for r in (a, s)]
        claims = [sorted((c["kind"], c["statement"]) for c in (e or {}).get("claims") or []) for e in expl]
        out.append({
            "case_id": case_id, "q": turn["q"], "status": [a.get("status"), s.get("status")],
            "tools_equal": tools[0] == tools[1], "schema_equal": keys[0] == keys[1],
            "schema_diff": sorted(keys[0] ^ keys[1]), "coverage": cov, "coverage_equal": cov[0] == cov[1],
            "explanation_equal": claims[0] == claims[1] if any(expl) else None,
            "headline_equal": ((expl[0] or {}).get("headline") == (expl[1] or {}).get("headline")) if any(expl) else None,
        })
        print(f"  stream {case_id}: tools_equal={out[-1]['tools_equal']} expl_equal={out[-1]['explanation_equal']}", flush=True)
    return out


# ── summary ──────────────────────────────────────────────────────────────────

def _rate(values):
    values = [v for v in values if v is not None]
    return round(sum(1 for v in values if v) / len(values), 4) if values else None


def _mean(values):
    values = [v for v in values if v is not None]
    return round(sum(values) / len(values), 4) if values else None


def _median(values):
    values = sorted(v for v in values if v is not None)
    return values[len(values) // 2] if values else None


def summarize(rows: list[dict], stream: list[dict]) -> dict:
    ok = [r for r in rows if r["status"] == 200]
    analytic = [r for r in ok if r["mode"] in ANALYTIC_MODES and "no_access_ok" not in r]
    with_data = [r for r in ok if r["numbers"] is not None]
    by_mode = {}
    for r in ok:
        by_mode.setdefault(r["mode"] or "-", []).append(r["chars"])
    expl_rows = [r for r in ok if r["mode"] in ANALYTIC_MODES and r["has_explanation_field"]]
    latencies = sorted(r["latency_s"] for r in rows if r["latency_s"] is not None)
    return {
        "turns": len(rows),
        "http_ok_rate": _rate([r["status"] == 200 for r in rows]),
        "answer_relevance": _rate([r["lead_ok"] for r in ok]),
        "evidence_coverage": _mean([r["coverage"] for r in ok]),
        "numeric_fact_recall": _mean([r["numeric_recall"] for r in ok]),
        "answers_with_unverified_numbers": _rate([r["unverified_numbers"] > 0 for r in with_data if r["numbers"]]),
        "faithfulness_no_overclaim": _rate([not r["overclaims"] for r in analytic]),
        "causal_hedged": _rate([r["hedged"] for r in ok]),
        "faithfulness": _rate([not r["overclaims"] and r["hedged"] is not False for r in analytic]),
        "actionability": _rate([r.get("actionable") for r in ok]),
        "style_adherence": _rate([r.get("style_ok") for r in ok]),
        "no_access_handled": _rate([r.get("no_access_ok") for r in ok]),
        "not_found_handled": _rate([r.get("not_found_ok") for r in ok]),
        "clarification_handled": _rate([r.get("clarify_ok") for r in ok]),
        "median_chars_by_mode": {m: _median(v) for m, v in sorted(by_mode.items())},
        "median_chars_lookup": _median(by_mode.get("lookup", [])),
        "words_per_sentence": _mean([r["words_per_sentence"] for r in ok]),
        "repeated_number_rate": _mean([r["dup_numbers"] for r in ok]),
        "filler_rate": _rate([r["filler"] for r in ok]),
        "technical_field_rate": _rate([r["technical_fields"] for r in ok]),
        "card_duplication": _mean([r["card_dup"] for r in ok]),
        "explanation_present": _rate([isinstance(r.get("explanation"), dict) for r in expl_rows]) if expl_rows else None,
        "explanation_evidence_backed": _mean([(r.get("explanation") or {}).get("evidence_backed") for r in ok]),
        "explanation_mode_accuracy": _rate([r["plan_mode"] == r["mode"] for r in ok if r["plan_mode"] and r["mode"]]),
        "explanation_language_flags_left": _rate([bool((r.get("explanation") or {}).get("language_flags"))
                                                   for r in ok if r.get("explanation")]),
        "stream_tools_equal": _rate([s["tools_equal"] for s in stream]),
        "stream_schema_equal": _rate([s["schema_equal"] for s in stream]),
        "stream_coverage_equal": _rate([s["coverage_equal"] for s in stream]),
        "stream_explanation_equal": _rate([s["explanation_equal"] for s in stream]),
        "latency_p50_s": latencies[len(latencies) // 2] if latencies else None,
        "latency_p90_s": latencies[int(len(latencies) * 0.9)] if latencies else None,
        "avg_llm_calls": _mean([r["llm_calls"] for r in rows]),
    }


def render_md(label: str, meta: dict, overall: dict, cats: dict, stream: list[dict], rows: list[dict]) -> str:
    lines = [f"# Explainable AI eval - {label}", "", f"Generated: {meta['generated_at']}  ", f"Code dir: `{meta['code_dir']}`  ",
             f"Model: {meta.get('model')}  ", f"Turns: {overall['turns']}", "", "## Overall", "", "| Metric | Value |", "|---|---|"]
    lines += [f"| {k} | {json.dumps(v, ensure_ascii=False) if isinstance(v, dict) else v} |" for k, v in overall.items()]
    lines += ["", "## By category", "", "| Category | turns | relevance | coverage | unverified | no overclaim | actionable | style | p50 chars |",
              "|---|---|---|---|---|---|---|---|---|"]
    for cat, s in cats.items():
        lines.append(f"| {cat} | {s['turns']} | {s['answer_relevance']} | {s['evidence_coverage']} | "
                     f"{s['answers_with_unverified_numbers']} | {s['faithfulness_no_overclaim']} | {s['actionability']} | "
                     f"{s['style_adherence']} | {_median([r['chars'] for r in rows if r['category'] == cat])} |")
    lines += ["", "## Streaming vs non-streaming", "", "| Case | tools | schema | coverage | explanation |", "|---|---|---|---|---|"]
    for s in stream:
        lines.append(f"| {s['case_id']} | {s['tools_equal']} | {s['schema_equal']} | {s['coverage']} | {s['explanation_equal']} |")
    lines += ["", "## Turns", ""]
    for r in rows:
        flags = []
        if r["overclaims"]:
            flags.append("overclaim=" + "/".join(r["overclaims"]))
        if r["unverified_numbers"]:
            flags.append(f"unverified={r['unverified_numbers']}")
        for key in ("lead_ok", "actionable", "style_ok", "no_access_ok", "not_found_ok", "clarify_ok", "hedged"):
            if r.get(key) is False:
                flags.append(f"{key}=False")
        lines += [f"### {r['case_id']}#{r['turn']} — {r['q']}", "",
                  f"tools: {', '.join(r['tools']) or '—'} · {r['chars']} ký tự · coverage {r['coverage']} · "
                  f"{'; '.join(flags) or 'ok'}", "", "> " + r["answer"].replace("\n", "\n> "), ""]
    return "\n".join(lines) + "\n"


async def amain(args) -> None:
    mods = ec.load_code(args.code_dir)
    await mods.create_tables()
    with open(os.path.join(EVAL_DIR, "explain_dataset.json"), encoding="utf-8") as f:
        cases = json.load(f)["cases"]
    if args.only:
        wanted = set(args.only.split(","))
        cases = [c for c in cases if c["category"] in wanted or c["id"] in wanted]
    gateway = os.getenv("SMARTBOOK_GATEWAY_URL", "http://api-gateway:3000").rstrip("/")
    password = os.getenv("COPILOT_EVAL_PASSWORD", "123456")
    async with httpx.AsyncClient(timeout=30) as client:
        tokens = {
            "ADMIN": await ec.login(client, gateway, os.getenv("COPILOT_EVAL_ADMIN", "hung"), password),
            "WAREHOUSE_MANAGER": await ec.login(client, gateway, os.getenv("COPILOT_EVAL_MANAGER", "manager01"), password),
        }
    sem = asyncio.Semaphore(args.concurrency)
    print(f"Running {len(cases)} cases ({sum(len(c['turns']) for c in cases)} turns) on {args.code_dir}", flush=True)
    results = await asyncio.gather(*(run_case(mods, c, tokens, sem) for c in cases))
    rows = [r for rs in results for r in rs]
    stream = await stream_consistency(mods, cases, tokens) if not args.skip_stream else []
    overall = summarize(rows, stream)
    cats = {}
    for cat in sorted({r["category"] for r in rows}):
        cats[cat] = summarize([r for r in rows if r["category"] == cat], [])
    provider = mods.main._get_assistant_provider()
    meta = {"generated_at": datetime.now(timezone.utc).isoformat(), "code_dir": args.code_dir, "label": args.label,
            "model": getattr(provider, "model", None), "today_vn": datetime.now(ec.VN_TZ).date().isoformat()}
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    out_dir = args.out_dir or os.path.join(EVAL_DIR, "reports")
    os.makedirs(out_dir, exist_ok=True)
    base = os.path.join(out_dir, f"explain_{args.label}_{stamp}")
    with open(base + ".json", "w", encoding="utf-8") as f:
        json.dump({"meta": meta, "overall": overall, "by_category": cats, "stream": stream, "rows": rows},
                  f, ensure_ascii=False, indent=1, default=str)
    with open(base + ".md", "w", encoding="utf-8") as f:
        f.write(render_md(args.label, meta, overall, cats, stream, rows))
    print(json.dumps(overall, ensure_ascii=False, indent=1))
    print(f"Wrote {base}.md/.json")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--code-dir", required=True)
    parser.add_argument("--label", required=True)
    parser.add_argument("--concurrency", type=int, default=3)
    parser.add_argument("--only", default="")
    parser.add_argument("--skip-stream", action="store_true")
    parser.add_argument("--out-dir", default="")
    asyncio.run(amain(parser.parse_args()))


if __name__ == "__main__":
    main()
