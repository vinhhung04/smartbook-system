"""Tests for /verify-packing-photo and /scan-receipt: both call OpenRouter's
vision model via llm_provider.analyze_image(). No real network calls - the
provider is mocked at main.get_openrouter_provider(), matching the pattern
in test_storage_suggestion_explanation.py.
"""
import asyncio
import io
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

import llm_provider
import main


def _run(coro):
    return asyncio.run(coro)


def _fake_usage() -> llm_provider.ChatUsage:
    return llm_provider.ChatUsage(
        provider="openrouter", model="qwen/qwen3.7-flash", latency_ms=1,
        prompt_tokens=10, completion_tokens=5, tool_call_count=0,
    )


class _FakeUploadFile:
    def __init__(self, content: bytes = b"fake-image-bytes", content_type: str = "image/jpeg"):
        self.content_type = content_type
        self.file = io.BytesIO(content)


def _mock_provider(parsed=None, side_effect=None):
    provider = AsyncMock()
    if side_effect is not None:
        provider.analyze_image.side_effect = side_effect
    else:
        provider.analyze_image.return_value = (parsed, _fake_usage())
    return provider


class VerifyPackingPhotoTests(unittest.TestCase):
    def test_string_item_count_is_coerced_to_int(self):
        provider = _mock_provider({"item_count": "3", "detected_titles": ["Doraemon"]})
        with patch("main.get_openrouter_provider", return_value=provider):
            result = _run(main._verify_packing_photo_from_bytes(b"bytes"))
        self.assertEqual(result["item_count"], 3)
        self.assertIsInstance(result["item_count"], int)
        self.assertEqual(result["detected_titles"], ["Doraemon"])

    def test_null_fields_default_to_zero_and_empty_list(self):
        provider = _mock_provider({"item_count": None, "detected_titles": None})
        with patch("main.get_openrouter_provider", return_value=provider):
            result = _run(main._verify_packing_photo_from_bytes(b"bytes"))
        self.assertEqual(result, {"item_count": 0, "detected_titles": []})

    def test_endpoint_returns_502_on_vision_response_error(self):
        provider = _mock_provider(side_effect=llm_provider.VisionResponseError("bad json"))
        file = _FakeUploadFile()
        with patch("main.get_openrouter_provider", return_value=provider):
            with self.assertRaises(HTTPException) as ctx:
                _run(main.verify_packing_photo(file))
        self.assertEqual(ctx.exception.status_code, 502)

    def test_endpoint_returns_502_on_timeout(self):
        provider = _mock_provider(side_effect=TimeoutError("upstream timed out"))
        file = _FakeUploadFile()
        with patch("main.get_openrouter_provider", return_value=provider):
            with self.assertRaises(HTTPException) as ctx:
                _run(main.verify_packing_photo(file))
        self.assertEqual(ctx.exception.status_code, 502)

    def test_endpoint_returns_502_on_invalid_schema(self):
        # item_count "many" isn't coercible to int - a genuinely wrong response
        # shape, not just a friendly null default.
        provider = _mock_provider({"item_count": "many", "detected_titles": []})
        file = _FakeUploadFile()
        with patch("main.get_openrouter_provider", return_value=provider):
            with self.assertRaises(HTTPException) as ctx:
                _run(main.verify_packing_photo(file))
        self.assertEqual(ctx.exception.status_code, 502)

    def test_endpoint_success_returns_dict_directly(self):
        provider = _mock_provider({"item_count": 2, "detected_titles": ["A", "B"]})
        file = _FakeUploadFile()
        with patch("main.get_openrouter_provider", return_value=provider):
            result = _run(main.verify_packing_photo(file))
        self.assertEqual(result, {"item_count": 2, "detected_titles": ["A", "B"]})


class ScanReceiptTests(unittest.TestCase):
    def test_normalizes_line_items(self):
        provider = _mock_provider({
            "supplier_name": "NXB Tre", "invoice_number": "INV-1", "invoice_date": "2026-09-01",
            "line_items": [{"title": "Doraemon", "isbn": "9786041234567", "quantity": "5", "unit_price": "45000"}],
        })
        file = _FakeUploadFile()
        with patch("main.get_openrouter_provider", return_value=provider):
            result = _run(main.scan_receipt(file))
        self.assertTrue(result["success"])
        self.assertEqual(result["line_items"], [
            {"title": "Doraemon", "isbn": "9786041234567", "quantity": 5, "unit_price": 45000.0},
        ])
        self.assertEqual(result["total_items"], 1)

    def test_model_reported_error_returns_success_false_not_an_http_error(self):
        provider = _mock_provider({"error": "Không thể đọc nội dung hóa đơn"})
        file = _FakeUploadFile()
        with patch("main.get_openrouter_provider", return_value=provider):
            result = _run(main.scan_receipt(file))
        self.assertEqual(result, {"success": False, "error": "Không thể đọc nội dung hóa đơn"})

    def test_ai_timeout_returns_502(self):
        provider = _mock_provider(side_effect=TimeoutError("upstream timed out"))
        file = _FakeUploadFile()
        with patch("main.get_openrouter_provider", return_value=provider):
            with self.assertRaises(HTTPException) as ctx:
                _run(main.scan_receipt(file))
        self.assertEqual(ctx.exception.status_code, 502)

    def test_invalid_vision_response_returns_502(self):
        provider = _mock_provider(side_effect=llm_provider.VisionResponseError("not json"))
        file = _FakeUploadFile()
        with patch("main.get_openrouter_provider", return_value=provider):
            with self.assertRaises(HTTPException) as ctx:
                _run(main.scan_receipt(file))
        self.assertEqual(ctx.exception.status_code, 502)

    def test_rejects_non_receipt_content_type(self):
        file = _FakeUploadFile(content_type="text/plain")
        with self.assertRaises(HTTPException) as ctx:
            _run(main.scan_receipt(file))
        self.assertEqual(ctx.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
