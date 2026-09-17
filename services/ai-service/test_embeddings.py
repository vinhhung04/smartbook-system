from __future__ import annotations

import unittest
from unittest import mock

import embeddings


class EmbedCircuitBreakerTest(unittest.TestCase):
    def _clock(self, start: float = 1000.0):
        """Dong ho gia, tu tang khi goi — de test khong phu thuoc thoi gian thuc."""
        state = {"now": start}
        def now():
            return state["now"]
        def advance(seconds: float):
            state["now"] += seconds
        return now, advance

    def test_closed_by_default(self):
        breaker = embeddings.EmbedCircuitBreaker(threshold=3, cooldown_seconds=60)
        self.assertTrue(breaker.should_try_primary())

    def test_stays_closed_below_threshold(self):
        breaker = embeddings.EmbedCircuitBreaker(threshold=3, cooldown_seconds=60)
        breaker.record_failure()
        breaker.record_failure()
        self.assertTrue(breaker.should_try_primary())

    def test_opens_at_threshold(self):
        breaker = embeddings.EmbedCircuitBreaker(threshold=3, cooldown_seconds=60)
        breaker.record_failure()
        breaker.record_failure()
        breaker.record_failure()
        self.assertFalse(breaker.should_try_primary())

    def test_success_resets_failure_count(self):
        breaker = embeddings.EmbedCircuitBreaker(threshold=3, cooldown_seconds=60)
        breaker.record_failure()
        breaker.record_failure()
        breaker.record_success()
        breaker.record_failure()
        breaker.record_failure()
        # Chi 2 that bai lien tiep ke tu lan success — chua cham threshold.
        self.assertTrue(breaker.should_try_primary())

    def test_stays_open_before_cooldown_elapses(self):
        now, advance = self._clock()
        breaker = embeddings.EmbedCircuitBreaker(threshold=1, cooldown_seconds=60, now_fn=now)
        breaker.record_failure()
        advance(30)
        self.assertFalse(breaker.should_try_primary())

    def test_half_opens_after_cooldown_elapses(self):
        now, advance = self._clock()
        breaker = embeddings.EmbedCircuitBreaker(threshold=1, cooldown_seconds=60, now_fn=now)
        breaker.record_failure()
        advance(61)
        # Sau cooldown, mach chuyen HALF_OPEN — cho phep MOT lan thu lai.
        self.assertTrue(breaker.should_try_primary())

    def test_failure_during_half_open_reopens_and_resets_cooldown(self):
        now, advance = self._clock()
        breaker = embeddings.EmbedCircuitBreaker(threshold=1, cooldown_seconds=60, now_fn=now)
        breaker.record_failure()
        advance(61)
        self.assertTrue(breaker.should_try_primary())  # HALF_OPEN, duoc thu
        breaker.record_failure()  # lan thu that bai
        self.assertFalse(breaker.should_try_primary())  # OPEN lai ngay
        advance(61)
        self.assertTrue(breaker.should_try_primary())  # cooldown moi da het

    def test_success_during_half_open_closes_circuit(self):
        now, advance = self._clock()
        breaker = embeddings.EmbedCircuitBreaker(threshold=1, cooldown_seconds=60, now_fn=now)
        breaker.record_failure()
        advance(61)
        self.assertTrue(breaker.should_try_primary())  # HALF_OPEN
        breaker.record_success()
        advance(1)  # rat it thoi gian troi qua, khong phai vi het cooldown
        self.assertTrue(breaker.should_try_primary())  # CLOSED, khong con phu thuoc cooldown


class FakeEmbedResponse:
    def __init__(self, embeddings):
        self.embeddings = embeddings


class FakeOllamaClient:
    def __init__(self, vectors: dict, default=None):
        self._vectors = vectors
        self._default = default

    def embed(self, model, input):
        texts = [input] if isinstance(input, str) else list(input)
        return FakeEmbedResponse(embeddings=[self._vectors.get(t, self._default) for t in texts])


class FailingOllamaClient:
    def embed(self, model, input):
        raise ConnectionError("ollama unreachable")


class OllamaEmbedderTest(unittest.TestCase):
    def test_embeds_batch_via_client(self):
        client = FakeOllamaClient({"a": [1.0, 0.0], "b": [0.0, 1.0]})
        embedder = embeddings.OllamaEmbedder()
        result = embedder.embed_batch(["a", "b"], client=client)
        self.assertEqual(result, [[1.0, 0.0], [0.0, 1.0]])

    def test_empty_input_returns_empty_list(self):
        embedder = embeddings.OllamaEmbedder()
        self.assertEqual(embedder.embed_batch([], client=FakeOllamaClient({})), [])

    def test_failure_returns_none_not_raise(self):
        embedder = embeddings.OllamaEmbedder()
        self.assertIsNone(embedder.embed_batch(["a"], client=FailingOllamaClient()))

    def test_mismatched_vector_count_returns_none(self):
        class ShortResponseClient:
            def embed(self, model, input):
                return FakeEmbedResponse(embeddings=[[1.0, 0.0]])  # 1 vector cho 2 text
        embedder = embeddings.OllamaEmbedder()
        self.assertIsNone(embedder.embed_batch(["a", "b"], client=ShortResponseClient()))


