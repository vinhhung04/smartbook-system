from __future__ import annotations

import asyncio
import unittest
from unittest import mock

import embeddings
import ingestion
import vector_store


class ChunkMarkdownTest(unittest.TestCase):
    def test_splits_on_headings(self):
        text = "# A\nnoi dung a\n\n# B\nnoi dung b"
        chunks = ingestion.chunk_markdown(text)
        self.assertEqual(len(chunks), 2)
        self.assertIn("noi dung a", chunks[0])
        self.assertIn("noi dung b", chunks[1])

    def test_keeps_heading_with_its_body(self):
        chunks = ingestion.chunk_markdown("## Phi phat\nTra tre bi phat 5000d/ngay")
        self.assertIn("Phi phat", chunks[0])
        self.assertIn("5000d", chunks[0])

    def test_splits_long_section_on_paragraphs(self):
        body = "\n\n".join(["doan van " + str(i) + " " + "x" * 200 for i in range(10)])
        chunks = ingestion.chunk_markdown("# Dai\n" + body, max_chars=500)
        self.assertGreater(len(chunks), 1)
        self.assertTrue(all(len(chunk) <= 700 for chunk in chunks))

    def test_no_heading_still_returns_content(self):
        chunks = ingestion.chunk_markdown("chi la mot doan van thuong")
        self.assertEqual(len(chunks), 1)

    def test_empty_returns_empty(self):
        self.assertEqual(ingestion.chunk_markdown(""), [])
        self.assertEqual(ingestion.chunk_markdown("   \n  "), [])


class PlanChunksTest(unittest.TestCase):
    def test_all_new_when_nothing_exists(self):
        texts = ["a", "b"]
        self.assertEqual(ingestion.plan_chunks({}, texts), [0, 1])

    def test_skips_unchanged(self):
        texts = ["a", "b"]
        existing = {0: ingestion.chunk_hash("a"), 1: ingestion.chunk_hash("b")}
        self.assertEqual(ingestion.plan_chunks(existing, texts), [])

    def test_only_changed_index_is_replanned(self):
        texts = ["a", "b-moi"]
        existing = {0: ingestion.chunk_hash("a"), 1: ingestion.chunk_hash("b")}
        self.assertEqual(ingestion.plan_chunks(existing, texts), [1])

    def test_new_index_beyond_existing_is_planned(self):
        texts = ["a", "b"]
        existing = {0: ingestion.chunk_hash("a")}
        self.assertEqual(ingestion.plan_chunks(existing, texts), [1])


class _RaisingUpsertStore(vector_store.InMemoryVectorStore):
    """InMemoryVectorStore nhung upsert_document raise cho mot source_id cu the,
    gia lap DB that bai giua chung khi ingest nhieu tai lieu."""

    def __init__(self, fail_source_id: str) -> None:
        super().__init__()
        self._fail_source_id = fail_source_id

    async def upsert_document(self, corpus, source_id, title, content, content_hash, metadata):
        if source_id == self._fail_source_id:
            raise RuntimeError("boom: DB that bai gia lap")
        return await super().upsert_document(corpus, source_id, title, content, content_hash, metadata)


