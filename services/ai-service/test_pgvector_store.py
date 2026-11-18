"""Integration test cham vao Postgres that. Skip khi khong co —
`python -m unittest discover` van chay duoc tren may khong dung Docker.

Chay co Postgres:
    TEST_PG_DSN=postgresql+asyncpg://user:pass@127.0.0.1:25432/ai_pg_audit_<8hex> \
        python -m unittest test_pgvector_store -v
"""
from __future__ import annotations

import asyncio
import os
import re
import unittest
from urllib.parse import urlsplit

import embeddings

TEST_DSN = os.getenv("TEST_PG_DSN", "")
_VERIFIED_EMPTY_TARGETS: set[str] = set()


def validate_disposable_pg_target(dsn: str) -> None:
    """Catalog sync intentionally removes documents; never aim it at a user DB."""
    target = urlsplit(dsn)
    if (target.scheme != "postgresql+asyncpg"
            or target.hostname not in {"127.0.0.1", "localhost"}
            or target.port not in {5432, 15432, 25432}
            or not re.fullmatch(r"/ai_pg_audit_[a-f0-9]{8}", target.path)
            or target.query or target.fragment):
        raise RuntimeError("AI PG tests require a fresh loopback ai_pg_audit_<8hex> database")


async def verify_empty_audit_database(db) -> None:
    validate_disposable_pg_target(TEST_DSN)
    if TEST_DSN in _VERIFIED_EMPTY_TARGETS:
        return
    from sqlalchemy import text
    async with db.engine.connect() as connection:
        tables = list((await connection.execute(text(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema='public' AND table_type='BASE TABLE'"))).scalars())
        if not {"ai_documents", "ai_pending_actions", "ai_inference_leases"}.issubset(tables):
            raise RuntimeError("Run the explicit AI schema owner migration before PG tests")
        for table in tables:
            # Names come from server metadata, quoted as SQL identifiers.
            quoted = '"' + table.replace('"', '""') + '"'
            if await connection.scalar(text(f'SELECT EXISTS (SELECT 1 FROM public.{quoted})')):
                raise RuntimeError("AI PG tests refuse a populated database; create a new audit target")
    _VERIFIED_EMPTY_TARGETS.add(TEST_DSN)


@unittest.skipUnless(TEST_DSN, "TEST_PG_DSN khong duoc set — bo qua integration test")
class PgVectorStoreTest(unittest.TestCase):
    def setUp(self):
        validate_disposable_pg_target(TEST_DSN)
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
            await verify_empty_audit_database(db)
            await db.init_db()
            await db.engine.dispose()

        self.store = PgVectorStore()
        asyncio.run(_init_and_dispose())
        asyncio.run(self._clean())
        # The strict fresh-target guard above ensures these cleanup operations
        # can only affect fixtures created by this test process.
        self.addCleanup(lambda: asyncio.run(self._clean()))

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

    def test_list_and_delete_documents_for_catalog_sync(self):
        """catalog_sync.py doc trang thai ca corpus trong mot query, cat chunk mo
        coi va go document theo source_id (chunk di theo ON DELETE CASCADE)."""
        corpus = self.vector_store.CORPUS_BOOK

        async def scenario():
            doc = await self.store.upsert_document(
                corpus=corpus, source_id="test-s1", title="Sach",
                content="Sach", content_hash="h1", metadata={"isbn": "1", "author": None})
            await self.store.upsert_chunks([
                self.vector_store.Chunk(doc, corpus, index, f"phan {index}", f"c{index}",
                                        self._vec(0.5), embeddings.EMBED_IDENTITY)
                for index in range(3)
            ])
            await self.store.upsert_document(
                corpus=corpus, source_id="test-s2", title="Rong",
                content="Rong", content_hash="h2", metadata={})
            listed = await self.store.list_documents(corpus)
            trimmed = await self.store.delete_chunks_from(doc, 1)
            after_trim = await self.store.existing_chunk_hashes(doc)
            removed = await self.store.delete_documents(corpus, ["test-s1", "test-s2", "test-missing"])
            after_delete = await self.store.list_documents(corpus)
            import db
            await db.engine.dispose()
            return listed, trimmed, after_trim, removed, after_delete

        listed, trimmed, after_trim, removed, after_delete = asyncio.run(scenario())
        self.assertEqual(listed["test-s1"].chunk_hashes, {0: "c0", 1: "c1", 2: "c2"})
        self.assertEqual(listed["test-s1"].metadata, {"isbn": "1", "author": None})
        self.assertEqual(listed["test-s2"].chunk_hashes, {})
        self.assertEqual(trimmed, 2)
        self.assertEqual(after_trim, {0: "c0"})
        self.assertEqual(removed, 2)
        self.assertNotIn("test-s1", after_delete)
        self.assertNotIn("test-s2", after_delete)

    def test_catalog_sync_end_to_end_on_postgres(self):
        """catalog_sync tren Postgres that: lan 2 khong embed lai gi, doi mo ta
        thi chi embed lai quyen do va tim kiem thay noi dung moi, quyen bien
        mat khoi catalog bi go — khong co document/chunk trung lap."""
        from unittest import mock

        import catalog_sync

        corpus = self.vector_store.CORPUS_BOOK
        calls: list[int] = []

        def fake_embed(texts):
            calls.append(len(texts))
            return embeddings.BatchEmbedResult(
                vectors=[self._vec(1.0 if "python" in text.lower() else 0.2) for text in texts],
                model=embeddings.EMBED_IDENTITY, provider="fake")

        def book(book_id, description):
            return {"id": book_id, "title": f"Sach {book_id}", "author": None,
                    "category": "Tin hoc", "description": description, "isbn": None}

        async def scenario():
            self.vector_store.set_store(self.store)
            catalog = [book("test-c1", "nau an"), book("test-c2", "lich su"), book("test-c3", "dia ly")]

            async def fetch():
                return list(catalog)

            with mock.patch.object(embeddings, "embed_batch", side_effect=fake_embed):
                first = await catalog_sync.sync_book_corpus(fetch=fetch)
                second = await catalog_sync.sync_book_corpus(fetch=fetch)
                calls_before_change = list(calls)
                catalog[0] = book("test-c1", "lap trinh python")
                del catalog[2]
                third = await catalog_sync.sync_book_corpus(fetch=fetch)
            hits = await self.store.search_semantic(
                corpus, self._vec(1.0), k=1, embedding_model=embeddings.EMBED_IDENTITY,
                source_ids=["test-c1", "test-c2"])
            state = await self.store.list_documents(corpus)
            self.vector_store.set_store(None)
            import db
            await db.engine.dispose()
            return first, second, third, calls_before_change, hits, state

        first, second, third, calls_before_change, hits, state = asyncio.run(scenario())
        self.assertEqual(first["last_stats"]["embedded"], 3)
        self.assertEqual(second["last_stats"]["unchanged"], 3)
        self.assertEqual(calls_before_change, [1, 1, 1])
        self.assertEqual(third["last_stats"]["embedded"], 1)
        self.assertEqual(third["last_stats"]["removed"], 1)
        self.assertEqual(hits[0].source_id, "test-c1")
        self.assertIn("python", hits[0].content)
        test_docs = {sid: s for sid, s in state.items() if sid.startswith("test-c")}
        self.assertEqual(set(test_docs), {"test-c1", "test-c2"})
        self.assertTrue(all(list(s.chunk_hashes) == [0] for s in test_docs.values()))


if __name__ == "__main__":
    unittest.main()
