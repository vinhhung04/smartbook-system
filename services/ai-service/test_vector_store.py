from __future__ import annotations

import asyncio
import unittest

import vector_store
from vector_store import Chunk


def run(coro):
    return asyncio.run(coro)


class InMemoryVectorStoreTest(unittest.TestCase):
    def setUp(self):
        self.store = vector_store.InMemoryVectorStore()

    def _seed(self):
        doc_a = run(self.store.upsert_document(
            corpus=vector_store.CORPUS_BOOK, source_id="b1", title="Python co ban",
            content="Huong dan lap trinh Python", content_hash="h1", metadata={"author": "A"}))
        doc_b = run(self.store.upsert_document(
            corpus=vector_store.CORPUS_BOOK, source_id="b2", title="Ky nang song",
            content="Day tre tu phuc vu", content_hash="h2", metadata={"author": "B"}))
        run(self.store.upsert_chunks([
            Chunk(doc_a, vector_store.CORPUS_BOOK, 0, "Huong dan lap trinh Python", "c1", [1.0, 0.0], "m"),
            Chunk(doc_b, vector_store.CORPUS_BOOK, 0, "Day tre tu phuc vu", "c2", [0.0, 1.0], "m"),
        ]))
        return doc_a, doc_b

    def test_upsert_document_is_idempotent_per_source_id(self):
        first = run(self.store.upsert_document(
            corpus=vector_store.CORPUS_BOOK, source_id="b1", title="T",
            content="C", content_hash="h1", metadata={}))
        second = run(self.store.upsert_document(
            corpus=vector_store.CORPUS_BOOK, source_id="b1", title="T2",
            content="C2", content_hash="h2", metadata={}))
        self.assertEqual(first, second)

    def test_search_semantic_ranks_by_cosine(self):
        self._seed()
        hits = run(self.store.search_semantic(vector_store.CORPUS_BOOK, [1.0, 0.0], k=2, embedding_model="m"))
        self.assertEqual([hit.source_id for hit in hits], ["b1", "b2"])
        self.assertAlmostEqual(hits[0].score, 1.0)

    def test_search_semantic_restricted_to_source_ids(self):
        self._seed()
        hits = run(self.store.search_semantic(
            vector_store.CORPUS_BOOK, [1.0, 0.0], k=5, embedding_model="m", source_ids=["b2"]))
        self.assertEqual([hit.source_id for hit in hits], ["b2"])

    def test_search_semantic_isolates_corpus(self):
        self._seed()
        hits = run(self.store.search_semantic(vector_store.CORPUS_DOC, [1.0, 0.0], k=5, embedding_model="m"))
        self.assertEqual(hits, [])

    def test_search_semantic_filters_by_embedding_model(self):
        """Chunk embed boi model khac phai bi loai — khong duoc tron hai khong
        gian vector khac nhau (AD-3/AD-7)."""
        self._seed()  # _seed dung embedding_model="m" mac dinh
        hits = run(self.store.search_semantic(
            vector_store.CORPUS_BOOK, [1.0, 0.0], k=5, embedding_model="model-khac"))
        self.assertEqual(hits, [])

    def test_search_keyword_matches_tokens(self):
        self._seed()
        hits = run(self.store.search_keyword(vector_store.CORPUS_BOOK, "python", k=5))
        self.assertEqual([hit.source_id for hit in hits], ["b1"])

    def test_existing_chunk_hashes_maps_index_to_hash(self):
        doc_a, _ = self._seed()
        self.assertEqual(run(self.store.existing_chunk_hashes(doc_a)), {0: "c1"})

    def test_upsert_chunks_replaces_same_index(self):
        doc_a, _ = self._seed()
        run(self.store.upsert_chunks([
            Chunk(doc_a, vector_store.CORPUS_BOOK, 0, "Noi dung moi", "c1-new", [0.5, 0.5], "m"),
        ]))
        self.assertEqual(run(self.store.existing_chunk_hashes(doc_a)), {0: "c1-new"})

    def test_delete_chunks_except_model_removes_only_stale_model_chunks(self):
        doc_a, doc_b = self._seed()  # both chunks embedded with model "m"
        run(self.store.upsert_chunks([
            Chunk(doc_b, vector_store.CORPUS_BOOK, 1, "Them mot chunk moi", "c3", [0.2, 0.8], "new-model"),
        ]))

        deleted = run(self.store.delete_chunks_except_model("new-model"))

        self.assertEqual(deleted, 2)  # the two "m"-tagged chunks from _seed()
        remaining = [
            row["embedding_model"]
            for slot in self.store._chunks.values() for row in slot.values()
        ]
        self.assertEqual(remaining, ["new-model"])

    def test_delete_chunks_except_model_is_a_noop_when_nothing_is_stale(self):
        self._seed()
        deleted = run(self.store.delete_chunks_except_model("m"))
        self.assertEqual(deleted, 0)


if __name__ == "__main__":
    unittest.main()
