"""catalog_sync.py: dong bo BOOK_METADATA voi feed noi bo cua inventory-service.

Khong can mang/DB/OpenRouter: HTTP di qua httpx.MockTransport, vector store la
InMemoryVectorStore, embedding duoc mock o embeddings.embed_batch. Moi test
tuong ung mot yeu cau cua co che dong bo (phan trang, retry, xac thuc
service-to-service, incremental, go bo sach, embedding provider loi,
idempotent) va la regression test cho loi task_5448fb5f: corpus sach luon rong
vi startup goi /api/books khong co JWT.
"""
from __future__ import annotations

import asyncio
import os
import unittest
from unittest import mock

import httpx

import catalog_sync
import embeddings
import ingestion
import vector_store

KEY = "test-internal-key-123"


def _book(book_id: str, title: str, description: str = "", isbn: str | None = None, **extra) -> dict:
    return {"id": book_id, "title": title, "author": "Tac gia", "category": "The loai",
            "description": description, "summary_vi": None, "isbn": isbn, **extra}


def _vec_for(text: str) -> list[float]:
    # Vector xac dinh theo noi dung: sach co tu "python" nghieng ve truc 0.
    lead = 1.0 if "python" in text.lower() else 0.1
    return [lead, 1.0 - lead]


class _FakeEmbed:
    """Thay embeddings.embed_batch: dem so text da embed, co the gia lap provider chet."""

    def __init__(self, healthy: bool = True) -> None:
        self.healthy = healthy
        self.calls: list[list[str]] = []

    def __call__(self, texts):
        self.calls.append(list(texts))
        if not self.healthy:
            return None
        return embeddings.BatchEmbedResult(
            vectors=[_vec_for(text) for text in texts], model=embeddings.EMBED_IDENTITY, provider="fake")

    @property
    def embedded_texts(self) -> int:
        return sum(len(batch) for batch in self.calls) if self.healthy else 0


class _Base(unittest.TestCase):
    def setUp(self) -> None:
        self.store = vector_store.InMemoryVectorStore()
        vector_store.set_store(self.store)
        self.addCleanup(vector_store.set_store, None)
        self.embed = _FakeEmbed()
        patcher = mock.patch.object(embeddings, "embed_batch", side_effect=self.embed)
        patcher.start()
        self.addCleanup(patcher.stop)
        env = mock.patch.dict(os.environ, {"INTERNAL_SERVICE_KEY": KEY})
        env.start()
        self.addCleanup(env.stop)
        # Khong cho that giua cac lan retry.
        sleep = mock.patch.object(catalog_sync, "_sleep", new=mock.AsyncMock())
        self.sleep = sleep.start()
        self.addCleanup(sleep.stop)
        catalog_sync._status.update(
            running=False, last_started_at=None, last_finished_at=None, last_success_at=None,
            last_outcome=None, last_error=None, last_stats=None, consecutive_failures=0)

    def sync(self, books):
        async def fetch():
            return list(books)
        return asyncio.run(catalog_sync.sync_book_corpus(fetch=fetch))

    def corpus_ids(self) -> set[str]:
        return set(asyncio.run(self.store.list_documents(vector_store.CORPUS_BOOK)))


