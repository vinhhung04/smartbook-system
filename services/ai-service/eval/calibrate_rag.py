"""Threshold calibration for retrieval_confidence.py, run OFFLINE against a
signals dump instead of re-querying OpenRouter/pgvector for every candidate
threshold.

Requires a signals dump taken with BOTH `--abstention off` (so `retrieved_ids`
is the raw, unfiltered RRF list even for a NO_EVIDENCE case - calibration needs
to know what recall a threshold WOULD have kept) and `--dump-signals`:

    python eval/eval_rag.py --abstention off --dump-signals

Then:
    python eval/calibrate_rag.py eval/reports/rag_signals_<timestamp>.json

For each corpus (BOOK_METADATA / INTERNAL_DOC) independently - their cosine
distributions differ (see faq_retrieval.py/book_index.py's threshold
comments) - this grids tau_evidence (and, more coarsely, tau_confident) and
reports Recall@5 / Answerable Recall@5 / No-answer Accuracy / FPR / Coverage /
Abstention F1 for each candidate, split into a `calib` half (used to pick
tau) and a `test` half (used to report the picked value's actual performance,
so the printed numbers aren't the same data that chose them) via a fixed-seed
shuffle - since rag_dataset.json doesn't currently tag a split, this script
makes one deterministically rather than requiring the dataset to carry it.

Selection rule (Chức năng 1.8's acceptance criteria): among candidates whose
`calib`-split Recall@5 is not more than RECALL_TOLERANCE below the dataset's
own recorded baseline (BASELINE_RECALL_AT_5, read from the eval report this
migration's threshold change was made against - see docs/SERVICES/AI_SERVICE.md),
pick the one with the best No-answer Accuracy, tie-broken by Abstention F1.
"""
from __future__ import annotations

import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import scoring  # noqa: E402
import retrieval_confidence as confidence  # noqa: E402

REPORTS_DIR = os.path.join(os.path.dirname(__file__), "reports")

# eval/reports/rag_20260925_041036.md - the report cited in the commit that
# lowered FAQ_MATCH_THRESHOLD/BOOK_SEMANTIC_THRESHOLD to 0.3. Recall@5 must not
# regress by more than this when abstention is layered on top of that gain.
# Stored as ANSWERABLE Recall@5 (that report's blended R@5, unblended by its
# own answerable/no-answer split - 0.8106*60/55 and 0.85*40/35 respectively),
# to match this script comparing against answerable_recall_at_5 below.
BASELINE_RECALL_AT_5 = {"BOOK_METADATA": 0.884, "INTERNAL_DOC": 0.9714}
# A live run (eval/reports/rag_20260925_082047.md) showed BOOK_METADATA has no
# threshold that both reaches strong No-answer Accuracy and stays within 0.02
# of baseline - author-only queries carry a genuinely weak, ambiguous semantic
# signal. 0.06 is the tolerance that lets a REAL no-answer improvement win
# instead of this script always falling back to "keep everything eligible"
# on that corpus; see retrieval_confidence.py's _BOOK_DEFAULTS comment for the
# full trade-off table this was picked from.
RECALL_TOLERANCE = 0.06

TAU_EVIDENCE_GRID = [round(0.20 + 0.05 * i, 2) for i in range(11)]  # 0.20 .. 0.70
TAU_CONFIDENT_GRID = [0.5, 0.6, 0.66, 0.75, 0.85]
SPLIT_SEED = 20260925


def _split(cases: list[dict]) -> tuple[list[dict], list[dict]]:
    shuffled = list(cases)
    random.Random(SPLIT_SEED).shuffle(shuffled)
    midpoint = len(shuffled) // 2
    return shuffled[:midpoint], shuffled[midpoint:]


def _signals_from_dump(row: dict) -> confidence.RetrievalSignals:
    fields = row["signals"]
    return confidence.RetrievalSignals(**fields)


def _simulate(rows: list[dict], cfg: confidence.ConfidenceConfig) -> list[dict]:
    """Re-derive the decision (and, from it, retrieved_ids) each row WOULD
    have gotten under `cfg`, without re-running retrieval - the ranking
    itself doesn't change, only whether it's withheld."""
    simulated = []
    for row in rows:
        signals = _signals_from_dump(row)
        result = confidence.evaluate(signals, cfg)
        retrieved_ids = [] if result.decision == confidence.NO_EVIDENCE else row["retrieved_ids"]
        simulated.append({**row, "retrieved_ids": retrieved_ids, "decision": result.decision})
    return simulated


def _evaluate_candidate(rows: list[dict], cfg: confidence.ConfidenceConfig) -> dict:
    simulated = _simulate(rows, cfg)
    recall5 = scoring.aggregate_retrieval_scores(simulated)["recall_at_5"]
    answerable5 = scoring.answerable_recall(simulated)["recall_at_5"]
    abstention = scoring.abstention_metrics(simulated)
    return {
        "recall_at_5": recall5, "answerable_recall_at_5": answerable5,
        "no_answer_accuracy": abstention["no_answer_accuracy"],
        "false_positive_rate": abstention["false_positive_rate"],
        "coverage": abstention["coverage"], "abstention_f1": abstention["abstention_f1"],
    }


