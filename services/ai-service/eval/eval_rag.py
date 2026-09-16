"""Retrieval + answer-grounding eval cho RAG.

Chay truc tiep vao tang retrieval (assistant_tools.search_books /
faq_retrieval.find_relevant), khong qua HTTP — chi tang retrieval dang duoc do,
khong phai auth/conversation/cache. Cung quy uoc voi eval_assistant_tools.py.

Chay TRUOC khi doi retrieval sang pgvector de co baseline, roi chay lai SAU de
so sanh. Report ghi vao eval/reports/rag_<timestamp>.md.

Usage (tu services/ai-service/):
    python eval/eval_rag.py
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import scoring  # noqa: E402
import assistant_tools  # noqa: E402
import faq_retrieval  # noqa: E402

DATASET_PATH = os.path.join(os.path.dirname(__file__), "rag_dataset.json")
REPORTS_DIR = os.path.join(os.path.dirname(__file__), "reports")
AUTH_TOKEN = os.getenv("EVAL_AUTH_TOKEN", "")


async def retrieve(entry: dict) -> list[str]:
    """Tra ve source_id da xep hang. Shape khac nhau giua hai corpus nen
    chuan hoa o day, khong o trong scoring."""
    if entry["corpus"] == "BOOK_METADATA":
        auth = f"Bearer {AUTH_TOKEN}" if AUTH_TOKEN else None
        payload = await assistant_tools.search_books(auth_header=auth, query=entry["question"])
        if "error" in payload:
            return []
        return [str(item.get("id") or "") for item in payload.get("results", [])]
    matches = await asyncio.to_thread(faq_retrieval.find_relevant, entry["question"])
    return [str(match.entry.get("id") or "") for match in matches]


async def main() -> int:
    with open(DATASET_PATH, "r", encoding="utf-8") as handle:
        dataset = json.load(handle)

    results = []
    for entry in dataset:
        retrieved = await retrieve(entry)
        results.append({
            "id": entry["id"],
            "corpus": entry["corpus"],
            "question": entry["question"],
            "retrieved_ids": retrieved,
            "expected_ids": entry["expected_ids"],
        })

    overall = scoring.aggregate_retrieval_scores(results)
    by_corpus = {
        corpus: scoring.aggregate_retrieval_scores([r for r in results if r["corpus"] == corpus])
        for corpus in ("BOOK_METADATA", "INTERNAL_DOC")
    }
    # Case khong co dap an do rieng: chi dung khi tra ve rong.
    empty_cases = [r for r in results if not r["expected_ids"]]
    empty_correct = sum(1 for r in empty_cases if not r["retrieved_ids"])

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    os.makedirs(REPORTS_DIR, exist_ok=True)
    report_path = os.path.join(REPORTS_DIR, f"rag_{timestamp}.md")
    lines = [
        f"# RAG retrieval eval — {timestamp}",
        "",
        f"- Tong: {overall['count']} case",
        f"- Recall@1 {overall['recall_at_1']} / Recall@3 {overall['recall_at_3']} / Recall@5 {overall['recall_at_5']}",
        f"- MRR {overall['mrr']}",
        f"- Case khong dap an tra dung rong: {empty_correct}/{len(empty_cases)}",
        "",
        "## Theo corpus",
    ]
    for corpus, agg in by_corpus.items():
        lines.append(f"- **{corpus}** ({agg['count']}): R@1 {agg['recall_at_1']}, R@3 {agg['recall_at_3']}, R@5 {agg['recall_at_5']}, MRR {agg['mrr']}")
    lines += ["", "## Case truot (khong co expected nao trong top-5)", ""]
    for r in results:
        if r["expected_ids"] and scoring.recall_at_k(r["retrieved_ids"], r["expected_ids"], 5) == 0.0:
            lines.append(f"- `{r['id']}` {r['question']} — mong {r['expected_ids']}, nhan {r['retrieved_ids'][:5]}")

    with open(report_path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")
    print("\n".join(lines))
    print(f"\nReport: {report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
