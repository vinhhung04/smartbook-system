import unittest
import asyncio
from unittest.mock import AsyncMock, patch

from main import (
    _build_isbn_intelligence,
    _manual_entry_response,
    _build_source_statuses,
    enrich_book_after_isbn,
    EnrichBookAfterIsbnRequest,
)


class EnrichBookAfterIsbnTests(unittest.IsolatedAsyncioTestCase):
    def test_provider_error_outcome_is_not_reported_as_not_found(self):
        statuses = _build_source_statuses({
            "source": {"googleBooks": False, "openLibrary": False},
            "_providerOutcomes": {"googleBooks": "TIMEOUT", "openLibrary": "ERROR"},
        }, 0)
        self.assertEqual(statuses["googleBooks"]["status"], "TIMEOUT")
        self.assertEqual(statuses["openLibrary"]["status"], "ERROR")

    def test_intelligence_prefers_google_and_reports_conflicts(self):
        result = _build_isbn_intelligence({
            "googleBooks": {"title": "Clean Code", "authors": ["Robert C. Martin"]},
            "openLibrary": {"title": "Clean Code (2nd edition)", "authors": ["Robert C. Martin"]},
            "worldCat": None,
            "fahasa": None,
            "tiki": None,
            "vinabook": None,
        }, {
            "googleBooks": {"enabled": True, "status": "SUCCESS", "durationMs": 12},
            "openLibrary": {"enabled": True, "status": "SUCCESS", "durationMs": 10},
            "worldCat": {"enabled": False, "status": "DISABLED", "durationMs": 0},
            "fahasa": {"enabled": False, "status": "DISABLED", "durationMs": 0},
            "tiki": {"enabled": False, "status": "DISABLED", "durationMs": 0},
            "vinabook": {"enabled": False, "status": "DISABLED", "durationMs": 0},
        })

        self.assertEqual(result["metadata"]["title"], "Clean Code")
        self.assertEqual(result["fieldEvidence"]["title"]["selectedSource"], "googleBooks")
        self.assertGreater(result["fieldConfidence"]["authors"], 0)
        self.assertEqual(result["conflicts"][0]["field"], "title")
        self.assertGreater(result["metadataQualityScore"], 0)

    def test_intelligence_keeps_timeout_status_and_returns_remaining_metadata(self):
        result = _build_isbn_intelligence({
            "googleBooks": None,
            "openLibrary": {"title": "Available from Open Library"},
            "worldCat": None,
            "fahasa": None,
            "tiki": None,
            "vinabook": None,
        }, {
            "googleBooks": {"enabled": True, "status": "TIMEOUT", "durationMs": 8000},
            "openLibrary": {"enabled": True, "status": "SUCCESS", "durationMs": 10},
            "worldCat": {"enabled": False, "status": "DISABLED", "durationMs": 0},
            "fahasa": {"enabled": False, "status": "DISABLED", "durationMs": 0},
            "tiki": {"enabled": False, "status": "DISABLED", "durationMs": 0},
            "vinabook": {"enabled": False, "status": "DISABLED", "durationMs": 0},
        })

        self.assertEqual(result["metadata"]["title"], "Available from Open Library")
        self.assertEqual(result["sources"][0]["status"], "TIMEOUT")
        self.assertGreater(result["fieldConfidence"]["title"], 0)

    async def test_invalid_isbn_returns_intelligence_fields_without_lookup(self):
        from main import lookup_book_by_isbn, IsbnLookupRequest

        result = await lookup_book_by_isbn(IsbnLookupRequest(isbn="not-an-isbn"))

        self.assertFalse(result["found"])
        self.assertEqual(result["metadataQualityScore"], 0.0)
        self.assertEqual(len(result["sources"]), 6)
        self.assertIn("processingTimeMs", result)

    async def test_lookup_keeps_metadata_when_one_provider_times_out(self):
        from main import lookup_book_by_isbn, IsbnLookupRequest
        legacy = _manual_entry_response("9780132350884", "9780132350884", "metadata not found")
        legacy.update({
            "success": True,
            "found": True,
            "title": "Open Library result",
            "source": {"googleBooks": False, "openLibrary": True},
            "_providerMetadata": {
                "googleBooks": None,
                "openLibrary": {"title": "Open Library result"},
                "worldCat": None, "fahasa": None, "tiki": None, "vinabook": None,
            },
        })
        with patch("main._lookup_book_by_isbn_legacy", new=AsyncMock(return_value=legacy)):
            result = await lookup_book_by_isbn(IsbnLookupRequest(isbn="9780132350884"))

        self.assertEqual(result["title"], "Open Library result")
        self.assertEqual(result["sources"][1]["status"], "SUCCESS")
        self.assertGreater(result["fieldConfidence"]["title"], 0)

    async def test_marketplace_provider_timeout_does_not_block_other_sources(self):
        from main import _fetch_all_marketplace

        async def slow_provider(*_args, **_kwargs):
            await asyncio.sleep(0.08)
            return None, 0.0

        with patch("main._ddgs_search_one_domain", return_value=[]), \
             patch("main._fetch_first_valid", new=AsyncMock(side_effect=slow_provider)), \
             patch("main._fetch_tiki_by_isbn_api", new=AsyncMock(side_effect=slow_provider)), \
             patch("main.BOOK_MARKETPLACE_TIMEOUT_SECONDS", 0.01):
            result = await _fetch_all_marketplace("9780132350884", None)

        self.assertEqual(result[-1], {
            "fahasa": "TIMEOUT",
            "tiki": "TIMEOUT",
            "vinabook": "TIMEOUT",
        })
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
             patch("main._normalize_with_catalog_authority", new=AsyncMock(return_value=({
                 "normalized": {"title": "Clean Code", "authors": ["Robert C. Martin"], "publisher": "Prentice Hall", "categories": ["Programming"], "description": "A handbook of agile software craftsmanship."},
                 "authorNormalization": [{"status": "AUTO_MATCH"}], "publisherNormalization": {"status": "AUTO_MATCH"}, "categoryNormalization": [{"status": "AUTO_MATCH"}], "authorityMatches": {}, "qualityWarnings": [],
             }, None))), \
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
        self.assertEqual(result["authorNormalization"][0]["status"], "AUTO_MATCH")

    async def test_invalid_isbn_returns_manual_lookup_without_crashing_ai(self):
        lookup = _manual_entry_response("123", None, "isbn must be ISBN-10 or ISBN-13")

        with patch("main.lookup_book_by_isbn", new=AsyncMock(return_value=lookup)), \
             patch("main._normalize_with_catalog_authority", new=AsyncMock(return_value=(None, "Authority normalization unavailable; staff review is required before catalog changes."))):
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
             patch("main._normalize_with_catalog_authority", new=AsyncMock(return_value=(None, "Authority normalization unavailable; staff review is required before catalog changes."))), \
             patch("main._call_anthropic", new=AsyncMock(side_effect=RuntimeError("AI down"))):
            result = await enrich_book_after_isbn(EnrichBookAfterIsbnRequest(isbn="9780132350884"))

        self.assertEqual(result["lookup"], lookup)
        self.assertEqual(result["aiSuggestions"]["description"], "Original description")
        self.assertEqual(result["aiSuggestions"]["provider"], "none")
        self.assertTrue(any("AI không khả dụng" in warning for warning in result["aiSuggestions"]["qualityWarnings"]))

    async def test_authority_unavailable_keeps_lookup_without_fabricated_matches(self):
        lookup = _manual_entry_response("9780132350884", "9780132350884", "metadata not found")
        with patch("main.lookup_book_by_isbn", new=AsyncMock(return_value=lookup)), \
             patch("main._normalize_with_catalog_authority", new=AsyncMock(return_value=(None, "Authority normalization unavailable; staff review is required before catalog changes."))):
            result = await enrich_book_after_isbn(EnrichBookAfterIsbnRequest(isbn="9780132350884"))
        self.assertEqual(result["authorNormalization"], [])
        self.assertIn("Authority normalization unavailable", result["qualityWarnings"][0])


if __name__ == "__main__":
    unittest.main()
