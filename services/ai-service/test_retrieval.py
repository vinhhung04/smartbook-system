from __future__ import annotations

import asyncio
import unittest
from unittest import mock

import faq_retrieval
import retrieval
import retrieval_confidence as confidence
from faq_retrieval import FAQMatch
from intent import BOOK_SEARCH_QUERY, GENERAL_QUERY
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


ATOMIC = {"id": "b-1", "variant_id": "v-1", "title": "Atomic Habits", "author": "James Clear", "isbn": "9780735211292",
          "available_quantity": 11, "availability_status": "AVAILABLE",
          "pickup_branches": [{"warehouse_id": "w-d1", "warehouse_name": "Chi Nhanh District 1", "available_quantity": 4},
                              {"warehouse_id": "w-hk", "warehouse_name": "Chi nhánh Hà Nội – Hoàn Kiếm", "available_quantity": 7}]}


class BookSearchTests(unittest.TestCase):
    """Audit 2026-11-19 (P0-1): /chat book search read /api/books, whose counts are the
    caller's warehouse scope (a reader: 0 -> "hết hàng" for every book), and was
    refused outright without a token."""

    def _search(self, query, pages, auth_header):
        calls = []

        async def fetch(_client, endpoint, auth, params=None):
            calls.append((endpoint, auth, dict(params or {})))
            payload = pages(params or {})
            return {"name": "Catalog Books", "endpoint": endpoint, "status": "ok"}, payload, None

        with mock.patch.object(retrieval, "_fetch", new=fetch):
            result = asyncio.run(retrieval.retrieve_context(
                {"intent": BOOK_SEARCH_QUERY, "query": query}, auth_header=auth_header))
        return result, calls

    def test_public_catalog_is_used_with_or_without_a_token(self):
        for auth in (None, "Bearer reader-token"):
            result, calls = self._search("atomic habits", lambda p: {"data": [ATOMIC], "meta": {"totalPages": 1}}, auth)
            self.assertEqual(calls, [(retrieval.PUBLIC_BOOKS_ENDPOINT, None, {"pageSize": 10, "search": "atomic habits"})])
            self.assertIn("con 11 ban co the muon (Chi Nhanh District 1 4, Chi nhánh Hà Nội – Hoàn Kiếm 7)", result["summary"])
            self.assertNotIn("Authorization", result["summary"])
            book = result["raw"]["Catalog Books"][0]
            self.assertEqual((book["quantity"], book["pickup_warehouse_id"]), (11, "w-hk"))  # most copies

    def test_no_copies_says_none_can_be_borrowed(self):
        gone = {**ATOMIC, "available_quantity": 0, "pickup_branches": []}
        result, _ = self._search("atomic habits", lambda p: {"data": [gone]}, None)
        self.assertIn("hien khong con ban nao co the muon", result["summary"])
        self.assertIsNone(result["raw"]["Catalog Books"][0]["pickup_warehouse_id"])

    def test_no_direct_hit_token_matches_the_catalog_pages(self):
        other = {"id": "b-2", "title": "Clean Code", "author": "Robert C. Martin", "available_quantity": 2}

        def pages(p):
            if "search" in p:
                return {"data": [], "meta": {"totalPages": 1}}
            return {"data": [ATOMIC] if p["page"] == 1 else [other], "meta": {"totalPages": 2}}

        result, calls = self._search("sach atomic cua james", pages, None)
        self.assertEqual([c[2].get("page") for c in calls], [None, 1, 2])  # stops at totalPages
        self.assertEqual([b["title"] for b in result["raw"]["Catalog Books"]], ["Atomic Habits"])
        self.assertEqual(len(result["sources"]), 1)  # cited once, not once per page

    def test_anonymous_data_question_context_has_no_technical_auth_words(self):
        # audit E-11: the prompt said "khong co Authorization token" and the model repeated it
        result = asyncio.run(retrieval.retrieve_context({"intent": "OVERDUE_LOAN_QUERY", "query": "qua han"}, None))
        text = result["summary"] + " ".join(result["warnings"])
        self.assertNotIn("Authorization", text)
        self.assertNotIn("token", text)
        self.assertIn("dang nhap", result["summary"])


if __name__ == "__main__":
    unittest.main()