class FetchCatalogTest(unittest.TestCase):
    def setUp(self) -> None:
        env = mock.patch.dict(os.environ, {"INTERNAL_SERVICE_KEY": KEY})
        env.start()
        self.addCleanup(env.stop)
        sleep = mock.patch.object(catalog_sync, "_sleep", new=mock.AsyncMock())
        self.sleep = sleep.start()
        self.addCleanup(sleep.stop)

    def _fetch(self, handler):
        async def run():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                return await catalog_sync.fetch_catalog_books(client)
        return asyncio.run(run())

    def test_follows_every_page_and_sends_the_service_key(self):
        pages = {
            None: {"items": [_book("a", "A"), _book("b", "B")], "next_cursor": "b"},
            "b": {"items": [_book("c", "C")], "next_cursor": "c"},
            "c": {"items": [], "next_cursor": None},
        }
        seen = []

        def handler(request: httpx.Request) -> httpx.Response:
            seen.append(request)
            return httpx.Response(200, json=pages[request.url.params.get("after")])

        books = self._fetch(handler)
        self.assertEqual([book["id"] for book in books], ["a", "b", "c"])
        self.assertEqual(len(seen), 3)
        self.assertTrue(all(req.headers["x-internal-service-key"] == KEY for req in seen))
        self.assertTrue(all(req.url.path == "/internal/catalog/books" for req in seen))
        self.assertNotIn("authorization", seen[0].headers)

    def test_retries_a_transient_5xx_then_succeeds(self):
        responses = [httpx.Response(503), httpx.Response(200, json={"items": [_book("a", "A")]})]
        books = self._fetch(lambda request: responses.pop(0))
        self.assertEqual([book["id"] for book in books], ["a"])
        self.assertEqual(self.sleep.await_count, 1)

    def test_retries_a_timeout_and_gives_up_after_max_attempts(self):
        def handler(request):
            raise httpx.ReadTimeout("slow", request=request)

        with self.assertRaises(catalog_sync.CatalogFetchError):
            self._fetch(handler)
        self.assertEqual(self.sleep.await_count, catalog_sync.CATALOG_SYNC_MAX_ATTEMPTS - 1)

    def test_rejected_key_fails_fast_without_retry(self):
        calls = []

        def handler(request):
            calls.append(request)
            return httpx.Response(403, json={"message": "Forbidden"})

        with self.assertRaises(catalog_sync.CatalogFetchError) as ctx:
            self._fetch(handler)
        self.assertEqual(len(calls), 1)
        self.assertIn("INTERNAL_SERVICE_KEY", str(ctx.exception))

    def test_missing_key_never_calls_inventory(self):
        with mock.patch.dict(os.environ, {"INTERNAL_SERVICE_KEY": ""}):
            with self.assertRaises(catalog_sync.CatalogFetchError):
                self._fetch(lambda request: self.fail("khong duoc goi HTTP khi chua co khoa"))

    def test_repeating_cursor_is_an_error_not_an_infinite_loop(self):
        payload = {"items": [_book("a", "A")], "next_cursor": "a"}
        with self.assertRaises(catalog_sync.CatalogFetchError):
            self._fetch(lambda request: httpx.Response(200, json=payload))

    def test_malformed_payload_is_an_error(self):
        with self.assertRaises(catalog_sync.CatalogFetchError):
            self._fetch(lambda request: httpx.Response(200, json=[_book("a", "A")]))


