import unittest
from unittest.mock import AsyncMock, patch

from cache import isbn_lookup_cache
from main import IsbnLookupRequest, lookup_book_by_isbn

VALID_ISBN = "9780439708180"
LONG_DESC = "Một mô tả đủ dài để vượt qua ngưỡng tám mươi ký tự dùng cho chất lượng mô tả sách. " * 2


def google_partial():
    """Google found the book but only title/authors/thumbnail (the reported bug)."""
    return ({"title": "Nhà Giả Kim", "subtitle": None, "authors": ["Paulo Coelho"], "publisher": None,
             "publishedDate": None, "description": None, "categories": [], "language": None,
             "pageCount": None, "thumbnail": "http://img/x.jpg"}, 0.35)


def google_full():
    return ({"title": "Clean Code", "subtitle": None, "authors": ["Robert C. Martin"], "publisher": "Prentice Hall",
             "publishedDate": "2008", "description": LONG_DESC, "categories": ["Computers"], "language": "en",
             "pageCount": 464, "thumbnail": "http://img/cc.jpg"}, 1.0)


def market(**fields):
    base = {"title": "Nhà Giả Kim", "authors": ["Paulo Coelho"], "publisher": None, "publishedDate": None,
            "description": None, "pageCount": None, "categories": [], "language": "vi", "thumbnail": None}
    return ({**base, **fields}, 0.6, None)


def provider_router(table):
    """AsyncMock side_effect: table maps provider -> (data, score, outcome); unknown -> not found."""
    async def _call(provider, isbn13):
        return table.get(provider, (None, 0.0, None))
    return AsyncMock(side_effect=_call)


def called_providers(mock):
    return [call.args[0] for call in mock.await_args_list]


class FieldLevelLookupTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        isbn_lookup_cache.clear()
        self._patches = [
            patch("main.ENABLE_FIELD_LEVEL_ISBN_RETRIEVAL", True),
            patch("main.ENABLE_MARKETPLACE_LOOKUP", True),
            patch("main.ENABLE_WORLDCAT_LOOKUP", False),
        ]
        for p in self._patches:
            p.start()

    def tearDown(self):
        for p in self._patches:
            p.stop()
        isbn_lookup_cache.clear()

    async def _lookup(self, google, table, **kwargs):
        provider = provider_router(table)
        with patch("main._run_standard_lookups", new=AsyncMock(return_value=[google, (None, 0.0)])), \
             patch("main._fetch_marketplace_provider", new=provider):
            result = await lookup_book_by_isbn(IsbnLookupRequest(isbn=VALID_ISBN, **kwargs))
        return result, provider

    async def test_full_metadata_never_calls_marketplace_or_web(self):
        result, provider = await self._lookup(google_full(), {})
        self.assertTrue(result["found"])
        provider.assert_not_awaited()

    async def test_partial_metadata_still_triggers_targeted_retrieval(self):
        vina = market(publisher="NXB Hội Nhà Văn", publishedDate="2020", description=LONG_DESC, pageCount=228,
                      sourceUrl="https://vinabook.test/p")
        result, provider = await self._lookup(google_partial(), {"vinabook": vina})

        self.assertTrue(result["found"])
        self.assertEqual(called_providers(provider).count("vinabook"), 1)
        self.assertEqual(result["publisher"], "NXB Hội Nhà Văn")
        self.assertEqual(result["description"], LONG_DESC)
        self.assertEqual(result["pageCount"], 228)
        self.assertEqual(result["fieldEvidence"]["publisher"]["selectedSource"], "vinabook")

    async def test_each_provider_called_once_and_fahasa_skipped_when_gaps_filled(self):
        tiki = market(publisher="NXB X", description=LONG_DESC)
        vina = market(publisher="NXB X", publishedDate="2020", pageCount=228)
        result, provider = await self._lookup(google_partial(), {"tiki": tiki, "vinabook": vina})

        self.assertEqual(sorted(called_providers(provider)), ["tiki", "vinabook"])
        self.assertEqual(result["publisher"], "NXB X")
        self.assertEqual(result["pageCount"], 228)
        self.assertEqual(result["conflicts"], [])

    async def test_falls_through_to_fahasa_when_cheap_providers_cannot_fill_gaps(self):
        fahasa = market(publisher="NXB X", publishedDate="2020", description=LONG_DESC, pageCount=300)
        result, provider = await self._lookup(google_partial(), {"fahasa": fahasa})
        self.assertEqual(called_providers(provider), ["tiki", "vinabook", "fahasa"])
        self.assertEqual(result["pageCount"], 300)

    async def test_provider_timeout_returns_partial_metadata_not_an_error(self):
        table = {"tiki": market(publisher="NXB X"), "vinabook": (None, 0.0, "TIMEOUT"), "fahasa": (None, 0.0, "TIMEOUT")}
        result, _ = await self._lookup(google_partial(), table)

        self.assertTrue(result["success"])
        self.assertTrue(result["found"])
        self.assertEqual(result["publisher"], "NXB X")
        statuses = {s["name"]: s["status"] for s in result["sources"]}
        self.assertEqual(statuses["vinabook"], "TIMEOUT")
        self.assertEqual(statuses["fahasa"], "TIMEOUT")

    async def test_provider_exception_does_not_fail_the_lookup(self):
        async def boom(provider, isbn13):
            raise RuntimeError("scraper exploded")
        with patch("main._run_standard_lookups", new=AsyncMock(return_value=[google_partial(), (None, 0.0)])), \
             patch("main._fetch_marketplace_provider", new=AsyncMock(side_effect=boom)):
            result = await lookup_book_by_isbn(IsbnLookupRequest(isbn=VALID_ISBN))
        self.assertTrue(result["found"])
        self.assertEqual(result["title"], "Nhà Giả Kim")

    async def test_nothing_found_returns_manual_entry_after_trying_every_provider(self):
        result, provider = await self._lookup((None, 0.0), {})
        self.assertFalse(result["found"])
        self.assertTrue(result["manualEntryRequired"])
        self.assertEqual(called_providers(provider), ["tiki", "vinabook", "fahasa", "webSearch"])

    async def test_missing_only_supporting_fields_does_not_call_providers(self):
        data, score = google_full()
        data = {**data, "categories": [], "language": None, "thumbnail": None}
        result, provider = await self._lookup((data, score), {})
        provider.assert_not_awaited()

    async def test_exhausted_time_budget_skips_targeted_calls(self):
        with patch("main.ISBN_LOOKUP_TOTAL_BUDGET_SECONDS", 1.0):
            result, provider = await self._lookup(google_partial(), {})
        provider.assert_not_awaited()
        self.assertTrue(result["found"])

    async def test_marketplace_flag_off_means_no_targeted_calls(self):
        with patch("main.ENABLE_MARKETPLACE_LOOKUP", False):
            result, provider = await self._lookup(google_partial(), {})
        provider.assert_not_awaited()
        self.assertTrue(result["found"])

    async def test_conflict_from_targeted_provider_is_kept(self):
        google = ({**google_partial()[0], "publisher": "NXB A"}, 0.5)
        fahasa = market(publisher="NXB B", publishedDate="2020", description=LONG_DESC, pageCount=228)
        result, _ = await self._lookup(google, {"fahasa": fahasa})
        self.assertIn("publisher", [c["field"] for c in result["conflicts"]])

    async def test_orchestrator_crash_falls_back_to_legacy_path(self):
        with patch("main._run_field_level_lookup", new=AsyncMock(side_effect=RuntimeError("bug"))), \
             patch("main.ENABLE_MARKETPLACE_LOOKUP", False), \
             patch("main._run_standard_lookups", new=AsyncMock(return_value=[google_partial(), (None, 0.0)])):
            result = await lookup_book_by_isbn(IsbnLookupRequest(isbn=VALID_ISBN))
        self.assertTrue(result["found"])

    async def test_barcode_mode_does_not_use_field_level_orchestrator(self):
        marketplace = (market(publisher="NXB")[0], 0.8, None, 0.0, None, 0.0, True, {})
        with patch("main._run_field_level_lookup", new=AsyncMock()) as orchestrator, \
             patch("main._fetch_all_marketplace", new=AsyncMock(return_value=marketplace)):
            result = await lookup_book_by_isbn(IsbnLookupRequest(isbn="1234567890123"))
        orchestrator.assert_not_awaited()
        self.assertTrue(result["found"])


LEGACY_KEYS = [
    "success", "found", "isbn", "isbn13", "isbn10", "title", "authors", "publisher", "description",
    "categories", "language", "pageCount", "thumbnail", "source", "confidence", "summaryVi", "keywords",
    "fieldEvidence", "fieldConfidence", "sources", "conflicts", "metadataQualityScore", "processingTimeMs",
]


