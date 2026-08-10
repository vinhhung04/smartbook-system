import unittest
from unittest.mock import AsyncMock, patch

from main import _manual_entry_response, enrich_book_after_isbn, EnrichBookAfterIsbnRequest


class EnrichBookAfterIsbnTests(unittest.IsolatedAsyncioTestCase):
    async def test_returns_lookup_and_ai_suggestions_for_found_isbn(self):
        lookup = {
            "success": True,
            "found": True,
            "isbn": "9780132350884",
            "isbn13": "9780132350884",
            "isbn10": "0132350882",
            "title": "Clean Code",
            "subtitle": None,
            "authors": ["Robert C. Martin"],
            "publisher": "Prentice Hall",
            "publishedDate": "2008",
            "description": "A handbook of agile software craftsmanship.",
            "categories": ["Programming"],
            "language": "en",
            "pageCount": 464,
            "thumbnail": None,
            "source": {"aiSummary": "none"},
            "confidence": {"overall": 0.9},
            "summaryVi": None,
            "keywords": [],
            "manualEntryRequired": False,
        }

        with patch("main.lookup_book_by_isbn", new=AsyncMock(return_value=lookup)), \
             patch("main._call_anthropic", new=AsyncMock(return_value=("Tóm tắt tiếng Việt", ["clean code", "lập trình"], True))), \
             patch("main._call_anthropic_json", new=AsyncMock(side_effect=[
                 ({"normalizedDescription": "Mô tả đã chuẩn hóa"}, True),
                 ({"suggestedCategories": ["Công nghệ"]}, True),
             ])):
            result = await enrich_book_after_isbn(
                EnrichBookAfterIsbnRequest(isbn="9780132350884", existingCategories=["Công nghệ", "Kinh tế"])
            )

        self.assertEqual(result["lookup"], lookup)
        self.assertEqual(result["aiSuggestions"]["description"], "Mô tả đã chuẩn hóa")
        self.assertEqual(result["aiSuggestions"]["summaryVi"], "Tóm tắt tiếng Việt")
        self.assertEqual(result["aiSuggestions"]["keywords"], ["clean code", "lập trình"])
        self.assertEqual(result["aiSuggestions"]["categories"], ["Công nghệ"])
        self.assertEqual(result["aiSuggestions"]["provider"], "anthropic")
        self.assertGreater(result["aiSuggestions"]["confidence"], 0)

    async def test_invalid_isbn_returns_manual_lookup_without_crashing_ai(self):
        lookup = _manual_entry_response("123", None, "isbn must be ISBN-10 or ISBN-13")

        with patch("main.lookup_book_by_isbn", new=AsyncMock(return_value=lookup)):
            result = await enrich_book_after_isbn(EnrichBookAfterIsbnRequest(isbn="123"))

        self.assertEqual(result["lookup"], lookup)
        self.assertIsNone(result["aiSuggestions"]["description"])
        self.assertEqual(result["aiSuggestions"]["keywords"], [])
        self.assertIn("Không có metadata", result["aiSuggestions"]["qualityWarnings"][0])

    async def test_ai_failure_still_returns_lookup_with_warning(self):
        lookup = {
            "success": True,
            "found": True,
            "isbn": "9780132350884",
            "isbn13": "9780132350884",
            "isbn10": "0132350882",
            "title": "Clean Code",
            "subtitle": None,
            "authors": ["Robert C. Martin"],
            "publisher": None,
            "publishedDate": None,
            "description": "Original description",
            "categories": [],
            "language": "en",
            "pageCount": None,
            "thumbnail": None,
            "source": {"aiSummary": "none"},
            "confidence": {"overall": 0.7},
            "summaryVi": None,
            "keywords": [],
            "manualEntryRequired": False,
        }

        with patch("main.lookup_book_by_isbn", new=AsyncMock(return_value=lookup)), \
             patch("main._call_anthropic", new=AsyncMock(side_effect=RuntimeError("AI down"))):
            result = await enrich_book_after_isbn(EnrichBookAfterIsbnRequest(isbn="9780132350884"))

        self.assertEqual(result["lookup"], lookup)
        self.assertEqual(result["aiSuggestions"]["description"], "Original description")
        self.assertEqual(result["aiSuggestions"]["provider"], "none")
        self.assertTrue(any("AI không khả dụng" in warning for warning in result["aiSuggestions"]["qualityWarnings"]))


if __name__ == "__main__":
    unittest.main()
