"""Multi-image book OCR (book_ocr/ + routes_book_ocr.py). OpenRouter is
never called: a fake provider stands in for qwen/qwen3.7-flash, so these run
in CI without an API key. Values are checked, not just HTTP 200."""
import asyncio
import dataclasses
import io
import unicodedata
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

import llm_provider
from book_ocr import service
from book_ocr.config import load_settings
from book_ocr.errors import BookOcrError
from book_ocr.extractor import FallbackBudget
from book_ocr.images import prepare_image
from book_ocr.validation import validate_extraction
import routes_book_ocr

ISBN = "9786041234567"        # valid checksum
ISBN_OTHER = "9786049876547"  # valid checksum, different book
ISBN10 = "0439708184"         # -> 9780439708180


def jpeg(width=600, height=900, color=(200, 180, 160), exif_orientation=None) -> bytes:
    out = io.BytesIO()
    image = Image.new("RGB", (width, height), color)
    if exif_orientation:
        exif = Image.Exif()
        exif[0x0112] = exif_orientation
        image.save(out, format="JPEG", exif=exif)
    else:
        image.save(out, format="JPEG")
    return out.getvalue()


def png_rgba(width=300, height=300) -> bytes:
    out = io.BytesIO()
    Image.new("RGBA", (width, height), (0, 0, 0, 0)).save(out, format="PNG")
    return out.getvalue()


def webp(width=300, height=400) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (width, height), (10, 20, 30)).save(out, format="WEBP")
    return out.getvalue()


def obs(source, value, observed=None):
    return {"source": source, "value": value, "observedText": observed if observed is not None else str(value)}


def model_answer(**observations):
    return {"images": [], "observations": observations, "otherCodes": []}


def usage(model="qwen/qwen3.7-flash", cost=0.0004):
    return llm_provider.ChatUsage(provider="openrouter", model=model, latency_ms=1200, prompt_tokens=2100,
                                  completion_tokens=180, tool_call_count=0, cost_usd=cost, feature="book_ocr")


class FakeProvider:
    def __init__(self, model, answer=None, error=None):
        self.model = model
        self.analyze_images = AsyncMock()
        if error is not None:
            self.analyze_images.side_effect = error
        else:
            self.analyze_images.return_value = (answer, usage(model))


def settings(**overrides):
    base = dataclasses.replace(load_settings(), enabled=True, model="qwen/qwen3.7-flash", fallback_model=None,
                               max_file_bytes=2 * 1024 * 1024, max_total_bytes=5 * 1024 * 1024, max_images=3,
                               fallback_daily_budget_usd=0.5)
    return dataclasses.replace(base, **overrides)


def scan(uploads, answer=None, *, error=None, lookup=None, barcode=None, cfg=None, providers=None):
    providers = providers or {"qwen/qwen3.7-flash": FakeProvider("qwen/qwen3.7-flash", answer, error)}
    result = asyncio.run(service.scan_book_images(
        uploads, barcode=barcode, lookup_isbn=lookup, settings=cfg or settings(),
        provider_factory=lambda model: providers[model]))
    return result, providers


def http_status_error(code):
    request = httpx.Request("POST", "https://openrouter.ai/api/v1/chat/completions")
    return httpx.HTTPStatusError("upstream", request=request, response=httpx.Response(code, request=request))


class BookOcrTestCase(unittest.TestCase):
    def setUp(self):
        service.extraction_cache.clear()


