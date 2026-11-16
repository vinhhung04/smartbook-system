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


def test_internal_doc_weak_match_between_old_and_new_threshold_now_abstains():
    """Regression (re-calibration 2026-10-08): a top INTERNAL_DOC hit with a
    middling cosine and no keyword support scores between the old 0.35 and the
    new 0.40 evidence threshold - the profile of out-of-scope questions such as
    'Thu vien co wifi mien phi khong?' - and must be withheld, not answered."""
    import vector_store

    signals = rc.RetrievalSignals(
        corpus=vector_store.CORPUS_DOC, result_count=3, semantic_available=True,
        semantic_top1=0.49, semantic_rank=1, keyword_rank=None, top1_agree=False)
    result = rc.evaluate(signals, rc._DOC_DEFAULTS)
    assert 0.35 <= result.confidence < 0.40
    assert result.decision == rc.NO_EVIDENCE


def test_internal_doc_keyword_only_hit_can_still_pass_the_evidence_threshold():
    """tau_evidence for INTERNAL_DOC must stay <= w_keyword: a top keyword hit
    with no semantic signal (embeddings down) scores exactly w_keyword, and a
    higher tau would silently disable that fallback (re-calibration 2026-11-12
    picked 0.45 on semantic-only data; rejected for this reason)."""
    assert rc._DOC_DEFAULTS.tau_evidence <= rc._DOC_DEFAULTS.w_keyword


def _doc_hit(source_id: str, score: float, content: str) -> Hit:
    return Hit(chunk_id="c-" + source_id, document_id="d-" + source_id, source_id=source_id,
               corpus="INTERNAL_DOC", content=content, score=score)


def test_focus_coverage_is_share_of_question_content_words_in_top_chunk():
    top = _doc_hit("reader-features", 0.5, "## Dành cho bạn đọc\nĐặt trước sách, gia hạn, đánh giá.")
    signals = rc.extract_signals("INTERNAL_DOC", [top], [], [top], True,
                                 query="Thư viện có cho thuê máy tính xách tay không?")
    assert signals.focus_coverage == 0.0
    no_query = rc.extract_signals("INTERNAL_DOC", [top], [], [top], True)
    assert no_query.focus_coverage is None


def _uncertain(focus, semantic_available=True):
    # semantic strong, no keyword support -> confidence 0.5, UNCERTAIN under the doc defaults
    return rc.RetrievalSignals(corpus="INTERNAL_DOC", result_count=3, semantic_available=semantic_available,
                               semantic_top1=0.6, semantic_rank=1, keyword_rank=None, top1_agree=False,
                               focus_coverage=focus)


def test_uncertain_match_without_question_terms_in_evidence_abstains():
    result = rc.evaluate(_uncertain(0.0), rc._DOC_DEFAULTS)
    assert result.decision == rc.NO_EVIDENCE and "LOW_QUERY_TERM_COVERAGE" in result.reason_codes
    assert rc.evaluate(_uncertain(0.4), rc._DOC_DEFAULTS).decision == rc.UNCERTAIN
    assert rc.evaluate(_uncertain(None), rc._DOC_DEFAULTS).decision == rc.UNCERTAIN  # old dumps / no terms


def test_focus_gate_never_touches_confident_matches_or_the_keyword_only_fallback():
    confident = rc.RetrievalSignals(corpus="INTERNAL_DOC", result_count=1, semantic_available=True,
                                    semantic_top1=0.6, semantic_rank=1, keyword_rank=1, top1_agree=True,
                                    focus_coverage=0.0)
    assert rc.evaluate(confident, rc._DOC_DEFAULTS).decision == rc.CONFIDENT_MATCH
    keyword_only = rc.RetrievalSignals(corpus="INTERNAL_DOC", result_count=1, semantic_available=False,
                                       semantic_top1=0.0, semantic_rank=None, keyword_rank=1, top1_agree=False,
                                       focus_coverage=0.0)
    assert rc.evaluate(keyword_only, rc._DOC_DEFAULTS).decision != rc.NO_EVIDENCE


def test_book_corpus_has_no_focus_gate():
    assert rc._BOOK_DEFAULTS.min_focus_coverage == 0.0


def test_focus_gate_only_fires_on_zero_overlap():
    """A false-premise question ('nghe nói… có đúng không') carries words its evidence lacks;
    0.167 coverage was a real answerable question (chat eval ans-contra-01)."""
    assert rc.evaluate(_uncertain(0.1667), rc._DOC_DEFAULTS).decision == rc.UNCERTAIN
