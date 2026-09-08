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
from main import ANALYTICS_TOOLS, ASSISTANT_MODEL, ASSISTANT_SYSTEM_PROMPT, OLLAMA_HOST  # noqa: E402

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


def render_report(results: list[dict], summary: dict) -> str:
    lines = [
        "# Assistant tool-selection eval",
        "",
        f"Generated: {datetime.now(timezone.utc).isoformat()}",
        f"Model: {ASSISTANT_MODEL}",
        f"Total questions: {summary['total']}",
        "",
        "## Summary",
        "",
        f"- Exact match rate: {summary['exact_match_rate']:.1%}",
        f"- Avg precision: {summary['avg_precision']:.1%}",
        f"- Avg recall: {summary['avg_recall']:.1%}",
        "",
        "## Per-question results",
        "",
        "| Question | Expected | Actual | Exact | Precision | Recall |",
        "|---|---|---|---|---|---|",
    ]
    for r in results:
        mark = "✅" if r["exact_match"] else "❌"
        lines.append(
            f"| {r['question']} | {', '.join(r['expected']) or '—'} | {', '.join(r['actual']) or '—'} | "
            f"{mark} | {r['precision']:.2f} | {r['recall']:.2f} |"
        )
    return "\n".join(lines) + "\n"


async def main() -> None:
    with open(DATASET_PATH, encoding="utf-8") as f:
        dataset = json.load(f)

    print(f"Running assistant tool-selection eval on {len(dataset)} questions (model={ASSISTANT_MODEL})...")
    results = []
    for index, entry in enumerate(dataset, start=1):
        try:
            actual_tools = await ask_once(entry["question"])
        except Exception as exc:  # noqa: BLE001 - one bad question must not abort the whole eval
            print(f"  [{index}/{len(dataset)}] ERROR: {type(exc).__name__}: {exc}")
            actual_tools = []
        verdict = scoring.tool_selection_verdict(entry["expected_tools"], actual_tools)
        verdict["question"] = entry["question"]
        print(f"  [{index}/{len(dataset)}] {entry['question'][:60]!r} -> {actual_tools} "
              f"({'OK' if verdict['exact_match'] else 'MISS'})")
        results.append(verdict)

    summary = scoring.aggregate_tool_selection_scores(results)
    print(json.dumps(summary, indent=2, ensure_ascii=False))

    os.makedirs(REPORTS_DIR, exist_ok=True)
    report_path = os.path.join(REPORTS_DIR, f"assistant_tools_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md")
    with open(report_path, "w", encoding="utf-8") as f:
        f.write(render_report(results, summary))
    print(f"\nReport written to {report_path}")


if __name__ == "__main__":
    asyncio.run(main())