class ExtractionTests(BookOcrTestCase):
    def test_one_image_success(self):
        answer = model_answer(title=[obs("front_cover", "Mắt Biếc")],
                              authors=[obs("front_cover", ["Nguyễn Nhật Ánh"], "NGUYỄN NHẬT ÁNH")])
        result, providers = scan({"front_cover": jpeg()}, answer)
        call = providers["qwen/qwen3.7-flash"].analyze_images.call_args
        self.assertEqual([i.label for i in call.args[0]], ["front_cover"])
        self.assertEqual(call.args[0][0].mime, "image/jpeg")
        self.assertEqual(result["status"], "SUCCESS")
        self.assertEqual(result["metadata"]["title"], "Mắt Biếc")
        self.assertEqual(result["metadata"]["authors"], ["Nguyễn Nhật Ánh"])
        self.assertEqual(result["fields"]["title"]["status"], "EXTRACTED")
        self.assertEqual(result["proposals"]["title"]["value"], "Mắt Biếc")
        # One model reading of one photo: proposed (one click), not filled on its own (OCR 2.0 policy).
        self.assertFalse(result["proposals"]["title"]["safeToApply"])
        self.assertIn("SINGLE_SOURCE", result["proposals"]["title"]["reasons"])
        self.assertEqual(result["isbnLookup"]["status"], "SKIPPED_NO_VALID_ISBN")
        self.assertEqual(result["usage"]["imageCount"], 1)
        self.assertEqual(result["usage"]["costUsd"], 0.0004)
        self.assertEqual(result["fieldEvidence"]["title"], [{"source": "front_cover", "observedText": "Mắt Biếc"}])

    def test_three_images_in_one_request_corroborate(self):
        answer = model_answer(
            title=[obs("front_cover", "NHÀ GIẢ KIM"), obs("copyright_page", "Nhà giả kim", "NHÀ GIẢ KIM\nTiểu thuyết")],
            authors=[obs("front_cover", ["Paulo Coelho"]), obs("copyright_page", ["Paulo Coelho"], "Tác giả: Paulo Coelho")],
            translators=[obs("copyright_page", ["Lê Chu Cầu"], "Người dịch: Lê Chu Cầu")],
            publisher=[obs("copyright_page", "Nhà xuất bản Hội Nhà Văn", "NHÀ XUẤT BẢN HỘI NHÀ VĂN")],
            isbn=[obs("back_cover", ISBN, "ISBN 978-604-1-23456-7"), obs("copyright_page", ISBN, "ISBN: 978-604-1-23456-7")],
            publicationYear=[obs("copyright_page", 2020, "Xuất bản năm 2020")],
            pageCount=[obs("copyright_page", 228, "Số trang: 228")],
            description=[{"source": "back_cover", "value": "Tất cả những trải nghiệm trong chuyến phiêu du...", "observedText": None}],
        )
        lookup = AsyncMock(return_value={"found": False})
        result, providers = scan({"front_cover": jpeg(), "back_cover": jpeg(), "copyright_page": jpeg()}, answer, lookup=lookup)
        provider = providers["qwen/qwen3.7-flash"]
        self.assertEqual(provider.analyze_images.await_count, 1)
        self.assertEqual([i.label for i in provider.analyze_images.call_args.args[0]],
                         ["front_cover", "back_cover", "copyright_page"])
        fields = result["fields"]
        self.assertEqual(fields["title"]["status"], "CORROBORATED")
        self.assertEqual(fields["title"]["value"], "Nhà giả kim")  # not the ALL-CAPS cover spelling
        self.assertEqual(fields["isbn"]["status"], "CORROBORATED")
        self.assertEqual(fields["authors"]["status"], "CORROBORATED")
        self.assertEqual(result["metadata"]["translators"], ["Lê Chu Cầu"])
        self.assertEqual(result["metadata"]["publishedYear"], 2020)
        self.assertEqual(result["metadata"]["pageCount"], 228)
        self.assertEqual(result["metadata"]["language"], "vi")
        self.assertEqual(result["fields"]["language"]["status"], "INFERRED")
        self.assertFalse(result["proposals"]["language"]["safeToApply"])  # inferred, not read
        lookup.assert_awaited_once_with(ISBN)
        self.assertEqual(result["isbnLookup"]["status"], "NOT_FOUND")
        self.assertEqual(result["proposals"]["translatorText"]["value"], "Lê Chu Cầu")
        self.assertEqual(result["proposals"]["publishedDate"]["value"], "2020")

    def test_vietnamese_title_keeps_diacritics_and_is_nfc(self):
        decomposed = unicodedata.normalize("NFD", "Tôi Thấy Hoa Vàng Trên Cỏ Xanh")
        result, _ = scan({"front_cover": jpeg()}, model_answer(title=[obs("front_cover", decomposed)]))
        self.assertEqual(result["metadata"]["title"], "Tôi Thấy Hoa Vàng Trên Cỏ Xanh")
        self.assertTrue(unicodedata.is_normalized("NFC", result["metadata"]["title"]))

    def test_valid_isbn13_and_isbn10_converted(self):
        result, _ = scan({"back_cover": jpeg()}, model_answer(isbn=[obs("back_cover", "978-604-1-23456-7", "ISBN 978-604-1-23456-7")]))
        self.assertEqual(result["metadata"]["isbn13"], ISBN)
        result10, _ = scan({"copyright_page": jpeg()}, model_answer(isbn=[obs("copyright_page", "0-439-70818-4", "ISBN 0-439-70818-4")]))
        self.assertEqual(result10["metadata"]["isbn13"], "9780439708180")
        self.assertEqual(result10["metadata"]["isbn10"], ISBN10)
        self.assertEqual(result10["proposals"]["isbn10"]["value"], ISBN10)

    def test_invalid_isbn_checksum_and_non_isbn_ean(self):
        lookup = AsyncMock()
        answer = model_answer(isbn=[obs("back_cover", "9786041234568", "ISBN 978-604-1-23456-8"),
                                    obs("copyright_page", "8935235226272", "8935235226272")])
        result, _ = scan({"back_cover": jpeg(), "copyright_page": jpeg()}, answer, lookup=lookup)
        self.assertEqual(result["fields"]["isbn"]["status"], "INVALID")
        self.assertIsNone(result["metadata"]["isbn13"])
        self.assertIn("INVALID_CHECKSUM:isbn:back_cover", result["warnings"])
        self.assertIn("NOT_ISBN_PREFIX:isbn:copyright_page", result["warnings"])
        self.assertEqual(result["proposals"]["isbn"]["status"], "INVALID")
        self.assertIsNone(result["proposals"]["isbn"]["value"])
        lookup.assert_not_awaited()

    def test_no_isbn_still_usable(self):
        lookup = AsyncMock()
        result, _ = scan({"front_cover": jpeg()}, model_answer(title=[obs("front_cover", "Dế Mèn phiêu lưu ký")]), lookup=lookup)
        self.assertEqual(result["status"], "SUCCESS")
        self.assertIn("isbn13", result["missingFields"])
        self.assertEqual(result["proposals"]["isbn"]["status"], "MISSING")
        self.assertIsNone(result["proposals"]["isbn"]["value"])
        self.assertEqual(result["isbnLookup"]["status"], "SKIPPED_NO_VALID_ISBN")
        lookup.assert_not_awaited()

    def test_two_images_different_isbns_conflict(self):
        lookup = AsyncMock()
        answer = model_answer(isbn=[obs("back_cover", ISBN, "ISBN " + ISBN), obs("copyright_page", ISBN_OTHER, "ISBN " + ISBN_OTHER)])
        result, _ = scan({"back_cover": jpeg(), "copyright_page": jpeg()}, answer, lookup=lookup)
        self.assertEqual(result["fields"]["isbn"]["status"], "CONFLICTED")
        self.assertIn("isbn13", result["conflictedFields"])
        self.assertIsNone(result["proposals"]["isbn"]["value"])
        self.assertEqual({o["value"] for o in result["proposals"]["isbn"]["options"]}, {ISBN, ISBN_OTHER})
        self.assertEqual(result["isbnLookup"]["status"], "SKIPPED_ISBN_CONFLICT")
        lookup.assert_not_awaited()

    def test_two_images_different_titles_conflict(self):
        answer = model_answer(title=[obs("front_cover", "Cây cam ngọt của tôi"), obs("copyright_page", "Cây chuối non đi giày xanh")])
        result, _ = scan({"front_cover": jpeg(), "copyright_page": jpeg()}, answer)
        self.assertEqual(result["fields"]["title"]["status"], "CONFLICTED")
        self.assertIsNone(result["metadata"]["title"])
        self.assertFalse(result["proposals"]["title"]["safeToApply"])
        self.assertEqual(result["status"], "NO_DATA")

    def test_identity_conflict_makes_every_field_unsafe(self):
        # Live case: a Dế Mèn front cover + a Harry Potter page in one scan.
        answer = model_answer(title=[obs("front_cover", "Dế Mèn phiêu lưu ký"), obs("copyright_page", "Harry Potter và Hội Phượng Hoàng")],
                              translators=[obs("copyright_page", ["Lý Lan"], "LÝ LAN dịch")])
        result, _ = scan({"front_cover": jpeg(), "copyright_page": jpeg()}, answer)
        self.assertIn("IMAGES_MAY_SHOW_DIFFERENT_BOOKS", result["warnings"])
        self.assertEqual(result["proposals"]["translatorText"]["value"], "Lý Lan")
        self.assertFalse(any(p["safeToApply"] for p in result["proposals"].values()))

    def test_answer_missing_fields_is_fine(self):
        result, _ = scan({"front_cover": jpeg()}, {"observations": {"title": [obs("front_cover", "Số đỏ")]}})
        self.assertEqual(result["metadata"]["title"], "Số đỏ")
        self.assertIn("authors", result["missingFields"])
        self.assertEqual(result["metadata"]["authors"], [])

    def test_answer_with_wrong_schema(self):
        with self.assertRaises(BookOcrError) as ctx:
            scan({"front_cover": jpeg()}, {"observations": [{"title": "x"}]})
        self.assertEqual((ctx.exception.status, ctx.exception.code), (502, "AI_INVALID_SCHEMA"))
        # One malformed item is dropped, the rest of the answer survives.
        result, _ = scan({"front_cover": jpeg(color=(1, 2, 3))}, model_answer(
            title=[{"value": "no source"}, obs("front_cover", "Số đỏ")], authors="not-a-list"))
        self.assertEqual(result["metadata"]["title"], "Số đỏ")
        self.assertIn("MALFORMED_OBSERVATION:title", result["warnings"])
        self.assertIn("MALFORMED_FIELD:authors", result["warnings"])

    def test_invalid_json_from_model(self):
        with self.assertRaises(BookOcrError) as ctx:
            scan({"front_cover": jpeg()}, error=llm_provider.VisionResponseError("not json", usage()))
        self.assertEqual((ctx.exception.status, ctx.exception.code), (502, "AI_INVALID_RESPONSE"))

    def test_fabricated_or_unsupported_values_are_rejected(self):
        answer = model_answer(
            title=[obs("front_cover", "Harry Potter", "MẮT BIẾC")],                       # not what it read
            publisher=[{"source": "front_cover", "value": "NXB Trẻ", "observedText": None}],  # no evidence
            isbn=[obs("back_cover", ISBN, "ISBN " + ISBN)],                               # image not uploaded
            authors=[obs("front_cover", ["Lê Chu Cầu"], "Dịch giả: Lê Chu Cầu")],        # translator line
            publicationYear=[obs("front_cover", 2019, "In xong và nộp lưu chiểu năm 2019")],  # print year
        )
        result, _ = scan({"front_cover": jpeg()}, answer)
        for field in ("title", "publisher", "isbn", "authors", "publicationYear"):
            self.assertEqual(result["fields"][field]["status"], "INVALID", field)
            self.assertIsNone(result["proposals"].get({"isbn": "isbn13", "authors": "authorsText",
                                                       "publicationYear": "publishedDate"}.get(field, field))["value"])
        warnings = result["warnings"]
        self.assertIn("UNGROUNDED:title:front_cover", warnings)
        self.assertIn("NO_EVIDENCE:publisher:front_cover", warnings)
        self.assertIn("UNKNOWN_SOURCE:isbn:back_cover", warnings)
        self.assertIn("ROLE_MISMATCH:authors:front_cover", warnings)
        self.assertIn("ROLE_MISMATCH:publicationYear:front_cover", warnings)
        self.assertEqual(result["status"], "NO_DATA")

    def test_print_year_is_not_publication_year(self):
        answer = model_answer(printYear=[obs("copyright_page", 2021, "In xong và nộp lưu chiểu năm 2021")],
                              copyrightYear=[obs("copyright_page", 1990, "© 1990 Nguyễn Nhật Ánh")])
        result, _ = scan({"copyright_page": jpeg()}, answer)
        self.assertEqual(result["metadata"]["printYear"], 2021)
        self.assertEqual(result["metadata"]["copyrightYear"], 1990)
        self.assertIsNone(result["metadata"]["publishedYear"])
        self.assertIn("ONLY_PRINT_YEAR_FOUND", result["warnings"])
        self.assertEqual(result["proposals"]["publishedDate"]["status"], "MISSING")

    def test_model_timeout(self):
        with self.assertRaises(BookOcrError) as ctx:
            scan({"front_cover": jpeg()}, error=httpx.ReadTimeout("slow"))
        self.assertEqual((ctx.exception.status, ctx.exception.code), (504, "AI_TIMEOUT"))
        with self.assertRaises(BookOcrError) as ctx:
            scan({"front_cover": jpeg()}, error=asyncio.TimeoutError())
        self.assertEqual(ctx.exception.code, "AI_TIMEOUT")

    def test_openrouter_429_and_5xx(self):
        with self.assertRaises(BookOcrError) as ctx:
            scan({"front_cover": jpeg()}, error=http_status_error(429))
        self.assertEqual((ctx.exception.status, ctx.exception.code), (429, "AI_RATE_LIMITED"))
        with self.assertRaises(BookOcrError) as ctx:
            scan({"front_cover": jpeg()}, error=http_status_error(503))
        self.assertEqual((ctx.exception.status, ctx.exception.code), (502, "AI_UPSTREAM_ERROR"))
        self.assertNotIn("openrouter", ctx.exception.message.lower())

    def test_missing_api_key(self):
        with patch.dict("os.environ", {"OPENROUTER_API_KEY": ""}):
            with self.assertRaises(BookOcrError) as ctx:
                asyncio.run(service.scan_book_images({"front_cover": jpeg()}, settings=settings()))
        self.assertEqual((ctx.exception.status, ctx.exception.code), (503, "AI_NOT_CONFIGURED"))

    def test_partial_author_agreement_needs_review(self):
        answer = model_answer(authors=[obs("front_cover", ["Ngô Tất Tố"]),
                                       obs("copyright_page", ["Ngô Tất Tố", "Phan Văn A"], "Ngô Tất Tố, Phan Văn A")])
        result, _ = scan({"front_cover": jpeg(), "copyright_page": jpeg()}, answer)
        self.assertEqual(result["fields"]["authors"]["status"], "REVIEW_REQUIRED")
        self.assertEqual(result["metadata"]["authors"], ["Ngô Tất Tố", "Phan Văn A"])
        self.assertFalse(result["proposals"]["authorsText"]["safeToApply"])


