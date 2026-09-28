"""Integration test cham vao Postgres that. Skip khi khong co —
`python -m unittest discover` van chay duoc tren may khong dung Docker.

Chay co Postgres:
    TEST_PG_DSN=postgresql+asyncpg://user:pass@localhost:5432/ai_db \
        python -m unittest test_pgvector_store -v
"""
from __future__ import annotations

import asyncio
import os
import unittest

import embeddings

TEST_DSN = os.getenv("TEST_PG_DSN", "")


@unittest.skipUnless(TEST_DSN, "TEST_PG_DSN khong duoc set — bo qua integration test")
class PgVectorStoreTest(unittest.TestCase):
    def setUp(self):
        os.environ["DATABASE_URL"] = TEST_DSN
        import importlib
        import db, vector_store
        importlib.reload(db)
        importlib.reload(vector_store)
        from pg_vector_store import PgVectorStore
        self.vector_store = vector_store

        async def _init_and_dispose():
            # Each asyncio.run() call in this test file starts a fresh event
            # loop. db.engine's default pool hands out asyncpg connections
            # bound to whichever loop opened them — reusing one from a
            # *previous*, now-closed loop crashes with "Future attached to a
            # different loop". Per SQLAlchemy's own docs, dispose() belongs
            # at the END of the coroutine that owns the engine for this loop,
            # while the loop is still alive — not at the start of the next
            # one trying to clean up after an already-dead loop.
            await db.init_db()
            await db.engine.dispose()

        self.store = PgVectorStore()
        asyncio.run(_init_and_dispose())
        asyncio.run(self._clean())

    async def _clean(self):
        from sqlalchemy import text
        import db
        async with db.engine.begin() as conn:
            await conn.execute(text("DELETE FROM ai_documents WHERE source_id LIKE 'test-%'"))
        # Dispose as the last thing this coroutine does, before asyncio.run()
        # returns and this loop closes — see the comment in setUp() above.
        await db.engine.dispose()

    def _vec(self, lead: float) -> list[float]:
        vec = [0.0] * self.vector_store.EMBEDDING_DIM
        vec[0] = lead
        vec[1] = 1.0 - lead
        return vec

    def test_roundtrip_semantic_and_keyword(self):
        async def scenario():
            doc = await self.store.upsert_document(
                corpus=self.vector_store.CORPUS_BOOK, source_id="test-b1",
                title="Python co ban", content="Huong dan lap trinh Python",
                content_hash="h1", metadata={"author": "A"})
            await self.store.upsert_chunks([self.vector_store.Chunk(
                doc, self.vector_store.CORPUS_BOOK, 0,
                "Huong dan lap trinh Python", "c1", self._vec(1.0), embeddings.EMBED_MODEL)])
            # Second book, so source_ids filtering below actually excludes something.
            doc2 = await self.store.upsert_document(
                corpus=self.vector_store.CORPUS_BOOK, source_id="test-b3",
                title="Java co ban", content="Huong dan lap trinh Java",
                content_hash="h1", metadata={"author": "B"})
            await self.store.upsert_chunks([self.vector_store.Chunk(
                doc2, self.vector_store.CORPUS_BOOK, 0,
                "Huong dan lap trinh Java", "c1", self._vec(1.0), embeddings.EMBED_MODEL)])
            semantic = await self.store.search_semantic(
                self.vector_store.CORPUS_BOOK, self._vec(1.0), k=5,
                embedding_model=embeddings.EMBED_MODEL)
            keyword = await self.store.search_keyword(
                self.vector_store.CORPUS_BOOK, "python", k=5)
            hashes = await self.store.existing_chunk_hashes(doc)
            semantic_filtered = await self.store.search_semantic(
                self.vector_store.CORPUS_BOOK, self._vec(1.0), k=5,
                embedding_model=embeddings.EMBED_MODEL, source_ids=["test-b1"])
            keyword_filtered = await self.store.search_keyword(
                self.vector_store.CORPUS_BOOK, "lap trinh", k=5,
                source_ids=["test-b1"])
            # Dispose as the last statement of this coroutine, before this
            # loop closes — see the comment in setUp() above.
            import db
            await db.engine.dispose()
            return semantic, keyword, hashes, semantic_filtered, keyword_filtered

        semantic, keyword, hashes, semantic_filtered, keyword_filtered = asyncio.run(scenario())
        self.assertIn("test-b1", [hit.source_id for hit in semantic])
        self.assertAlmostEqual(semantic[0].score, 1.0, places=4)
        self.assertIn("test-b1", [hit.source_id for hit in keyword])
        self.assertEqual(hashes, {0: "c1"})
        # source_ids=[...] must include the requested book and exclude the other.
        self.assertIn("test-b1", [hit.source_id for hit in semantic_filtered])
        self.assertNotIn("test-b3", [hit.source_id for hit in semantic_filtered])
        self.assertIn("test-b1", [hit.source_id for hit in keyword_filtered])
        self.assertNotIn("test-b3", [hit.source_id for hit in keyword_filtered])

    def test_upsert_document_idempotent(self):
        async def scenario():
            first = await self.store.upsert_document(
                corpus=self.vector_store.CORPUS_BOOK, source_id="test-b2", title="T",
                content="C", content_hash="h1", metadata={})
            second = await self.store.upsert_document(
                corpus=self.vector_store.CORPUS_BOOK, source_id="test-b2", title="T2",
                content="C2", content_hash="h2", metadata={})
            # Dispose as the last statement of this coroutine, before this
            # loop closes — see the comment in setUp() above.
            import db
            await db.engine.dispose()
            return first, second
        first, second = asyncio.run(scenario())
        self.assertEqual(first, second)

    def test_delete_chunks_except_model_removes_only_stale_rows(self):
        async def scenario():
            doc = await self.store.upsert_document(
                corpus=self.vector_store.CORPUS_BOOK, source_id="test-b4",
                title="Sach cu", content="Noi dung cu", content_hash="h1", metadata={})
            await self.store.upsert_chunks([
                self.vector_store.Chunk(
                    doc, self.vector_store.CORPUS_BOOK, 0, "Noi dung cu", "c1",
                    self._vec(1.0), "stale-model@768"),
            ])
            doc2 = await self.store.upsert_document(
                corpus=self.vector_store.CORPUS_BOOK, source_id="test-b5",
                title="Sach moi", content="Noi dung moi", content_hash="h1", metadata={})
            await self.store.upsert_chunks([
                self.vector_store.Chunk(
                    doc2, self.vector_store.CORPUS_BOOK, 0, "Noi dung moi", "c1",
                    self._vec(1.0), embeddings.EMBED_IDENTITY),
            ])

            deleted = await self.store.delete_chunks_except_model(embeddings.EMBED_IDENTITY)
            remaining_stale = await self.store.existing_chunk_hashes(doc)
            remaining_current = await self.store.existing_chunk_hashes(doc2)
            import db
            await db.engine.dispose()
            return deleted, remaining_stale, remaining_current

        deleted, remaining_stale, remaining_current = asyncio.run(scenario())
        self.assertGreaterEqual(deleted, 1)
        self.assertEqual(remaining_stale, {})
        self.assertEqual(remaining_current, {0: "c1"})

    def test_keyword_ignores_dau(self):
        """unaccent: go khong dau van phai match noi dung co dau."""
        async def scenario():
            doc = await self.store.upsert_document(
                corpus=self.vector_store.CORPUS_DOC, source_id="test-d1", title="Quy dinh",
                content="Phi phạt trả sách quá hạn", content_hash="h1", metadata={})
            await self.store.upsert_chunks([self.vector_store.Chunk(
                doc, self.vector_store.CORPUS_DOC, 0,
                "Phi phạt trả sách quá hạn", "c1", self._vec(0.5), embeddings.EMBED_MODEL)])
            hits = await self.store.search_keyword(self.vector_store.CORPUS_DOC, "phi phat", k=5)
            # Dispose as the last statement of this coroutine, before this
            # loop closes — see the comment in setUp() above.
            import db
            await db.engine.dispose()
            return hits
        hits = asyncio.run(scenario())
        self.assertIn("test-d1", [hit.source_id for hit in hits])


if __name__ == "__main__":
    unittest.main()
