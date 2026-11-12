"""AI web search lane - offline only: OpenRouter is never called here."""
import asyncio
import json
import unittest
from unittest.mock import AsyncMock, patch

import httpx

import ai_web_search as aws
import isbn_rounds
from isbn_rounds import BookProvider, SourcePaused, run_round1, run_round2

CODE = "8935250722483"
PAGE = ("Your Name Thông tin chi tiết Mã hàng 8935250722483 Tên Nhà Cung Cấp IPM Tác giả Shinkai Makoto "
        "Người Dịch Thúy An NXB Hồng Đức Năm XB 2026 Số trang 256 Hình thức Bìa Mềm")


def response(answer: dict, pages: dict[str, str]) -> dict:
    """A Responses API answer with one url_citation per page (shape used by OpenRouter)."""
    annotations = [{"type": "url_citation", "url": url, "title": "t", "content": content} for url, content in pages.items()]
    return {"output": [
        {"type": "web_search_call", "status": "completed"},
        {"type": "message", "content": [{"type": "output_text", "text": json.dumps(answer, ensure_ascii=False),
                                         "annotations": annotations}]},
    ], "usage": {"server_tool_use_details": {"web_search_requests": 1}}}


ANSWER = {"results": [{"url": "https://www.fahasa.com/your-name.html", "title": "Your Name",
                       "authors": ["Shinkai Makoto"], "translators": ["Thúy An"], "publisher": "Hồng Đức",
                       "published_year": "2026", "page_count": "256"}]}


class VerifyTests(unittest.TestCase):
    def test_a_cited_page_showing_the_labelled_code_identifies_the_book(self):
        data = aws.verify(CODE, response(ANSWER, {"https://fahasa.com/your-name.html/": PAGE}))
        self.assertEqual(data["identifiers"], [CODE])
        self.assertEqual((data["title"], data["authors"], data["translator"], data["publisher"],
                          data["publishedDate"], data["pageCount"]),
                         ("Your Name", ["Shinkai Makoto"], ["Thúy An"], "Hồng Đức", "2026", 256))
        self.assertEqual(data["sourceFetchMode"], "ai-web-search")

    def test_an_answer_without_citations_is_a_memory_answer_and_rejected(self):
        self.assertIsNone(aws.verify(CODE, response(ANSWER, {})))

    def test_values_not_on_the_page_are_dropped(self):
        answer = {"results": [{**ANSWER["results"][0], "authors": ["Shinkai Makoto", "Người Bịa Ra"],
                               "publisher": "NXB Không Có", "page_count": "999"}]}
        data = aws.verify(CODE, response(answer, {"https://www.fahasa.com/your-name.html": PAGE}))
        self.assertEqual(data["authors"], ["Shinkai Makoto"])
        self.assertIsNone(data["publisher"])
        self.assertIsNone(data["pageCount"])

    def test_a_page_with_another_code_is_not_proof(self):
        combo = PAGE.replace(CODE, "8936066700001") + " gồm cuốn " + CODE + " và 8935250700000"
        data = aws.verify(CODE, response(ANSWER, {"https://www.fahasa.com/your-name.html": combo}))
        self.assertEqual(data["identifiers"], [])  # AMBIGUOUS: Round 1 reports MISMATCH
        self.assertEqual(data["_codeEvidence"], "AMBIGUOUS")

    def test_uncited_url_or_ungrounded_title_is_ignored(self):
        self.assertIsNone(aws.verify(CODE, response(ANSWER, {"https://other.vn/x": PAGE})))
        answer = {"results": [{**ANSWER["results"][0], "title": "Tên Sách Do AI Nghĩ Ra"}]}
        self.assertIsNone(aws.verify(CODE, response(answer, {"https://www.fahasa.com/your-name.html": PAGE})))

    def test_code_evidence(self):
        self.assertEqual(aws.code_evidence("ISBN: 893-5250-722483", CODE), "LABELLED")
        self.assertEqual(aws.code_evidence("barcode 8935250722483 only", CODE), "LABELLED")
        self.assertEqual(aws.code_evidence("Your Name 8935250722483 bìa mềm", CODE), "SOLE")
        self.assertIsNone(aws.code_evidence("89352507224830", CODE))  # longer number, not the code