class BarcodeTests(BookOcrTestCase):
    def test_decoded_barcode_corroborates_image_isbn(self):
        answer = model_answer(isbn=[obs("back_cover", ISBN, "ISBN " + ISBN)])
        result, _ = scan({"back_cover": jpeg()}, answer, barcode=ISBN)
        self.assertEqual(result["fields"]["isbn"]["status"], "CORROBORATED")
        self.assertEqual(result["fields"]["isbn"]["sources"], ["back_cover", "barcode"])

    def test_retail_ean_barcode_is_not_isbn(self):
        result, _ = scan({"back_cover": jpeg()}, model_answer(), barcode="8934974184027")
        self.assertIsNone(result["metadata"]["isbn13"])
        self.assertIn("BARCODE_NOT_ISBN", result["warnings"])
        self.assertEqual(result["otherCodes"][0]["value"], "8934974184027")


class LookupReconciliationTests(BookOcrTestCase):
    ANSWER = model_answer(
        title=[obs("front_cover", "Nhà giả kim")],
        publisher=[obs("copyright_page", "NXB Hội Nhà Văn", "NXB HỘI NHÀ VĂN")],
        isbn=[obs("copyright_page", ISBN, "ISBN " + ISBN)],
        pageCount=[obs("copyright_page", 228, "228 trang")],
    )

    def lookup(self, **overrides):
        record = {"found": True, "isbn": ISBN, "isbn13": ISBN, "title": "NHÀ GIẢ KIM", "authors": ["Paulo Coelho"],
                  "publisher": "Nhà Xuất Bản Hội Nhà Văn", "pageCount": 227, "description": "Một cuốn sách về ước mơ.",
                  "categories": ["Tiểu thuyết"], "conflictedFields": [], "lowConfidenceFields": []}
        record.update(overrides)
        return AsyncMock(return_value=record)

    def test_lookup_used_and_fields_reconciled(self):
        lookup = self.lookup()
        result, _ = scan({"front_cover": jpeg(), "copyright_page": jpeg()}, self.ANSWER, lookup=lookup)
        lookup.assert_awaited_once_with(ISBN)
        p = result["proposals"]
        self.assertEqual(result["isbnLookup"]["status"], "FOUND")
        self.assertTrue(result["isbnLookup"]["editionMatches"])
        # Same title, marks included; the printed (not ALL-CAPS) spelling is proposed.
        self.assertEqual((p["title"]["status"], p["title"]["value"], p["title"]["source"], p["title"]["safeToApply"]),
                         ("CORROBORATED", "Nhà giả kim", "images+isbn_lookup", True))
        self.assertEqual(p["publisher"]["status"], "CORROBORATED")  # "NXB" == "Nhà Xuất Bản"
        # 228 printed vs 227 from the provider: shown to staff, nothing chosen.
        self.assertEqual((p["pageCount"]["status"], p["pageCount"]["value"]), ("CONFLICTED", None))
        self.assertIn("pageCount", result["conflictedFields"])
        self.assertEqual({o["value"] for o in p["pageCount"]["options"]}, {"228", "227"})
        # Not printed in the images, offered from the lookup.
        self.assertEqual((p["authorsText"]["status"], p["authorsText"]["value"], p["authorsText"]["safeToApply"]),
                         ("LOOKUP_ONLY", "Paulo Coelho", True))
        self.assertEqual(p["categoriesText"]["value"], "Tiểu thuyết")
        # The ISBN echo of a lookup made BY that ISBN is not counted as corroboration.
        self.assertEqual(p["isbn13"]["status"], "EXTRACTED")
        self.assertIn("LOOKUP_RECORD_FOUND", p["isbn13"]["reasons"])

    def test_lookup_flags_and_other_edition_are_never_safe(self):
        flagged = self.lookup(conflictedFields=["authors"])
        result, _ = scan({"front_cover": jpeg(), "copyright_page": jpeg()}, self.ANSWER, lookup=flagged)
        self.assertFalse(result["proposals"]["authorsText"]["safeToApply"])
        self.assertIn("LOOKUP_FLAGGED_FIELD", result["proposals"]["authorsText"]["reasons"])

        service.extraction_cache.clear()
        other_edition = self.lookup(isbn="9780061122415", isbn13="9780061122415")
        result, _ = scan({"front_cover": jpeg(), "copyright_page": jpeg()}, self.ANSWER, lookup=other_edition)
        self.assertFalse(result["isbnLookup"]["editionMatches"])
        self.assertIn("ISBN_LOOKUP_DIFFERENT_EDITION", result["warnings"])
        self.assertFalse(any(p["safeToApply"] for p in result["proposals"].values() if p["source"] == "isbn_lookup"))
        # The printed values stay, they are not replaced by the other edition's record.
        self.assertEqual(result["proposals"]["pageCount"]["value"], "228")
        self.assertEqual(result["proposals"]["pageCount"]["status"], "REVIEW_REQUIRED")

    def test_isbn_of_another_book_is_not_trusted(self):
        # Live case: a "Hội Phượng Hoàng" cover + the barcode of "Philosopher's Stone".
        answer = model_answer(title=[obs("front_cover", "Harry Potter và Hội Phượng Hoàng")],
                              authors=[obs("front_cover", ["J.K. ROWLING"])])
        lookup = AsyncMock(return_value={"found": True, "isbn": "9781408855652", "isbn13": "9781408855652",
                                         "title": "Harry Potter and the Philosopher's Stone", "authors": ["J. K. Rowling"],
                                         "pageCount": 332, "publishedDate": "2014-09-01", "conflictedFields": []})
        result, _ = scan({"front_cover": jpeg()}, answer, lookup=lookup, barcode="9781408855652")
        p = result["proposals"]
        self.assertIn("ISBN_LOOKUP_TITLE_MISMATCH", result["warnings"])
        self.assertTrue(result["isbnLookup"]["editionMatches"])  # the ISBN echo alone looks fine
        for field in ("pageCount", "publishedDate", "isbn", "isbn13", "authorsText"):
            self.assertFalse(p[field]["safeToApply"], field)
            self.assertIn("LOOKUP_TITLE_MISMATCH", p[field]["reasons"], field)
        self.assertEqual((p["title"]["value"], p["title"]["status"]), ("Harry Potter và Hội Phượng Hoàng", "REVIEW_REQUIRED"))
        self.assertEqual(p["authorsText"]["status"], "REVIEW_REQUIRED")  # not "corroborated" by another book's record

    def test_lookup_timeout_keeps_ocr_result(self):
        async def slow(_isbn):
            await asyncio.sleep(5)
        result, _ = scan({"copyright_page": jpeg()}, self.ANSWER, lookup=slow,
                         cfg=settings(lookup_timeout_seconds=0.05))
        self.assertEqual(result["isbnLookup"]["status"], "TIMEOUT")
        self.assertIn("ISBN_LOOKUP_TIMEOUT", result["warnings"])
        self.assertEqual(result["metadata"]["isbn13"], ISBN)

    def test_lookup_error_keeps_ocr_result(self):
        result, _ = scan({"copyright_page": jpeg()}, self.ANSWER, lookup=AsyncMock(side_effect=RuntimeError("boom")))
        self.assertEqual(result["isbnLookup"]["status"], "ERROR")
        self.assertEqual(result["proposals"]["publisher"]["status"], "EXTRACTED")


