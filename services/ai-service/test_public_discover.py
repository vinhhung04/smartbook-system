"""Unit tests for routes_public_discover.py — no OpenRouter, no Postgres, no
inventory-service: the vector store, embedding call and catalog fetch are
stubbed so what's exercised is the grounding/abstention/cost-control logic."""
from __future__ import annotations

import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

import embeddings
import routes_public_discover as discover_mod
import vector_store
from cache import RateLimiter


def _run(coro):
    return asyncio.run(coro)


def _hit(source_id: str, score: float) -> vector_store.Hit:
    return vector_store.Hit(chunk_id=f"c-{source_id}", document_id=f"d-{source_id}", source_id=source_id,
                            corpus=vector_store.CORPUS_BOOK, content="", score=score)


class FakeStore:
    def __init__(self, semantic, keyword):
        self._semantic = semantic
        self._keyword = keyword

    async def search_semantic(self, corpus, query_vec, k, embedding_model, source_ids=None):
        return self._semantic

    async def search_keyword(self, corpus, query, k, source_ids=None):
        return self._keyword


class GroundResultsTests(unittest.TestCase):
    def test_drops_hits_the_public_catalog_did_not_confirm(self):
        fused = [_hit("ghost", 0.03), _hit("b1", 0.02), _hit("b2", 0.01)]
        books = {"b1": {"id": "b1", "title": "Có thật"}, "b2": {"id": "b2", "title": "Cũng có thật"}}
        results = discover_mod.ground_results(fused, [_hit("b1", 0.7)], [_hit("b2", 1.0)], books, limit=10)
        self.assertEqual([r["book"]["id"] for r in results], ["b1", "b2"])
        self.assertEqual(results[0]["matched"], ["semantic"])
        self.assertEqual(results[1]["matched"], ["keyword"])

    def test_respects_limit(self):
        fused = [_hit(f"b{i}", 0.1) for i in range(5)]
        books = {f"b{i}": {"id": f"b{i}"} for i in range(5)}
        self.assertEqual(len(discover_mod.ground_results(fused, [], [], books, limit=2)), 2)


class DiscoverTests(unittest.TestCase):
    def setUp(self):
        discover_mod._cache.clear()
        discover_mod._budget = RateLimiter(requests_per_minute=100, requests_per_hour=100)

    def _patch(self, semantic, keyword, catalog):
        embed = embeddings.EmbedResult(vector=[0.1, 0.2], model="test-model", provider="test")
        return (
            patch.object(vector_store, "get_store", return_value=FakeStore(semantic, keyword)),
            patch.object(embeddings, "embed_text", return_value=embed),
            patch.object(discover_mod, "_fetch_public_books", AsyncMock(return_value=catalog)),
        )

    def test_returns_only_grounded_catalog_books(self):
        semantic = [_hit("b1", 0.62), _hit("deleted", 0.6)]
        keyword = [_hit("b1", 1.0)]
        p1, p2, p3 = self._patch(semantic, keyword, {"b1": {"id": "b1", "title": "AI cho người mới"}})
        with p1, p2, p3:
            body = _run(discover_mod.public_discover(q="sách dễ đọc về trí tuệ nhân tạo"))
        self.assertEqual([r["book"]["id"] for r in body["results"]], ["b1"])
        self.assertEqual(body["results"][0]["matched"], ["semantic", "keyword"])
        self.assertFalse(body["cached"])

    def test_abstains_without_calling_the_catalog_when_there_is_no_evidence(self):
        p1, p2, p3 = self._patch([], [], {})
        with p1, p2, p3 as fetch:
            body = _run(discover_mod.public_discover(q="xyz không liên quan"))
        self.assertEqual(body["status"], "NO_EVIDENCE")
        self.assertEqual(body["results"], [])
        fetch.assert_not_called()

    def test_identical_queries_are_served_from_cache_without_new_embedding_calls(self):
        p1, p2, p3 = self._patch([_hit("b1", 0.7)], [_hit("b1", 1.0)], {"b1": {"id": "b1"}})
        with p1, p2 as embed, p3:
            _run(discover_mod.public_discover(q="Sách về lịch sử"))
            second = _run(discover_mod.public_discover(q="  sách   về LỊCH SỬ "))
        self.assertTrue(second["cached"])
        self.assertEqual(embed.call_count, 1)

    def test_global_budget_exhausted_returns_429(self):
        discover_mod._budget = RateLimiter(requests_per_minute=0, requests_per_hour=0)
        with self.assertRaises(HTTPException) as ctx:
            _run(discover_mod.public_discover(q="tiểu thuyết trinh thám"))
        self.assertEqual(ctx.exception.status_code, 429)

    def test_upstream_failure_degrades_to_503_for_client_fallback(self):
        with patch.object(vector_store, "get_store", side_effect=RuntimeError("db down")), \
                patch.object(embeddings, "embed_text", return_value=None):
            with self.assertRaises(HTTPException) as ctx:
                _run(discover_mod.public_discover(q="truyện thiếu nhi"))
        self.assertEqual(ctx.exception.status_code, 503)

    def test_rejects_too_short_queries(self):
        with self.assertRaises(HTTPException) as ctx:
            _run(discover_mod.public_discover(q=" a "))
        self.assertEqual(ctx.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
