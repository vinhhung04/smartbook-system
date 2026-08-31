from __future__ import annotations

import asyncio
import unittest
from unittest import mock

import faq_retrieval
import retrieval
from faq_retrieval import FAQMatch
from intent import GENERAL_QUERY


class GeneralQueryRetrievalTests(unittest.TestCase):
    def test_general_query_with_faq_match_returns_summary_and_sources(self):
        fake_entry = {
            "id": "test-faq",
            "category": "general",
            "question": "Cau hoi mau?",
            "answer": "Tra loi mau.",
        }
        with mock.patch.object(
            faq_retrieval, "find_relevant", return_value=[FAQMatch(entry=fake_entry, score=0.9)]
        ):
            result = asyncio.run(
                retrieval.retrieve_context({"intent": GENERAL_QUERY, "query": "cau hoi mau"}, auth_header=None)
            )

        self.assertIn("Tra loi mau.", result["summary"])
        self.assertTrue(result["sources"])
        self.assertEqual(result["sources"][0]["status"], "ok")
        self.assertEqual(result["raw"]["faq_matches"][0]["id"], "test-faq")

    def test_general_query_without_faq_match_returns_empty_envelope(self):
        with mock.patch.object(faq_retrieval, "find_relevant", return_value=[]):
            result = asyncio.run(
                retrieval.retrieve_context({"intent": GENERAL_QUERY, "query": "cau hoi la"}, auth_header=None)
            )

        self.assertEqual(result["summary"], "")
        self.assertEqual(result["sources"], [])

    def test_general_query_survives_faq_lookup_exception(self):
        """retrieve_context must never propagate an embedding-layer failure to /chat."""
        with mock.patch.object(faq_retrieval, "find_relevant", side_effect=RuntimeError("boom")):
            result = asyncio.run(
                retrieval.retrieve_context({"intent": GENERAL_QUERY, "query": "cau hoi loi"}, auth_header=None)
            )

        self.assertEqual(result["summary"], "")
        self.assertEqual(result["sources"], [])


if __name__ == "__main__":
    unittest.main()
