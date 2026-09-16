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
        self.store = PgVectorStore()
        asyncio.run(db.init_db())
        asyncio.run(self._clean())

    async def _clean(self):
        from sqlalchemy import text
        import db
        # Each asyncio.run() call in this test file starts a fresh event loop.
        # db.engine's default pool hands out asyncpg connections bound to
        # whichever loop opened them — reusing one from a *previous*, now-closed
        # loop crashes with "Future attached to a different loop". dispose()
        # drops any pooled connections left over from the previous asyncio.run()
        # before this loop's queries run.
        await db.engine.dispose()
        async with db.engine.begin() as conn:
            await conn.execute(text("DELETE FROM ai_documents WHERE source_id LIKE 'test-%'"))

    def _vec(self, lead: float) -> list[float]:
        vec = [0.0] * self.vector_store.EMBEDDING_DIM
        vec[0] = lead
        vec[1] = 1.0 - lead
        return vec

    async def _dispose_stale_pool(self):
        """See the comment in `_clean` above — same reason, repeated at the
        start of every scenario() run under its own asyncio.run()."""
        import db
        await db.engine.dispose()

    def test_roundtrip_semantic_and_keyword(self):
        async def scenario():
            await self._dispose_stale_pool()
            doc = await self.store.upsert_document(
                corpus=self.vector_store.CORPUS_BOOK, source_id="test-b1",
                title="Python co ban", content="Huong dan lap trinh Python",
                content_hash="h1", metadata={"author": "A"})
            await self.store.upsert_chunks([self.vector_store.Chunk(
                doc, self.vector_store.CORPUS_BOOK, 0,
                "Huong dan lap trinh Python", "c1", self._vec(1.0), "test-model")])
            # Second book, so source_ids filtering below actually excludes something.
            doc2 = await self.store.upsert_document(
                corpus=self.vector_store.CORPUS_BOOK, source_id="test-b3",
                title="Java co ban", content="Huong dan lap trinh Java",
                content_hash="h1", metadata={"author": "B"})
            await self.store.upsert_chunks([self.vector_store.Chunk(
                doc2, self.vector_store.CORPUS_BOOK, 0,
                "Huong dan lap trinh Java", "c1", self._vec(1.0), "test-model")])
            semantic = await self.store.search_semantic(
                self.vector_store.CORPUS_BOOK, self._vec(1.0), k=5)
            keyword = await self.store.search_keyword(
                self.vector_store.CORPUS_BOOK, "python", k=5)
            hashes = await self.store.existing_chunk_hashes(doc)
            semantic_filtered = await self.store.search_semantic(
                self.vector_store.CORPUS_BOOK, self._vec(1.0), k=5,
                source_ids=["test-b1"])
            keyword_filtered = await self.store.search_keyword(
                self.vector_store.CORPUS_BOOK, "lap trinh", k=5,
                source_ids=["test-b1"])
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
            await self._dispose_stale_pool()
            first = await self.store.upsert_document(
                corpus=self.vector_store.CORPUS_BOOK, source_id="test-b2", title="T",
                content="C", content_hash="h1", metadata={})
            second = await self.store.upsert_document(
                corpus=self.vector_store.CORPUS_BOOK, source_id="test-b2", title="T2",
                content="C2", content_hash="h2", metadata={})
            return first, second
        first, second = asyncio.run(scenario())
        self.assertEqual(first, second)

    def test_keyword_ignores_dau(self):
        """unaccent: go khong dau van phai match noi dung co dau."""
        async def scenario():
            await self._dispose_stale_pool()
            doc = await self.store.upsert_document(
                corpus=self.vector_store.CORPUS_DOC, source_id="test-d1", title="Quy dinh",
                content="Phi phạt trả sách quá hạn", content_hash="h1", metadata={})
            await self.store.upsert_chunks([self.vector_store.Chunk(
                doc, self.vector_store.CORPUS_DOC, 0,
                "Phi phạt trả sách quá hạn", "c1", self._vec(0.5), "test-model")])
            return await self.store.search_keyword(self.vector_store.CORPUS_DOC, "phi phat", k=5)
        hits = asyncio.run(scenario())
        self.assertIn("test-d1", [hit.source_id for hit in hits])


if __name__ == "__main__":
    unittest.main()