class SpendingTests(unittest.IsolatedAsyncioTestCase):
    async def test_cached_answer_spends_nothing(self):
        call = AsyncMock()
        with patch("ai_web_search._cache_get", new=AsyncMock(return_value=(True, None))), \
             patch("ai_web_search.call_openrouter", new=call):
            async with httpx.AsyncClient() as client:
                self.assertIsNone(await aws.ai_by_code(client, CODE))
        call.assert_not_awaited()

    async def test_counter_unavailable_means_no_call(self):
        call = AsyncMock()
        with patch("ai_web_search._cache_get", new=AsyncMock(return_value=(False, None))), \
             patch("db.get_session", side_effect=OSError("db down")), \
             patch("llm_provider.openrouter_connection", return_value=("k", "https://or.test/api/v1")), \
             patch("ai_web_search.call_openrouter", new=call):
            async with httpx.AsyncClient() as client:
                with self.assertRaises(SourcePaused):
                    await aws.ai_by_code(client, CODE)
        call.assert_not_awaited()

    async def test_a_paid_call_is_reserved_then_verified_and_cached(self):
        put = AsyncMock()
        with patch("ai_web_search._cache_get", new=AsyncMock(return_value=(False, None))), \
             patch("ai_web_search.reserve_call", new=AsyncMock(return_value=7)) as reserve, \
             patch("ai_web_search._finish_call", new=AsyncMock()) as finish, \
             patch("ai_web_search._cache_put", new=put), \
             patch("llm_provider.openrouter_connection", return_value=("k", "https://or.test/api/v1")), \
             patch("ai_web_search.call_openrouter",
                   new=AsyncMock(return_value=response(ANSWER, {"https://www.fahasa.com/your-name.html": PAGE}))):
            async with httpx.AsyncClient() as client:
                data = await aws.ai_by_code(client, CODE)
        reserve.assert_awaited_once()
        self.assertEqual(finish.await_args.args[1], "FOUND")
        self.assertEqual(put.await_args.args[1]["identifiers"], [CODE])
        self.assertEqual(data["title"], "Your Name")

    async def test_provider_429_is_retried_inside_one_reserved_slot(self):
        request = httpx.Request("POST", "https://or.test/api/v1/responses")
        busy = httpx.HTTPStatusError("429", request=request, response=httpx.Response(
            429, request=request, text='{"error":{"message":"Provider returned error","code":429}}'))
        call = AsyncMock(side_effect=[busy, response(ANSWER, {"https://www.fahasa.com/your-name.html": PAGE})])
        with patch("ai_web_search._cache_get", new=AsyncMock(return_value=(False, None))), \
             patch("ai_web_search.reserve_call", new=AsyncMock(return_value=9)) as reserve, \
             patch("ai_web_search._finish_call", new=AsyncMock()), patch("ai_web_search._cache_put", new=AsyncMock()), \
             patch("ai_web_search.RETRY_DELAY_SECONDS", 0), \
             patch("llm_provider.openrouter_connection", return_value=("k", "https://or.test/api/v1")), \
             patch("ai_web_search.call_openrouter", new=call):
            async with httpx.AsyncClient() as client:
                data = await aws.ai_by_code(client, CODE)
        self.assertEqual(call.await_count, 2)
        reserve.assert_awaited_once()  # the retry does not count as another call
        self.assertEqual(data["identifiers"], [CODE])

    async def test_persistent_429_is_logged_with_the_reason(self):
        request = httpx.Request("POST", "https://or.test/api/v1/responses")
        busy = httpx.HTTPStatusError("429", request=request, response=httpx.Response(429, request=request, text="busy"))
        with patch("ai_web_search._cache_get", new=AsyncMock(return_value=(False, None))), \
             patch("ai_web_search.reserve_call", new=AsyncMock(return_value=9)), \
             patch("ai_web_search._finish_call", new=AsyncMock()) as finish, \
             patch("ai_web_search.RETRY_DELAY_SECONDS", 0), \
             patch("llm_provider.openrouter_connection", return_value=("k", "https://or.test/api/v1")), \
             patch("ai_web_search.call_openrouter", new=AsyncMock(side_effect=busy)):
            async with httpx.AsyncClient() as client:
                with self.assertRaises(httpx.HTTPStatusError):
                    await aws.ai_by_code(client, CODE)
        status, detail = finish.await_args.args[1], finish.await_args.args[2]
        self.assertEqual((status, detail["httpStatus"], detail["attempts"]), ("ERROR", 429, 3))

    async def test_a_call_cut_off_by_the_timeout_is_recorded_not_left_reserved(self):
        async def slow(*_args, **_kwargs):
            await asyncio.sleep(5)
        with patch("ai_web_search._cache_get", new=AsyncMock(return_value=(False, None))), \
             patch("ai_web_search.reserve_call", new=AsyncMock(return_value=4)), \
             patch("ai_web_search._finish_call", new=AsyncMock()) as finish, \
             patch("llm_provider.openrouter_connection", return_value=("k", "https://or.test/api/v1")), \
             patch("ai_web_search.call_openrouter", new=slow):
            async with httpx.AsyncClient() as client:
                with self.assertRaises(asyncio.TimeoutError):
                    await asyncio.wait_for(aws.ai_by_code(client, CODE), timeout=0.05)
        self.assertEqual(finish.await_args.args[1], "TIMEOUT")

    async def test_limit_reached_is_reported_as_paused(self):
        provider = BookProvider("aiWebSearch", by_code=AsyncMock(side_effect=SourcePaused("Hết hạn mức (3/3)")))
        call = await isbn_rounds.call_with_retry(provider, lambda client: provider.by_code(client, CODE))
        self.assertEqual((call["status"], call["error"]), ("PAUSED", "Hết hạn mức (3/3)"))

    async def test_request_shape(self):
        seen = {}

        def handler(request):
            seen["url"], seen["body"] = str(request.url), json.loads(request.content)
            seen["auth"] = request.headers["authorization"]
            return httpx.Response(200, json={"output": []})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            await aws.call_openrouter(client, CODE, "sk-test", "https://or.test/api/v1")
        self.assertEqual(seen["url"], "https://or.test/api/v1/responses")
        self.assertEqual(seen["auth"], "Bearer sk-test")
        tool = seen["body"]["tools"][0]
        self.assertEqual(tool["type"], "openrouter:web_search")
        self.assertEqual((tool["parameters"]["engine"], tool["parameters"]["max_uses"]), ("exa", 1))
        self.assertEqual(seen["body"]["model"], "qwen/qwen3.7-flash")
        self.assertIn(CODE, seen["body"]["input"])
        self.assertEqual(seen["body"]["reasoning"], {"effort": "low"})  # 2 of 3 live calls ran past 60 s


