"""Shared Ollama embedding + on-disk vector cache primitives.

Used by faq_retrieval.py (static FAQ set) and book_index.py (catalog search).
Every function here degrades gracefully: embedding failures return None rather
than raising, because both callers must fall back to non-semantic behavior
instead of failing the user's request.
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import time
from typing import Callable, NamedTuple

import ollama

logger = logging.getLogger("uvicorn.error")


class EmbedResult(NamedTuple):
    vector: list[float]
    model: str
    provider: str


class BatchEmbedResult(NamedTuple):
    vectors: list[list[float]]
    model: str
    provider: str


class _BreakerState:
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


class EmbedCircuitBreaker:
    """State may thuan cho viec chon Ollama hay cloud, khong tu goi provider nao.

    CLOSED (Ollama) -> [threshold loi lien tiep] -> OPEN (cloud, dem cooldown)
    -> [het cooldown] -> HALF_OPEN (cho mot lan thu Ollama) -> CLOSED neu thanh
    cong / OPEN lai neu van loi.

    now_fn injectable de test khong phu thuoc thoi gian thuc troi qua that.
    """

    def __init__(
        self, threshold: int, cooldown_seconds: float,
        now_fn: Callable[[], float] = time.monotonic,
    ) -> None:
        self._threshold = threshold
        self._cooldown = cooldown_seconds
        self._now = now_fn
        self._consecutive_failures = 0
        self._state = _BreakerState.CLOSED
        self._opened_at: float | None = None

    def should_try_primary(self) -> bool:
        if self._state == _BreakerState.CLOSED:
            return True
        if self._state == _BreakerState.OPEN:
            if self._opened_at is not None and self._now() - self._opened_at >= self._cooldown:
                self._state = _BreakerState.HALF_OPEN
                return True
            return False
        return True  # HALF_OPEN: cho phep dung mot lan thu

    def record_success(self) -> None:
        self._consecutive_failures = 0
        self._state = _BreakerState.CLOSED
        self._opened_at = None

    def record_failure(self) -> None:
        self._consecutive_failures += 1
        if self._state == _BreakerState.HALF_OPEN or self._consecutive_failures >= self._threshold:
            self._state = _BreakerState.OPEN
            self._opened_at = self._now()


OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://ollama:11434")
# Dedicated embedding model, separate from the chat models (SUMMARY_MODEL /
# ASSISTANT_MODEL). FAQ_EMBED_MODEL is the documented name in docker-compose
# and .env.example; EMBED_MODEL overrides it if both are set.
EMBED_MODEL = os.getenv("EMBED_MODEL") or os.getenv("FAQ_EMBED_MODEL", "nomic-embed-text")
# Hard bound on any single embedding call. Without it, the first index build
# after a catalog change could block an assistant turn indefinitely on a
# CPU-only Ollama; a timeout just means no semantic signal for that turn.
EMBED_TIMEOUT_SECONDS = float(os.getenv("EMBED_TIMEOUT_SECONDS", "30"))


class OllamaEmbedder:
    """Provider mac dinh, chay offline duoc. Logic y het embed_batch cu truoc
    Phase B — chi chuyen vao class de dung chung interface voi CloudEmbedder."""

    name = "ollama"

    def embed_batch(self, texts: list[str], client: "ollama.Client | None" = None) -> list[list[float]] | None:
        if not texts:
            return []
        try:
            active_client = client or ollama.Client(host=OLLAMA_HOST, timeout=EMBED_TIMEOUT_SECONDS)
            response = active_client.embed(model=EMBED_MODEL, input=texts)
            vectors = response.embeddings
            if len(vectors) != len(texts):
                logger.warning("embeddings: expected %d vectors, got %d", len(texts), len(vectors))
                return None
            return [list(vector) for vector in vectors]
        except Exception as exc:
            logger.warning("embeddings: ollama embedding failed: %s", type(exc).__name__)
            return None


class CloudEmbedder:
    """Fallback qua OpenRouter khi Ollama chet. `dimensions` LUON gui trong
    request de cat vector ve dung 768 chieu, khop cot vector(768) da co —
    khong duoc bo, model qwen3-embedding-8b mac dinh tra 4096 chieu."""

    name = "openrouter"

    def __init__(
        self, api_key: str, base_url: str, model: str, dimensions: int, timeout: float,
    ) -> None:
        self._api_key = api_key
        self._base_url = (base_url or "https://openrouter.ai/api/v1").rstrip("/")
        self._model = model
        self._dimensions = dimensions
        self._timeout = timeout

    def embed_batch(self, texts: list[str]) -> list[list[float]] | None:
        if not texts:
            return []
        import httpx

        try:
            with httpx.Client(timeout=self._timeout) as client:
                response = client.post(
                    f"{self._base_url}/embeddings",
                    headers={"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"},
                    json={"model": self._model, "input": texts, "dimensions": self._dimensions},
                )
                response.raise_for_status()
                data = response.json()
            vectors = [item["embedding"] for item in data.get("data", [])]
            if len(vectors) != len(texts):
                logger.warning("embeddings: openrouter expected %d vectors, got %d", len(texts), len(vectors))
                return None
            return vectors
        except Exception as exc:
            logger.warning("embeddings: openrouter embedding failed: %s", type(exc).__name__)
            return None


def embed_batch(texts: list[str], client: ollama.Client | None = None) -> list[list[float]] | None:
    """Embed multiple strings in one Ollama call. Returns None on any failure —
    callers must degrade gracefully, never raise."""
    if not texts:
        return []
    try:
        active_client = client or ollama.Client(host=OLLAMA_HOST, timeout=EMBED_TIMEOUT_SECONDS)
        response = active_client.embed(model=EMBED_MODEL, input=texts)
        vectors = response.embeddings
        if len(vectors) != len(texts):
            logger.warning("embeddings: expected %d vectors, got %d", len(texts), len(vectors))
            return None
        return [list(vector) for vector in vectors]
    except Exception as exc:
        logger.warning("embeddings: embedding failed: %s", type(exc).__name__)
        return None


def embed_text(text: str, client: ollama.Client | None = None) -> list[float] | None:
    vectors = embed_batch([text], client=client)
    if not vectors:
        return None
    return vectors[0]


def cosine_similarity(a: list[float], b: list[float]) -> float:
    if len(a) != len(b) or not a:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def content_hash(payload) -> str:
    """Stable hash of the embedded source content, so a cache built from older
    content is detected and rebuilt instead of silently reused."""
    text = json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
