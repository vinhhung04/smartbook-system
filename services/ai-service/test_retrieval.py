from __future__ import annotations

import asyncio
import unittest
from unittest import mock

import faq_retrieval
import retrieval
import retrieval_confidence as confidence
from faq_retrieval import FAQMatch
from intent import GENERAL_QUERY


def _confidence(decision: str, score: float = 0.8, reasons=("SEMANTIC_STRONG",)):
    signals = confidence.RetrievalSignals("INTERNAL_DOC", 1, True, score, 1, 1, True)
    return confidence.RetrievalConfidence(decision, score, list(reasons), signals)


class GeneralQueryRetrievalTests(unittest.TestCase):
    def test_general_query_with_faq_match_returns_summary_and_sources(self):
        fake_entry = {
            "id": "test-faq",
            "category": "general",
            "question": "Cau hoi mau?",
            "answer": "Tra loi mau.",
        }
        with mock.patch.object(
            faq_retrieval, "find_relevant_with_confidence",
            return_value=([FAQMatch(entry=fake_entry, score=0.9)], _confidence(confidence.CONFIDENT_MATCH)),
        ):
            result = asyncio.run(
                retrieval.retrieve_context({"intent": GENERAL_QUERY, "query": "cau hoi mau"}, auth_header=None)
            )

        self.assertIn("Tra loi mau.", result["summary"])
        self.assertTrue(result["sources"])
        self.assertEqual(result["sources"][0]["status"], "ok")
        self.assertEqual(result["raw"]["faq_matches"][0]["id"], "test-faq")
        self.assertEqual(result["retrieval_status"], confidence.CONFIDENT_MATCH)

    def test_general_query_without_faq_match_returns_empty_envelope(self):
        with mock.patch.object(
            faq_retrieval, "find_relevant_with_confidence",
            return_value=([], _confidence(confidence.NO_EVIDENCE, 0.0, ["EMPTY_RESULT"])),
        ):
            result = asyncio.run(
                retrieval.retrieve_context({"intent": GENERAL_QUERY, "query": "cau hoi la"}, auth_header=None)
            )

        self.assertEqual(result["summary"], "")
        self.assertEqual(result["sources"], [])
        self.assertEqual(result["retrieval_status"], confidence.NO_EVIDENCE)

    def test_general_query_survives_faq_lookup_exception(self):
        """retrieve_context must never propagate an embedding-layer failure to /chat."""
        with mock.patch.object(faq_retrieval, "find_relevant_with_confidence", side_effect=RuntimeError("boom")):
            result = asyncio.run(
                retrieval.retrieve_context({"intent": GENERAL_QUERY, "query": "cau hoi loi"}, auth_header=None)
            )

        self.assertEqual(result["summary"], "")
        self.assertEqual(result["sources"], [])
        self.assertEqual(result["retrieval_status"], confidence.NO_EVIDENCE)

    def test_no_evidence_decision_withholds_matches_even_if_fusion_returned_some(self):
        """A NO_EVIDENCE decision must blank the context even when the fused
        list wasn't literally empty (e.g. a weak semantic-only hit) - the
        decision, not incidental list emptiness, is what gates abstention."""
        fake_entry = {"id": "weak", "question": "Q?", "answer": "A."}
        with mock.patch.object(
            faq_retrieval, "find_relevant_with_confidence",
            return_value=([FAQMatch(entry=fake_entry, score=0.02)], _confidence(confidence.NO_EVIDENCE, 0.1, ["LOW_OVERALL_CONFIDENCE"])),
        ):
            result = asyncio.run(
                retrieval.retrieve_context({"intent": GENERAL_QUERY, "query": "cau hoi khong ro"}, auth_header=None)
            )

        self.assertEqual(result["summary"], "")
        self.assertEqual(result["sources"], [])
        self.assertNotIn("faq_matches", result["raw"])

    def test_uncertain_decision_hedges_the_summary_but_keeps_the_match(self):
        fake_entry = {"id": "maybe", "question": "Q?", "answer": "A."}
        with mock.patch.object(
            faq_retrieval, "find_relevant_with_confidence",
            return_value=([FAQMatch(entry=fake_entry, score=0.4)], _confidence(confidence.UNCERTAIN, 0.4)),
        ):
            result = asyncio.run(
                retrieval.retrieve_context({"intent": GENERAL_QUERY, "query": "cau hoi mo ho"}, auth_header=None)
            )

        self.assertIn("do tin cay chua cao", result["summary"])
        self.assertTrue(result["sources"])
        self.assertEqual(result["retrieval_status"], confidence.UNCERTAIN)


if __name__ == "__main__":
    unittest.main()
