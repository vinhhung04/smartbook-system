"""RAG Phase 3 eval: does selective rewriting help conversational follow-ups?

For every case in rag_conversation_dataset.json, INTERNAL_DOC retrieval (production path,
abstention on) is run three ways on the same hybrid search + RRF:
  original   - the follow-up as typed (what the policy fast path searched before Phase 3)
  rewritten  - query_rewrite.rewrite() output (falls back to the original when not eligible/failed)
  standalone - the labelled source question from rag_dataset.json (upper bound, not a system)
Live: calls OpenRouter for the rewrite (and embeddings via eval/.cache). Usage, from services/ai-service:
    python eval/eval_query_rewrite.py [--label X]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import statistics
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import embed_cache  # noqa: E402
import faq_retrieval  # noqa: E402
import query_rewrite  # noqa: E402
import scoring  # noqa: E402
from nlu import _history_snippet  # noqa: E402

DATASET = os.path.join(os.path.dirname(__file__), "rag_conversation_dataset.json")
REPORTS = os.path.join(os.path.dirname(__file__), "reports")
VARIANTS = ("original", "rewritten", "standalone")


def retrieve(query: str) -> dict:
    matches, confidence = faq_retrieval.find_relevant_with_confidence(query)
    ids = [] if confidence.decision == "NO_EVIDENCE" else [str(m.entry.get("id") or "") for m in matches]
    return {"retrieved_ids": ids, "decision": confidence.decision}


def summarize(rows: list[dict]) -> dict:
    return {"cases": len(rows), "answerable": scoring.answerable_recall(rows), **scoring.abstention_metrics(rows)}


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--label", default="")
    args = parser.parse_args()
    embed_cache.install()
    cases = json.load(open(DATASET, encoding="utf-8"))["cases"]
    rows = []
    for case in cases:
        history = _history_snippet(case["history"])
        result = await query_rewrite.rewrite(case["question"], history)
        queries = {"original": case["question"], "rewritten": result.query, "standalone": case["standalone_question"]}
        outcome = {name: await asyncio.to_thread(retrieve, q) for name, q in queries.items()}
        rows.append({"id": case["id"], "kind": case["kind"], "expected_ids": case["expected_ids"],
                     "question": case["question"], "rewrite": result.query, "status": result.status,
                     "latency_ms": result.latency_ms, **{f"{name}": outcome[name] for name in VARIANTS}})
    embed_cache.save()

    by_variant = {name: summarize([{"expected_ids": r["expected_ids"], **r[name]} for r in rows]) for name in VARIANTS}
    eligible = [r for r in rows if r["status"] != "not_eligible"]
    statuses = {s: sum(1 for r in rows if r["status"] == s) for s in sorted({r["status"] for r in rows})}
    latencies = [r["latency_ms"] for r in eligible if r["latency_ms"]]
    controls = [r for r in rows if r["kind"] == "control_complete"]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    kinds = ", ".join(f"{k} {sum(1 for r in rows if r['kind'] == k)}" for k in sorted({r["kind"] for r in rows}))
    lines = [f"# Query rewrite eval — {stamp}{' (' + args.label + ')' if args.label else ''}", "",
             f"- Cases: {len(rows)} ({kinds})",
             f"- Rewrite status: {statuses}; eligible {len(eligible)}; "
             f"failure rate (failed+invalid / eligible): "
             f"{round(sum(1 for r in eligible if r['status'] in ('failed', 'invalid')) / len(eligible), 4) if eligible else '-'}",
             f"- Controls left as typed: {sum(1 for r in controls if r['rewrite'] == r['question'])}/{len(controls)}",
             f"- Rewrite latency ms (eligible): p50 {statistics.median(latencies) if latencies else '-'}, "
             f"max {max(latencies) if latencies else '-'}", "",
             "| variant | Ans R@1 | Ans R@3 | Ans R@5 | Ans MRR | no-answer acc | FPR | FNR |", "|---|---|---|---|---|---|---|---|"]
    for name, m in by_variant.items():
        a = m["answerable"]
        lines.append(f"| {name} | {a['recall_at_1']} | {a['recall_at_3']} | {a['recall_at_5']} | {a['mrr']} | "
                     f"{m['no_answer_accuracy']} | {m['false_positive_rate']} | {m['false_negative_rate']} |")
    lines += ["", "| case | kind | status | typed | rewrite | expected | original top | rewritten top |",
              "|---|---|---|---|---|---|---|---|"]
    for r in rows:
        lines.append(f"| {r['id']} | {r['kind']} | {r['status']} | {r['question']} | {r['rewrite']} | "
                     f"{r['expected_ids'] or '-'} | {r['original']['retrieved_ids'][:1] or r['original']['decision']} | "
                     f"{r['rewritten']['retrieved_ids'][:1] or r['rewritten']['decision']} |")
    os.makedirs(REPORTS, exist_ok=True)
    base = os.path.join(REPORTS, f"query_rewrite_{stamp}{'_' + args.label if args.label else ''}")
    with open(base + ".md", "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")
    with open(base + ".json", "w", encoding="utf-8") as handle:
        json.dump({"by_variant": by_variant, "statuses": statuses, "rows": rows}, handle, ensure_ascii=False, indent=1)
    print("\n".join(lines))
    print(f"\nReport: {base}.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