class CostControlTests(BookOcrTestCase):
    ANSWER = model_answer(title=[obs("front_cover", "Số đỏ")])

    def test_identical_images_are_not_paid_for_twice(self):
        provider = FakeProvider("qwen/qwen3.7-flash", self.ANSWER)
        providers = {"qwen/qwen3.7-flash": provider}
        first, _ = scan({"front_cover": jpeg()}, providers=providers)
        second, _ = scan({"front_cover": jpeg()}, providers=providers)
        self.assertEqual(provider.analyze_images.await_count, 1)
        self.assertFalse(first["usage"]["cacheHit"])
        self.assertTrue(second["usage"]["cacheHit"])
        self.assertEqual(second["usage"]["costUsd"], 0.0)
        self.assertEqual(second["metadata"]["title"], "Số đỏ")

    def test_no_fallback_unless_configured(self):
        with self.assertRaises(BookOcrError):
            scan({"front_cover": jpeg()}, error=http_status_error(503))  # only one provider exists

    def test_fallback_on_upstream_error_is_called_once(self):
        providers = {"qwen/qwen3.7-flash": FakeProvider("qwen/qwen3.7-flash", error=http_status_error(503)),
                     "backup/model": FakeProvider("backup/model", self.ANSWER)}
        with patch.object(service, "fallback_budget", FallbackBudget()):
            result, _ = scan({"front_cover": jpeg()}, providers=providers, cfg=settings(fallback_model="backup/model"))
        self.assertEqual(providers["backup/model"].analyze_images.await_count, 1)
        self.assertTrue(result["usage"]["fallbackUsed"])
        self.assertEqual(result["usage"]["model"], "backup/model")
        self.assertEqual([c["trigger"] for c in result["usage"]["calls"]], ["primary", "fallback:UPSTREAM_ERROR"])
        self.assertIn("FALLBACK_USED:UPSTREAM_ERROR", result["warnings"])

    def test_fallback_when_title_and_isbn_unreadable_but_not_for_optional_fields(self):
        empty = FakeProvider("qwen/qwen3.7-flash", model_answer(coverPrice=[obs("back_cover", "89.000đ", "Giá: 89.000đ")]))
        backup = FakeProvider("backup/model", self.ANSWER)
        with patch.object(service, "fallback_budget", FallbackBudget()):
            result, _ = scan({"front_cover": jpeg(), "back_cover": jpeg()},
                             providers={"qwen/qwen3.7-flash": empty, "backup/model": backup},
                             cfg=settings(fallback_model="backup/model"))
        self.assertEqual(backup.analyze_images.await_count, 1)
        self.assertEqual(result["metadata"]["title"], "Số đỏ")

        service.extraction_cache.clear()
        title_only = FakeProvider("qwen/qwen3.7-flash", self.ANSWER)  # subtitle/publisher missing: no fallback
        backup2 = FakeProvider("backup/model", self.ANSWER)
        with patch.object(service, "fallback_budget", FallbackBudget()):
            scan({"front_cover": jpeg()}, providers={"qwen/qwen3.7-flash": title_only, "backup/model": backup2},
                 cfg=settings(fallback_model="backup/model"))
        backup2.analyze_images.assert_not_awaited()

    def test_fallback_daily_budget(self):
        budget = FallbackBudget()
        budget.record(0.6)
        providers = {"qwen/qwen3.7-flash": FakeProvider("qwen/qwen3.7-flash", error=http_status_error(503)),
                     "backup/model": FakeProvider("backup/model", self.ANSWER)}
        with patch.object(service, "fallback_budget", budget), self.assertRaises(BookOcrError):
            scan({"front_cover": jpeg()}, providers=providers, cfg=settings(fallback_model="backup/model"))
        providers["backup/model"].analyze_images.assert_not_awaited()

    def test_busy_service_refuses_instead_of_queueing(self):
        with patch.object(service, "_active_scans", 2), self.assertRaises(BookOcrError) as ctx:
            scan({"front_cover": jpeg()}, self.ANSWER, cfg=settings(max_concurrency=2))
        self.assertEqual((ctx.exception.status, ctx.exception.code), (429, "OCR_BUSY"))


