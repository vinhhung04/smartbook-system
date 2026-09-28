"""Embedding client: OpenRouter (qwen/qwen3-embedding-8b) is the sole
embedding provider this service depends on - no local model, no offline
fallback. Ollama's circuit breaker used to arbitrate between a local Ollama
embedder and this same OpenRouter call as its fallback; with Ollama removed
there is only one provider left; the breaker added nothing over just calling
it directly, so it is gone too.

Used by book_index.py (tim sach), faq_retrieval.py (tim tai lieu noi bo),
ingestion.py (dong bo vector store). embed_batch()/embed_text() never raise —
an OpenRouter failure returns None, and the caller degrades itself (drops the
semantic signal, falls back to keyword search only).
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import time
from typing import NamedTuple

from metrics import ai_request_duration, ai_llm_cost_usd_total, ai_llm_tokens_total

logger = logging.getLogger("uvicorn.error")


class EmbedResult(NamedTuple):
    vector: list[float]
    model: str
    provider: str


class BatchEmbedResult(NamedTuple):
    vectors: list[list[float]]
    model: str
    provider: str


OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "").strip()
OPENROUTER_BASE_URL = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").rstrip("/")
EMBED_MODEL = os.getenv("OPENROUTER_EMBED_MODEL", "qwen/qwen3-embedding-8b")
# `dimensions` is ALWAYS sent in the request to cut the vector down to this size -
# qwen3-embedding-8b defaults to 4096 dimensions, and the database column is a
# fixed vector(768) (schema.sql), matched by EXPECTED_DIMENSIONS below.
EMBED_DIMENSIONS = int(os.getenv("OPENROUTER_EMBED_DIMENSIONS", "768"))
EMBED_TIMEOUT_SECONDS = float(os.getenv("OPENROUTER_EMBED_TIMEOUT_SECONDS", "30"))
EXPECTED_DIMENSIONS = 768  # must match vector_store.EMBEDDING_DIM / schema.sql's vector(768)

if EMBED_DIMENSIONS != EXPECTED_DIMENSIONS:
    logger.error(
        "embeddings: OPENROUTER_EMBED_DIMENSIONS=%d does not match the database's "
        "vector(%d) column - every embed call will be rejected as a dimension "
        "mismatch until this is fixed.", EMBED_DIMENSIONS, EXPECTED_DIMENSIONS,
    )

# Embedding identity used as vector_store's `embedding_model` column: content
# embedded by a different model OR a different dimension count lives in a
# different vector space and must never be compared/reused - see
# ingestion.chunk_hash(), which folds this same identity into the content
# hash so a model/dimension change forces every chunk to re-embed.
EMBED_IDENTITY = f"{EMBED_MODEL}@{EMBED_DIMENSIONS}"


def _log_embed_call(
    *, model: str, latency_ms: float, prompt_tokens: int | None, cost_usd: float | None,
    error: str | None = None,
) -> None:
    ai_request_duration.labels(endpoint="embedding").observe(latency_ms / 1000)
    if prompt_tokens is not None:
        ai_llm_tokens_total.labels(feature="embedding", model=model, kind="prompt").inc(prompt_tokens)
    if cost_usd:
        ai_llm_cost_usd_total.labels(feature="embedding", model=model).inc(cost_usd)
    if error:
        logger.warning("embed_call model=%s latency_ms=%.0f error=%s", model, latency_ms, error)
    else:
        logger.info(
            "embed_call model=%s latency_ms=%.0f prompt_tokens=%s cost_usd=%s",
            model, latency_ms, prompt_tokens, cost_usd,
        )


class OpenRouterEmbedder:
    """Calls OpenRouter's /embeddings endpoint. `dimensions` is always sent
    to cut the vector down to a fixed size - see EMBED_DIMENSIONS above."""

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
        if not self._api_key:
            # No key means the request would 401 anyway - but skipping it here
            # also avoids sending the caller's raw query/document text out on a
            # connection an operator may believe is never configured. Stop
            # before opening any connection.
            logger.warning("embeddings: OPENROUTER_API_KEY not set")
            return None
        import httpx

        started = time.perf_counter()
        try:
            with httpx.Client(timeout=self._timeout) as client:
                response = client.post(
                    f"{self._base_url}/embeddings",
                    headers={"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"},
                    json={"model": self._model, "input": texts, "dimensions": self._dimensions},
                )
                response.raise_for_status()
                data = response.json()
        except Exception as exc:
            _log_embed_call(
                model=self._model, latency_ms=(time.perf_counter() - started) * 1000,
                prompt_tokens=None, cost_usd=None, error=type(exc).__name__,
            )
            logger.warning("embeddings: openrouter embedding failed: %s", type(exc).__name__)
            return None

        latency_ms = (time.perf_counter() - started) * 1000
        usage = data.get("usage") or {}
        vectors = [item["embedding"] for item in data.get("data", [])]

        if len(vectors) != len(texts):
            _log_embed_call(
                model=self._model, latency_ms=latency_ms, prompt_tokens=usage.get("prompt_tokens"),
                cost_usd=usage.get("cost"), error="vector count mismatch",
            )
            logger.warning("embeddings: openrouter expected %d vectors, got %d", len(texts), len(vectors))
            return None

        wrong_dim = next((len(v) for v in vectors if len(v) != self._dimensions), None)
        if wrong_dim is not None:
            # If this slips through, the failure only surfaces much later as a
            # swallowed Postgres "CAST ... AS vector" error - fail loudly here instead.
            _log_embed_call(
                model=self._model, latency_ms=latency_ms, prompt_tokens=usage.get("prompt_tokens"),
                cost_usd=usage.get("cost"), error="dimension mismatch",
            )
            logger.warning(
                "embeddings: openrouter expected %d dimensions, got %d", self._dimensions, wrong_dim)
            return None

        _log_embed_call(
            model=self._model, latency_ms=latency_ms, prompt_tokens=usage.get("prompt_tokens"),
            cost_usd=usage.get("cost"),
        )
        return vectors


# Mocked in tests via mock.patch.object(embeddings, "_embedder") instead of
# mocking httpx directly.
_embedder = OpenRouterEmbedder(
    api_key=OPENROUTER_API_KEY, base_url=OPENROUTER_BASE_URL,
    model=EMBED_MODEL, dimensions=EMBED_DIMENSIONS, timeout=EMBED_TIMEOUT_SECONDS,
)


def embed_batch(texts: list[str]) -> BatchEmbedResult | None:
    """Never raises: an OpenRouter failure returns None and the caller
    degrades (drop the semantic signal, keyword search only)."""
    if not texts:
        return BatchEmbedResult(vectors=[], model=EMBED_IDENTITY, provider="none")

    vectors = _embedder.embed_batch(texts)
    if vectors is None:
        return None
    return BatchEmbedResult(vectors=vectors, model=EMBED_IDENTITY, provider="openrouter")


def embed_text(text: str) -> EmbedResult | None:
    result = embed_batch([text])
    if not result or not result.vectors:
        return None
    return EmbedResult(vector=result.vectors[0], model=result.model, provider=result.provider)


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
