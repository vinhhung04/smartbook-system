"""Labeled ANSWER-quality eval for the AI assistant (/assistant) — unlike
eval_assistant_tools.py (which only measures tool selection), this drives the
real endpoint end-to-end (fast path, LLM loop, tool execution, evidence,
grounding) and scores the final answer text for number recall, fact recall,
refusal correctness, citation presence, and number hallucination.

Design note on `required_numbers`: each entry names a JSON *path* into the
tool result the run actually fetches (e.g. "get_overdue_summary.
total_overdue_loans"), not a hardcoded value. Hardcoding "27 phiếu quá hạn"
would rot the moment anyone re-seeds the database and would be unrunnable on
a different dataset - fatal for a reproducible thesis artifact. The tool
result IS the source of truth the answer must be faithful to; this eval
resolves that value at run time and checks the answer against it.

Requires the full stack running (gateway, auth-service, ai-service, Ollama)
- it logs in itself and calls POST /ai/assistant per question.

Usage (from services/ai-service/):
    python eval/eval_assistant_answers.py
Env overrides: SMARTBOOK_GATEWAY_URL (default http://localhost:3000),
ASSISTANT_EVAL_USERNAME/ASSISTANT_EVAL_PASSWORD (default manager01/123456).
"""
from __future__ import annotations

import json
import os
import sys
import uuid
from datetime import datetime, timezone

import httpx

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # this dir, for `import scoring`
import scoring  # noqa: E402

DATASET_PATH = os.path.join(os.path.dirname(__file__), "answer_dataset.json")
REPORTS_DIR = os.path.join(os.path.dirname(__file__), "reports")
GATEWAY_URL = os.getenv("SMARTBOOK_GATEWAY_URL", "http://localhost:3000").rstrip("/")
USERNAME = os.getenv("ASSISTANT_EVAL_USERNAME", "manager01")
PASSWORD = os.getenv("ASSISTANT_EVAL_PASSWORD", "123456")
REQUEST_TIMEOUT_SECONDS = float(os.getenv("ASSISTANT_EVAL_TIMEOUT_SECONDS", "150"))


async def login(client: httpx.AsyncClient) -> str:
    response = await client.post(f"{GATEWAY_URL}/auth/login", json={"identifier": USERNAME, "password": PASSWORD})
    response.raise_for_status()
    token = response.json().get("token")
    if not token:
        raise RuntimeError(f"login succeeded but no token in response: {response.text[:200]}")
    return token


def resolve_path(data: dict, path: str):
    """Walks a dotted path into `data`, indexing dicts by key and lists by
    integer segment. Returns None (never raises) if any step is missing or
    out of range - the caller treats that as "not resolvable this run" and
    skips the check rather than failing it."""
    current = data
    for segment in path.split("."):
        if isinstance(current, dict):
            if segment not in current:
                return None
            current = current[segment]
        elif isinstance(current, list):
            try:
                index = int(segment)
            except ValueError:
                return None
            if index < 0 or index >= len(current):
                return None
            current = current[index]
        else:
            return None
    return current


def resolve_required_numbers(entry: dict, tool_results: dict) -> list[dict]:
    resolved = []
    for item in entry.get("required_numbers") or []:
        value = resolve_path(tool_results, item["field"])
        expected = value if isinstance(value, (int, float)) and not isinstance(value, bool) else None
        resolved.append({"field": item["field"], "expected": expected, "tolerance": item.get("tolerance", 0)})
    return resolved