class ImageTests(BookOcrTestCase):
    def prepare(self, data, **limits):
        options = {"max_file_bytes": 2 * 1024 * 1024, "max_pixels": 40_000_000, "max_edge": 1600, **limits}
        return prepare_image("front_cover", data, **options)

    def assertRejected(self, data, status, code, **limits):
        with self.assertRaises(BookOcrError) as ctx:
            self.prepare(data, **limits)
        self.assertEqual((ctx.exception.status, ctx.exception.code), (status, code))

    def test_wrong_formats_are_rejected_by_content(self):
        gif = io.BytesIO()
        Image.new("RGB", (100, 100)).save(gif, format="GIF")
        self.assertRejected(gif.getvalue(), 415, "UNSUPPORTED_IMAGE_TYPE")
        self.assertRejected(b"%PDF-1.7 not an image", 415, "UNSUPPORTED_IMAGE_TYPE")
        self.assertRejected(b"<?php echo 'hi'; ?>", 415, "UNSUPPORTED_IMAGE_TYPE")
        self.assertRejected(jpeg()[:200], 400, "CORRUPT_IMAGE")         # truncated JPEG
        self.assertRejected(b"", 400, "EMPTY_IMAGE")

    def test_size_limits(self):
        self.assertRejected(jpeg(), 413, "IMAGE_TOO_LARGE", max_file_bytes=1000)
        self.assertRejected(jpeg(3000, 3000), 413, "IMAGE_DIMENSIONS_TOO_LARGE", max_pixels=4_000_000)
        self.assertRejected(jpeg(40, 40), 400, "IMAGE_TOO_SMALL")

    def test_total_upload_limit(self):
        with self.assertRaises(BookOcrError) as ctx:
            scan({"front_cover": jpeg(), "back_cover": jpeg()}, model_answer(), cfg=settings(max_total_bytes=5000))
        self.assertEqual((ctx.exception.status, ctx.exception.code), (413, "UPLOAD_TOO_LARGE"))

    def test_exif_orientation_resize_and_metadata_stripped(self):
        prepared = self.prepare(jpeg(2400, 1200, exif_orientation=6))   # rotated 90 degrees when viewed
        self.assertEqual(prepared.original_size, (1200, 2400))
        self.assertEqual(prepared.size, (800, 1600))
        self.assertTrue(prepared.resized)
        self.assertEqual(Image.open(io.BytesIO(prepared.data)).getexif().get(0x0112), None)

    def test_small_image_is_never_upscaled_and_alpha_is_flattened(self):
        prepared = self.prepare(png_rgba())
        self.assertEqual(prepared.size, (300, 300))
        self.assertFalse(prepared.resized)
        self.assertEqual(Image.open(io.BytesIO(prepared.data)).getpixel((5, 5)), (255, 255, 255))
        self.assertEqual(self.prepare(webp()).source_format, "WEBP")

    def test_request_shape_validation(self):
        for uploads, code in (({}, "NO_IMAGES"), ({"spine": jpeg()}, "UNKNOWN_IMAGE_SLOT")):
            with self.assertRaises(BookOcrError) as ctx:
                scan(uploads, model_answer())
            self.assertEqual(ctx.exception.code, code)
        with self.assertRaises(BookOcrError) as ctx:
            scan({"front_cover": jpeg(), "back_cover": jpeg()}, model_answer(), cfg=settings(max_images=1))
        self.assertEqual(ctx.exception.code, "TOO_MANY_IMAGES")


class ProviderTests(unittest.TestCase):
    def test_analyze_images_sends_labelled_images_in_one_request(self):
        provider = llm_provider.OpenRouterProvider(api_key="k", base_url="https://example.test", model="m")
        captured = {}

        async def fake_request(payload, timeout):
            captured.update(payload)
            return {"choices": [{"message": {"content": '{"observations": {}}'}}],
                    "usage": {"prompt_tokens": 9, "completion_tokens": 3, "cost": 0.0001}}, "m"
        with patch.object(provider, "_request_completion", side_effect=fake_request):
            parsed, used = asyncio.run(provider.analyze_images(
                [llm_provider.VisionImage("front_cover", b"a", "image/jpeg"),
                 llm_provider.VisionImage("copyright_page", b"b", "image/webp")],
                "PROMPT", max_tokens=100, timeout=5))
        content = captured["messages"][0]["content"]
        self.assertEqual([part["type"] for part in content], ["text", "text", "image_url", "text", "image_url"])
        self.assertEqual(content[1]["text"], "Image label: front_cover")
        self.assertTrue(content[4]["image_url"]["url"].startswith("data:image/webp;base64,"))
        self.assertEqual(captured["response_format"], {"type": "json_object"})
        self.assertEqual(parsed, {"observations": {}})
        self.assertEqual((used.prompt_tokens, used.cost_usd, used.feature), (9, 0.0001, "book_ocr"))

    def test_analyze_image_payload_is_unchanged(self):
        provider = llm_provider.OpenRouterProvider(api_key="k", base_url="https://example.test", model="m")
        captured = {}

        async def fake_request(payload, timeout):
            captured.update(payload)
            return {"choices": [{"message": {"content": "{}"}}], "usage": {}}, "m"
        with patch.object(provider, "_request_completion", side_effect=fake_request):
            asyncio.run(provider.analyze_image(b"\x89PNG\r\n\x1a\nrest", "P", max_tokens=10, timeout=5))
        content = captured["messages"][0]["content"]
        self.assertEqual([part["type"] for part in content], ["text", "image_url"])
        self.assertTrue(content[1]["image_url"]["url"].startswith("data:image/png;base64,"))

    def test_book_ocr_provider_ignores_global_fallback_model(self):
        from book_ocr.extractor import default_provider_factory
        with patch.dict("os.environ", {"OPENROUTER_API_KEY": "k", "OPENROUTER_FALLBACK_MODEL": "expensive/model"}):
            provider = default_provider_factory("qwen/qwen3.7-flash")
        self.assertIsNone(provider._fallback_model)

    def test_invalid_json_error_carries_usage(self):
        provider = llm_provider.OpenRouterProvider(api_key="k", base_url="https://example.test", model="m")

        async def fake_request(payload, timeout):
            return {"choices": [{"message": {"content": "not json"}}], "usage": {"prompt_tokens": 5, "cost": 0.0002}}, "m"
        with patch.object(provider, "_request_completion", side_effect=fake_request), \
                self.assertRaises(llm_provider.VisionResponseError) as ctx:
            asyncio.run(provider.analyze_images([llm_provider.VisionImage("x", b"a", "image/jpeg")], "P",
                                                max_tokens=10, timeout=5))
        self.assertEqual(ctx.exception.usage.cost_usd, 0.0002)


