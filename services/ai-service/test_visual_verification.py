"""Feature A - independent verification by a second vision model
(book_ocr/visual_verification.py). No network: the verifier is a fake provider,
exactly like the OCR model in test_book_ocr.py (CI runs with no OpenRouter key).
"""
from __future__ import annotations

import asyncio
import dataclasses
import io
import unittest
from unittest.mock import AsyncMock, patch

from PIL import Image

import llm_provider
from book_ocr import visual_verification as vv
from book_ocr.config import load_settings
from book_ocr.images import prepare_image
from book_ocr.visual_verification import read_images, verify_value

VERIFY_MODEL = "google/gemini-3.1-flash-lite"


def reading(text, legible=True, boxes=None):
    """A parsed reading: one entry per non-empty line, boxes[i] (or None) for line i."""
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return {"legible": legible, "lines": [{"text": line, "box": (boxes or {}).get(i)} for i, line in enumerate(lines)]}


BOX_TITLE = {"x": 0.1, "y": 0.2, "width": 0.6, "height": 0.1}
BOX_AUTHOR = {"x": 0.1, "y": 0.4, "width": 0.4, "height": 0.05}


def jpeg(color=(200, 180, 160)) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (400, 600), color).save(out, format="JPEG")
    return out.getvalue()


def prepared(*kinds):
    return [prepare_image(k, jpeg((i * 40, 100, 100)), max_file_bytes=2 * 1024 * 1024, max_pixels=40_000_000, max_edge=1600)
            for i, k in enumerate(kinds)]


def settings(**overrides):
    base = dataclasses.replace(load_settings(), model="qwen/qwen3.7-flash", verify_model=VERIFY_MODEL,
                               verify_daily_budget_usd=0.5, verify_max_tokens=2500)
    return dataclasses.replace(base, **overrides)


def usage(cost=0.0012):
    return llm_provider.ChatUsage(provider="openrouter", model=VERIFY_MODEL, latency_ms=900, prompt_tokens=2000,
                                  completion_tokens=200, tool_call_count=0, cost_usd=cost, feature="book_ocr_verify")


class FakeVerifier:
    def __init__(self, answer=None, error=None):
        self.model = VERIFY_MODEL
        self.analyze_images = AsyncMock()
        if error is not None:
            self.analyze_images.side_effect = error
        else:
            self.analyze_images.return_value = (answer, usage())


class VerifierRequestTests(unittest.TestCase):
    def test_verifier_requests_its_response_schema(self):
        vv.verification_cache.clear()
        fake = FakeVerifier(answer={"images": []})
        asyncio.run(read_images(prepared("front_cover"), settings(), lambda m: fake))
        self.assertEqual(fake.analyze_images.call_args.kwargs["json_schema"], vv.VERIFY_SCHEMA)

    def test_default_token_ceiling_is_6000(self):
        with patch.dict("os.environ", {}, clear=True):
            self.assertEqual(load_settings().verify_max_tokens, 6000)


class VerifyValueTests(unittest.TestCase):
    page = reading("NHÀ GIẢ KIM\nPaulo Coelho\nNXB Hội Nhà Văn", boxes={0: BOX_TITLE, 1: BOX_AUTHOR})

    def test_every_word_read_independently_is_verified(self):
        out = verify_value("Nhà giả kim", self.page)
        self.assertEqual(out["status"], "VERIFIED")
        self.assertEqual(out["readText"], "NHÀ GIẢ KIM")
        # Only the matched line's box - not the "NXB Hội Nhà Văn" line sharing "Nhà".
        self.assertEqual(out["boxes"], [BOX_TITLE])

    def test_some_words_missing_is_partially_verified(self):
        out = verify_value("Nhà giả kim của Paulo Coelho", self.page)
        self.assertEqual(out["status"], "PARTIALLY_VERIFIED")
        self.assertEqual(out["readText"], "NHÀ GIẢ KIM / Paulo Coelho")
        self.assertEqual(out["boxes"], [BOX_TITLE, BOX_AUTHOR])

    def test_matched_line_without_a_usable_box_still_verifies_but_draws_nothing(self):
        out = verify_value("NXB Hội Nhà Văn", self.page)
        self.assertEqual((out["status"], out["boxes"]), ("VERIFIED", []))

    def test_nothing_found_on_a_legible_image_is_unverified(self):
        # The OCR model claims a title the second model, reading the same image
        # blind, never saw: a real mismatch, not a photo quality problem.
        out = verify_value("Chiến tranh và hòa bình", self.page)
        self.assertEqual(out, {"status": "UNVERIFIED", "readText": None, "boxes": []})

    def test_unreadable_or_missing_reading_is_illegible_never_absent(self):
        self.assertEqual(verify_value("Nhà giả kim", reading("", legible=False))["status"], "ILLEGIBLE")
        self.assertEqual(verify_value("Nhà giả kim", reading("   "))["status"], "ILLEGIBLE")
        self.assertEqual(verify_value("Nhà giả kim", None)["status"], "ILLEGIBLE")


