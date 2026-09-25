"""Unit tests for embeddings.py: OpenRouter is the sole embedding provider.
No real network calls - httpx.Client is mocked at the transport level."""
from __future__ import annotations

import unittest
from unittest import mock

import httpx

import embeddings


def _make_embedder(dimensions: int = 768, timeout: float = 5.0) -> embeddings.OpenRouterEmbedder:
    return embeddings.OpenRouterEmbedder(
        api_key="sk-fake", base_url="https://openrouter.ai/api/v1",
        model="qwen/qwen3-embedding-8b", dimensions=dimensions, timeout=timeout,
    )


_RealClient = httpx.Client


def _patch_client(handler):
    def _factory(*args, **kwargs):
        kwargs.pop("timeout", None)
        return _RealClient(transport=httpx.MockTransport(handler), timeout=5.0)
    return mock.patch("httpx.Client", side_effect=_factory)


class OpenRouterEmbedderTest(unittest.TestCase):
    def test_sends_dimensions_param_and_parses_response(self):
        captured = {}

        def handler(request: httpx.Request) -> httpx.Response:
            import json
            captured["body"] = json.loads(request.content)
            return httpx.Response(200, json={
                "data": [{"embedding": [0.1] * 768}, {"embedding": [0.2] * 768}],
                "usage": {"prompt_tokens": 12, "cost": 0.0000001},
            })

        embedder = _make_embedder()
        with _patch_client(handler):
            vectors = embedder.embed_batch(["a", "b"])

        self.assertEqual(len(vectors), 2)
        self.assertEqual(len(vectors[0]), 768)
        self.assertEqual(captured["body"]["dimensions"], 768)
        self.assertEqual(captured["body"]["model"], "qwen/qwen3-embedding-8b")
        self.assertEqual(captured["body"]["input"], ["a", "b"])

    def test_empty_input_returns_empty_list_without_any_http_call(self):
        embedder = _make_embedder()
        with mock.patch("httpx.Client") as client_cls:
            result = embedder.embed_batch([])
        self.assertEqual(result, [])
        client_cls.assert_not_called()

    def test_empty_api_key_returns_none_without_any_http_call(self):
        embedder = embeddings.OpenRouterEmbedder(
            api_key="", base_url="https://openrouter.ai/api/v1",
            model="qwen/qwen3-embedding-8b", dimensions=768, timeout=5.0,
        )
        with mock.patch("httpx.Client") as client_cls:
            result = embedder.embed_batch(["a"])
        self.assertIsNone(result)
        client_cls.assert_not_called()

    def test_wrong_dimension_returns_none(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"data": [{"embedding": [0.1] * 4096}], "usage": {}})

        embedder = _make_embedder()
        with _patch_client(handler):
            result = embedder.embed_batch(["a"])
        self.assertIsNone(result)

    def test_vector_count_mismatch_returns_none(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"data": [{"embedding": [0.1] * 768}], "usage": {}})

        embedder = _make_embedder()
        with _patch_client(handler):
            result = embedder.embed_batch(["a", "b"])
        self.assertIsNone(result)

    def test_http_error_returns_none_not_raise(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(500, json={"error": "down"})

        embedder = _make_embedder()
        with _patch_client(handler):
            result = embedder.embed_batch(["a"])
        self.assertIsNone(result)

    def test_timeout_returns_none_not_raise(self):
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.TimeoutException("timed out", request=request)

        embedder = _make_embedder()
        with _patch_client(handler):
            result = embedder.embed_batch(["a"])
        self.assertIsNone(result)

    def test_batch_embedding_preserves_order(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={
                "data": [{"embedding": [1.0] * 768}, {"embedding": [2.0] * 768}, {"embedding": [3.0] * 768}],
                "usage": {},
            })

        embedder = _make_embedder()
        with _patch_client(handler):
            vectors = embedder.embed_batch(["a", "b", "c"])
        self.assertEqual([v[0] for v in vectors], [1.0, 2.0, 3.0])


class ModuleLevelEmbedBatchTest(unittest.TestCase):
    """embed_batch()/embed_text() dispatch to the module's single _embedder
    instance - mocked the same way test_ingestion.py does."""

    def test_empty_input_returns_empty_result_without_calling_the_embedder(self):
        with mock.patch.object(embeddings, "_embedder") as mock_embedder:
            result = embeddings.embed_batch([])
        self.assertEqual(result, embeddings.BatchEmbedResult(vectors=[], model=embeddings.EMBED_IDENTITY, provider="none"))
        mock_embedder.embed_batch.assert_not_called()

    def test_success_returns_identity_as_model(self):
        with mock.patch.object(embeddings, "_embedder") as mock_embedder:
            mock_embedder.embed_batch.return_value = [[0.1, 0.2]]
            result = embeddings.embed_batch(["a"])
        self.assertEqual(result.provider, "openrouter")
        self.assertEqual(result.model, embeddings.EMBED_IDENTITY)
        self.assertEqual(result.vectors, [[0.1, 0.2]])

    def test_failure_returns_none(self):
        with mock.patch.object(embeddings, "_embedder") as mock_embedder:
            mock_embedder.embed_batch.return_value = None
            result = embeddings.embed_batch(["a"])
        self.assertIsNone(result)

    def test_embed_text_wraps_single_vector(self):
        with mock.patch.object(embeddings, "_embedder") as mock_embedder:
            mock_embedder.embed_batch.return_value = [[0.5, 0.5]]
            result = embeddings.embed_text("a")
        self.assertEqual(result.vector, [0.5, 0.5])
        self.assertEqual(result.model, embeddings.EMBED_IDENTITY)

    def test_embed_text_returns_none_when_embedder_fails(self):
        with mock.patch.object(embeddings, "_embedder") as mock_embedder:
            mock_embedder.embed_batch.return_value = None
            self.assertIsNone(embeddings.embed_text("a"))


class EmbedIdentityTest(unittest.TestCase):
    def test_identity_combines_model_and_dimensions(self):
        self.assertEqual(embeddings.EMBED_IDENTITY, f"{embeddings.EMBED_MODEL}@{embeddings.EMBED_DIMENSIONS}")


class CosineSimilarityTest(unittest.TestCase):
    def test_identical_vectors_score_one(self):
        self.assertAlmostEqual(embeddings.cosine_similarity([1.0, 0.0], [1.0, 0.0]), 1.0)

    def test_orthogonal_vectors_score_zero(self):
        self.assertAlmostEqual(embeddings.cosine_similarity([1.0, 0.0], [0.0, 1.0]), 0.0)

    def test_mismatched_length_scores_zero(self):
        self.assertEqual(embeddings.cosine_similarity([1.0], [1.0, 0.0]), 0.0)

    def test_zero_vector_scores_zero(self):
        self.assertEqual(embeddings.cosine_similarity([0.0, 0.0], [1.0, 0.0]), 0.0)


if __name__ == "__main__":
    unittest.main()
