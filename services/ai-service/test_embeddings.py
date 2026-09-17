from __future__ import annotations

import threading
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

    def test_half_open_trial_is_consumed_by_a_single_caller(self):
        now, advance = self._clock()
        breaker = embeddings.EmbedCircuitBreaker(threshold=1, cooldown_seconds=60, now_fn=now)
        breaker.record_failure()
        advance(61)
        # Caller dau tien lat OPEN -> HALF_OPEN va gianh lan thu duy nhat.
        self.assertTrue(breaker.should_try_primary())
        # Caller thu hai den TRUOC khi lan thu do duoc record_success/failure
        # giai quyet — khong duoc dam vao Ollama nua.
        self.assertFalse(breaker.should_try_primary())
        self.assertFalse(breaker.should_try_primary())

    def test_concurrent_callers_grant_exactly_one_half_open_trial(self):
        now, advance = self._clock()
        breaker = embeddings.EmbedCircuitBreaker(threshold=1, cooldown_seconds=60, now_fn=now)
        breaker.record_failure()
        advance(61)

        thread_count = 16
        barrier = threading.Barrier(thread_count)
        results: list[bool] = []
        results_lock = threading.Lock()

        def probe():
            barrier.wait()  # ep tat ca cung vao should_try_primary mot luc
            granted = breaker.should_try_primary()
            with results_lock:
                results.append(granted)

        threads = [threading.Thread(target=probe) for _ in range(thread_count)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        self.assertEqual(len(results), thread_count)
        self.assertEqual(sum(results), 1, f"expected exactly 1 trial granted, got {sum(results)}")

    def test_is_open_is_a_pure_read(self):
        now, advance = self._clock()
        breaker = embeddings.EmbedCircuitBreaker(threshold=1, cooldown_seconds=60, now_fn=now)
        self.assertFalse(breaker.is_open())  # CLOSED
        breaker.record_failure()
        self.assertTrue(breaker.is_open())  # OPEN
        advance(61)
        # Khac should_try_primary(): is_open() KHONG duoc tu lat sang HALF_OPEN.
        self.assertTrue(breaker.is_open())
        self.assertTrue(breaker.is_open())
        self.assertTrue(breaker.should_try_primary())  # gio moi lat HALF_OPEN
        self.assertFalse(breaker.is_open())  # HALF_OPEN khong phai OPEN


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
    def _embedder(self, api_key: str = "test-key"):
        return embeddings.CloudEmbedder(
            api_key=api_key, base_url="https://openrouter.ai/api/v1",
            model="qwen/qwen3-embedding-8b", dimensions=768, timeout=10,
        )

    @staticmethod
    def _vec(value: float, dim: int = 768) -> list[float]:
        return [value] * dim

    def _fake_client(self, payload: dict):
        fake_response = mock.Mock()
        fake_response.raise_for_status = mock.Mock()
        fake_response.json.return_value = payload
        fake_client = mock.MagicMock()
        fake_client.__enter__.return_value = fake_client
        fake_client.post.return_value = fake_response
        return fake_client

    def test_sends_dimensions_param_and_parses_response(self):
        vec_a, vec_b = self._vec(0.1), self._vec(0.3)
        fake_client = self._fake_client(
            {"data": [{"embedding": vec_a}, {"embedding": vec_b}]})

        with mock.patch("httpx.Client", return_value=fake_client):
            result = self._embedder().embed_batch(["a", "b"])

        self.assertEqual(result, [vec_a, vec_b])
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
        fake_client = self._fake_client({"data": [{"embedding": self._vec(0.1)}]})  # 1 cho 2 text
        with mock.patch("httpx.Client", return_value=fake_client):
            self.assertIsNone(self._embedder().embed_batch(["a", "b"]))

    def test_mismatched_vector_dimension_returns_none(self):
        # Dung so luong vector nhung sai so chieu — neu lot qua, loi chi lo ra
        # rat muon duoi dang loi Postgres "CAST ... AS vector" bi nuot.
        fake_client = self._fake_client(
            {"data": [{"embedding": self._vec(0.1)}, {"embedding": self._vec(0.2, dim=4096)}]})
        with mock.patch("httpx.Client", return_value=fake_client):
            self.assertIsNone(self._embedder().embed_batch(["a", "b"]))

    def test_empty_api_key_returns_none_without_any_http_call(self):
        with mock.patch("httpx.Client") as fake_httpx_client:
            self.assertIsNone(self._embedder(api_key="").embed_batch(["a"]))
        # Khong duoc mo ket noi nao — query cua nguoi dung khong duoc roi may.
        fake_httpx_client.assert_not_called()


class EmbedBatchDispatchTest(unittest.TestCase):
    def setUp(self):
        # Moi test bat dau voi mach dong (Ollama), khong ke thua state tu test truoc.
        embeddings._breaker = embeddings.EmbedCircuitBreaker(
            threshold=embeddings.EMBED_BREAKER_THRESHOLD,
            cooldown_seconds=embeddings.EMBED_BREAKER_COOLDOWN_SECONDS,
        )

    def _breaker_opens_on_first_failure(self):
        """Mach mo ngay sau MOT lan loi — cloud chi duoc dung khi mach da mo,
        nen test ve cloud phai dua mach toi trang thai do truoc."""
        embeddings._breaker = embeddings.EmbedCircuitBreaker(threshold=1, cooldown_seconds=60)

    def test_uses_ollama_when_healthy(self):
        client = FakeOllamaClient({"a": [1.0, 0.0]})
        with mock.patch.object(embeddings, "_cloud_embedder") as fake_cloud:
            result = embeddings.embed_batch(["a"], client=client)
        self.assertEqual(result.vectors, [[1.0, 0.0]])
        self.assertEqual(result.provider, "ollama")
        self.assertEqual(result.model, embeddings.EMBED_MODEL)
        fake_cloud.embed_batch.assert_not_called()

    def test_falls_back_to_cloud_when_breaker_opens(self):
        self._breaker_opens_on_first_failure()
        with mock.patch.object(embeddings, "_cloud_embedder") as fake_cloud:
            fake_cloud.embed_batch.return_value = [[0.5, 0.5]]
            result = embeddings.embed_batch(["a"], client=FailingOllamaClient())
        self.assertEqual(result.vectors, [[0.5, 0.5]])
        self.assertEqual(result.provider, "openrouter")
        self.assertEqual(result.model, embeddings.CLOUD_EMBED_MODEL)

    def test_failure_below_threshold_returns_none_without_touching_cloud(self):
        # threshold mac dinh la 3: mot lan loi le te KHONG duoc keo theo mot
        # cuoc goi cloud tra tien (va cong them ca CLOUD_EMBED_TIMEOUT_SECONDS
        # vao do tre) — spec noi "3 loi lien tiep -> mo mach, CHUYEN cloud".
        with mock.patch.object(embeddings, "_cloud_embedder") as fake_cloud:
            result = embeddings.embed_batch(["a"], client=FailingOllamaClient())
        self.assertIsNone(result)
        fake_cloud.embed_batch.assert_not_called()

    def test_breaker_opens_after_threshold_and_skips_ollama(self):
        class TrackingClient:
            def __init__(self):
                self.called = False

            def embed(self, model, input):
                self.called = True
                raise ConnectionError("ollama unreachable")

        with mock.patch.object(embeddings, "_cloud_embedder") as fake_cloud:
            fake_cloud.embed_batch.return_value = [[0.25, 0.75]]
            failing = FailingOllamaClient()
            for _ in range(embeddings.EMBED_BREAKER_THRESHOLD):
                embeddings.embed_batch(["a"], client=failing)
            # Mach da mo — lan goi tiep theo KHONG duoc cham vao client Ollama.
            tracking = TrackingClient()
            result = embeddings.embed_batch(["a"], client=tracking)

        self.assertFalse(tracking.called, "Ollama khong duoc goi khi mach dang mo")
        self.assertEqual(result.vectors, [[0.25, 0.75]])
        self.assertEqual(result.provider, "openrouter")
        self.assertEqual(result.model, embeddings.CLOUD_EMBED_MODEL)

    def test_both_providers_fail_returns_none(self):
        self._breaker_opens_on_first_failure()
        with mock.patch.object(embeddings, "_cloud_embedder") as fake_cloud:
            fake_cloud.embed_batch.return_value = None
            self.assertIsNone(embeddings.embed_batch(["a"], client=FailingOllamaClient()))

    def test_no_cloud_fallback_returns_none_when_ollama_fails(self):
        # Duong GHI (ingestion.py): Ollama loi thi bo qua tai lieu, tuyet doi
        # khong embed bang model cloud.
        self._breaker_opens_on_first_failure()
        with mock.patch.object(embeddings, "_cloud_embedder") as fake_cloud:
            fake_cloud.embed_batch.return_value = [[0.5, 0.5]]
            result = embeddings.embed_batch(
                ["a"], client=FailingOllamaClient(), allow_cloud_fallback=False)
        self.assertIsNone(result)
        fake_cloud.embed_batch.assert_not_called()

    def test_no_cloud_fallback_skips_cloud_even_when_breaker_already_open(self):
        self._breaker_opens_on_first_failure()
        embeddings._breaker.record_failure()  # mach da mo tu truoc
        with mock.patch.object(embeddings, "_cloud_embedder") as fake_cloud:
            fake_cloud.embed_batch.return_value = [[0.5, 0.5]]
            result = embeddings.embed_batch(
                ["a"], client=FakeOllamaClient({"a": [1.0, 0.0]}), allow_cloud_fallback=False)
        self.assertIsNone(result)
        fake_cloud.embed_batch.assert_not_called()

    def test_no_cloud_fallback_still_uses_ollama_when_healthy(self):
        with mock.patch.object(embeddings, "_cloud_embedder") as fake_cloud:
            result = embeddings.embed_batch(
                ["a"], client=FakeOllamaClient({"a": [1.0, 0.0]}), allow_cloud_fallback=False)
        self.assertEqual(result.vectors, [[1.0, 0.0]])
        self.assertEqual(result.provider, "ollama")
        fake_cloud.embed_batch.assert_not_called()

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
        self._breaker_opens_on_first_failure()
        with mock.patch.object(embeddings, "_cloud_embedder") as fake_cloud:
            fake_cloud.embed_batch.return_value = None
            self.assertIsNone(embeddings.embed_text("a", client=FailingOllamaClient()))

    def test_embed_text_passes_allow_cloud_fallback_through(self):
        self._breaker_opens_on_first_failure()
        with mock.patch.object(embeddings, "_cloud_embedder") as fake_cloud:
            fake_cloud.embed_batch.return_value = [[0.5, 0.5]]
            result = embeddings.embed_text(
                "a", client=FailingOllamaClient(), allow_cloud_fallback=False)
        self.assertIsNone(result)
        fake_cloud.embed_batch.assert_not_called()


if __name__ == "__main__":
    unittest.main()
