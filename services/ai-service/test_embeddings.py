from __future__ import annotations

import unittest

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


if __name__ == "__main__":
    unittest.main()
