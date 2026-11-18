import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from cache import isbn_lookup_cache
from isbn_rounds import BookProvider
from main import IsbnLookupRequest, _fetch_marketplace_provider, lookup_book_by_isbn

# A valid retail EAN-13 that is not an ISBN (893...) -> the "barcode mode" branch.
NON_ISBN_BARCODE = "8935235226272"
# 13 digits with a wrong check digit: neither an ISBN nor an EAN, never looked up.
BAD_CHECKSUM_CODE = "1234567890123"


class BarcodeModeCharacterizationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        isbn_lookup_cache.clear()

    def tearDown(self):
        isbn_lookup_cache.clear()

    async def test_barcode_lookup_keeps_marketplace_metadata_through_intelligence_wrapper(self):
        fahasa = {
            "title": "Sách từ barcode", "subtitle": None, "authors": ["Tác giả A"],
            "publisher": "NXB Trẻ", "publishedDate": "2020", "description": "Mô tả",
            "categories": [], "language": "vi", "pageCount": 200, "thumbnail": None,
            "sourceUrl": "https://fahasa.test/x",
        }
        async def by_code(_client, code):
            return {**fahasa, "identifiers": [code]}
        store = BookProvider("dinhTi", by_code=by_code, round1=True, accepts_raw_barcode=True, retries=0)
        with patch("main.ENABLE_MARKETPLACE_LOOKUP", True), \
             patch("main._book_providers", return_value=[store]), patch("main.ISBN_ROUND1_ORDER", "dinhTi"):
            result = await lookup_book_by_isbn(IsbnLookupRequest(isbn=NON_ISBN_BARCODE))

        self.assertTrue(result["found"])
        self.assertEqual(result["title"], "Sách từ barcode")
        self.assertEqual(result["authors"], ["Tác giả A"])
        self.assertEqual(result["publisher"], "NXB Trẻ")
        self.assertEqual(result["codeKind"], "EAN13")
        self.assertIsNone(result["isbn13"])  # the EAN is never reported as an ISBN
        self.assertEqual(result["crossLookup"]["status"], "NOT_FOUND")

    async def test_bad_checksum_code_is_not_looked_up(self):
        by_code = AsyncMock()
        store = BookProvider("dinhTi", by_code=by_code, round1=True, accepts_raw_barcode=True, retries=0)
        with patch("main.ENABLE_MARKETPLACE_LOOKUP", True), \
             patch("main._book_providers", return_value=[store]), patch("main.ISBN_ROUND1_ORDER", "dinhTi"):
            result = await lookup_book_by_isbn(IsbnLookupRequest(isbn=BAD_CHECKSUM_CODE))
        by_code.assert_not_awaited()
        self.assertFalse(result["found"])
        self.assertTrue(result["manualEntryRequired"])
        self.assertEqual(result["codeKind"], "INVALID")


class MarketplaceProviderTests(unittest.IsolatedAsyncioTestCase):
    async def test_tiki_success_returns_metadata_without_outcome(self):
        meta = {"title": "T"}
        with patch("main._fetch_tiki_by_isbn_api", new=AsyncMock(return_value=(meta, 0.5))):
            self.assertEqual(await _fetch_marketplace_provider("tiki", "9780439708180"), (meta, 0.5, None))

    async def test_tiki_not_found_has_no_outcome(self):
        with patch("main._fetch_tiki_by_isbn_api", new=AsyncMock(return_value=(None, 0.0))):
            self.assertEqual(await _fetch_marketplace_provider("tiki", "9780439708180"), (None, 0.0, None))

    async def test_timeout_and_error_are_reported_not_raised(self):
        with patch("main._fetch_tiki_by_isbn_api", new=AsyncMock(side_effect=asyncio.TimeoutError())):
            self.assertEqual((await _fetch_marketplace_provider("tiki", "x"))[2], "TIMEOUT")
        with patch("main._fetch_tiki_by_isbn_api", new=AsyncMock(side_effect=RuntimeError("boom"))):
            self.assertEqual((await _fetch_marketplace_provider("tiki", "x"))[2], "ERROR")

    async def test_fahasa_uses_ddgs_urls_then_first_valid(self):
        meta = {"title": "F", "sourceUrl": "https://fahasa.test/p"}
        with patch("main._ddgs_search_one_domain", return_value=["https://fahasa.test/p"]),              patch("main._fetch_first_valid", new=AsyncMock(return_value=(meta, 0.7))) as first_valid:
            result = await _fetch_marketplace_provider("fahasa", "9780439708180")
        self.assertEqual(result, (meta, 0.7, None))
        self.assertEqual(first_valid.await_args.args[1], ["https://fahasa.test/p"])

    async def test_fahasa_still_tries_direct_search_when_ddgs_fails(self):
        with patch("main._ddgs_search_one_domain", side_effect=RuntimeError("ddgs down")),              patch("main._fetch_first_valid", new=AsyncMock(return_value=(None, 0.0))) as first_valid:
            result = await _fetch_marketplace_provider("fahasa", "9780439708180")
        self.assertEqual(result[0], None)
        self.assertEqual(first_valid.await_args.args[1], [])

    async def test_web_search_maps_not_found_to_no_outcome(self):
        with patch("main._fetch_web_search_fallback", new=AsyncMock(return_value=(None, 0.0, "NOT_FOUND"))):
            self.assertEqual(await _fetch_marketplace_provider("webSearch", "x"), (None, 0.0, None))
        with patch("main._fetch_web_search_fallback", new=AsyncMock(return_value=(None, 0.0, "TIMEOUT"))):
            self.assertEqual((await _fetch_marketplace_provider("webSearch", "x"))[2], "TIMEOUT")


if __name__ == "__main__":
    unittest.main()
