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

import ollama

logger = logging.getLogger("uvicorn.error")

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://ollama:11434")
# Dedicated embedding model, separate from the chat models (SUMMARY_MODEL /
# ASSISTANT_MODEL). FAQ_EMBED_MODEL is the documented name in docker-compose
# and .env.example; EMBED_MODEL overrides it if both are set.
EMBED_MODEL = os.getenv("EMBED_MODEL") or os.getenv("FAQ_EMBED_MODEL", "nomic-embed-text")
# Hard bound on any single embedding call. Without it, the first index build
# after a catalog change could block an assistant turn indefinitely on a
# CPU-only Ollama; a timeout just means no semantic signal for that turn.
EMBED_TIMEOUT_SECONDS = float(os.getenv("EMBED_TIMEOUT_SECONDS", "30"))


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


def read_cache(path: str) -> dict | None:
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, json.JSONDecodeError):
        return None


def write_cache(path: str, payload: dict) -> None:
    try:
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle)
    except OSError:
        logger.warning("embeddings: could not write vector cache to %s", path)
