"""Unit tests for assistant_tools._get()'s truncate behaviour.

Regression coverage for a real bug found during the OpenRouter/embedding
migration: ingestion.py's book corpus sync (main.py's startup hook,
reindex_embeddings.py) fetches /api/books through this same _get() helper,
and _get() ran every response through _truncate()/MAX_LIST_ITEMS - a limit
meant to keep a single tool-calling result small for the LLM's context
window, not to cap bulk data ingestion. Verified live against a 116-book
catalog: only the first 12 were ever ingested. truncate=False is the fix -
default behaviour (every tool-calling call site) is unchanged.
"""
from __future__ import annotations

import asyncio
import unittest
from unittest import mock

import httpx

import assistant_tools

_RealAsyncClient = httpx.AsyncClient


def _patch_client(handler):
    def _factory(*args, **kwargs):
        kwargs.pop("timeout", None)
        return _RealAsyncClient(transport=httpx.MockTransport(handler), timeout=5.0)
    return mock.patch("httpx.AsyncClient", side_effect=_factory)


def _run(coro):
    return asyncio.run(coro)


class GetTruncateTests(unittest.TestCase):
    def _big_list_handler(self, size: int):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json=[{"id": str(i)} for i in range(size)])
        return handler

    def test_default_truncates_a_large_list_to_max_list_items(self):
        with _patch_client(self._big_list_handler(assistant_tools.MAX_LIST_ITEMS + 20)):
            result = _run(assistant_tools._get("/api/books", None))
        self.assertEqual(len(result), assistant_tools.MAX_LIST_ITEMS + 1)  # + the "_truncated" marker
        self.assertIn("_truncated", result[-1])

    def test_truncate_false_returns_the_full_list(self):
        size = assistant_tools.MAX_LIST_ITEMS + 20
        with _patch_client(self._big_list_handler(size)):
            result = _run(assistant_tools._get("/api/books", None, truncate=False))
        self.assertEqual(len(result), size)
        self.assertNotIn("_truncated", result[-1])

    def test_truncate_false_still_returns_a_short_list_unchanged(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json=[{"id": "1"}, {"id": "2"}])

        with _patch_client(handler):
            result = _run(assistant_tools._get("/api/books", None, truncate=False))
        self.assertEqual(result, [{"id": "1"}, {"id": "2"}])

    def test_truncate_false_still_surfaces_an_http_error(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(500, json={"error": "down"})

        with _patch_client(handler):
            result = _run(assistant_tools._get("/api/books", None, truncate=False))
        self.assertIn("error", result)


if __name__ == "__main__":
    unittest.main()
