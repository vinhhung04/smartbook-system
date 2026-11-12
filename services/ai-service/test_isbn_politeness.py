"""Not getting blocked: per-host spacing, pausing a source after 403/429,
the library catalog as source 0, Fahasa over plain HTTP, persistent cache."""
import time
import unittest
from unittest.mock import AsyncMock, patch

import httpx

import isbn_rounds
from cache import isbn_lookup_cache
from isbn_rounds import BookProvider, call_with_retry


def http_error(status, headers=None):
    request = httpx.Request("GET", "https://site.test/x")
    return httpx.HTTPStatusError(str(status), request=request,
                                 response=httpx.Response(status, request=request, headers=headers or {}))


class PolitenessTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        isbn_rounds.reset_politeness_state()
        self._patches = [patch("isbn_rounds.RETRY_BACKOFF_SECONDS", 0)]
        for p in self._patches:
            p.start()

    def tearDown(self):
        for p in self._patches:
            p.stop()
        isbn_rounds.reset_politeness_state()

    async def test_403_pauses_the_source_and_it_is_not_asked_again(self):
        blocked = AsyncMock(side_effect=http_error(403))
        provider = BookProvider("fahasa", retries=3)
        first = await call_with_retry(provider, lambda client: blocked(client))
        self.assertEqual((first["status"], first["error"]), ("ERROR", "HTTP 403"))
        self.assertEqual(blocked.await_count, 1)  # a block is never retried

        second = await call_with_retry(provider, lambda client: blocked(client))
        self.assertEqual(second["status"], "PAUSED")
        self.assertIn("HTTP 403", second["error"])
        self.assertEqual(blocked.await_count, 1)  # paused: the site is not contacted

    async def test_retry_after_sets_the_pause_and_repeat_blocks_back_off_longer(self):
        await call_with_retry(BookProvider("googleBooks", retries=0),
                              AsyncMock(side_effect=http_error(429, {"Retry-After": "120"})))
        state = isbn_rounds.paused_until("googleBooks")
        self.assertAlmostEqual(state["until"] - time.monotonic(), 120, delta=2)

        with patch("isbn_rounds.BLOCK_COOLDOWN_SECONDS", 10):
            isbn_rounds.reset_politeness_state()
            for _ in range(2):
                isbn_rounds._breakers.get("tiki", {}).update(until=0)  # let the pause lapse
                await call_with_retry(BookProvider("tiki", retries=0), AsyncMock(side_effect=http_error(403)))
            self.assertAlmostEqual(isbn_rounds.paused_until("tiki")["until"] - time.monotonic(), 20, delta=2)

    async def test_success_clears_the_pause_counter(self):
        await call_with_retry(BookProvider("tiki", retries=0), AsyncMock(side_effect=http_error(403)))
        isbn_rounds._breakers["tiki"]["until"] = 0
        await call_with_retry(BookProvider("tiki", retries=0), AsyncMock(return_value=None))
        self.assertNotIn("tiki", isbn_rounds._breakers)

    async def test_a_paused_source_lets_round1_move_on(self):
        await call_with_retry(BookProvider("a", retries=0), AsyncMock(side_effect=http_error(403)))
        b = AsyncMock(return_value={"title": "T", "identifiers": ["9780132350884"]})
        result = await isbn_rounds.run_round1(
            [BookProvider("a", by_code=AsyncMock(), round1=True), BookProvider("b", by_code=b, round1=True)],
            "9780132350884", {"9780132350884"}, True)
        self.assertEqual([o["status"] for o in result["outcomes"]], ["PAUSED", "SUCCESS"])

    async def test_requests_to_one_host_are_spaced(self):
        seen = []

        def handler(request):
            seen.append(time.monotonic())
            return httpx.Response(200)

        with patch("isbn_rounds.MIN_REQUEST_INTERVAL_SECONDS", 0.1):
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler),
                                         event_hooks={"request": [isbn_rounds._throttle]}) as client:
                for _ in range(3):
                    await client.get("https://store.test/a")
        self.assertGreaterEqual(seen[2] - seen[0], 0.19)


