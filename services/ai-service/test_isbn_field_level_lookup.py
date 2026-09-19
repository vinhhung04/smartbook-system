import unittest
from unittest.mock import AsyncMock, patch

from cache import isbn_lookup_cache
from main import IsbnLookupRequest, lookup_book_by_isbn

# 13 digits with an invalid ISBN/EAN checksum -> the legacy "barcode mode" branch.
NON_ISBN_BARCODE = "1234567890123"


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
        marketplace = (fahasa, 0.8, None, 0.0, None, 0.0, True, {})
        with patch("main.ENABLE_MARKETPLACE_LOOKUP", True), \
             patch("main._fetch_all_marketplace", new=AsyncMock(return_value=marketplace)):
            result = await lookup_book_by_isbn(IsbnLookupRequest(isbn=NON_ISBN_BARCODE))

        self.assertTrue(result["found"])
        self.assertEqual(result["title"], "Sách từ barcode")
        self.assertEqual(result["authors"], ["Tác giả A"])
        self.assertEqual(result["publisher"], "NXB Trẻ")


if __name__ == "__main__":
    unittest.main()
