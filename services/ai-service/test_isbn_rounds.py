"""Two-round ISBN search - scenarios from the upgrade spec (offline fakes only)."""
import asyncio
import unittest
from unittest.mock import AsyncMock, patch

import httpx

import isbn_rounds
from cache import isbn_lookup_cache
from isbn_rounds import BookProvider, merge_outcomes, run_round1, run_round2

ISBN = "9780132350884"
TARGETS = {ISBN, "0132350882"}
BOOK = {"title": "Clean Code", "authors": ["Robert C. Martin"], "publisher": "Prentice Hall",
        "publishedDate": "2008", "pageCount": 464, "description": "A handbook of agile software craftsmanship.",
        "categories": [], "language": "en", "thumbnail": None, "subtitle": None, "translator": []}


def record(code=ISBN, **fields):
    return {**BOOK, **fields, "identifiers": [code], "sourceUrl": f"https://src.test/{code}"}


def by_code_returning(value):
    return AsyncMock(return_value=value)


def by_title_returning(*candidates):
    return AsyncMock(return_value=list(candidates))


def provider(name, by_code=None, by_title=None, round1=False, **kwargs):
    kwargs.setdefault("retries", 0)
    return BookProvider(name, by_code=by_code, by_title=by_title, round1=round1, **kwargs)


