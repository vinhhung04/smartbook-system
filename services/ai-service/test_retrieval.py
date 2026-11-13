from __future__ import annotations

import asyncio
import unittest
from unittest import mock

import faq_retrieval
import retrieval
import retrieval_confidence as confidence
from faq_retrieval import FAQMatch
from intent import GENERAL_QUERY
from rag import LIVE_DATA_LEAD, RAG_SYSTEM_RULES, UNCERTAIN_FALLBACK_REPLY, UNCERTAIN_FAQ_LEAD, build_fallback_reply


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

        # the lead is the marker RAG_SYSTEM_RULES tells the model to key on
        self.assertTrue(result["summary"].startswith(UNCERTAIN_FAQ_LEAD))
        self.assertIn(UNCERTAIN_FAQ_LEAD, RAG_SYSTEM_RULES)
        self.assertTrue(result["sources"])
        self.assertEqual(result["retrieval_status"], confidence.UNCERTAIN)

    def _policy_retrieval(self, fetch):
        entry = {"id": "fine-calculation", "question": "Phí phạt trễ hạn?", "answer": "Thẻ Đọc 5.000 VND/ngày."}
        with mock.patch.object(faq_retrieval, "find_relevant_with_confidence",
                               return_value=([FAQMatch(entry=entry, score=0.9)], _confidence(confidence.CONFIDENT_MATCH))), \
             mock.patch.object(retrieval, "_fetch", new=fetch):
            return asyncio.run(retrieval.retrieve_context({"intent": GENERAL_QUERY, "query": "phi phat"}, auth_header=None))

    def test_policy_document_is_paired_with_live_configuration(self):
        plans = {"data": [{"name": "Thẻ Đọc", "max_active_loans": 3, "fine_per_day": 7000}]}

        async def fetch(_client, endpoint, _auth, params=None):
            return {"name": endpoint, "endpoint": endpoint, "status": "ok"}, plans, None

        result = self._policy_retrieval(fetch)
        self.assertIn(LIVE_DATA_LEAD, result["summary"])
        self.assertIn("phạt trễ hạn 7.000 VND/ngày", result["summary"])  # the live value, not the document's 5.000
        self.assertIn("Gói thành viên hiện hành", [s["name"] for s in result["sources"]])
        self.assertEqual(result["raw"]["live_data"][retrieval.PUBLIC_PLANS_ENDPOINT], plans["data"])

    def test_live_read_failure_keeps_the_document_and_says_it_may_be_stale(self):
        async def fetch(_client, endpoint, _auth, params=None):
            return {"name": endpoint, "endpoint": endpoint, "status": "timeout"}, None, "timed out"

        result = self._policy_retrieval(fetch)
        self.assertNotIn(LIVE_DATA_LEAD, result["summary"])
        self.assertIn("Thẻ Đọc 5.000 VND/ngày.", result["summary"])
        self.assertTrue(any("có thể đã cũ" in w for w in result["warnings"]))

    def test_document_without_configurable_values_triggers_no_live_read(self):
        async def fetch(*_args, **_kw):
            raise AssertionError("no live read expected")

        entry = {"id": "goods-receipt-process", "question": "Nhập kho?", "answer": "Post phiếu."}
        with mock.patch.object(faq_retrieval, "find_relevant_with_confidence",
                               return_value=([FAQMatch(entry=entry, score=0.9)], _confidence(confidence.CONFIDENT_MATCH))), \
             mock.patch.object(retrieval, "_fetch", new=fetch):
            result = asyncio.run(retrieval.retrieve_context({"intent": GENERAL_QUERY, "query": "nhap kho"}, auth_header=None))
        self.assertNotIn("live_data", result["raw"])

    def test_uncertain_fallback_names_the_near_misses_without_presenting_them(self):
        retrieval_result = {
            "summary": f"{UNCERTAIN_FAQ_LEAD}\n- Giờ mở cửa?: 8:00 – 20:00",
            "raw": {"faq_matches": [{"id": "branches", "question": "Giờ mở cửa?", "answer": "8:00 – 20:00"}]},
            "sources": [{"name": "FAQ: Giờ mở cửa?", "endpoint": "faq://branches", "status": "ok"}],
            "warnings": [], "retrieval_status": confidence.UNCERTAIN,
        }
        reply = build_fallback_reply({"intent": GENERAL_QUERY}, retrieval_result)

        self.assertTrue(reply.startswith(UNCERTAIN_FALLBACK_REPLY))
        self.assertIn("Giờ mở cửa?", reply)
        self.assertNotIn("8:00", reply)
        self.assertNotIn("Nguồn dữ liệu", reply)


if __name__ == "__main__":
    unittest.main()
