"""
Simple in-memory cache + rate limiter for Groq API.
Prevents duplicate requests and excessive usage.
"""
import hashlib
import time
import asyncio
from collections import OrderedDict
from typing import Optional

# ── Response Cache ────────────────────────────────────────────────────────────

class ResponseCache:
    """LRU cache for chat responses — avoids re-calling Groq for same questions."""

    def __init__(self, max_size: int = 100, ttl_seconds: int = 300):
        self.max_size = max_size
        self.ttl = ttl_seconds
        self._cache: OrderedDict[str, tuple[str, float]] = OrderedDict()

    def _hash_message(self, message: str, history_hash: str = "") -> str:
        """Create cache key from message + conversation context."""
        combined = f"{history_hash}:{message[:200]}"
        return hashlib.sha256(combined.encode()).hexdigest()[:16]

    def get(self, message: str, history_hash: str = "") -> Optional[str]:
        key = self._hash_message(message, history_hash)
        if key in self._cache:
            reply, timestamp = self._cache[key]
            if time.time() - timestamp < self.ttl:
                self._cache.move_to_end(key)
                return reply
            else:
                del self._cache[key]
        return None

    def set(self, message: str, reply: str, history_hash: str = ""):
        key = self._hash_message(message, history_hash)
        self._cache[key] = (reply, time.time())
        self._cache.move_to_end(key)
        if len(self._cache) > self.max_size:
            self._cache.popitem(last=False)

    def clear(self):
        self._cache.clear()


# ── Rate Limiter ─────────────────────────────────────────────────────────────

class RateLimiter:
    """
    Simple token bucket rate limiter.
    Limits requests per user/IP to prevent API abuse.
    """

    def __init__(self, requests_per_minute: int = 15, requests_per_hour: int = 100):
        self.rpm_limit = requests_per_minute
        self.rph_limit = requests_per_hour
        self._minute: dict[str, list[float]] = {}
        self._hour: dict[str, list[float]] = {}
        self._lock = asyncio.Lock()

    async def acquire(self, key: str = "default") -> tuple[bool, str]:
        """
        Check if request is allowed. Returns (allowed, reason).
        """
        async with self._lock:
            now = time.time()
            minute_ago = now - 60
            hour_ago = now - 3600

            # Clean old entries
            self._minute[key] = [t for t in self._minute.get(key, []) if t > minute_ago]
            self._hour[key] = [t for t in self._hour.get(key, []) if t > hour_ago]

            # Check limits
            if len(self._minute.get(key, [])) >= self.rpm_limit:
                return False, "Quá nhiều yêu cầu. Vui lòng chờ 1 phút."
            if len(self._hour.get(key, [])) >= self.rph_limit:
                return False, "Đã đạt giới hạn hourly. Vui lòng thử lại sau."

            # Record this request
            self._minute.setdefault(key, []).append(now)
            self._hour.setdefault(key, []).append(now)
            return True, ""


# ── Global instances ───────────────────────────────────────────────────────────

response_cache = ResponseCache(max_size=100, ttl_seconds=300)
rate_limiter = RateLimiter(requests_per_minute=15, requests_per_hour=100)

# ── Summary Cache (riêng cho /generate-summary-vi) ─────────────────────────────

class SummaryCache:
    """Cache riêng cho summary — persistent hơn vì summary không thay đổi."""

    def __init__(self, max_size: int = 200, ttl_seconds: int = 3600):
        self.max_size = max_size
        self.ttl = ttl_seconds
        self._cache: OrderedDict[str, tuple[dict, float]] = OrderedDict()

    def get(self, key: str) -> Optional[dict]:
        if key in self._cache:
            data, timestamp = self._cache[key]
            if time.time() - timestamp < self.ttl:
                self._cache.move_to_end(key)
                return data
            else:
                del self._cache[key]
        return None

    def set(self, key: str, data: dict):
        self._cache[key] = (data, time.time())
        self._cache.move_to_end(key)
        if len(self._cache) > self.max_size:
            self._cache.popitem(last=False)

    def clear(self):
        self._cache.clear()


summary_cache = SummaryCache(max_size=200, ttl_seconds=3600)