def code_provider(name, found=True, delay=0.0, code=CODE, title="Your Name"):
    async def by_code(_client, _code):
        await asyncio.sleep(delay)
        return {"title": title, "authors": ["Shinkai Makoto"], "identifiers": [code], "sourceUrl": name} if found else None
    return BookProvider(name, by_code=AsyncMock(side_effect=by_code), round1=True, retries=0)


class ParallelLaneTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        isbn_rounds.reset_politeness_state()

    async def test_book_in_catalog_never_starts_the_ai_lane(self):
        ai = code_provider("aiWebSearch")
        round1 = await run_round1([code_provider("catalog"), code_provider("ipm")], CODE, {CODE}, True,
                                  parallel=ai, parallel_after="catalog")
        self.assertEqual(round1["identity"], "catalog")
        ai.by_code.assert_not_awaited()
        self.assertEqual(round1["outcomes"][-1]["reason"], "BOOK_IN_CATALOG")

    async def test_ai_runs_alongside_and_a_code_source_still_wins(self):
        ai = code_provider("aiWebSearch", delay=0.2)
        round1 = await run_round1([code_provider("catalog", found=False), code_provider("ipm", delay=0.05)],
                                  CODE, {CODE}, True, parallel=ai, parallel_after="catalog")
        self.assertEqual(round1["identity"], "ipm")
        self.assertIsNotNone(round1["parallelTask"])  # still running: becomes a Round 2 source
        round2 = await run_round2([], round1, CODE, {CODE})
        self.assertIn("aiWebSearch", round2["metadata"])
        self.assertEqual(round2["outcomes"][0]["status"], "SUCCESS")
        ai.by_code.assert_awaited_once()  # one paid call for both rounds

    async def test_ai_identifies_the_book_when_no_code_source_has_it(self):
        ai = code_provider("aiWebSearch")
        round1 = await run_round1([code_provider("catalog", found=False), code_provider("ipm", found=False)],
                                  CODE, {CODE}, True, parallel=ai, parallel_after="catalog")
        self.assertEqual(round1["identity"], "aiWebSearch")
        self.assertIsNone(round1["parallelTask"])

    async def test_unverified_ai_answer_is_not_an_identity(self):
        ai = code_provider("aiWebSearch", code="8936066700001")
        round1 = await run_round1([code_provider("catalog", found=False)], CODE, {CODE}, True,
                                  parallel=ai, parallel_after="catalog")
        self.assertIsNone(round1["identity"])
        self.assertEqual(round1["outcomes"][-1]["status"], "MISMATCH")

    async def test_lanes_overlap_in_time(self):
        ai = code_provider("aiWebSearch", delay=0.3)
        started = asyncio.get_running_loop().time()
        await run_round1([code_provider("catalog", found=False), code_provider("ipm", found=False, delay=0.3)],
                         CODE, {CODE}, True, parallel=ai, parallel_after="catalog")
        self.assertLess(asyncio.get_running_loop().time() - started, 0.55)  # not 0.6 s one after the other


