"""eval/calibrate_rag.py selection rule (Phase B1):
- a candidate that loses too much answerable recall, or that disables the
  keyword-only fallback, is never chosen;
- with no valid candidate the result is NO_VALID_CANDIDATE - not "the best
  of the invalid ones" (the old `pool = eligible or table`).
"""
from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "eval"))
import calibrate_rag  # noqa: E402
import retrieval_confidence as confidence  # noqa: E402


def _row(case_id: str, expected: list[str], semantic_top1: float, keyword_rank: int | None) -> dict:
    """One signals-dump row (eval_rag.py --abstention off --dump-signals shape)."""
    return {
        "id": case_id, "corpus": "INTERNAL_DOC", "expected_ids": expected,
        "retrieved_ids": ["doc-a", "doc-b"], "decision": "UNCERTAIN",
        "signals": {"corpus": "INTERNAL_DOC", "result_count": 2, "semantic_available": True,
                    "semantic_top1": semantic_top1, "semantic_rank": 1,
                    "keyword_rank": keyword_rank, "top1_agree": keyword_rank == 1},
    }


class CalibrationSelectionTest(unittest.TestCase):
    def test_keyword_fallback_check_matches_the_production_rule(self):
        doc = confidence._DOC_DEFAULTS
        self.assertTrue(calibrate_rag.keyword_fallback_ok(doc))  # 0.40 = w_keyword: still passes
        stricter = confidence.ConfidenceConfig(doc.cos_floor, doc.cos_ceil, doc.tau_confident, 0.45)
        self.assertFalse(calibrate_rag.keyword_fallback_ok(stricter))

    def test_chosen_candidate_never_disables_the_keyword_fallback(self):
        # answerable cases: strong semantic + keyword; no-answer cases: middling
        # semantic only - a tau above 0.40 would separate them best on paper
        rows = [_row(f"a{i}", ["doc-a"], 0.62, 1) for i in range(20)]
        rows += [_row(f"n{i}", [], 0.51, None) for i in range(20)]
        outcome, table = calibrate_rag.calibrate_corpus("INTERNAL_DOC", rows, confidence._DOC_DEFAULTS)

        self.assertTrue(any(not row["keyword_fallback_ok"] for row in table))
        self.assertEqual(outcome["status"], "OK")
        self.assertTrue(outcome["chosen"]["keyword_fallback_ok"])
        self.assertLessEqual(outcome["chosen"]["tau_evidence"], confidence._DOC_DEFAULTS.w_keyword)

    def test_no_valid_candidate_is_reported_not_papered_over(self):
        # answerable cases whose expected document is never retrieved: no
        # threshold can reach the baseline recall, so nothing is eligible
        rows = [_row(f"a{i}", ["doc-z"], 0.62, 1) for i in range(20)]
        rows += [_row(f"n{i}", [], 0.51, None) for i in range(20)]
        outcome, _table = calibrate_rag.calibrate_corpus("INTERNAL_DOC", rows, confidence._DOC_DEFAULTS)

        self.assertEqual(outcome["status"], calibrate_rag.NO_VALID_CANDIDATE)
        self.assertIsNone(outcome["chosen"])
        report = calibrate_rag.render_report({"INTERNAL_DOC": outcome}, {"INTERNAL_DOC": _table}, "t")
        self.assertIn("NO_VALID_CANDIDATE", report)
        self.assertIn("never changes production thresholds", report)


if __name__ == "__main__":
    unittest.main()