async def ask_assistant(client: httpx.AsyncClient, token: str, question: str) -> dict:
    # A fresh conversation_id per question: _assistant_cache_key (main.py)
    # keys the response cache on conversation_id, so reusing one across
    # questions would risk serving a cached answer from an earlier question
    # in this same run - a cold path per question is a correctness
    # requirement here, not just tidiness.
    conversation_id = str(uuid.uuid4())
    response = await client.post(
        f"{GATEWAY_URL}/ai/assistant",
        json={"message": question, "conversation_id": conversation_id},
        headers={"Authorization": f"Bearer {token}"},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    return response.json()


def render_report(results: list[dict], summary: dict) -> str:
    lines = [
        "# Assistant answer-quality eval",
        "",
        f"Generated: {datetime.now(timezone.utc).isoformat()}",
        f"Total questions: {summary['total']}",
        "",
        "## Summary",
        "",
        f"- Overall pass rate: {summary['overall_pass_rate']:.1%}",
        f"- Number recall: {_fmt_pct(summary['number_recall'])}",
        f"- Fact recall: {_fmt_pct(summary['fact_recall'])}",
        f"- Citation rate: {_fmt_pct(summary['citation_rate'])}",
        f"- Refusal accuracy: {_fmt_pct(summary['refusal_accuracy'])}",
        f"- Hallucinated-number rate: {summary['hallucinated_number_rate']:.1%}",
        "",
        "## Per-question results",
        "",
        "| Question | Pass | Numbers | Facts | Refusal | Citation | Hallucinated |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in results:
        mark = "✅" if r["overall_pass"] else "❌"
        lines.append(
            f"| {r['question']} | {mark} | {_fmt_pct(r['numbers']['recall'])} | {_fmt_pct(r['facts']['recall'])} | "
            f"{'✅' if r['refusal']['correct'] else '❌'} | {'✅' if r['citation']['correct'] else '❌'} | "
            f"{', '.join(str(n) for n in r['hallucinated_numbers']) or '—'} |"
        )

    misses = [r for r in results if not r["overall_pass"]]
    if misses:
        lines += ["", "## Misses", ""]
        for r in misses:
            lines.append(f"### {r['question']}")
            if r["numbers"]["missing"]:
                lines.append(f"- Missing numbers: {', '.join(r['numbers']['missing'])}")
            if r["facts"]["missing"]:
                lines.append(f"- Missing facts: {', '.join(r['facts']['missing'])}")
            if r["forbidden_hits"]:
                lines.append(f"- Forbidden content present: {', '.join(r['forbidden_hits'])}")
            if not r["refusal"]["correct"]:
                lines.append(f"- Refusal: {r['refusal']['reason']}")
            if not r["citation"]["correct"]:
                lines.append(f"- Citation: {r['citation']['reason']}")
            if r["hallucinated_numbers"]:
                lines.append(f"- Hallucinated numbers: {', '.join(str(n) for n in r['hallucinated_numbers'])}")
            lines.append(f"- Answer: {r.get('answer', '')[:300]}")
            lines.append("")

    return "\n".join(lines) + "\n"


def _fmt_pct(value: float | None) -> str:
    return f"{value:.1%}" if value is not None else "n/a"


async def main() -> None:
    with open(DATASET_PATH, encoding="utf-8") as f:
        dataset = json.load(f)

    async with httpx.AsyncClient() as client:
        print(f"Logging in as {USERNAME}...")
        token = await login(client)

        print(f"Running assistant answer-quality eval on {len(dataset)} questions...")
        results = []
        for index, entry in enumerate(dataset, start=1):
            try:
                response = await ask_assistant(client, token, entry["question"])
            except Exception as exc:  # noqa: BLE001 - one bad question must not abort the whole eval
                print(f"  [{index}/{len(dataset)}] ERROR: {type(exc).__name__}: {exc}")
                response = {"answer": "", "tools_used": [], "data": {}, "evidence": []}

            answer = response.get("answer") or ""
            tool_results = response.get("data") or {}
            tools_used = [call.get("name") for call in (response.get("tools_used") or [])]
            evidence = response.get("evidence") or []

            entry_with_resolved = {**entry, "resolved_numbers": resolve_required_numbers(entry, tool_results)}
            verdict = scoring.score_answer(entry_with_resolved, answer, tool_results, tools_used, evidence)
            verdict["answer"] = answer
            verdict["tools_used"] = tools_used

            print(f"  [{index}/{len(dataset)}] {entry['question'][:60]!r} -> "
                  f"{'PASS' if verdict['overall_pass'] else 'FAIL'} (tools={tools_used})")
            results.append(verdict)

    summary = scoring.aggregate_answer_scores(results)
    print(json.dumps(summary, indent=2, ensure_ascii=False))

    os.makedirs(REPORTS_DIR, exist_ok=True)
    report_path = os.path.join(REPORTS_DIR, f"assistant_answers_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md")
    with open(report_path, "w", encoding="utf-8") as f:
        f.write(render_report(results, summary))
    print(f"\nReport written to {report_path}")


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