class CatalogAndFahasaAdapterTests(unittest.IsolatedAsyncioTestCase):
    async def test_catalog_returns_the_saved_edition_with_its_codes(self):
        from main import _catalog_by_code
        book = {"book_id": "b1", "isbn13": "8935212359658", "isbn10": None, "title": "Bé ngoan học lễ phép",
                "authors": ["Khánh Vân"], "translator": ["Hà Giang"], "publisher": "NXB Hà Nội",
                "published_date": "2021", "page_count": 10, "language": "vi", "categories": ["Thiếu nhi"],
                "cover_image_url": "https://cdn.test/c.webp", "description": None}
        seen = []

        def handler(request):
            seen.append(request)
            return httpx.Response(200, json=book) if request.url.path.endswith("8935212359658") else httpx.Response(404)

        with patch("main.INTERNAL_SERVICE_KEY", "k"):
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                data = await _catalog_by_code(client, "8935212359658")
                missing = await _catalog_by_code(client, "9780132350884")
        self.assertEqual(data["identifiers"], ["8935212359658"])
        self.assertEqual((data["pageCount"], data["translator"]), (10, ["Hà Giang"]))
        self.assertEqual(seen[0].headers["x-internal-service-key"], "k")
        self.assertIsNone(missing)

    async def test_fahasa_reports_the_codes_its_page_shows(self):
        from main import _fahasa_by_code
        page = """<script type="application/ld+json">{"@type":"Product","name":"Combo Sách Nhà Giả Kim + Cây Cam",
        "sku":"8936066700001","image":"x.jpg"}</script><td>Mã hàng</td><td>8936066700001</td>"""
        handler = lambda request: httpx.Response(200, text=page)  # noqa: E731
        with patch("main._ddgs_fahasa_urls", return_value=["https://www.fahasa.com/combo.html"]):
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                data = await _fahasa_by_code(client, "8935235226272")
        # A combo page mentions the book but carries its own code -> Round 1 calls it a MISMATCH.
        self.assertEqual(data["identifiers"], ["8936066700001"])

    async def test_fahasa_tries_other_searches_until_a_page_shows_the_code(self):
        from main import _fahasa_by_code
        pages = {
            "https://www.fahasa.com/other-book.html": '<script type="application/ld+json">{"@type":"Product","name":"Sách khác"}'
                                                      '</script><td>Mã hàng</td><td>8935235219472</td>',
            "https://www.fahasa.com/dac-nhan-tam-425244.html": '<script type="application/ld+json">{"@type":"Product",'
                                                               '"name":"Đắc Nhân Tâm"}</script><td>Mã hàng</td><td>8935325011894</td>',
        }
        searches = []

        def fake_search(query, backend):
            searches.append((query, backend))
            # The first engine finds an unrelated page, the second one finds the book.
            return ["https://www.fahasa.com/other-book.html"] if len(searches) == 1 else \
                ["https://www.fahasa.com/dac-nhan-tam-425244.html"]

        handler = lambda request: httpx.Response(200, text=pages[str(request.url)])  # noqa: E731
        with patch("main._ddgs_fahasa_urls", side_effect=fake_search):
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                data = await _fahasa_by_code(client, "8935325011894")
        self.assertEqual(data["sourceUrl"], "https://www.fahasa.com/dac-nhan-tam-425244.html")
        self.assertIn("8935325011894", data["identifiers"])
        self.assertEqual(searches[:2], [("8935325011894", "auto"), ("8935325011894 site:fahasa.com", "bing")])

    def test_fahasa_attribute_table_is_read(self):
        from main import _parse_fahasa_attributes
        page = """<table class="data-table table-additional"><tbody>
        <tr> <th class="table-label"> Mã hàng </th> <td class="data_0"> <div> 8935325011894 </div> </td> </tr>
        <tr> <th class="table-label"> Tên Nhà Cung Cấp </th> <td class="data_1"> <a href="/az"> AZ Việt Nam</a> </td> </tr>
        <tr> <th class="table-label"> Tác giả </th> <td class="data_2"> <div> Dale Carnegie </div> </td> </tr>
        <tr> <th class="table-label"> Người Dịch </th> <td class="data_3"> <div> Tín Nghĩa </div> </td> </tr>
        <tr> <th class="table-label"> NXB </th> <td class="data_4"> <div> Thế Giới </div> </td> </tr>
        <tr> <th class="table-label"> Năm XB </th> <td class="data_5"> <div> 2023 </div> </td> </tr>
        <tr> <th class="table-label"> Ngôn Ngữ </th> <td class="data_6"> <div> Tiếng Việt </div> </td> </tr>
        <tr> <th class="table-label"> Số trang </th> <td class="data_9"> <div> 360 </div> </td> </tr>
        </tbody></table>"""
        self.assertEqual(_parse_fahasa_attributes(page), {
            "authors": ["Dale Carnegie"], "translator": ["Tín Nghĩa"], "publisher": "Thế Giới",
            "publishedDate": "2023", "language": "vi", "pageCount": 360,
        })

    async def test_fahasa_with_no_search_results_is_not_found(self):
        from main import _fahasa_by_code
        with patch("main._ddgs_fahasa_urls", return_value=[]):
            async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(500))) as client:
                self.assertIsNone(await _fahasa_by_code(client, "8935325011894"))

    async def test_fahasa_cloudflare_block_surfaces_as_http_error(self):
        from main import _fahasa_by_code
        with patch("main._ddgs_fahasa_urls", return_value=["https://www.fahasa.com/x.html"]):
            async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(403))) as client:
                with self.assertRaises(httpx.HTTPStatusError):
                    await _fahasa_by_code(client, "8935235226272")


class PersistentCacheTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        isbn_lookup_cache.clear()

    def tearDown(self):
        isbn_lookup_cache.clear()

    async def test_a_fresh_stored_lookup_is_served_without_asking_any_source(self):
        from main import IsbnLookupRequest, lookup_book_by_isbn
        stored = {"found": True, "title": "Đã lưu", "sources": []}
        providers = AsyncMock()
        with patch("isbn_cache_store.get", new=AsyncMock(return_value=(stored, True))), \
             patch("main._book_providers", new=providers):
            result = await lookup_book_by_isbn(IsbnLookupRequest(isbn="9780132350884"))
        self.assertEqual(result["title"], "Đã lưu")
        providers.assert_not_called()

    async def test_due_lookup_falls_back_to_the_stored_result_when_sources_find_nothing(self):
        from main import IsbnLookupRequest, lookup_book_by_isbn
        stored = {"found": True, "title": "Đã lưu", "sources": []}
        down = BookProvider("googleBooks", by_code=AsyncMock(side_effect=httpx.ConnectError("down")),
                            round1=True, retries=0)
        with patch("isbn_cache_store.get", new=AsyncMock(return_value=(stored, False))), \
             patch("main._book_providers", return_value=[down]), patch("main.ISBN_ROUND1_ORDER", "googleBooks"):
            result = await lookup_book_by_isbn(IsbnLookupRequest(isbn="9780132350884"))
        down.by_code.assert_awaited()  # it did try the sources again
        self.assertEqual(result["title"], "Đã lưu")
        self.assertTrue(result["servedFromStore"])

    async def test_found_lookups_are_written_through(self):
        from main import IsbnLookupRequest, lookup_book_by_isbn
        book = {"title": "Clean Code", "authors": ["Robert C. Martin"], "identifiers": ["9780132350884"]}
        provider = BookProvider("googleBooks", by_code=AsyncMock(return_value=book), round1=True, retries=0)
        put = AsyncMock()
        with patch("isbn_cache_store.get", new=AsyncMock(return_value=(None, False))), patch("isbn_cache_store.put", new=put), \
             patch("main._book_providers", return_value=[provider]), patch("main.ISBN_ROUND1_ORDER", "googleBooks"):
            await lookup_book_by_isbn(IsbnLookupRequest(isbn="9780132350884"))
        self.assertEqual(put.await_args.args[0], "9780132350884:False:r2v1")

    async def test_cache_store_is_a_no_op_when_disabled_or_broken(self):
        import isbn_cache_store
        with patch("isbn_cache_store.ENABLED", False):
            self.assertEqual(await isbn_cache_store.get("k"), (None, False))
        with patch("isbn_cache_store.ENABLED", True), patch("db.get_session", side_effect=OSError("db down")):
            self.assertEqual(await isbn_cache_store.get("k"), (None, False))
            await isbn_cache_store.put("k", {"a": 1}, 60)  # must not raise


if __name__ == "__main__":
    unittest.main()