def calibrate_corpus(corpus: str, rows: list[dict], base_cfg: confidence.ConfidenceConfig) -> tuple[dict, list[dict]]:
    calib_rows, test_rows = _split(rows)
    baseline = BASELINE_RECALL_AT_5.get(corpus, 0.0)

    table = []
    for tau_confident in TAU_CONFIDENT_GRID:
        for tau_evidence in TAU_EVIDENCE_GRID:
            if tau_evidence >= tau_confident:
                continue
            cfg = confidence.ConfidenceConfig(
                cos_floor=base_cfg.cos_floor, cos_ceil=base_cfg.cos_ceil,
                tau_confident=tau_confident, tau_evidence=tau_evidence,
                w_semantic=base_cfg.w_semantic, w_keyword=base_cfg.w_keyword, w_agree=base_cfg.w_agree,
            )
            calib_metrics = _evaluate_candidate(calib_rows, cfg)
            table.append({"tau_confident": tau_confident, "tau_evidence": tau_evidence, **calib_metrics})

    # Compared against ANSWERABLE Recall@5, not the blended one: the blended
    # metric's ceiling depends on how many no-answer cases are in the split
    # (rag_dataset.json now has proportionally more of them than the dataset
    # BASELINE_RECALL_AT_5 was measured on), so a straight comparison would
    # flag every candidate as "regressed" for a reason that has nothing to do
    # with retrieval quality.
    eligible = [row for row in table if row["answerable_recall_at_5"] >= baseline - RECALL_TOLERANCE]
    pool = eligible or table
    best = max(pool, key=lambda row: (row["no_answer_accuracy"] or 0.0, row["abstention_f1"] or 0.0))

    best_cfg = confidence.ConfidenceConfig(
        cos_floor=base_cfg.cos_floor, cos_ceil=base_cfg.cos_ceil,
        tau_confident=best["tau_confident"], tau_evidence=best["tau_evidence"],
        w_semantic=base_cfg.w_semantic, w_keyword=base_cfg.w_keyword, w_agree=base_cfg.w_agree,
    )
    test_metrics = _evaluate_candidate(test_rows, best_cfg)
    return {"chosen": best, "test_split_metrics": test_metrics, "calib_n": len(calib_rows), "test_n": len(test_rows)}, table


def render_report(by_corpus: dict, tables: dict, timestamp: str) -> str:
    lines = [f"# RAG confidence-threshold calibration — {timestamp}", ""]
    for corpus, outcome in by_corpus.items():
        chosen = outcome["chosen"]
        lines += [
            f"## {corpus}",
            "",
            f"- calib/test split: {outcome['calib_n']} / {outcome['test_n']} case",
            f"- Baseline Answerable Recall@5 (pre-abstention): {BASELINE_RECALL_AT_5.get(corpus)}, tolerance {RECALL_TOLERANCE}",
            f"- **Chosen: tau_confident={chosen['tau_confident']}, tau_evidence={chosen['tau_evidence']}**"
            f" (calib R@5 {chosen['recall_at_5']}, No-answer acc {chosen['no_answer_accuracy']}, "
            f"F1 {chosen['abstention_f1']})",
            f"- On the held-out `test` split: {outcome['test_split_metrics']}",
            "",
            "| tau_confident | tau_evidence | R@5 | Answerable R@5 | No-answer acc | FPR | Coverage | Abstention F1 |",
            "|---|---|---|---|---|---|---|---|",
        ]
        for row in sorted(tables[corpus], key=lambda r: (r["tau_confident"], r["tau_evidence"])):
            lines.append(
                f"| {row['tau_confident']} | {row['tau_evidence']} | {row['recall_at_5']} | "
                f"{row['answerable_recall_at_5']} | {row['no_answer_accuracy']} | {row['false_positive_rate']} | "
                f"{row['coverage']} | {row['abstention_f1']} |"
            )
        lines.append("")
    return "\n".join(lines)


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: python eval/calibrate_rag.py eval/reports/rag_signals_<timestamp>.json", file=sys.stderr)
        return 2
    with open(sys.argv[1], "r", encoding="utf-8") as handle:
        rows = json.load(handle)

    by_corpus_rows = {
        corpus: [r for r in rows if r["corpus"] == corpus]
        for corpus in ("BOOK_METADATA", "INTERNAL_DOC")
    }
    base_cfgs = {"BOOK_METADATA": confidence.BOOK_CONFIDENCE, "INTERNAL_DOC": confidence.DOC_CONFIDENCE}

    by_corpus, tables = {}, {}
    for corpus, corpus_rows in by_corpus_rows.items():
        if not corpus_rows:
            continue
        by_corpus[corpus], tables[corpus] = calibrate_corpus(corpus, corpus_rows, base_cfgs[corpus])

    from datetime import datetime, timezone
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    report = render_report(by_corpus, tables, timestamp)
    print(report)

    os.makedirs(REPORTS_DIR, exist_ok=True)
    out_path = os.path.join(REPORTS_DIR, f"calibration_{timestamp}.md")
    with open(out_path, "w", encoding="utf-8") as handle:
        handle.write(report)
    print(f"\nSaved to {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