class IngestBooksResilienceTest(unittest.TestCase):
    """Loi tren MOT tai lieu (vd DB loi o upsert_document) khong duoc lam sap
    toan bo batch — day la loi finding dang sua: truoc day chi bat truong hop
    embed_batch tra ve None, con exception tu store thi van propagate ra ngoai
    va dung ca vong lap giua chung."""

    def setUp(self):
        self.store = _RaisingUpsertStore(fail_source_id="2")
        vector_store.set_store(self.store)
        self.embed_patcher = mock.patch.object(
            embeddings, "embed_batch",
            side_effect=lambda texts: embeddings.BatchEmbedResult(
                vectors=[[0.1, 0.2] for _ in texts], model="test-model", provider="openrouter"),
        )
        self.embed_mock = self.embed_patcher.start()

    def tearDown(self):
        self.embed_patcher.stop()
        vector_store.set_store(None)

    def test_one_book_failure_does_not_abort_the_batch(self):
        books = [
            {"id": 1, "title": "Sach A", "author": "Tac gia A"},
            {"id": 2, "title": "Sach B", "author": "Tac gia B"},
            {"id": 3, "title": "Sach C", "author": "Tac gia C"},
        ]

        with self.assertLogs("uvicorn.error", level="WARNING") as log_ctx:
            result = asyncio.run(ingestion.ingest_books(books))

        # Book 2 that bai nhung 1 va 3 van duoc ingest — khong dung ca batch.
        self.assertEqual(result["documents"], 2)
        self.assertEqual(result["chunks_embedded"], 2)
        self.assertEqual(result["chunks_skipped"], 0)
        self.assertTrue(any("2" in message for message in log_ctx.output))

        self.assertIn((vector_store.CORPUS_BOOK, "1"), self.store._docs)
        self.assertIn((vector_store.CORPUS_BOOK, "3"), self.store._docs)
        self.assertNotIn((vector_store.CORPUS_BOOK, "2"), self.store._docs)


class IngestEmbedFailureTest(unittest.TestCase):
    """OpenRouter is the only embedding provider now (no Ollama fallback to
    arbitrate with a circuit breaker): a failed embed call skips the
    document entirely, and the NEXT ingest run (once OpenRouter is healthy
    again) picks it up and embeds it - it is never silently lost."""

    def setUp(self):
        self.store = vector_store.InMemoryVectorStore()
        vector_store.set_store(self.store)
        self.book = {"id": 4242, "title": "Sach A", "author": "Tac gia A"}

    def tearDown(self):
        vector_store.set_store(None)

    def test_embed_failure_skips_document_then_next_run_recovers_it(self):
        with mock.patch.object(embeddings, "embed_batch", return_value=None):
            result1 = asyncio.run(ingestion.ingest_books([self.book]))

        self.assertEqual(result1["chunks_embedded"], 0)
        self.assertEqual(result1["chunks_skipped"], 1)
        # Khong co chunk nao duoc ghi -> khong co gi bi tag sai model.
        self.assertEqual(
            [row for slot in self.store._chunks.values() for row in slot.values()], [])

        healthy_result = embeddings.BatchEmbedResult(
            vectors=[[1.0, 0.0]], model=embeddings.EMBED_IDENTITY, provider="openrouter")
        with mock.patch.object(embeddings, "embed_batch", return_value=healthy_result):
            result2 = asyncio.run(ingestion.ingest_books([self.book]))

        self.assertEqual(result2["chunks_embedded"], 1)
        rows = [row for slot in self.store._chunks.values() for row in slot.values()]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["embedding_model"], embeddings.EMBED_IDENTITY)

        hits = asyncio.run(self.store.search_semantic(
            vector_store.CORPUS_BOOK, [1.0, 0.0], k=5,
            embedding_model=embeddings.EMBED_IDENTITY))
        self.assertEqual([hit.source_id for hit in hits], ["4242"])


class ChunkHashModelRotationTest(unittest.TestCase):
    """chunk_hash() folds embeddings.EMBED_IDENTITY into the hash (content +
    model + dimensions): a chunk hashed under an old identity (e.g. the
    pre-migration nomic-embed-text) is planned for re-embedding once the
    configured identity changes, even though its text never changed."""

    def test_changing_the_embedding_identity_invalidates_existing_hashes(self):
        text = "noi dung khong doi"
        with mock.patch.object(embeddings, "EMBED_IDENTITY", "nomic-embed-text@768"):
            old_hash = ingestion.chunk_hash(text)

        with mock.patch.object(embeddings, "EMBED_IDENTITY", "qwen/qwen3-embedding-8b@768"):
            new_hash = ingestion.chunk_hash(text)
            todo = ingestion.plan_chunks({0: old_hash}, [text])

        self.assertNotEqual(old_hash, new_hash)
        self.assertEqual(todo, [0])


if __name__ == "__main__":
    unittest.main()
