"""Labeled tool-selection accuracy eval for the AI assistant (/assistant).

Drives one Ollama tool-calling round directly - same model, system prompt and
tool schemas the real /assistant endpoint uses (imported from main.py) - but
skips the auth/conversation/caching layers around it, since only the model's
tool choice is under test here, not the whole endpoint.

Requires a running Ollama with ASSISTANT_MODEL pulled (defaults to
llama3.1:8b-instruct-q4_0). No auth token, no gateway, no other services
needed - set OLLAMA_HOST if Ollama isn't at the in-Docker default.

Usage (from services/ai-service/):
    python eval/eval_assistant_tools.py
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from datetime import datetime, timezone

import ollama

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # ai-service root, for `import main`
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # this dir, for `import scoring`

import scoring  # noqa: E402
from main import ANALYTICS_TOOLS, ASSISTANT_MAX_TOOL_ROUNDS, ASSISTANT_MODEL, ASSISTANT_SYSTEM_PROMPT, OLLAMA_HOST  # noqa: E402

DATASET_PATH = os.path.join(os.path.dirname(__file__), "assistant_dataset.json")
REPORTS_DIR = os.path.join(os.path.dirname(__file__), "reports")
LLM_TIMEOUT_SECONDS = float(os.getenv("ASSISTANT_LLM_TIMEOUT_SECONDS", "120"))


async def ask_once(question: str) -> list[str]:
    """Runs a single tool-calling round and returns the tool names the model
    chose (empty list if it answered directly without calling any tool)."""
    client = ollama.Client(host=OLLAMA_HOST)
    messages = [
        {"role": "system", "content": ASSISTANT_SYSTEM_PROMPT},
        {"role": "user", "content": question},
    ]
    response = await asyncio.wait_for(
        asyncio.to_thread(
            client.chat,
            model=ASSISTANT_MODEL,
            messages=messages,
            tools=ANALYTICS_TOOLS,
            options={"temperature": 0.2, "num_predict": 200},
        ),
        timeout=LLM_TIMEOUT_SECONDS,
    )
    tool_calls = response["message"].get("tool_calls") or []
    return [call["function"]["name"] for call in tool_calls]


async def ask_multi_round(question: str, max_rounds: int = ASSISTANT_MAX_TOOL_ROUNDS) -> list[str]:
    """Same model/prompt/tools as ask_once, but continues the tool-calling loop
    up to `max_rounds`, feeding back a fixed stub tool result after each round
    so the model has the chance to call MORE tools in a later round - this is
    what /assistant's real loop supports (up to ASSISTANT_MAX_TOOL_ROUNDS) but
    ask_once alone never exercises, since it stops after round 1.

    Returns the union of every distinct tool name called across all rounds, in
    first-called order. Tool results are never actually executed (a fixed
    stub is fed back instead) so this still needs only Ollama - no gateway,
    no other services, matching this script's existing "no other services
    needed" property.
    """
    client = ollama.Client(host=OLLAMA_HOST)
    messages = [
        {"role": "system", "content": ASSISTANT_SYSTEM_PROMPT},
        {"role": "user", "content": question},
    ]
    called: list[str] = []
    for _round in range(max_rounds):
        response = await asyncio.wait_for(
            asyncio.to_thread(
                client.chat,
                model=ASSISTANT_MODEL,
                messages=messages,
                tools=ANALYTICS_TOOLS,
                options={"temperature": 0.2, "num_predict": 200},
            ),
            timeout=LLM_TIMEOUT_SECONDS,
        )
        message = response["message"]
        messages.append(message)
        tool_calls = message.get("tool_calls") or []
        if not tool_calls:
            break
        for call in tool_calls:
            name = call["function"]["name"]
            if name not in called:
                called.append(name)
            messages.append({
                "role": "tool", "tool_name": name,
                "content": json.dumps({"note": "du lieu da duoc lay"}, ensure_ascii=False),
            })
    return called


def render_report(round1_results: list[dict], round1_summary: dict, multi_results: list[dict], multi_summary: dict) -> str:
    lines = [
        "# Assistant tool-selection eval",
        "",
        f"Generated: {datetime.now(timezone.utc).isoformat()}",
        f"Model: {ASSISTANT_MODEL}",
        f"Total questions: {round1_summary['total']}",
        "",
        "## Summary — round 1 only",
        "",
        "(directly comparable to the original single-round baseline report)",
        "",
        f"- Exact match rate: {round1_summary['exact_match_rate']:.1%}",
        f"- Avg precision: {round1_summary['avg_precision']:.1%}",
        f"- Avg recall: {round1_summary['avg_recall']:.1%}",
        "",
        "## Summary — multi-round (up to ASSISTANT_MAX_TOOL_ROUNDS)",
        "",
        "(measures the loop's recovery across rounds, not just the first guess)",
        "",
        f"- Exact match rate: {multi_summary['exact_match_rate']:.1%}",
        f"- Avg precision: {multi_summary['avg_precision']:.1%}",
        f"- Avg recall: {multi_summary['avg_recall']:.1%}",
        "",
        "## Per-question results",
        "",
        "| Question | Expected | Round 1 | Multi-round |",
        "|---|---|---|---|",
    ]
    for r1, rm in zip(round1_results, multi_results):
        mark1 = "✅" if r1["exact_match"] else "❌"
        markm = "✅" if rm["exact_match"] else "❌"
        lines.append(
            f"| {r1['question']} | {', '.join(r1['expected']) or '—'} | "
            f"{mark1} {', '.join(r1['actual']) or '—'} | {markm} {', '.join(rm['actual']) or '—'} |"
        )
    return "\n".join(lines) + "\n"


async def main() -> None:
    with open(DATASET_PATH, encoding="utf-8") as f:
        dataset = json.load(f)

    print(f"Running assistant tool-selection eval on {len(dataset)} questions (model={ASSISTANT_MODEL})...")
    round1_results = []
    multi_results = []
    for index, entry in enumerate(dataset, start=1):
        try:
            round1_tools = await ask_once(entry["question"])
        except Exception as exc:  # noqa: BLE001 - one bad question must not abort the whole eval
            print(f"  [{index}/{len(dataset)}] round1 ERROR: {type(exc).__name__}: {exc}")
            round1_tools = []
        try:
            multi_tools = await ask_multi_round(entry["question"])
        except Exception as exc:  # noqa: BLE001
            print(f"  [{index}/{len(dataset)}] multi-round ERROR: {type(exc).__name__}: {exc}")
            multi_tools = []

        r1_verdict = scoring.tool_selection_verdict(entry["expected_tools"], round1_tools)
        r1_verdict["question"] = entry["question"]
        rm_verdict = scoring.tool_selection_verdict(entry["expected_tools"], multi_tools)
        rm_verdict["question"] = entry["question"]

        print(f"  [{index}/{len(dataset)}] {entry['question'][:60]!r} -> round1={round1_tools} "
              f"({'OK' if r1_verdict['exact_match'] else 'MISS'}) multi={multi_tools} "
              f"({'OK' if rm_verdict['exact_match'] else 'MISS'})")
        round1_results.append(r1_verdict)
        multi_results.append(rm_verdict)

    round1_summary = scoring.aggregate_tool_selection_scores(round1_results)
    multi_summary = scoring.aggregate_tool_selection_scores(multi_results)
    print("round1:", json.dumps(round1_summary, indent=2, ensure_ascii=False))
    print("multi_round:", json.dumps(multi_summary, indent=2, ensure_ascii=False))

    os.makedirs(REPORTS_DIR, exist_ok=True)
    report_path = os.path.join(REPORTS_DIR, f"assistant_tools_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md")
    with open(report_path, "w", encoding="utf-8") as f:
        f.write(render_report(round1_results, round1_summary, multi_results, multi_summary))
    print(f"\nReport written to {report_path}")


if __name__ == "__main__":
    asyncio.run(main())