class ReadImagesTests(unittest.TestCase):
    def setUp(self):
        vv.verification_cache.clear()
        vv.verify_budget = vv.FallbackBudget()

    def run_read(self, provider, cfg=None, images=None):
        return asyncio.run(read_images(images or prepared("front_cover"), cfg or settings(), lambda model: provider))

    def test_blind_reread_returns_readings_per_image_and_a_usage_call(self):
        provider = FakeVerifier({"images": [
            {"source": "front_cover", "legible": True, "lines": [{"text": "NHÀ GIẢ KIM", "box_2d": [200, 100, 300, 700]}]},
            {"source": "not_uploaded", "legible": True, "lines": [{"text": "x", "box_2d": [0, 0, 10, 10]}]}]})
        readings, calls, warnings = self.run_read(provider)
        self.assertEqual(readings, {"front_cover": {"legible": True, "lines": [{"text": "NHÀ GIẢ KIM", "box": BOX_TITLE}]}})
        self.assertEqual([(c.trigger, c.status, c.costUsd) for c in calls], [("verify", "OK", 0.0012)])
        self.assertEqual(warnings, [])
        prompt = provider.analyze_images.call_args.args[1]
        # Blind: the verifier is never shown what the OCR model read.
        self.assertNotIn("observations", prompt)
        self.assertNotIn("title", prompt.lower())

    def test_malformed_boxes_are_dropped_and_out_of_range_ones_clamped(self):
        lines = [{"text": "ok", "box_2d": [-20, 100, 300, 1200]},  # clamped to the image
                 {"text": "inverted", "box_2d": [300, 100, 200, 700]},
                 {"text": "short", "box_2d": [1, 2, 3]},
                 {"text": "strings", "box_2d": ["1", "2", "3", "4"]},
                 {"text": "missing"},
                 {"text": "   ", "box_2d": [0, 0, 10, 10]}]  # blank line: not kept at all
        readings, _, _ = self.run_read(FakeVerifier({"images": [{"source": "front_cover", "lines": lines}]}))
        self.assertEqual(readings["front_cover"]["lines"], [
            {"text": "ok", "box": {"x": 0.1, "y": 0.0, "width": 0.9, "height": 0.3}},
            {"text": "inverted", "box": None}, {"text": "short", "box": None},
            {"text": "strings", "box": None}, {"text": "missing", "box": None}])

    def test_same_images_are_not_paid_for_twice(self):
        provider = FakeVerifier({"images": [{"source": "front_cover", "legible": True, "lines": [{"text": "A"}]}]})
        self.run_read(provider)
        readings, calls, _ = self.run_read(provider)
        self.assertEqual(provider.analyze_images.call_count, 1)
        self.assertEqual(readings["front_cover"]["lines"][0]["text"], "A")
        self.assertEqual(calls, [])

    def test_verifier_equal_to_ocr_model_is_skipped(self):
        provider = FakeVerifier({"images": []})
        readings, calls, warnings = self.run_read(provider, settings(verify_model="qwen/qwen3.7-flash"))
        self.assertEqual((readings, calls, warnings), ({}, [], ["VISUAL_VERIFICATION_SAME_MODEL"]))
        provider.analyze_images.assert_not_called()

    def test_no_model_configured_is_off(self):
        readings, _, warnings = self.run_read(FakeVerifier({}), settings(verify_model=None))
        self.assertEqual((readings, warnings), ({}, ["VISUAL_VERIFICATION_NOT_CONFIGURED"]))

    def test_daily_budget_is_respected(self):
        provider = FakeVerifier({"images": []})
        readings, _, warnings = self.run_read(provider, settings(verify_daily_budget_usd=0))
        self.assertEqual((readings, warnings), ({}, ["VISUAL_VERIFICATION_BUDGET_EXHAUSTED"]))
        provider.analyze_images.assert_not_called()

    def test_a_failing_verifier_never_breaks_the_scan(self):
        readings, calls, warnings = self.run_read(FakeVerifier(error=RuntimeError("boom")))
        self.assertEqual(readings, {})
        self.assertEqual([(c.trigger, c.status) for c in calls], [("verify", "ERROR")])
        self.assertEqual(warnings, ["VISUAL_VERIFICATION_UNAVAILABLE"])


if __name__ == "__main__":
    unittest.main()
