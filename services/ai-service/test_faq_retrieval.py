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
        with mock.patch.object(embeddings, "embed_text", return_value=[1.0, 0.0]):
            matches = faq_retrieval.find_relevant("muon toi da bao nhieu", threshold=0.5)
        self.assertTrue(matches)
        self.assertEqual(matches[0].entry["id"], "quy-dinh-muon-tra")

    def test_entry_shape_unchanged(self):
        """AD-5: retrieval.py doc entry['question'] va entry['answer']."""
        with mock.patch.object(embeddings, "embed_text", return_value=[1.0, 0.0]):
            matches = faq_retrieval.find_relevant("muon toi da bao nhieu", threshold=0.5)
        self.assertIn("id", matches[0].entry)
        self.assertIn("question", matches[0].entry)
        self.assertIn("answer", matches[0].entry)

    def test_below_threshold_returns_empty(self):
        # [0.6, 0.8] is a real unit vector giving cosine 0.6 against the seeded
        # [1.0, 0.0] entry — a genuine similarity that still clears no bar this
        # high, unlike an exact-match vector which would always score 1.0.
        with mock.patch.object(embeddings, "embed_text", return_value=[0.6, 0.8]):
            self.assertEqual(faq_retrieval.find_relevant("bat ky", threshold=0.99), [])

    def test_embedding_unavailable_returns_empty(self):
        with mock.patch.object(embeddings, "embed_text", return_value=None):
            self.assertEqual(faq_retrieval.find_relevant("bat ky"), [])

    def test_empty_query_returns_empty(self):
        self.assertEqual(faq_retrieval.find_relevant("   "), [])


if __name__ == "__main__":
    unittest.main()