class RouteTests(BookOcrTestCase):
    def client(self, lookup=None):
        app = FastAPI()
        app.include_router(routes_book_ocr.build_router(lookup or AsyncMock(return_value={"found": False})))
        return TestClient(app)

    def post(self, client, files, data=None, headers=None):
        return client.post("/book-metadata/scan-images", files=files, data=data or {},
                           headers=headers if headers is not None else {"Authorization": "Bearer t"})

    def test_requires_authentication_and_catalog_import_permission(self):
        client = self.client()
        with patch("book_ocr.service.default_provider_factory") as factory:
            response = self.post(client, [("front_cover", ("a.jpg", jpeg(), "image/jpeg"))], headers={})
            self.assertEqual(response.status_code, 401)
            self.assertEqual(response.json()["code"], "UNAUTHORIZED")
            with patch.object(routes_book_ocr, "catalog_access_error", AsyncMock(return_value=(403, "x"))) as check:
                response = self.post(client, [("front_cover", ("a.jpg", jpeg(), "image/jpeg"))])
            self.assertEqual(response.status_code, 403)
            self.assertEqual(response.json(), {"message": "Bạn không có quyền nhập sách vào catalog.", "code": "FORBIDDEN"})
            self.assertEqual(check.await_args.args[1], "/api/metadata-reconciliations/capabilities/import")
            factory.assert_not_called()  # no paid inference before authorization

    def test_auth_is_checked_with_a_read_only_inventory_call(self):
        calls = []

        class Recorder:
            def __init__(self, *a, **k):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            async def get(self, url, headers=None):
                calls.append(("GET", url, headers))
                return httpx.Response(403)

        with patch("catalog_access.httpx.AsyncClient", Recorder):
            response = self.post(self.client(), [("front_cover", ("a.jpg", jpeg(), "image/jpeg"))])
        self.assertEqual(response.status_code, 403)
        self.assertEqual(len(calls), 1)
        self.assertTrue(calls[0][1].endswith("/api/metadata-reconciliations/capabilities/import"))
        self.assertEqual(calls[0][2], {"Authorization": "Bearer t"})

    def test_scan_end_to_end_without_catalog_writes(self):
        provider = FakeProvider("qwen/qwen3.7-flash", model_answer(
            title=[obs("front_cover", "Mắt biếc")], isbn=[obs("back_cover", ISBN, "ISBN " + ISBN)]))
        lookup = AsyncMock(return_value={"found": True, "isbn": ISBN, "isbn13": ISBN, "title": "Mắt biếc"})
        client = self.client(lookup)
        with patch.object(routes_book_ocr, "catalog_access_error", AsyncMock(return_value=None)), \
                patch("book_ocr.service.default_provider_factory", return_value=provider), \
                patch.object(httpx.AsyncClient, "post", side_effect=AssertionError("no writes")), \
                patch.object(httpx.AsyncClient, "patch", side_effect=AssertionError("no writes")):
            response = self.post(client, [("front_cover", ("a.jpg", jpeg(), "image/jpeg")),
                                          ("back_cover", ("b.png", png_rgba(), "image/png"))], data={"barcode": ISBN})
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["proposals"]["title"]["status"], "CORROBORATED")
        self.assertEqual(body["fields"]["isbn"]["status"], "CORROBORATED")  # image + decoded barcode
        self.assertEqual(body["isbnLookup"]["status"], "FOUND")
        lookup.assert_awaited_once_with(ISBN)

    def test_duplicate_unknown_and_mislabelled_uploads(self):
        client = self.client()
        with patch.object(routes_book_ocr, "catalog_access_error", AsyncMock(return_value=None)):
            dup = self.post(client, [("front_cover", ("a.jpg", jpeg(), "image/jpeg")),
                                     ("front_cover", ("b.jpg", jpeg(), "image/jpeg"))])
            self.assertEqual((dup.status_code, dup.json()["code"]), (400, "DUPLICATE_IMAGE_SLOT"))
            unknown = self.post(client, [("spine", ("a.jpg", jpeg(), "image/jpeg"))])
            self.assertEqual((unknown.status_code, unknown.json()["code"]), (400, "UNKNOWN_IMAGE_SLOT"))
            fake = self.post(client, [("front_cover", ("a.jpg", b"MZ\x90\x00 not an image", "image/jpeg"))])
            self.assertEqual((fake.status_code, fake.json()["code"]), (415, "UNSUPPORTED_IMAGE_TYPE"))
            none = self.post(client, [], data={"barcode": "1"})
            self.assertEqual((none.status_code, none.json()["code"]), (400, "NO_IMAGES"))

    def test_oversized_request_rejected_before_parsing(self):
        with patch.object(routes_book_ocr, "catalog_access_error", AsyncMock(return_value=None)), \
                patch.dict("os.environ", {"BOOK_OCR_MAX_TOTAL_MB": "0.1"}):
            response = self.post(self.client(), [("front_cover", ("a.jpg", jpeg(3000, 3000, (1, 99, 7)) + b"\0" * 300_000, "image/jpeg"))])
        self.assertEqual((response.status_code, response.json()["code"]), (413, "UPLOAD_TOO_LARGE"))

    def test_disabled_flag(self):
        with patch.dict("os.environ", {"BOOK_OCR_ENABLED": "false"}):
            client = self.client()
            self.assertFalse(client.get("/book-metadata/capabilities").json()["enabled"])
            response = self.post(client, [("front_cover", ("a.jpg", jpeg(), "image/jpeg"))])
        self.assertEqual((response.status_code, response.json()["code"]), (404, "BOOK_OCR_DISABLED"))


class ValidationUnitTests(unittest.TestCase):
    def test_validation_never_trusts_an_image_that_was_not_sent(self):
        out = validate_extraction(model_answer(title=[obs("copyright_page", "X")]), ["front_cover"])
        self.assertEqual(out["fields"]["title"].status, "INVALID")

    def test_translator_with_cue_and_author_on_another_line(self):
        answer = model_answer(
            authors=[obs("copyright_page", ["Paulo Coelho"], "Tác giả: Paulo Coelho\nDịch giả: Lê Chu Cầu")],
            translators=[obs("copyright_page", ["Lê Chu Cầu"], "Tác giả: Paulo Coelho\nDịch giả: Lê Chu Cầu")])
        out = validate_extraction(answer, ["copyright_page"])
        self.assertEqual(out["fields"]["authors"].status, "EXTRACTED")
        self.assertEqual(out["fields"]["translators"].status, "EXTRACTED")

    def test_distributor_is_not_publisher(self):
        out = validate_extraction(model_answer(publisher=[obs("back_cover", "Nhã Nam", "Phát hành: Nhã Nam")]), ["back_cover"])
        self.assertEqual(out["fields"]["publisher"].status, "INVALID")
        self.assertIn("ROLE_MISMATCH", out["fields"]["publisher"].reasons)

    def test_bare_string_observations_are_rejected(self):
        # What qwen3.7-flash returned live for prompt v1 (empty-array template): no source, no evidence.
        out = validate_extraction({"observations": {"title": ["Harry Potter và Hội Phượng Hoàng"],
                                                    "authors": ["J.K. ROWLING"]}}, ["front_cover"])
        self.assertEqual(out["fields"]["title"].status, "MISSING")
        self.assertIn("MALFORMED_OBSERVATION:title", out["warnings"])

    def test_prompt_template_shows_observation_objects(self):
        from book_ocr.prompts import build_prompt
        prompt = build_prompt(["front_cover", "back_cover"])
        self.assertIn('"title": [{"source": "copyright_page", "value": "Tên sách", "observedText": "TÊN SÁCH"}]', prompt)
        self.assertIn("front_cover, back_cover", prompt)

    def test_other_codes_need_digits(self):
        out = validate_extraction({"observations": {}, "otherCodes": [
            {"source": "front_cover", "label": "Minh họa", "value": "TSUKASA ABE"},
            {"source": "back_cover", "label": "Mã vạch", "value": "8934974184027"}]}, ["front_cover", "back_cover"])
        self.assertEqual([c["value"] for c in out["otherCodes"]], ["8934974184027"])

    def test_live_formatting_quirks_are_not_rejections(self):
        # Both seen live from qwen3.7-flash on the Frieren cover.
        out = validate_extraction(model_answer(
            title=[obs("front_cover", "Frieren - Pháp sư tiễn táng", "FRIEREN PHÁP SƯ TIỄN TÁNG")],
            publisher=[obs("front_cover", ["NXB Kim Đồng"], "NXB KIM ĐỒNG")]), ["front_cover"])
        self.assertEqual(out["fields"]["title"].status, "EXTRACTED")
        self.assertEqual(out["fields"]["publisher"].value, "NXB Kim Đồng")
        # ...but a changed tone mark, a partial word or two publishers are still rejected.
        out = validate_extraction(model_answer(
            title=[obs("front_cover", "Pháp sư tiến táng", "PHÁP SƯ TIỄN TÁNG")],
            subtitle=[obs("front_cover", "Pháp s", "PHÁP SƯ")],
            publisher=[obs("front_cover", ["NXB Kim Đồng", "NXB Trẻ"], "NXB KIM ĐỒNG, NXB TRẺ")]), ["front_cover"])
        self.assertIn("UNGROUNDED", out["fields"]["title"].observations[0].issues)
        self.assertIn("UNGROUNDED", out["fields"]["subtitle"].observations[0].issues)
        self.assertIn("INVALID_FORMAT", out["fields"]["publisher"].observations[0].issues)

    def test_hedge_values_are_not_observations(self):
        out = validate_extraction(model_answer(title=[obs("front_cover", "Không rõ")]), ["front_cover"])
        self.assertEqual(out["fields"]["title"].status, "MISSING")


