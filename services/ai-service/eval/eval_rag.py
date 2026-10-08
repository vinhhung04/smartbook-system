"""Retrieval + abstention eval cho RAG.

Chay truc tiep vao tang retrieval (assistant_tools._score_and_rank_books_with_confidence /
faq_retrieval.find_relevant_with_confidence), khong qua HTTP — chi tang retrieval dang duoc do,
khong phai auth/conversation/cache. Cung quy uoc voi eval_assistant_tools.py.

Chay TRUOC khi doi retrieval sang pgvector de co baseline, roi chay lai SAU de
so sanh. Report ghi vao eval/reports/rag_<timestamp>.md.

Ngoai Recall@1/3/5/MRR (nhu truoc), report gio co them cac metric ve abstention
(retrieval_confidence.py): No-answer Accuracy, False Positive/Negative Rate,
Answerable Recall, Abstention Precision/Recall/F1, Coverage, Selective Accuracy —
xem eval/scoring.py's abstention_metrics()/answerable_recall()/selective_accuracy().

`--abstention off` bo qua quyet dinh NO_EVIDENCE (dung retrieved_ids THO tu RRF,
truoc khi confidence layer loc) — dung de tai lap baseline truoc khi co
retrieval_confidence.py, hoac de so sanh truc tiep voi cac report cu
(rag_20260925_041036.md va truoc do).

`--dump-signals` ghi them eval/reports/rag_signals_<timestamp>.json — moi case
kem theo cac tin hieu confidence tho (semantic_top1, semantic_rank, keyword_rank,
top1_agree, decision, confidence) — de eval/calibrate_rag.py chon threshold
OFFLINE, khong phai goi lai OpenRouter/DB moi lan thu mot bo threshold.

Usage (tu services/ai-service/):
    python eval/eval_rag.py
    python eval/eval_rag.py --abstention off
    python eval/eval_rag.py --dump-signals
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import httpx  # noqa: E402

import scoring  # noqa: E402
import assistant_tools  # noqa: E402
import embed_cache  # noqa: E402
import embeddings  # noqa: E402
import faq_retrieval  # noqa: E402

DATASET_PATH = os.path.join(os.path.dirname(__file__), "rag_dataset.json")
REPORTS_DIR = os.path.join(os.path.dirname(__file__), "reports")
AUTH_TOKEN = os.getenv("EVAL_AUTH_TOKEN", "")


async def _fetch_books() -> list[dict]:
    """Fetched once for the whole run, same catalog every BOOK_METADATA case
    scores against (assistant_tools.search_books does this per-call in
    production; here it would just be the same HTTP round-trip repeated
    60 times for no benefit).

    With EVAL_AUTH_TOKEN: GET /api/books through the gateway, as before.
    Without it: inventory-service's internal feed (catalog_sync.fetch_catalog_books,
    INTERNAL_SERVICE_KEY) - the same active-book list the BOOK_METADATA corpus
    is synced from, so no user login is needed to run the eval."""
    if not AUTH_TOKEN:
        import catalog_sync
        return await catalog_sync.fetch_catalog_books()
    headers = {"Authorization": f"Bearer {AUTH_TOKEN}"}
    async with httpx.AsyncClient(timeout=httpx.Timeout(20)) as client:
        response = await client.get(f"{assistant_tools.GATEWAY_URL}/api/books", headers=headers)
    if response.status_code >= 400:
        return []
    data = assistant_tools._data(response.json())
    return data if isinstance(data, list) else []


async def retrieve(entry: dict, books: list[dict], apply_abstention: bool) -> dict:
    """Ca hai nhanh deu dung ham co tra ve RetrievalConfidence (khong phai
    search_books()/find_relevant() vi hai ham do da tu ap abstention roi —
    o day can kiem soat rieng qua `apply_abstention` de tai lap baseline)."""
    if entry["corpus"] == "BOOK_METADATA":
        results, confidence = await assistant_tools._score_and_rank_books_with_confidence(
            books, entry["question"], assistant_tools.SEARCH_BOOKS_RESULT_LIMIT,
        )
        retrieved_ids = [str(item.get("id") or "") for item in results]
    else:
        matches, confidence = await asyncio.to_thread(
            faq_retrieval.find_relevant_with_confidence, entry["question"]
        )
        retrieved_ids = [str(match.entry.get("id") or "") for match in matches]

    if apply_abstention and confidence.decision == "NO_EVIDENCE":
        retrieved_ids = []

    return {
        "retrieved_ids": retrieved_ids, "decision": confidence.decision,
        "confidence": confidence.confidence, "reason_codes": list(confidence.reason_codes),
        "signals": vars(confidence.signals),
    }


def _render_abstention_lines(label: str, metrics: dict) -> list[str]:
    return [
        f"- **{label}** — No-answer Accuracy: {metrics['no_answer_accuracy']} "
        f"({metrics['no_answer_count']} case) | FPR: {metrics['false_positive_rate']} | "
        f"FNR: {metrics['false_negative_rate']} ({metrics['answerable_count']} case answerable)",
        f"  Coverage: {metrics['coverage']} | Abstention P/R/F1: "
        f"{metrics['abstention_precision']} / {metrics['abstention_recall']} / {metrics['abstention_f1']}",
    ]


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--abstention", choices=["on", "off"], default="on",
                         help="on (default): withhold results on NO_EVIDENCE, matching production. "
                              "off: raw RRF results, to reproduce the pre-abstention baseline.")
    parser.add_argument("--dump-signals", action="store_true",
                         help="also write rag_signals_<timestamp>.json for eval/calibrate_rag.py")
    parser.add_argument("--split", choices=["all", "val", "test"], default="all",
                         help="evaluate only the hash-assigned validation or test half "
                              "(scoring.dataset_split); tune on val, report on test")
    parser.add_argument("--no-embed-cache", action="store_true",
                         help="call OpenRouter for every query instead of eval/.cache (not reproducible)")
    parser.add_argument("--label", default="",
                         help="short tag added to the report file name, e.g. baseline / after-fix")
    args = parser.parse_args()
    apply_abstention = args.abstention == "on"
    if not args.no_embed_cache:
        embed_cache.install()

    with open(DATASET_PATH, "r", encoding="utf-8") as handle:
        dataset = json.load(handle)

    if args.split != "all":
        dataset = [entry for entry in dataset if scoring.dataset_split(entry["id"]) == args.split]

    books = await _fetch_books()
    if any(entry["corpus"] == "BOOK_METADATA" for entry in dataset) and not books:
        # Truoc day catalog rong (vd token het han) lam moi case sach thanh
        # NO_EVIDENCE im lang va ket qua van duoc ghi thanh report nhu that.
        print("Catalog rong - khong the danh gia BOOK_METADATA. Kiem tra EVAL_AUTH_TOKEN/INTERNAL_SERVICE_KEY.")
        return 2
    results = []
    for entry in dataset:
        outcome = await retrieve(entry, books, apply_abstention)
        results.append({
            "id": entry["id"], "corpus": entry["corpus"], "question": entry["question"],
            "expected_ids": entry["expected_ids"], **outcome,
        })

    embed_cache.save()
    no_semantic = [r["id"] for r in results if not r["signals"].get("semantic_available")]
    overall = scoring.aggregate_retrieval_scores(results)
    by_corpus = {
        corpus: scoring.aggregate_retrieval_scores([r for r in results if r["corpus"] == corpus])
        for corpus in ("BOOK_METADATA", "INTERNAL_DOC")
    }
    abstention_overall = scoring.abstention_metrics(results)
    abstention_by_corpus = {
        corpus: scoring.abstention_metrics([r for r in results if r["corpus"] == corpus])
        for corpus in ("BOOK_METADATA", "INTERNAL_DOC")
    }
    answerable_overall = scoring.answerable_recall(results)
    selective_overall = scoring.selective_accuracy(results, k=1)

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    os.makedirs(REPORTS_DIR, exist_ok=True)
    suffix = "".join(f"_{part}" for part in (args.label, args.split if args.split != "all" else "") if part)
    report_path = os.path.join(REPORTS_DIR, f"rag_{timestamp}{suffix}.md")
    lines = [
        f"# RAG retrieval eval — {timestamp} (abstention={args.abstention}, split={args.split}"
        f"{', label=' + args.label if args.label else ''})",
        "",
        f"- Catalog: {len(books)} sach; embedding: {embeddings.EMBED_IDENTITY}; "
        f"BOOK_CONF tau={assistant_tools.retrieval_confidence.BOOK_CONFIDENCE.tau_confident}/"
        f"{assistant_tools.retrieval_confidence.BOOK_CONFIDENCE.tau_evidence}, "
        f"DOC_CONF tau={assistant_tools.retrieval_confidence.DOC_CONFIDENCE.tau_confident}/"
        f"{assistant_tools.retrieval_confidence.DOC_CONFIDENCE.tau_evidence}",
        f"- Query embedding cache: {embed_cache.stats}; case khong co tin hieu semantic "
        f"(provider loi -> keyword-only, KHONG so sanh duoc): {len(no_semantic)} {no_semantic[:10]}",
        f"- Tong: {overall['count']} case",
        f"- Recall@1 {overall['recall_at_1']} / Recall@3 {overall['recall_at_3']} / Recall@5 {overall['recall_at_5']}",
        f"- MRR {overall['mrr']}",
        f"- Answerable Recall@1/3/5: {answerable_overall['recall_at_1']} / "
        f"{answerable_overall['recall_at_3']} / {answerable_overall['recall_at_5']} "
        f"({answerable_overall['count']} case co dap an)",
        f"- Selective Accuracy@1 (chi tinh tren case he thong CHON tra loi): {selective_overall}",
        "",
        "## Abstention",
        *_render_abstention_lines("Overall", abstention_overall),
    ]
    for corpus, metrics in abstention_by_corpus.items():
        lines += _render_abstention_lines(corpus, metrics)
    lines += ["", "## Theo corpus (Recall/MRR)"]
    for corpus, agg in by_corpus.items():
        lines.append(f"- **{corpus}** ({agg['count']}): R@1 {agg['recall_at_1']}, R@3 {agg['recall_at_3']}, R@5 {agg['recall_at_5']}, MRR {agg['mrr']}")
    lines += ["", "## Case truot (khong co expected nao trong top-5)", ""]
    for r in results:
        if r["expected_ids"] and scoring.recall_at_k(r["retrieved_ids"], r["expected_ids"], 5) == 0.0:
            lines.append(f"- `{r['id']}` {r['question']} — mong {r['expected_ids']}, nhan {r['retrieved_ids'][:5]} (decision={r['decision']})")
    lines += ["", "## Case khong dap an nhung he thong van tra ket qua (false positive)", ""]
    for r in results:
        if not r["expected_ids"] and r["retrieved_ids"]:
            lines.append(f"- `{r['id']}` {r['question']} — tra {r['retrieved_ids']} (decision={r['decision']}, confidence={r['confidence']})")

    with open(report_path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")
    print("\n".join(lines))
    print(f"\nReport: {report_path}")

    if args.dump_signals:
        signals_path = os.path.join(REPORTS_DIR, f"rag_signals_{timestamp}{suffix}.json")
        with open(signals_path, "w", encoding="utf-8") as handle:
            json.dump(results, handle, ensure_ascii=False, indent=2, default=str)
        print(f"Signals: {signals_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
