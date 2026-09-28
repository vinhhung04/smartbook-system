import unittest
from unittest.mock import AsyncMock, patch

from cache import SummaryCache, isbn_lookup_cache
from main import ISBN_INCOMPLETE_CACHE_TTL_SECONDS, IsbnLookupRequest, lookup_book_by_isbn

FOUND_RESULT = {
    "success": True,
    "found": True,
    "isbn": "9780439708180",
    "isbn13": "9780439708180",
    "isbn10": "0439708184",
    "title": "Harry Potter and the Sorcerer's Stone",
    "authors": ["J. K. Rowling"],
    "categories": [],
    "publisher": "Scholastic",
    "source": {"googleBooks": True, "openLibrary": False, "worldCat": False,
               "fahasa": False, "tiki": False, "vinabook": False, "webSearch": False, "aiSummary": "none"},
    "confidence": {"overall": 0.9, "googleBooks": 0.9, "openLibrary": 0.0, "worldCat": 0.0,
                   "fahasa": 0.0, "tiki": 0.0, "vinabook": 0.0, "webSearch": 0.0},
    "_providerMetadata": {},
}

NOT_FOUND_RESULT = {
    "success": False,
    "found": False,
    "isbn": "9780439708180",
    "title": None,
    "source": {"googleBooks": False, "openLibrary": False, "worldCat": False,
               "fahasa": False, "tiki": False, "vinabook": False, "webSearch": False},
    "confidence": {"overall": 0.0, "googleBooks": 0.0, "openLibrary": 0.0, "worldCat": 0.0,
                   "fahasa": 0.0, "tiki": 0.0, "vinabook": 0.0, "webSearch": 0.0},
    "_providerMetadata": {},
}


class IsbnLookupCacheTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        isbn_lookup_cache.clear()

    def tearDown(self):
        isbn_lookup_cache.clear()

    async def test_second_lookup_of_a_found_isbn_is_served_from_cache(self):
        with patch("main._lookup_book_by_isbn_legacy", AsyncMock(return_value=dict(FOUND_RESULT))) as mocked:
            req = IsbnLookupRequest(isbn="9780439708180")
            first = await lookup_book_by_isbn(req)
            second = await lookup_book_by_isbn(req)

        self.assertEqual(mocked.await_count, 1)
        self.assertEqual(first["title"], second["title"])

    async def test_a_not_found_result_is_never_cached_so_it_is_retried_every_time(self):
        with patch("main._lookup_book_by_isbn_legacy", AsyncMock(return_value=dict(NOT_FOUND_RESULT))) as mocked:
            req = IsbnLookupRequest(isbn="9780439708180")
            await lookup_book_by_isbn(req)
            await lookup_book_by_isbn(req)

        self.assertEqual(mocked.await_count, 2)

    async def test_different_isbns_do_not_share_a_cache_entry(self):
        with patch("main._lookup_book_by_isbn_legacy", AsyncMock(return_value=dict(FOUND_RESULT))) as mocked:
            await lookup_book_by_isbn(IsbnLookupRequest(isbn="9780439708180"))
            await lookup_book_by_isbn(IsbnLookupRequest(isbn="9780061120084"))

        self.assertEqual(mocked.await_count, 2)

    async def test_generate_vietnamese_summary_flag_is_part_of_the_cache_key(self):
        with patch("main._lookup_book_by_isbn_legacy", AsyncMock(return_value=dict(FOUND_RESULT))) as mocked:
            await lookup_book_by_isbn(IsbnLookupRequest(isbn="9780439708180", generateVietnameseSummary=False))
            await lookup_book_by_isbn(IsbnLookupRequest(isbn="9780439708180", generateVietnameseSummary=True))

        self.assertEqual(mocked.await_count, 2)

    async def test_an_invalid_isbn_is_never_cached(self):
        with patch("main._lookup_book_by_isbn_legacy", AsyncMock(return_value=dict(NOT_FOUND_RESULT))) as mocked:
            req = IsbnLookupRequest(isbn="not-an-isbn")
            await lookup_book_by_isbn(req)
            await lookup_book_by_isbn(req)

        self.assertEqual(mocked.await_count, 2)


FULL_METADATA = {
    "title": "Clean Code", "subtitle": None, "authors": ["Robert C. Martin"], "publisher": "Prentice Hall",
    "publishedDate": "2008", "description": "Mô tả đủ dài để vượt ngưỡng tám mươi ký tự dùng cho chất lượng mô tả. " * 2,
    "categories": ["Computers"], "language": "en", "pageCount": 464, "thumbnail": "http://x/y.jpg",
}
COMPLETE_RESULT = {**FOUND_RESULT, "_providerMetadata": {"googleBooks": FULL_METADATA}}


class SummaryCacheTtlTests(unittest.TestCase):
    def test_per_entry_ttl_overrides_default(self):
        cache = SummaryCache(max_size=10, ttl_seconds=1000)
        with patch("cache.time.time", return_value=0):
            cache.set("short", {"a": 1}, ttl_seconds=10)
            cache.set("default", {"a": 2})
        with patch("cache.time.time", return_value=11):
            self.assertIsNone(cache.get("short"))
            self.assertEqual(cache.get("default"), {"a": 2})
        with patch("cache.time.time", return_value=1001):
            self.assertIsNone(cache.get("default"))


class IsbnCacheQualityTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        isbn_lookup_cache.clear()

    def tearDown(self):
        isbn_lookup_cache.clear()

    def _entry_ttl(self):
        (_, _, ttl), = isbn_lookup_cache._cache.values()
        return ttl

    async def test_incomplete_result_gets_short_ttl(self):
        with patch("main._lookup_book_by_isbn_legacy", AsyncMock(return_value=dict(FOUND_RESULT))):
            await lookup_book_by_isbn(IsbnLookupRequest(isbn="9780439708180"))
        self.assertEqual(self._entry_ttl(), ISBN_INCOMPLETE_CACHE_TTL_SECONDS)

    async def test_complete_result_uses_default_long_ttl(self):
        with patch("main._lookup_book_by_isbn_legacy", AsyncMock(return_value=dict(COMPLETE_RESULT))):
            result = await lookup_book_by_isbn(IsbnLookupRequest(isbn="9780439708180"))
        self.assertFalse(result["needsEnrichment"])
        self.assertIsNone(self._entry_ttl())

    async def test_provider_timeout_result_gets_short_ttl_even_if_complete(self):
        timed_out = {**COMPLETE_RESULT, "_providerOutcomes": {"fahasa": "TIMEOUT"}}
        with patch("main.ENABLE_MARKETPLACE_LOOKUP", True),              patch("main._lookup_book_by_isbn_legacy", AsyncMock(return_value=timed_out)):
            await lookup_book_by_isbn(IsbnLookupRequest(isbn="9780439708180"))
        self.assertEqual(self._entry_ttl(), ISBN_INCOMPLETE_CACHE_TTL_SECONDS)

    async def test_toggling_field_level_flag_does_not_share_cache_entries(self):
        with patch("main._lookup_book_by_isbn_legacy", AsyncMock(return_value=dict(FOUND_RESULT))) as mocked:
            with patch("main.ENABLE_FIELD_LEVEL_ISBN_RETRIEVAL", False):
                await lookup_book_by_isbn(IsbnLookupRequest(isbn="9780439708180"))
            with patch("main.ENABLE_FIELD_LEVEL_ISBN_RETRIEVAL", True):
                await lookup_book_by_isbn(IsbnLookupRequest(isbn="9780439708180"))
        self.assertEqual(mocked.await_count, 2)


if __name__ == "__main__":
    unittest.main()
