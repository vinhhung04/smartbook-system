from __future__ import annotations

import asyncio
import unittest
from unittest import mock

import embeddings
import faq_retrieval
import vector_store
from vector_store import Chunk


def run(coro):
    return asyncio.run(coro)


ENTRIES = [
    ("quy-dinh-muon-tra", "## Muon toi da bao nhieu quyen?\nMoi the muon toi da 5 quyen.", [1.0, 0.0]),
    ("phi-phat", "## Tra tre bi phat bao nhieu?\nPhi phat 5000d moi ngay qua han.", [0.0, 1.0]),
]


class FindRelevantTest(unittest.TestCase):
    def setUp(self):
        self.store = vector_store.InMemoryVectorStore()
        vector_store.set_store(self.store)
        for source_id, content, vec in ENTRIES:
            doc = run(self.store.upsert_document(
                corpus=vector_store.CORPUS_DOC, source_id=source_id,
                title=source_id, content=content, content_hash="h-" + source_id, metadata={}))
            run(self.store.upsert_chunks([Chunk(
                doc, vector_store.CORPUS_DOC, 0, content, "c-" + source_id, vec, "test-model")]))

    def tearDown(self):
        vector_store.set_store(None)

    def test_returns_match_above_threshold(self):
        with mock.patch.object(embeddings, "embed_text", return_value=embeddings.EmbedResult(vector=[1.0, 0.0], model="test-model", provider="openrouter")):
            matches = faq_retrieval.find_relevant("muon toi da bao nhieu", threshold=0.5)
        self.assertTrue(matches)
        self.assertEqual(matches[0].entry["id"], "quy-dinh-muon-tra")

    def test_entry_shape_unchanged(self):
        """AD-5: retrieval.py doc entry['question'] va entry['answer']."""
        with mock.patch.object(embeddings, "embed_text", return_value=embeddings.EmbedResult(vector=[1.0, 0.0], model="test-model", provider="openrouter")):
            matches = faq_retrieval.find_relevant("muon toi da bao nhieu", threshold=0.5)
        self.assertIn("id", matches[0].entry)
        self.assertIn("question", matches[0].entry)
        self.assertIn("answer", matches[0].entry)

    def test_below_threshold_returns_empty(self):
        # [0.6, 0.8] is a real unit vector giving cosine 0.6 against the seeded
        # [1.0, 0.0] entry — a genuine similarity that still clears no bar this
        # high, unlike an exact-match vector which would always score 1.0.
        with mock.patch.object(embeddings, "embed_text", return_value=embeddings.EmbedResult(vector=[0.6, 0.8], model="test-model", provider="openrouter")):
            self.assertEqual(faq_retrieval.find_relevant("bat ky", threshold=0.99), [])

    def test_embedding_unavailable_returns_empty(self):
        with mock.patch.object(embeddings, "embed_text", return_value=None):
            self.assertEqual(faq_retrieval.find_relevant("bat ky"), [])

    def test_empty_query_returns_empty(self):
        self.assertEqual(faq_retrieval.find_relevant("   "), [])

    def test_keyword_arm_surfaces_entry_semantic_arm_cannot(self):
        """I3: INTERNAL_DOC la hybrid, khong con semantic-only.

        Vector cua query khop TUYET DOI entry SAI ("quy-dinh-muon-tra") va la
        entry duy nhat vuot nguong, nen nhanh semantic mot minh khong bao gio
        tra ve "phi-phat". Nhung cau hoi trung tung chu voi noi dung cua
        "phi-phat" ("phi phat ... qua han") va khong token nao cham vao entry
        kia — chi nhanh keyword dua duoc no vao ket qua.
        """
        with mock.patch.object(embeddings, "embed_text", return_value=embeddings.EmbedResult(vector=[1.0, 0.0], model="test-model", provider="openrouter")):
            matches = faq_retrieval.find_relevant("phi phat qua han", threshold=0.5)
        self.assertIn("phi-phat", [match.entry["id"] for match in matches])

    def test_embedding_failure_still_surfaces_a_real_keyword_match(self):
        """Unlike the old contract (embedding failure -> always []), a keyword
        hit must still come back when OpenRouter is unavailable - same
        degrade-to-keyword-only behaviour book search already has."""
        with mock.patch.object(embeddings, "embed_text", return_value=None):
            matches = faq_retrieval.find_relevant("phi phat qua han")
        self.assertEqual([match.entry["id"] for match in matches], ["phi-phat"])

    def test_find_relevant_with_confidence_reports_no_evidence_on_empty_query(self):
        matches, result = faq_retrieval.find_relevant_with_confidence("   ")
        self.assertEqual(matches, [])
        self.assertEqual(result.decision, "NO_EVIDENCE")

    def test_find_relevant_with_confidence_is_not_no_evidence_for_a_real_match(self):
        with mock.patch.object(embeddings, "embed_text", return_value=embeddings.EmbedResult(vector=[1.0, 0.0], model="test-model", provider="openrouter")):
            matches, result = faq_retrieval.find_relevant_with_confidence("muon toi da bao nhieu", threshold=0.5)
        self.assertTrue(matches)
        self.assertNotEqual(result.decision, "NO_EVIDENCE")

    def test_unrelated_query_is_no_evidence_and_abstention_withholds_it(self):
        with mock.patch.object(embeddings, "embed_text", return_value=embeddings.EmbedResult(vector=[0.0, 0.0], model="test-model", provider="openrouter")):
            matches, result = faq_retrieval.find_relevant_with_confidence("xe dap dien di dau")
        self.assertEqual(matches, [])
        self.assertEqual(result.decision, "NO_EVIDENCE")
        self.assertEqual(faq_retrieval.find_relevant("xe dap dien di dau"), [])

    def test_keyword_arm_alone_matches_when_semantic_below_threshold(self):
        """Nguong ap len diem cosine cua nhanh semantic TRUOC fusion, khong ap
        len diem RRF: semantic bi loai sach ma keyword van khop thi van co
        ket qua (cung quy uoc voi gate keyword ben _score_and_rank_books)."""
        with mock.patch.object(embeddings, "embed_text", return_value=embeddings.EmbedResult(vector=[0.6, 0.8], model="test-model", provider="openrouter")):
            matches = faq_retrieval.find_relevant("phi phat qua han", threshold=0.99)
        self.assertEqual([match.entry["id"] for match in matches], ["phi-phat"])


if __name__ == "__main__":
    unittest.main()