class NoBackoff(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self._backoff = patch("isbn_rounds.RETRY_BACKOFF_SECONDS", 0)
        self._backoff.start()
        isbn_rounds.reset_politeness_state()

    def tearDown(self):
        self._backoff.stop()


class Round1Tests(NoBackoff):
    async def test_first_source_match_stops_round1(self):
        a, b = by_code_returning(record()), by_code_returning(record())
        result = await run_round1([provider("a", a, round1=True), provider("b", b, round1=True)], ISBN, TARGETS, True)
        self.assertEqual(result["identity"], "a")
        b.assert_not_awaited()
        self.assertEqual([o["status"] for o in result["outcomes"]], ["SUCCESS", "SKIPPED"])

    async def test_order_is_followed_until_a_match(self):
        a, b, c = by_code_returning(None), by_code_returning(record()), by_code_returning(record())
        result = await run_round1([provider(n, f, round1=True) for n, f in (("a", a), ("b", b), ("c", c))],
                                  ISBN, TARGETS, True)
        self.assertEqual(result["identity"], "b")
        a.assert_awaited_once()
        c.assert_not_awaited()

    async def test_no_source_matches(self):
        result = await run_round1([provider("a", by_code_returning(None), round1=True)], ISBN, TARGETS, True)
        self.assertIsNone(result["identity"])
        self.assertIsNone(result["data"])

    async def test_timeout_moves_on_to_the_next_source(self):
        async def slow(_client, _code):
            await asyncio.sleep(1)
        b = by_code_returning(record())
        result = await run_round1([provider("a", slow, round1=True, timeout=0.05), provider("b", b, round1=True)],
                                  ISBN, TARGETS, True)
        self.assertEqual(result["outcomes"][0]["status"], "TIMEOUT")
        self.assertEqual(result["identity"], "b")

    async def test_record_with_another_isbn_is_not_a_match(self):
        result = await run_round1([provider("a", by_code_returning(record(code="9780132350891")), round1=True)],
                                  ISBN, TARGETS, True)
        self.assertIsNone(result["identity"])
        self.assertEqual(result["outcomes"][0]["status"], "MISMATCH")

    async def test_same_title_other_edition_is_not_confirmed(self):
        other_edition = record(code="9780136083238", title="Clean Code (2nd edition)")
        result = await run_round1([provider("a", by_code_returning(other_edition), round1=True)], ISBN, TARGETS, True)
        self.assertIsNone(result["identity"])

    async def test_page_without_any_code_is_not_proof(self):
        result = await run_round1([provider("a", by_code_returning({**BOOK, "identifiers": []}), round1=True)],
                                  ISBN, TARGETS, True)
        self.assertEqual(result["outcomes"][0]["reason"], "CODE_UNKNOWN")
        self.assertIsNone(result["identity"])

    async def test_invalid_checksum_only_asks_raw_barcode_sources(self):
        api, store = by_code_returning(record()), by_code_returning(record(code="1234567890123"))
        result = await run_round1([provider("api", api, round1=True),
                                   provider("store", store, round1=True, accepts_raw_barcode=True)],
                                  "1234567890123", {"1234567890123"}, valid_isbn=False)
        api.assert_not_awaited()
        self.assertEqual(result["identity"], "store")

    async def test_transient_error_is_retried_but_not_found_is_not(self):
        calls = {"n": 0}

        async def flaky(_client, _code):
            calls["n"] += 1
            if calls["n"] == 1:
                raise httpx.ConnectError("boom")
            return record()
        result = await run_round1([provider("a", flaky, round1=True, retries=1)], ISBN, TARGETS, True)
        self.assertEqual(result["identity"], "a")
        self.assertEqual(result["outcomes"][0]["attempts"], 2)

        request = httpx.Request("GET", "https://x.test")
        missing = AsyncMock(side_effect=httpx.HTTPStatusError("404", request=request,
                                                              response=httpx.Response(404, request=request)))
        result = await run_round1([provider("b", missing, round1=True, retries=2)], ISBN, TARGETS, True)
        self.assertEqual(missing.await_count, 1)
        self.assertEqual(result["outcomes"][0]["error"], "HTTP 404")


class Round2Tests(NoBackoff):
    async def _run(self, providers, identity_data=None):
        round1 = {"identity": "a", "data": {**(identity_data or record()), "_provenance": {"round": 1}},
                  "outcomes": [{"source": "a", "status": "SUCCESS", "round": 1}]}
        return round1, await run_round2(providers, round1, ISBN, TARGETS)

    async def test_every_enabled_source_is_asked_even_after_complete_metadata(self):
        b, c = by_code_returning(record()), by_title_returning(record())
        _, round2 = await self._run([provider("a", by_code_returning(record()), round1=True),
                                     provider("b", b), provider("c", by_title=c)])
        b.assert_awaited_once()
        c.assert_awaited_once()
        self.assertEqual(set(round2["metadata"]), {"a", "b", "c"})

    async def test_a_failing_source_does_not_stop_the_others(self):
        broken = AsyncMock(side_effect=httpx.ConnectError("down"))
        _, round2 = await self._run([provider("x", broken), provider("y", by_code_returning(record()))])
        statuses = {o["source"]: o["status"] for o in round2["outcomes"]}
        self.assertEqual(statuses, {"x": "ERROR", "y": "SUCCESS"})

    async def test_same_title_with_another_isbn_is_a_different_edition(self):
        other = record(code="9780136083238")
        _, round2 = await self._run([provider("x", by_title=by_title_returning(other))])
        self.assertEqual(round2["outcomes"][0]["status"], "DIFFERENT_EDITION")
        self.assertNotIn("x", round2["metadata"])

    async def test_title_match_without_codes_only_brings_work_fields(self):
        candidate = {**BOOK, "identifiers": [], "pageCount": 999, "publisher": "Other", "sourceUrl": "u"}
        _, round2 = await self._run([provider("x", by_title=by_title_returning(candidate))])
        data = round2["metadata"]["x"]
        self.assertEqual(round2["outcomes"][0]["verification"], "TITLE_MATCH")
        self.assertIsNone(data["pageCount"])
        self.assertIsNone(data["publisher"])

    async def test_title_match_with_names_in_another_script_keeps_no_authors(self):
        candidate = {**BOOK, "identifiers": [], "authors": ["新海誠"], "sourceUrl": "u"}
        _, round2 = await self._run([provider("x", by_title=by_title_returning(candidate))])
        self.assertEqual(round2["outcomes"][0]["verification"], "TITLE_MATCH")
        self.assertEqual(round2["metadata"]["x"]["authors"], [])

    async def test_ean_scan_and_isbn_only_record_is_judged_by_title_and_author(self):
        round1 = {"identity": "a", "data": {**BOOK, "identifiers": ["8935235226272"]},
                  "outcomes": [{"source": "a", "status": "SUCCESS"}]}
        candidate = {**BOOK, "identifiers": ["9786046948506"]}  # the book's ISBN, not its EAN
        round2 = await run_round2([provider("x", by_title=by_title_returning(candidate))], round1,
                                  "8935235226272", {"8935235226272"})
        self.assertEqual(round2["outcomes"][0]["verification"], "TITLE_MATCH")

    async def test_not_found_and_failed_are_distinct(self):
        _, round2 = await self._run([provider("nf", by_code_returning(None)),
                                     provider("err", AsyncMock(side_effect=RuntimeError("parser")))])
        statuses = {o["source"]: o["status"] for o in round2["outcomes"]}
        self.assertEqual(statuses, {"nf": "NOT_FOUND", "err": "ERROR"})

    async def test_disabled_sources_are_reported_not_called(self):
        _, round2 = await self._run([provider("off", disabled_reason="INACTIVE")])
        self.assertEqual(round2["outcomes"][0]["status"], "DISABLED")

    async def test_round1_misses_are_not_asked_again_by_code(self):
        code_only = by_code_returning(record())
        round1 = {"identity": "a", "data": record(),
                  "outcomes": [{"source": "b", "status": "NOT_FOUND"}, {"source": "a", "status": "SUCCESS"}]}
        await run_round2([provider("b", code_only, round1=True)], round1, ISBN, TARGETS)
        code_only.assert_not_awaited()

    def test_round1_match_is_not_overwritten_by_round2(self):
        round1 = {"outcomes": [{"source": "a", "status": "SUCCESS"}, {"source": "b", "status": "MISMATCH"}]}
        round2 = {"outcomes": [{"source": "b", "status": "NOT_FOUND"}, {"source": "c", "status": "ERROR"}]}
        merged = merge_outcomes(round1, round2)
        self.assertEqual({k: v["status"] for k, v in merged.items()}, {"a": "SUCCESS", "b": "MISMATCH", "c": "ERROR"})


class LookupContractTests(NoBackoff):
    """Through main.lookup_book_by_isbn: provenance, verification summary, compatibility."""

    def setUp(self):
        super().setUp()
        isbn_lookup_cache.clear()

    def tearDown(self):
        isbn_lookup_cache.clear()
        super().tearDown()

    async def _lookup(self, providers, isbn=ISBN, order=None):
        from main import IsbnLookupRequest, lookup_book_by_isbn
        order = order or ",".join(p.name for p in providers if p.round1)
        with patch("main._book_providers", return_value=providers), patch("main.ISBN_ROUND1_ORDER", order), \
             patch("main.ENABLE_FIELD_LEVEL_ISBN_RETRIEVAL", False):
            return await lookup_book_by_isbn(IsbnLookupRequest(isbn=isbn))

    async def test_hyphenated_isbn_is_normalized_before_searching(self):
        search = by_code_returning(record())
        result = await self._lookup([provider("googleBooks", search, round1=True)], isbn="978-0-13-235088-4")
        self.assertEqual(search.await_args.args[1], ISBN)
        self.assertTrue(result["found"])

    async def test_invalid_isbn_calls_no_source(self):
        search = by_code_returning(record())
        result = await self._lookup([provider("googleBooks", search, round1=True)], isbn="12-34")
        search.assert_not_awaited()
        self.assertFalse(result["found"])

    async def test_cross_source_agreement_conflicts_and_provenance(self):
        providers = [
            provider("googleBooks", by_code_returning(record(pageCount=464)), round1=True),
            provider("openLibrary", by_code_returning(record(pageCount=464, translator=None))),
            provider("dinhTi", by_code_returning(record(pageCount=300, publisher="Prentice Hall"))),
            provider("tiki", by_title=by_title_returning({**BOOK, "identifiers": [], "sourceUrl": "https://tiki.test/x"})),
            provider("webSearch", AsyncMock(side_effect=httpx.ReadTimeout("slow"))),
            BookProvider("fahasa", disabled_reason="BLOCKED"),
        ]
        result = await self._lookup(providers)

        self.assertTrue(result["found"])
        verification = result["verification"]
        self.assertTrue(verification["round2Ran"])
        self.assertEqual(verification["round1"]["matchedSource"], "googleBooks")
        self.assertEqual(verification["foundSources"], ["dinhTi", "googleBooks", "openLibrary", "tiki"])
        self.assertEqual(verification["failedSources"], ["webSearch"])
        self.assertIn("fahasa", verification["disabledSources"])
        self.assertTrue(verification["crossSourceVerified"])
        self.assertIn("title", verification["verifiedFields"])
        # 464 (Google + Open Library) vs 300 (Đinh Tị): both kept, flagged as a conflict.
        self.assertIn("pageCount", verification["conflictedFields"])
        alternatives = next(c for c in result["conflicts"] if c["field"] == "pageCount")["alternatives"]
        self.assertEqual(alternatives, [{"source": "dinhTi", "value": 300}])
        self.assertEqual(sorted(result["fieldSources"]["title"]), ["dinhTi", "googleBooks", "openLibrary", "tiki"])
        # Per-value provenance.
        confirmation = next(c for c in result["fieldEvidence"]["title"]["confirmations"] if c["source"] == "tiki")
        self.assertEqual(confirmation["verification"], "TITLE_MATCH")
        self.assertEqual(confirmation["sourceUrl"], "https://tiki.test/x")
        self.assertEqual(confirmation["normalizedValue"], "clean code")
        self.assertIn("retrievedAt", confirmation)
        self.assertEqual(confirmation["round"], 2)
        by_name = {s["name"]: s for s in result["sources"]}
        self.assertEqual(by_name["tiki"]["matchedBy"], "title")
        self.assertEqual(by_name["webSearch"]["status"], "TIMEOUT")
        self.assertEqual(by_name["fahasa"]["status"], "DISABLED")
        self.assertEqual(by_name["vanLang"]["status"], "SKIPPED")  # not in this registry

    async def test_not_found_has_no_metadata_and_lists_what_was_checked(self):
        providers = [provider("googleBooks", by_code_returning(None), round1=True),
                     provider("openLibrary", AsyncMock(side_effect=httpx.ConnectError("x")), round1=True),
                     provider("tiki", by_title=by_title_returning(record()))]
        result = await self._lookup(providers)
        self.assertFalse(result["found"])
        self.assertIsNone(result["title"])
        self.assertEqual(result["message"], "Không tìm thấy thông tin sách theo mã đã nhập.")
        attempts = {a["source"]: a["status"] for a in result["verification"]["round1"]["attempts"]}
        # AI web search (title mode, the default) is a Round 2 source: not a Round 1 attempt.
        self.assertEqual(attempts, {"googleBooks": "NOT_FOUND", "openLibrary": "ERROR"})
        self.assertEqual({s["name"]: s["status"] for s in result["sources"]}["aiWebSearch"], "DISABLED")
        providers[2].by_title.assert_not_awaited()

    async def test_translator_is_fused_from_sources_that_have_it(self):
        providers = [provider("dinhTi", by_code_returning(record(translator=["Hà Giang"])), round1=True),
                     provider("nhanam", by_code_returning(record(translator=["Ha Giang"]))),
                     provider("tiki", by_code_returning(record(translator=["Lê Chu Cầu"])))]
        result = await self._lookup(providers)
        evidence = result["fieldEvidence"]["translator"]
        # "Hà Giang" / "Ha Giang" agree once accents are folded; the third name is a conflict.
        self.assertEqual(evidence["selectionReason"]["agreementCount"], 2)
        self.assertEqual(evidence["selectionReason"]["conflictCount"], 1)
        self.assertIn(result["translator"], (["Hà Giang"], ["Ha Giang"]))
        self.assertIn("translator", result["verification"]["conflictedFields"])


if __name__ == "__main__":
    unittest.main()