class VietnameseComparisonTests(unittest.TestCase):
    """OCR 2.0: fuzzy (search) and strict (verification) comparison are separate."""

    def test_compare_text_examples(self):
        from book_ocr.normalization import compare_text
        cases = [
            ("MẮT BIẾC", "Mắt Biếc", {}, "MATCH"),
            ("Pháp sư tiễn táng", "Pháp sư tiến táng", {}, "DIACRITICS_DIFFER"),  # ngã vs sắc, same letter count
            ("Nguyễn Nhật Ánh", "Nguyễn Nhật Anh", {}, "DIACRITICS_DIFFER"),     # missing mark
            ("Nhà xuất bản Trẻ", "NXB Trẻ", {"publisher": True}, "MATCH"),
            ("Nhà xuất bản Trẻ", "NXB Tre", {"publisher": True}, "DIACRITICS_DIFFER"),
            ("Đất rừng phương Nam", "Dat rung phuong Nam", {}, "DIACRITICS_DIFFER"),
            ("Đồi", "Dồi", {}, "DIACRITICS_DIFFER"),                               # đ vs d
            ("Bão", "Bảo", {}, "DIACRITICS_DIFFER"),                               # ngã vs hỏi
            ("Cạn", "Cán", {}, "DIACRITICS_DIFFER"),                               # nặng vs sắc
            ("Mắt biếc", "Số đỏ", {}, "DIFFERENT"),
            (unicodedata.normalize("NFD", "Tôi thấy hoa vàng"), "TÔI THẤY HOA VÀNG", {}, "MATCH"),  # decomposed input
            ("Frieren - Pháp sư", "FRIEREN: PHÁP SƯ", {}, "MATCH"),               # punctuation is not meaning
            ("ＭẮＴ ＢＩẾＣ", "Mắt Biếc", {}, "MATCH"),                              # full-width OCR forms (NFKC)
        ]
        for a, b, options, expected in cases:
            self.assertEqual(compare_text(a, b, **options), expected, (a, b))

    def readings(self, field, a, b, observed=None):
        answer = model_answer(**{field: [obs("front_cover", a, observed[0] if observed else None),
                                         obs("copyright_page", b, observed[1] if observed else None)]})
        return validate_extraction(answer, ["front_cover", "copyright_page"])["fields"][field]

    def test_two_images_with_different_tone_marks_are_never_corroborated(self):
        for a, b in (("Pháp sư tiễn táng", "Pháp sư tiến táng"),   # live Frieren error, same mark count
                     ("Nhà giả kim", "Nhà gia kim"),                # one mark lost
                     ("Đồi gió hú", "Dồi gió hú"),                  # đ read as d
                     ("Bão tố", "Bảo tố"), ("Cạn lời", "Cán lời"), ("Tuổi thơ dữ dội", "Tuổi thơ dư dội")):
            result = self.readings("title", a, b)
            self.assertEqual(result.status, "REVIEW_REQUIRED", (a, b))
            self.assertIn("DIACRITICS_DIFFER", result.reasons)

    def test_case_spacing_and_unicode_form_still_corroborate(self):
        decomposed = unicodedata.normalize("NFD", "Mắt Biếc")
        for a, b in (("MẮT BIẾC", "Mắt Biếc"), (decomposed, "Mắt biếc"), ("Mắt  Biếc", "Mắt Biếc")):
            result = self.readings("title", a, b)
            self.assertEqual((result.status, result.reasons), ("CORROBORATED", []), (a, b))

    def test_authors_and_publishers_are_compared_name_by_name(self):
        authors = self.readings("authors", ["Nguyễn Nhật Ánh"], ["Nguyễn Nhật Anh"])
        self.assertEqual(authors.status, "REVIEW_REQUIRED")
        self.assertIn("DIACRITICS_DIFFER", authors.reasons)
        same = self.readings("publisher", "Nhà xuất bản Trẻ", "NXB Trẻ", ["NHÀ XUẤT BẢN TRẺ", "NXB TRẺ"])
        self.assertEqual(same.status, "CORROBORATED")
        tre = self.readings("publisher", "Nhà xuất bản Trẻ", "NXB Tre", ["NHÀ XUẤT BẢN TRẺ", "NXB TRE"])
        self.assertEqual(tre.status, "REVIEW_REQUIRED")
        self.assertIn("DIACRITICS_DIFFER", tre.reasons)
        # A cover listing one of two authors is partial agreement, not a mark conflict.
        partial = self.readings("authors", ["Ngô Tất Tố"], ["Ngô Tất Tố", "Phan Văn A"], ["Ngô Tất Tố", "Ngô Tất Tố, Phan Văn A"])
        self.assertEqual(partial.reasons, ["PARTIAL_AGREEMENT"])

    def test_mark_conflict_offers_every_reading_and_fills_nothing(self):
        answer = model_answer(title=[obs("front_cover", "Pháp sư tiễn táng"), obs("copyright_page", "Pháp sư tiến táng")])
        service.extraction_cache.clear()
        result, _ = scan({"front_cover": jpeg(), "copyright_page": jpeg()}, answer)
        title = result["proposals"]["title"]
        self.assertFalse(title["safeToApply"])
        self.assertEqual({o["value"] for o in title["options"]}, {"Pháp sư tiễn táng", "Pháp sư tiến táng"})
        self.assertNotIn("IMAGES_MAY_SHOW_DIFFERENT_BOOKS", result["warnings"])  # same book, a mark to check


class LookupComparisonTests(BookOcrTestCase):
    def run_lookup(self, answer, record, images=("front_cover", "copyright_page"), barcode=None):
        lookup = AsyncMock(return_value={"found": True, "isbn": ISBN, "isbn13": ISBN, "conflictedFields": [], **record})
        result, _ = scan({kind: jpeg() for kind in images}, answer, lookup=lookup, barcode=barcode)
        return result, lookup

    def test_record_with_other_marks_needs_review(self):
        answer = model_answer(title=[obs("front_cover", "Pháp sư tiễn táng")], isbn=[obs("copyright_page", ISBN, "ISBN " + ISBN)])
        result, _ = self.run_lookup(answer, {"title": "Pháp sư tiến táng", "authors": ["Kanehito Yamada"]})
        title = result["proposals"]["title"]
        self.assertEqual((title["status"], title["value"], title["safeToApply"]), ("REVIEW_REQUIRED", "Pháp sư tiễn táng", False))
        self.assertIn("LOOKUP_DIACRITICS_DIFFER", title["reasons"])
        # Still the same book (identity is a fuzzy check), so the record's other fields stay usable.
        self.assertTrue(result["proposals"]["authorsText"]["safeToApply"])

    def test_unaccented_record_confirms_nothing_about_marks(self):
        answer = model_answer(title=[obs("front_cover", "Nhà giả kim")], isbn=[obs("copyright_page", ISBN, "ISBN " + ISBN)])
        result, _ = self.run_lookup(answer, {"title": "Nha Gia Kim"})
        title = result["proposals"]["title"]
        self.assertEqual((title["status"], title["value"], title["safeToApply"]), ("EXTRACTED", "Nhà giả kim", False))
        self.assertIn("LOOKUP_UNACCENTED", title["reasons"])
        self.assertNotIn("ISBN_LOOKUP_TITLE_MISMATCH", result["warnings"])

    def test_isbn_read_once_is_safe_only_when_the_record_carries_the_printed_title(self):
        answer = model_answer(title=[obs("front_cover", "Mắt biếc")], isbn=[obs("copyright_page", ISBN, "ISBN " + ISBN)])
        result, _ = self.run_lookup(answer, {"title": "Mắt Biếc"})
        self.assertTrue(result["proposals"]["isbn13"]["safeToApply"])
        service.extraction_cache.clear()
        not_found, _ = scan({"front_cover": jpeg(), "copyright_page": jpeg()}, answer, lookup=AsyncMock(return_value={"found": False}))
        self.assertFalse(not_found["proposals"]["isbn13"]["safeToApply"])
        self.assertIn("SINGLE_SOURCE", not_found["proposals"]["isbn13"]["reasons"])
        self.assertEqual(not_found["proposals"]["isbn13"]["value"], ISBN)  # still offered for one click

    def test_without_a_printed_title_one_isbn_reading_cannot_vouch_for_the_record(self):
        record = {"title": "Một cuốn khác", "pageCount": 300, "publishedDate": "2019", "authors": ["Ai Đó"]}
        result, _ = self.run_lookup(model_answer(isbn=[obs("back_cover", ISBN, "ISBN " + ISBN)]), record, images=("back_cover",))
        self.assertIn("ISBN_LOOKUP_IDENTITY_UNVERIFIED", result["warnings"])
        for field in ("pageCount", "publishedDate", "authorsText", "title"):
            self.assertEqual(result["proposals"][field]["status"], "LOOKUP_ONLY", field)
            self.assertFalse(result["proposals"][field]["safeToApply"], field)
        # The same ISBN printed on two photos is the book's own identity: the record may fill gaps.
        service.extraction_cache.clear()
        twice = model_answer(isbn=[obs("back_cover", ISBN, "ISBN " + ISBN), obs("copyright_page", ISBN, "ISBN: " + ISBN)])
        result, _ = self.run_lookup(twice, record, images=("back_cover", "copyright_page"))
        self.assertTrue(result["proposals"]["pageCount"]["safeToApply"])
        self.assertTrue(result["proposals"]["isbn13"]["safeToApply"])