class ContractTests(FieldLevelLookupTests):
    """Same fixture as FieldLevelLookupTests; asserts the additive response contract."""

    async def test_legacy_keys_are_all_still_present(self):
        result, _ = await self._lookup(google_partial(), {"vinabook": market(publisher="NXB X")})
        for key in LEGACY_KEYS:
            self.assertIn(key, result)

    async def test_sources_report_phase_reasons_and_skipped(self):
        result, _ = await self._lookup(google_partial(), {"tiki": market(publisher="NXB X", description=LONG_DESC),
                                                          "vinabook": market(publisher="NXB X", publishedDate="2020", pageCount=1)})
        by_name = {s["name"]: s for s in result["sources"]}
        self.assertEqual(by_name["googleBooks"]["phase"], "INITIAL")
        self.assertEqual(by_name["tiki"]["phase"], "TARGETED")
        self.assertIn("MISSING:publisher", by_name["tiki"]["reasons"])
        self.assertEqual(by_name["fahasa"]["status"], "SKIPPED")
        self.assertEqual(by_name["webSearch"]["status"], "SKIPPED")
        self.assertEqual(by_name["worldCat"]["status"], "DISABLED")

    async def test_full_metadata_marks_marketplace_as_skipped_not_not_found(self):
        result, _ = await self._lookup(google_full(), {})
        by_name = {s["name"]: s for s in result["sources"]}
        self.assertEqual(by_name["tiki"]["status"], "SKIPPED")
        self.assertEqual(result["retrieval"]["stopReason"], "COVERAGE_OK")
        self.assertEqual(result["retrieval"]["providerCalls"], 2)

    async def test_coverage_fields_and_selected_phase(self):
        result, _ = await self._lookup(google_partial(), {"vinabook": market(
            publisher="NXB X", publishedDate="2020", description=LONG_DESC, pageCount=228)})
        self.assertEqual(result["fieldEvidence"]["publisher"]["selectedPhase"], "TARGETED")
        self.assertEqual(result["fieldEvidence"]["title"]["selectedPhase"], "INITIAL")
        self.assertEqual(result["fieldStatus"]["publisher"], "SUFFICIENT")
        self.assertEqual(result["metadataCoverage"]["totalFields"], 9)
        self.assertGreater(result["metadataCoverage"]["ratio"], result["retrieval"]["initialCoverage"]["ratio"])
        self.assertIn("categories", result["missingFields"])
        self.assertFalse(result["needsEnrichment"])
        retrieval = result["retrieval"]
        self.assertEqual(retrieval["mode"], "field-level")
        self.assertIn("publisher", retrieval["recoveredFields"])
        self.assertGreater(retrieval["qualityAfter"], retrieval["qualityBefore"])

    async def test_needs_enrichment_when_high_value_gap_cannot_be_filled(self):
        result, _ = await self._lookup(google_partial(), {})
        self.assertTrue(result["needsEnrichment"])
        self.assertIn("description", result["missingFields"])
        self.assertEqual(result["retrieval"]["stopReason"], "NO_ELIGIBLE_PROVIDER")
        self.assertIn("description", result["retrieval"]["remainingGaps"])

    async def test_provider_durations_are_per_provider_not_total(self):
        result, _ = await self._lookup(google_partial(), {})
        by_name = {s["name"]: s for s in result["sources"]}
        self.assertLessEqual(by_name["tiki"]["durationMs"], result["processingTimeMs"])


class LegacyContractTests(unittest.IsolatedAsyncioTestCase):
    async def test_coverage_fields_are_added_even_when_flag_is_off(self):
        isbn_lookup_cache.clear()
        with patch("main.ENABLE_FIELD_LEVEL_ISBN_RETRIEVAL", False), patch("main.ENABLE_MARKETPLACE_LOOKUP", False), \
             patch("main._run_standard_lookups", new=AsyncMock(return_value=[google_partial(), (None, 0.0)])):
            result = await lookup_book_by_isbn(IsbnLookupRequest(isbn=VALID_ISBN))
        isbn_lookup_cache.clear()
        self.assertTrue(result["found"])
        self.assertIn("publisher", result["missingFields"])
        self.assertTrue(result["needsEnrichment"])
        self.assertNotIn("retrieval", result)
        self.assertNotIn("selectedPhase", result["fieldEvidence"]["title"])
        statuses = {s["name"]: s["status"] for s in result["sources"]}
        self.assertEqual(statuses["tiki"], "DISABLED")


class FlagOffTests(unittest.IsolatedAsyncioTestCase):
    async def test_flag_off_keeps_legacy_behavior(self):
        isbn_lookup_cache.clear()
        with patch("main.ENABLE_FIELD_LEVEL_ISBN_RETRIEVAL", False), patch("main.ENABLE_MARKETPLACE_LOOKUP", False), \
             patch("main._run_standard_lookups", new=AsyncMock(return_value=[google_partial(), (None, 0.0)])), \
             patch("main._fetch_marketplace_provider", new=AsyncMock()) as provider:
            result = await lookup_book_by_isbn(IsbnLookupRequest(isbn=VALID_ISBN))
        provider.assert_not_awaited()
        self.assertTrue(result["found"])
        isbn_lookup_cache.clear()


if __name__ == "__main__":
    unittest.main()
