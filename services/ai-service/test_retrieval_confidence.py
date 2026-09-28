from __future__ import annotations

import unittest

import retrieval_confidence as rc
from vector_store import Hit


def hit(source_id: str, score: float) -> Hit:
    return Hit(chunk_id="c-" + source_id, document_id="d-" + source_id, source_id=source_id,
               corpus="BOOK_METADATA", content="", score=score)


CFG = rc.ConfidenceConfig(cos_floor=0.30, cos_ceil=0.60, tau_confident=0.66, tau_evidence=0.35)


class ExtractSignalsTest(unittest.TestCase):
    def test_hard_match_short_circuits_everything(self):
        signals = rc.extract_signals("BOOK_METADATA", [], [], [], semantic_available=True, hard_match="ISBN_EXACT")
        self.assertEqual(signals.hard_match, "ISBN_EXACT")

    def test_empty_fused_list_has_zero_result_count(self):
        signals = rc.extract_signals("BOOK_METADATA", [], [], [], semantic_available=True)
        self.assertEqual(signals.result_count, 0)

    def test_signals_agree_when_top1_is_rank_1_on_both_arms(self):
        semantic = [hit("b1", 0.5), hit("b2", 0.4)]
        keyword = [hit("b1", 0.9)]
        fused = [hit("b1", 0.03), hit("b2", 0.02)]
        signals = rc.extract_signals("BOOK_METADATA", semantic, keyword, fused, semantic_available=True)
        self.assertTrue(signals.top1_agree)
        self.assertEqual(signals.semantic_rank, 1)
        self.assertEqual(signals.keyword_rank, 1)
        self.assertAlmostEqual(signals.semantic_top1, 0.5)

    def test_keyword_rank_none_when_top1_absent_from_keyword_arm(self):
        semantic = [hit("b1", 0.5)]
        fused = [hit("b1", 0.03)]
        signals = rc.extract_signals("BOOK_METADATA", semantic, [], fused, semantic_available=True)
        self.assertIsNone(signals.keyword_rank)
        self.assertFalse(signals.top1_agree)


class EvaluateTest(unittest.TestCase):
    def test_hard_match_is_always_confident(self):
        signals = rc.extract_signals("BOOK_METADATA", [], [], [], True, hard_match="ISBN_EXACT")
        result = rc.evaluate(signals, CFG)
        self.assertEqual(result.decision, rc.CONFIDENT_MATCH)
        self.assertEqual(result.confidence, 1.0)
        self.assertIn("ISBN_EXACT", result.reason_codes)

    def test_title_exact_hard_match_is_confident(self):
        signals = rc.extract_signals("BOOK_METADATA", [], [], [hit("b3", 0.0)], True, hard_match="TITLE_EXACT")
        result = rc.evaluate(signals, CFG)
        self.assertEqual(result.decision, rc.CONFIDENT_MATCH)

    def test_empty_result_is_no_evidence(self):
        signals = rc.extract_signals("BOOK_METADATA", [], [], [], True)
        result = rc.evaluate(signals, CFG)
        self.assertEqual(result.decision, rc.NO_EVIDENCE)
        self.assertIn("EMPTY_RESULT", result.reason_codes)

    def test_high_semantic_and_keyword_agreement_is_confident(self):
        semantic = [hit("b1", 0.55)]
        keyword = [hit("b1", 0.9)]
        fused = [hit("b1", 0.03)]
        signals = rc.extract_signals("BOOK_METADATA", semantic, keyword, fused, True)
        result = rc.evaluate(signals, CFG)
        self.assertEqual(result.decision, rc.CONFIDENT_MATCH)
        self.assertIn("SIGNALS_AGREE", result.reason_codes)

    def test_low_semantic_and_no_keyword_support_is_no_evidence(self):
        semantic = [hit("b1", 0.31)]
        fused = [hit("b1", 0.02)]
        signals = rc.extract_signals("BOOK_METADATA", semantic, [], fused, True)
        result = rc.evaluate(signals, CFG)
        self.assertEqual(result.decision, rc.NO_EVIDENCE)
        self.assertIn("NO_KEYWORD_SUPPORT", result.reason_codes)

    def test_semantic_only_weak_is_uncertain_or_no_evidence_never_confident(self):
        semantic = [hit("b1", 0.40)]
        fused = [hit("b1", 0.02)]
        signals = rc.extract_signals("BOOK_METADATA", semantic, [], fused, True)
        result = rc.evaluate(signals, CFG)
        self.assertIn(result.decision, (rc.UNCERTAIN, rc.NO_EVIDENCE))

    def test_keyword_strong_but_semantic_weak_still_yields_some_evidence(self):
        # Below BOOK_SEMANTIC_THRESHOLD, so the semantic arm never enters
        # the fused list at all: semantic_rank stays None (not "weak"
        # score), same as faq_retrieval.py/assistant_tools.py's pre-RRF gate.
        keyword = [hit("b1", 0.9)]
        fused = [hit("b1", 0.02)]
        signals = rc.extract_signals("BOOK_METADATA", [], keyword, fused, True)
        result = rc.evaluate(signals, CFG)
        self.assertNotEqual(result.decision, rc.NO_EVIDENCE)
        self.assertIn("KEYWORD_AGREEMENT", result.reason_codes)

    def test_semantic_strong_but_keyword_none(self):
        semantic = [hit("b1", 0.58)]
        fused = [hit("b1", 0.02)]
        signals = rc.extract_signals("BOOK_METADATA", semantic, [], fused, True)
        result = rc.evaluate(signals, CFG)
        self.assertIn("NO_KEYWORD_SUPPORT", result.reason_codes)
        self.assertNotEqual(result.decision, rc.NO_EVIDENCE)

    def test_embedding_failure_falls_back_to_keyword_and_is_not_no_evidence(self):
        keyword = [hit("b1", 1.0)]
        fused = [hit("b1", 1.0)]
        signals = rc.extract_signals("BOOK_METADATA", [], keyword, fused, semantic_available=False)
        result = rc.evaluate(signals, CFG)
        self.assertIn("EMBEDDING_UNAVAILABLE", result.reason_codes)
        self.assertIn("KEYWORD_ONLY_FALLBACK", result.reason_codes)
        self.assertNotEqual(result.decision, rc.NO_EVIDENCE)

    def test_to_dict_shape(self):
        signals = rc.extract_signals("BOOK_METADATA", [], [], [], True, hard_match="ISBN_EXACT")
        result = rc.evaluate(signals, CFG)
        payload = result.to_dict()
        self.assertEqual(set(payload), {"decision", "confidence", "reasonCodes"})


if __name__ == "__main__":
    unittest.main()