class IsbnTrustTests(BookOcrTestCase):
    def test_client_barcode_alone_is_not_verified_evidence(self):
        lookup = AsyncMock(return_value={"found": False})
        result, _ = scan({"back_cover": jpeg()}, model_answer(), barcode=ISBN, lookup=lookup)
        isbn = result["fields"]["isbn"]
        self.assertEqual(isbn["status"], "REVIEW_REQUIRED")
        self.assertIn("BARCODE_UNCONFIRMED", isbn["reasons"])
        self.assertFalse(result["proposals"]["isbn13"]["safeToApply"])
        self.assertEqual(result["proposals"]["isbn13"]["value"], ISBN)
        lookup.assert_awaited_once_with(ISBN)  # still looked up, so staff sees what it is

    def test_barcode_that_disagrees_with_the_printed_isbn_conflicts(self):
        result, _ = scan({"back_cover": jpeg()}, model_answer(isbn=[obs("back_cover", ISBN, "ISBN " + ISBN)]),
                         barcode=ISBN_OTHER, lookup=AsyncMock())
        self.assertEqual(result["fields"]["isbn"]["status"], "CONFLICTED")
        self.assertEqual(result["isbnLookup"]["status"], "SKIPPED_ISBN_CONFLICT")
        self.assertIn("IMAGES_MAY_SHOW_DIFFERENT_BOOKS", result["warnings"])

    def test_set_isbn_and_volume_isbn_on_one_page_conflict(self):
        answer = model_answer(isbn=[obs("copyright_page", ISBN, "ISBN bộ: " + ISBN), obs("copyright_page", ISBN_OTHER, "ISBN tập 1: " + ISBN_OTHER)])
        result, _ = scan({"copyright_page": jpeg()}, answer, lookup=AsyncMock())
        self.assertEqual(result["fields"]["isbn"]["status"], "CONFLICTED")
        self.assertIsNone(result["proposals"]["isbn13"]["value"])

    def test_wrong_checksum_is_never_repaired(self):
        result, _ = scan({"back_cover": jpeg()}, model_answer(isbn=[obs("back_cover", "9786041234568", "ISBN 978-604-1-23456-8")]))
        self.assertIsNone(result["metadata"]["isbn13"])
        self.assertTrue(all(o["value"] != ISBN for o in result["proposals"]["isbn13"]["options"]))


class AutofillPolicyTests(BookOcrTestCase):
    def test_field_policy_for_single_image_readings(self):
        answer = model_answer(
            title=[obs("copyright_page", "Số đỏ")],
            subtitle=[obs("copyright_page", "Tiểu thuyết")],
            authors=[obs("copyright_page", ["Vũ Trọng Phụng"], "Tác giả: Vũ Trọng Phụng")],
            translators=[obs("copyright_page", ["Lê Văn B"], "Người dịch: Lê Văn B")],
            publisher=[obs("copyright_page", "NXB Văn Học", "NXB VĂN HỌC")],
            publicationYear=[obs("copyright_page", 2020, "Xuất bản năm 2020")],
            pageCount=[obs("copyright_page", 228, "Số trang: 228")],
            description=[{"source": "copyright_page", "value": "Một tiểu thuyết trào phúng.", "observedText": None}],
        )
        result, _ = scan({"copyright_page": jpeg()}, answer)
        p = result["proposals"]
        for field in ("title", "subtitle", "authorsText", "publisher", "publishedDate", "description"):
            self.assertEqual((p[field]["status"], p[field]["safeToApply"]), ("EXTRACTED", False), field)
            self.assertIn("SINGLE_SOURCE", p[field]["reasons"], field)
        for field in ("translatorText", "pageCount"):
            self.assertTrue(p[field]["safeToApply"], field)
        self.assertFalse(p["language"]["safeToApply"])  # INFERRED

    def test_foreign_original_title_read_as_subtitle_is_not_filled(self):
        # Live (smoke run 2026-10-23, 1 of 9 scans): the English original title of a translated book as "subtitle".
        answer = model_answer(title=[obs("front_cover", "Harry Potter và Hội Phượng Hoàng")],
                              subtitle=[obs("front_cover", "Harry Potter and the Order of the Phoenix")])
        result, _ = scan({"front_cover": jpeg()}, answer)
        self.assertFalse(result["proposals"]["subtitle"]["safeToApply"])
        self.assertEqual(result["proposals"]["subtitle"]["value"], "Harry Potter and the Order of the Phoenix")  # still shown

    def test_corroborated_identity_fields_are_filled(self):
        answer = model_answer(title=[obs("front_cover", "SỐ ĐỎ"), obs("copyright_page", "Số đỏ")],
                              authors=[obs("front_cover", ["VŨ TRỌNG PHỤNG"]), obs("copyright_page", ["Vũ Trọng Phụng"], "Tác giả: Vũ Trọng Phụng")])
        result, _ = scan({"front_cover": jpeg(), "copyright_page": jpeg()}, answer)
        self.assertEqual((result["proposals"]["title"]["value"], result["proposals"]["title"]["safeToApply"]), ("Số đỏ", True))
        self.assertTrue(result["proposals"]["authorsText"]["safeToApply"])


class GroundingTests(unittest.TestCase):
    def test_illustrator_is_not_an_author(self):
        observed = "Nguyên tác: Kanehito Yamada  Minh họa: Tsukasa Abe"
        out = validate_extraction(model_answer(authors=[obs("front_cover", ["Kanehito Yamada"], observed),
                                                        obs("front_cover", ["Tsukasa Abe"], observed)]), ["front_cover"])
        issues = [o.issues for o in out["fields"]["authors"].observations]
        self.assertEqual(issues, [[], ["ROLE_MISMATCH"]])
        alone = validate_extraction(model_answer(authors=[obs("front_cover", ["Tạ Huy Long"], "Minh họa: Tạ Huy Long")]), ["front_cover"])
        self.assertEqual(alone["fields"]["authors"].status, "INVALID")

    def test_model_transcription_is_not_image_evidence(self):
        # A value echoed in its own observedText is only "grounded", never corroborated by itself.
        out = validate_extraction(model_answer(title=[obs("front_cover", "Harry Potter", "HARRY POTTER")]), ["front_cover"])
        self.assertEqual(out["fields"]["title"].status, "EXTRACTED")


if __name__ == "__main__":
    unittest.main()