class SyncBookCorpusTest(_Base):
    def test_regression_seeded_catalog_fills_book_corpus(self):
        """task_5448fb5f: sau khi seed va dong bo, BOOK_METADATA phai day du."""
        books = [_book(str(i), f"Sach {i}", "mo ta") for i in range(25)]
        status = self.sync(books)
        self.assertEqual(status["last_outcome"], "ok")
        self.assertEqual(self.corpus_ids(), {str(i) for i in range(25)})
        self.assertEqual(status["last_stats"]["embedded"], 25)

    def test_second_run_is_incremental_and_calls_no_embedding(self):
        books = [_book("1", "Lap trinh Python"), _book("2", "Lich su Viet Nam")]
        self.sync(books)
        calls_after_first = len(self.embed.calls)

        status = self.sync(books)
        self.assertEqual(len(self.embed.calls), calls_after_first)
        self.assertEqual(status["last_stats"]["unchanged"], 2)
        self.assertEqual(status["last_stats"]["embedded"], 0)

    def test_metadata_change_reembeds_only_that_book_and_search_sees_it(self):
        books = [_book("1", "Sach mot", "ve nau an"), _book("2", "Sach hai", "ve lich su")]
        self.sync(books)
        self.embed.calls.clear()

        books[0] = _book("1", "Sach mot", "nhap mon lap trinh python")
        status = self.sync(books)
        self.assertEqual(status["last_stats"]["embedded"], 1)
        self.assertEqual(status["last_stats"]["unchanged"], 1)
        self.assertEqual(len(self.embed.calls), 1)
        self.assertIn("python", self.embed.calls[0][0])

        hits = asyncio.run(self.store.search_semantic(
            vector_store.CORPUS_BOOK, [1.0, 0.0], k=1, embedding_model=embeddings.EMBED_IDENTITY))
        self.assertEqual(hits[0].source_id, "1")
        self.assertIn("python", hits[0].content)
        keyword = asyncio.run(self.store.search_keyword(vector_store.CORPUS_BOOK, "python", k=5))
        self.assertEqual([hit.source_id for hit in keyword], ["1"])

    def test_isbn_only_change_updates_metadata_without_embedding(self):
        books = [_book("1", "Sach", "mo ta", isbn="111")]
        self.sync(books)
        self.embed.calls.clear()

        status = self.sync([_book("1", "Sach", "mo ta", isbn="9786041234567")])
        self.assertEqual(self.embed.calls, [])
        self.assertEqual(status["last_stats"]["updated_without_embedding"], 1)
        state = asyncio.run(self.store.list_documents(vector_store.CORPUS_BOOK))["1"]
        self.assertEqual(state.metadata["isbn"], "9786041234567")

    def test_book_missing_from_full_scan_is_removed(self):
        self.sync([_book("1", "A"), _book("2", "B"), _book("3", "C")])
        status = self.sync([_book("1", "A"), _book("3", "C")])
        self.assertEqual(status["last_stats"]["removed"], 1)
        self.assertEqual(self.corpus_ids(), {"1", "3"})
        hits = asyncio.run(self.store.search_keyword(vector_store.CORPUS_BOOK, "B", k=5))
        self.assertNotIn("2", [hit.source_id for hit in hits])

    def test_failed_fetch_never_removes_anything(self):
        self.sync([_book("1", "A"), _book("2", "B")])

        async def broken_fetch():
            raise catalog_sync.CatalogFetchError("inventory down")

        status = asyncio.run(catalog_sync.sync_book_corpus(fetch=broken_fetch))
        self.assertEqual(status["last_outcome"], "failed")
        self.assertEqual(status["consecutive_failures"], 1)
        self.assertIn("inventory down", status["last_error"])
        self.assertEqual(self.corpus_ids(), {"1", "2"})

    def test_empty_catalog_does_not_wipe_a_populated_corpus(self):
        self.sync([_book("1", "A"), _book("2", "B")])
        status = self.sync([])
        self.assertEqual(status["last_outcome"], "degraded")
        self.assertTrue(status["last_stats"]["removal_skipped"])
        self.assertEqual(self.corpus_ids(), {"1", "2"})

    def test_embedding_outage_degrades_then_next_run_recovers(self):
        books = [_book(str(i), f"Sach {i}") for i in range(10)]
        self.embed.healthy = False
        status = self.sync(books)
        stats = status["last_stats"]
        self.assertEqual(status["last_outcome"], "degraded")
        # Ngung goi provider sau CATALOG_SYNC_EMBED_FAILURE_LIMIT lan loi lien tiep.
        self.assertEqual(stats["embed_failed"], catalog_sync.CATALOG_SYNC_EMBED_FAILURE_LIMIT)
        self.assertEqual(stats["embed_deferred"], 10 - catalog_sync.CATALOG_SYNC_EMBED_FAILURE_LIMIT)
        self.assertEqual(len(self.embed.calls), catalog_sync.CATALOG_SYNC_EMBED_FAILURE_LIMIT)

        self.embed.healthy = True
        status = self.sync(books)
        self.assertEqual(status["last_outcome"], "ok")
        self.assertEqual(status["last_stats"]["embedded"], 10)
        hits = asyncio.run(self.store.search_semantic(
            vector_store.CORPUS_BOOK, [0.1, 0.9], k=20, embedding_model=embeddings.EMBED_IDENTITY))
        self.assertEqual(len(hits), 10)

    def test_repeated_runs_never_duplicate_documents_or_chunks(self):
        books = [_book("1", "A"), _book("2", "B")]
        for _ in range(3):
            self.sync(books)
        self.assertEqual(len(self.store._docs), 2)
        chunk_counts = [len(rows) for rows in self.store._chunks.values()]
        self.assertEqual(chunk_counts, [1, 1])

    def test_concurrent_run_is_skipped_not_doubled(self):
        gate = asyncio.Event()

        async def slow_fetch():
            await gate.wait()
            return [_book("1", "A")]

        async def scenario():
            first = asyncio.create_task(catalog_sync.sync_book_corpus(fetch=slow_fetch))
            await asyncio.sleep(0)
            second = await catalog_sync.sync_book_corpus(fetch=slow_fetch)
            gate.set()
            return await first, second

        first, second = asyncio.run(scenario())
        self.assertEqual(second.get("skipped"), "busy")
        self.assertEqual(first["last_outcome"], "ok")
        self.assertEqual(len(self.store._docs), 1)

    def test_store_error_on_one_book_does_not_stop_the_rest(self):
        original = self.store.upsert_document

        async def flaky(corpus, source_id, *args, **kwargs):
            if source_id == "2":
                raise RuntimeError("db hiccup")
            return await original(corpus, source_id, *args, **kwargs)

        self.store.upsert_document = flaky
        status = self.sync([_book("1", "A"), _book("2", "B"), _book("3", "C")])
        self.assertEqual(status["last_stats"]["errors"], 1)
        self.assertEqual(self.corpus_ids(), {"1", "3"})