class CloudEmbedderTest(unittest.TestCase):
    def _embedder(self):
        return embeddings.CloudEmbedder(
            api_key="test-key", base_url="https://openrouter.ai/api/v1",
            model="qwen/qwen3-embedding-8b", dimensions=768, timeout=10,
        )

    def test_sends_dimensions_param_and_parses_response(self):
        fake_response = mock.Mock()
        fake_response.raise_for_status = mock.Mock()
        fake_response.json.return_value = {
            "data": [{"embedding": [0.1, 0.2]}, {"embedding": [0.3, 0.4]}]
        }
        fake_client = mock.MagicMock()
        fake_client.__enter__.return_value = fake_client
        fake_client.post.return_value = fake_response

        with mock.patch("httpx.Client", return_value=fake_client):
            result = self._embedder().embed_batch(["a", "b"])

        self.assertEqual(result, [[0.1, 0.2], [0.3, 0.4]])
        call_kwargs = fake_client.post.call_args.kwargs
        self.assertEqual(call_kwargs["json"]["dimensions"], 768)
        self.assertEqual(call_kwargs["json"]["model"], "qwen/qwen3-embedding-8b")
        self.assertEqual(call_kwargs["json"]["input"], ["a", "b"])
        self.assertEqual(call_kwargs["headers"]["Authorization"], "Bearer test-key")

    def test_empty_input_returns_empty_list(self):
        self.assertEqual(self._embedder().embed_batch([]), [])

    def test_http_error_returns_none_not_raise(self):
        fake_client = mock.MagicMock()
        fake_client.__enter__.return_value = fake_client
        fake_client.post.side_effect = ConnectionError("network down")
        with mock.patch("httpx.Client", return_value=fake_client):
            self.assertIsNone(self._embedder().embed_batch(["a"]))

    def test_mismatched_vector_count_returns_none(self):
        fake_response = mock.Mock()
        fake_response.raise_for_status = mock.Mock()
        fake_response.json.return_value = {"data": [{"embedding": [0.1, 0.2]}]}  # 1 cho 2 text
        fake_client = mock.MagicMock()
        fake_client.__enter__.return_value = fake_client
        fake_client.post.return_value = fake_response
        with mock.patch("httpx.Client", return_value=fake_client):
            self.assertIsNone(self._embedder().embed_batch(["a", "b"]))


class EmbedBatchDispatchTest(unittest.TestCase):
    def setUp(self):
        # Moi test bat dau voi mach dong (Ollama), khong ke thua state tu test truoc.
        embeddings._breaker = embeddings.EmbedCircuitBreaker(
            threshold=embeddings.EMBED_BREAKER_THRESHOLD,
            cooldown_seconds=embeddings.EMBED_BREAKER_COOLDOWN_SECONDS,
        )

    def test_uses_ollama_when_healthy(self):
        client = FakeOllamaClient({"a": [1.0, 0.0]})
        with mock.patch.object(embeddings, "_cloud_embedder") as fake_cloud:
            result = embeddings.embed_batch(["a"], client=client)
        self.assertEqual(result.vectors, [[1.0, 0.0]])
        self.assertEqual(result.provider, "ollama")
        self.assertEqual(result.model, embeddings.EMBED_MODEL)
        fake_cloud.embed_batch.assert_not_called()

    def test_falls_back_to_cloud_when_ollama_fails(self):
        with mock.patch.object(embeddings, "_cloud_embedder") as fake_cloud:
            fake_cloud.embed_batch.return_value = [[0.5, 0.5]]
            result = embeddings.embed_batch(["a"], client=FailingOllamaClient())
        self.assertEqual(result.vectors, [[0.5, 0.5]])
        self.assertEqual(result.provider, "openrouter")
        self.assertEqual(result.model, embeddings.CLOUD_EMBED_MODEL)

    def test_breaker_opens_after_threshold_and_skips_ollama(self):
        with mock.patch.object(embeddings, "_cloud_embedder") as fake_cloud:
            fake_cloud.embed_batch.return_value = [[0.0, 0.0]]
            failing = FailingOllamaClient()
            for _ in range(embeddings.EMBED_BREAKER_THRESHOLD):
                embeddings.embed_batch(["a"], client=failing)
            # Mach da mo — lan goi tiep theo KHONG duoc dung client (se raise
            # neu bi goi, chung minh Ollama bi bo qua hoan toan).
            class RaisingIfCalledClient:
                def embed(self, model, input):
                    raise AssertionError("Ollama khong duoc goi khi mach dang mo")
            embeddings.embed_batch(["a"], client=RaisingIfCalledClient())

    def test_both_providers_fail_returns_none(self):
        with mock.patch.object(embeddings, "_cloud_embedder") as fake_cloud:
            fake_cloud.embed_batch.return_value = None
            self.assertIsNone(embeddings.embed_batch(["a"], client=FailingOllamaClient()))

    def test_empty_input_returns_empty_result_without_calling_any_provider(self):
        with mock.patch.object(embeddings, "_cloud_embedder") as fake_cloud:
            result = embeddings.embed_batch([], client=FakeOllamaClient({}))
        self.assertEqual(result.vectors, [])
        fake_cloud.embed_batch.assert_not_called()

    def test_embed_text_wraps_single_vector(self):
        client = FakeOllamaClient({"a": [1.0, 0.0]})
        result = embeddings.embed_text("a", client=client)
        self.assertEqual(result.vector, [1.0, 0.0])
        self.assertEqual(result.provider, "ollama")

    def test_embed_text_returns_none_when_both_fail(self):
        with mock.patch.object(embeddings, "_cloud_embedder") as fake_cloud:
            fake_cloud.embed_batch.return_value = None
            self.assertIsNone(embeddings.embed_text("a", client=FailingOllamaClient()))


if __name__ == "__main__":
    unittest.main()