# ── title mode (ISBN_AI_WEB_MODE=title): Round 2 search by the identified title ──

NO_CODE_PAGE = "Your Name - Shinkai Makoto. Review: a story about two teenagers. Thúy An dịch, NXB Hồng Đức."
OTHER_EDITION_PAGE = PAGE.replace(CODE, "8935250799999")
URL_A, URL_B = "https://www.fahasa.com/your-name.html", "https://review.vn/your-name"


def ai_title_patches(answer_pages, cached=None):
    """Patches for one ai_by_title call; returns (contexts, call mock, finish mock, put mock)."""
    call = AsyncMock(return_value=response(*answer_pages)) if answer_pages else AsyncMock()
    finish, put = AsyncMock(), AsyncMock()
    contexts = [
        patch("ai_web_search._cache_get", new=AsyncMock(return_value=(cached is not None, cached))),
        patch("ai_web_search.reserve_call", new=AsyncMock(return_value=11)),
        patch("ai_web_search._finish_call", new=finish), patch("ai_web_search._cache_put", new=put),
        patch("llm_provider.openrouter_connection", return_value=("k", "https://or.test/api/v1")),
        patch("ai_web_search.call_openrouter", new=call),
    ]
    return contexts, call, finish, put


def answer_for(*urls):
    return {"results": [{**ANSWER["results"][0], "url": url} for url in urls]}


class TitleCandidateTests(unittest.TestCase):
    def test_page_codes_are_labelled_codes_or_the_sole_scanned_code(self):
        self.assertEqual(aws.page_codes(PAGE, CODE), [CODE])
        self.assertEqual(aws.page_codes("Your Name ISBN: 978-604-1-23456-7", CODE), ["9786041234567"])
        self.assertEqual(aws.page_codes("Your Name 8935250722483 bìa mềm", CODE), [CODE])
        self.assertEqual(aws.page_codes(NO_CODE_PAGE, CODE), [])

    def test_pages_showing_the_scanned_code_come_first(self):
        candidates = aws.title_candidates(CODE, response(answer_for(URL_B, URL_A),
                                                         {URL_B: NO_CODE_PAGE, URL_A: PAGE}))
        self.assertEqual([c["sourceUrl"] for c in candidates], [URL_A, URL_B])
        self.assertEqual((candidates[0]["identifiers"], candidates[1]["identifiers"]), ([CODE], []))

    def test_a_site_name_copied_into_the_title_is_dropped(self):
        # Seen live: qwen answered "Nhà giả kim – Bến Nghé Books" for a page titled "Nhà Giả Kim - Paulo Coelho".
        page = "# Nhà Giả Kim - Paulo Coelho Mã sản phẩm: 8935235226272 Thương hiệu: Nhã Nam Tác giả: Paulo Coelho"
        answer = {"results": [{"url": URL_A, "title": "Nhà giả kim – Bến Nghé Books", "authors": ["Paulo Coelho"]}]}
        [candidate] = aws.title_candidates("8935235226272", response(answer, {URL_A: page}))
        self.assertEqual((candidate["title"], candidate["identifiers"]), ("Nhà giả kim", ["8935235226272"]))
        self.assertIsNone(aws._grounded_title("Sách Khác – Bến Nghé Books", aws._norm(page)))
        # Seen live too: the answer copied the page heading, author included.
        answer["results"][0]["title"] = "Nhà Giả Kim - Paulo Coelho"
        [candidate] = aws.title_candidates("8935235226272", response(answer, {URL_A: page}))
        self.assertEqual(candidate["title"], "Nhà Giả Kim")

    def test_memory_answers_and_ungrounded_titles_are_dropped(self):
        self.assertEqual(aws.title_candidates(CODE, response(answer_for(URL_A), {})), [])
        answer = {"results": [{**ANSWER["results"][0], "url": URL_A, "title": "Tên Sách Do AI Nghĩ Ra"}]}
        self.assertEqual(aws.title_candidates(CODE, response(answer, {URL_A: PAGE})), [])


class TitleModeTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        isbn_rounds.reset_politeness_state()

    async def round2_with_ai(self, answer, pages):
        contexts, call, finish, put = ai_title_patches((answer, pages))
        for context in contexts:
            context.start()
        self.addCleanup(patch.stopall)
        ai = BookProvider("aiWebSearch", by_title=aws.title_search_for(CODE), round1=False, retries=0)
        round1 = await run_round1([code_provider("ipm")], CODE, {CODE}, True)
        round2 = await run_round2([ai], round1, CODE, {CODE})
        outcome = next(o for o in round2["outcomes"] if o["source"] == "aiWebSearch")
        return round2["metadata"].get("aiWebSearch"), outcome, call, finish, put

    async def test_a_page_with_the_scanned_code_gives_every_field(self):
        data, outcome, call, finish, put = await self.round2_with_ai(answer_for(URL_A), {URL_A: PAGE})
        self.assertEqual((outcome["status"], outcome["verification"]), ("SUCCESS", "CODE_MATCH"))
        self.assertEqual((data["publisher"], data["pageCount"], data["translator"]), ("Hồng Đức", 256, ["Thúy An"]))
        prompt = call.await_args.kwargs["prompt"]
        self.assertIn("Your Name Shinkai Makoto", prompt)  # searched by title + author, not by the bare code
        self.assertIn(CODE, prompt)
        self.assertEqual(finish.await_args.args[1], "FOUND")
        self.assertEqual(put.await_args.args[0], f"title:{CODE}")

    async def test_a_page_without_the_code_only_adds_work_fields(self):
        data, outcome, _call, finish, _put = await self.round2_with_ai(answer_for(URL_B), {URL_B: NO_CODE_PAGE})
        self.assertEqual(outcome["verification"], "TITLE_MATCH")
        self.assertEqual(data["authors"], ["Shinkai Makoto"])
        self.assertIsNone(data["publisher"])  # an edition field: never taken from a title-only match
        self.assertEqual(data["translator"], [])
        self.assertEqual(finish.await_args.args[1], "PARTIAL")

    async def test_a_page_with_another_code_is_a_different_edition(self):
        data, outcome, *_ = await self.round2_with_ai(answer_for(URL_A), {URL_A: OTHER_EDITION_PAGE})
        self.assertIsNone(data)
        self.assertEqual(outcome["status"], "DIFFERENT_EDITION")

    async def test_cached_title_search_spends_nothing(self):
        contexts, call, *_ = ai_title_patches(None, cached=[])
        for context in contexts:
            context.start()
        self.addCleanup(patch.stopall)
        async with httpx.AsyncClient() as client:
            self.assertEqual(await aws.ai_by_title(client, CODE, "Your Name", "Shinkai Makoto"), [])
        call.assert_not_awaited()

    async def test_title_mode_provider_is_round2_only_and_never_searches_by_code(self):
        import main
        with patch("ai_web_search.MODE", "title"):
            provider = main._ai_web_provider(CODE)
        self.assertIsNone(provider.by_code)
        self.assertIsNotNone(provider.by_title)
        self.assertFalse(provider.round1)
        with patch("ai_web_search.MODE", "off"):
            self.assertIn("ISBN_AI_WEB_MODE=off", main._ai_web_provider(CODE).disabled_reason)


if __name__ == "__main__":
    unittest.main()
