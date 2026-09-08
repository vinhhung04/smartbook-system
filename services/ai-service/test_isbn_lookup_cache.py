import unittest
from unittest.mock import AsyncMock, patch

from cache import isbn_lookup_cache
from main import IsbnLookupRequest, lookup_book_by_isbn

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


if __name__ == "__main__":
    unittest.main()
