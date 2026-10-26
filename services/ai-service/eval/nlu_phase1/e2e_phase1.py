"""End-to-end check of Phase 1 through the real /assistant code path.

Runs the test-split conversations of nlu_phase1_questions.jsonl through
main.assistant() of the given code tree twice - COPILOT_SEMANTIC_PLANNER off
and on - against the live stack (gateway, analytics, OpenRouter). Reuses
eval_copilot.py's harness (in-process endpoint, rate limiter patched, throwaway
SQLite conversation store, real JWTs).

Measures what the planner-level benchmark cannot: end-to-end latency, LLM calls
and cost per turn (answering + planning), and capability coverage of the tools
that were actually used - including tools the answering LLM chose by itself
when the plan had none (so the "off" baseline gets credit for those).

    docker run --rm --network smartbook-system_default -e ... \
      -v <ai-service>:/code -v <ai-service>/eval:/evalh smartbook-system-ai-service \
      python /evalh/nlu_phase1/e2e_phase1.py --code-dir /code
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import random
import statistics
import sys
import time
import uuid
from datetime import datetime, timezone

import httpx

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
import eval_copilot as harness  # noqa: E402
from eval_nlu_phase1 import TOOL_CAPS, load_cases, norm_caps, _pct  # noqa: E402

GROUPS = {"simple", "paraphrase", "multi_intent", "context", "informal", "cwi"}


async def run_conversation(mods, case: dict, token: str, flag: bool, lock: asyncio.Lock) -> list[dict]:
    cid = str(uuid.uuid4())
    rows = []
    for i, turn in enumerate(case["turns"]):
        async with lock:  # the flag is module state: one turn at a time per flag value
            mods.main.copilot_semantic_planner.ENABLED = flag
            out = await harness.call_assistant(mods, token, turn["q"], cid)
        tools = [t.get("name") for t in out.get("tools_used") or []]
        plan = out.get("plan") or {}
        semantic = plan.get("semantic") or {}
        answer_calls = (out.get("debug") or {}).get("llm_calls") or []
        planner_calls = semantic.get("llm_calls") or []
        gold = set(turn.get("caps") or [])
        used = set().union(*[TOOL_CAPS.get(t, set()) for t in tools]) if tools else set()
        rows.append({
            "case": case["id"], "group": case["group"], "turn": i, "q": turn["q"], "flag": flag,
            "setup": bool(turn.get("setup")), "status": out.get("status"), "latency_s": out.get("latency_s"),
            "tools": tools, "planned": [t.get("name") for t in plan.get("required_tools") or []],
            "routed": bool(semantic.get("routed")), "decision": semantic.get("decision"),
            "planner_ms": semantic.get("latency_ms"),
            "llm_calls": len(answer_calls) + len(planner_calls),
            "cost_usd": sum((c or {}).get("costUsd") or 0 for c in answer_calls + planner_calls),
            "tokens": sum(((c or {}).get("prompt_tokens") or 0) + ((c or {}).get("completion_tokens") or 0)
                          for c in answer_calls + planner_calls),
            "gold": sorted(gold), "coverage": (len(norm_caps(gold) & used) / len(gold)) if gold else None,
            "verification": (out.get("verification") or {}).get("status") if isinstance(out.get("verification"), dict)
            else None,
            "grounding_warning": bool(out.get("grounding_warning")), "answer": (out.get("answer") or "")[:600],
        })
    return rows


def summarize(rows: list[dict]) -> dict:
    out = {}
    for flag in (False, True):
        rs = [r for r in rows if r["flag"] is flag and not r["setup"]]
        lat = [r["latency_s"] for r in rs if r["status"] == 200]
        routed_ids = {(r["case"], r["turn"]) for r in rows if r["flag"] and r["routed"]}
        routed = [r["latency_s"] for r in rs if (r["case"], r["turn"]) in routed_ids and r["status"] == 200]
        cov = [r["coverage"] for r in rs if r["coverage"] is not None]
        out["on" if flag else "off"] = {
            "turns": len(rs), "errors": sum(1 for r in rs if r["status"] != 200),
            "latency_s": {"p50": _pct(lat, 0.5), "p95": _pct(lat, 0.95)},
            "latency_s_on_routed_turns": {"p50": _pct(routed, 0.5), "p95": _pct(routed, 0.95), "n": len(routed)},
            "llm_calls_per_turn": round(statistics.mean(r["llm_calls"] for r in rs), 2) if rs else None,
            "cost_usd_per_turn": round(statistics.mean(r["cost_usd"] for r in rs), 6) if rs else None,
            "tokens_per_turn": round(statistics.mean(r["tokens"] for r in rs)) if rs else None,
            "tool_capability_coverage_mean": round(statistics.mean(cov), 3) if cov else None,
            "full_coverage": f"{sum(1 for c in cov if c == 1.0)}/{len(cov)}",
            "grounding_warnings": sum(1 for r in rs if r["grounding_warning"]),
            "routed_turns": sum(1 for r in rs if r["routed"]),
        }
    return out


async def amain(args) -> None:
    mods = harness.load_code(args.code_dir)
    await mods.create_tables()
    cases = [c for c in load_cases("test") if c["group"] in GROUPS]
    gateway = os.getenv("SMARTBOOK_GATEWAY_URL", "http://api-gateway:3000").rstrip("/")
    async with httpx.AsyncClient(timeout=30) as client:
        token = await harness.login(client, gateway, os.getenv("COPILOT_EVAL_ADMIN", "hung"),
                                    os.getenv("COPILOT_EVAL_PASSWORD", "123456"))
    random.seed(20261026)
    # Alternate which flag value runs first so the shared tool cache warms both equally.
    jobs = []
    for c in cases:
        order = [False, True] if random.random() < 0.5 else [True, False]
        jobs.append((c, order))
    lock = asyncio.Lock()
    sem = asyncio.Semaphore(args.concurrency)
    started = time.time()

    async def job(c, order):
        async with sem:
            rows = []
            for flag in order:
                rows += await run_conversation(mods, c, token, flag, lock)
            return rows
    results = await asyncio.gather(*(job(c, o) for c, o in jobs))
    rows = [r for rs in results for r in rs]
    summary = summarize(rows)
    meta = {"generated_at": datetime.now(timezone.utc).isoformat(), "code_dir": args.code_dir,
            "cases": len(cases), "wall_s": round(time.time() - started, 1),
            "note": "one turn at a time (flag is module state); latency includes tool calls to the live stack"}
    os.makedirs(os.path.join(HERE, "..", "reports", "nlu_phase1"), exist_ok=True)
    path = os.path.join(HERE, "..", "reports", "nlu_phase1", f"e2e_{args.label}.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump({"meta": meta, "summary": summary, "rows": rows}, fh, ensure_ascii=False, indent=1)
    print(json.dumps({"meta": meta, "summary": summary}, ensure_ascii=False, indent=1))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--code-dir", required=True)
    ap.add_argument("--label", default="run1")
    ap.add_argument("--concurrency", type=int, default=2)
    asyncio.run(amain(ap.parse_args()))


if __name__ == "__main__":
    main()