class LoopAndAuthTest(unittest.TestCase):
    def test_backoff_after_failure_is_short_then_capped_at_interval(self):
        with mock.patch.object(catalog_sync, "CATALOG_SYNC_INTERVAL_SECONDS", 300.0):
            self.assertEqual(catalog_sync.next_delay_seconds(0), 300.0)
            self.assertEqual(catalog_sync.next_delay_seconds(1), 15.0)
            self.assertEqual(catalog_sync.next_delay_seconds(2), 30.0)
            self.assertEqual(catalog_sync.next_delay_seconds(10), 300.0)

    def test_internal_key_check(self):
        with mock.patch.dict(os.environ, {"INTERNAL_SERVICE_KEY": KEY}):
            self.assertTrue(catalog_sync.is_valid_internal_key(KEY))
            self.assertFalse(catalog_sync.is_valid_internal_key("wrong"))
            self.assertFalse(catalog_sync.is_valid_internal_key(None))
        with mock.patch.dict(os.environ, {"INTERNAL_SERVICE_KEY": ""}):
            # Khoa chua cau hinh: tu choi ca chuoi rong.
            self.assertFalse(catalog_sync.is_valid_internal_key(""))

    def test_internal_endpoints_reject_callers_without_the_key(self):
        import main
        from fastapi import HTTPException

        request = type("R", (), {"headers": {}})()
        with mock.patch.dict(os.environ, {"INTERNAL_SERVICE_KEY": KEY}):
            for endpoint in (main.catalog_sync_status, main.catalog_sync_trigger):
                with self.assertRaises(HTTPException) as ctx:
                    asyncio.run(endpoint(request))
                self.assertEqual(ctx.exception.status_code, 403)

    def test_startup_hook_no_longer_reads_api_books_without_a_token(self):
        """Regression task_5448fb5f: nguon sach cua startup phai la feed noi bo."""
        import inspect
        import main

        source = inspect.getsource(main._startup_ingest_corpus)
        self.assertNotIn('"/api/books"', source)
        self.assertIn("catalog_sync.sync_loop", source)


class IngestionHousekeepingTest(_Base):
    def test_shrinking_document_drops_its_orphan_chunks(self):
        store = self.store
        long_texts = ["# A\nmot", "# B\nhai", "# C\nba"]

        async def scenario():
            await ingestion._ingest_one(store, vector_store.CORPUS_DOC, "doc", "Doc", "x", long_texts, {})
            await ingestion._ingest_one(store, vector_store.CORPUS_DOC, "doc", "Doc", "y", long_texts[:1], {})
            return await store.list_documents(vector_store.CORPUS_DOC)

        state = asyncio.run(scenario())["doc"]
        self.assertEqual(sorted(state.chunk_hashes), [0])

    def test_deleted_corpus_file_is_removed_from_internal_docs(self):
        import tempfile

        with tempfile.TemporaryDirectory() as directory:
            for name in ("phi-phat", "gio-mo-cua"):
                with open(os.path.join(directory, f"{name}.md"), "w", encoding="utf-8") as handle:
                    handle.write(f"# {name}\nnoi dung {name}")
            asyncio.run(ingestion.ingest_internal_docs(directory))
            os.remove(os.path.join(directory, "phi-phat.md"))
            stats = asyncio.run(ingestion.ingest_internal_docs(directory))

        self.assertEqual(stats["removed"], 1)
        remaining = asyncio.run(self.store.list_documents(vector_store.CORPUS_DOC))
        self.assertEqual(set(remaining), {"gio-mo-cua"})


if __name__ == "__main__":
    unittest.main()
