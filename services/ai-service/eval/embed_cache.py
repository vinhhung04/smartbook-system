"""Disk cache + retry for QUERY embeddings during offline evals.

Why: a single OpenRouter timeout mid-run silently turns that case into a
keyword-only retrieval (embeddings.embed_batch returns None by design), so two
runs of the same code could differ only by network luck - which makes a
before/after comparison meaningless. With this cache, every run of a given
dataset under a given embedding identity scores the SAME query vectors, and a
failed call is retried instead of being scored as "no semantic signal".

Only the eval process is patched; production code paths are untouched.
Cache file: eval/.cache/query_embeddings.json (git-ignored), keyed by
"<EMBED_IDENTITY>\\n<text>".
"""
from __future__ import annotations

import json
import os
import threading
import time

import embeddings

CACHE_PATH = os.path.join(os.path.dirname(__file__), ".cache", "query_embeddings.json")
MAX_ATTEMPTS = 4

_lock = threading.Lock()
_cache: dict[str, list[float]] | None = None
stats = {"hits": 0, "misses": 0, "retries": 0, "failures": 0}


def _load() -> dict[str, list[float]]:
    global _cache
    if _cache is None:
        try:
            with open(CACHE_PATH, "r", encoding="utf-8") as handle:
                _cache = json.load(handle)
        except (OSError, ValueError):
            _cache = {}
    return _cache


def save() -> None:
    with _lock:
        if _cache is None:
            return
        os.makedirs(os.path.dirname(CACHE_PATH), exist_ok=True)
        with open(CACHE_PATH, "w", encoding="utf-8") as handle:
            json.dump(_cache, handle)


def install() -> None:
    """Wrap embeddings.embed_batch for the rest of this process."""
    original = embeddings.embed_batch

    def cached_embed_batch(texts):
        cache = _load()
        keys = [f"{embeddings.EMBED_IDENTITY}\n{text}" for text in texts]
        with _lock:
            missing = [i for i, key in enumerate(keys) if key not in cache]
            stats["hits"] += len(keys) - len(missing)
        if missing:
            result = None
            for attempt in range(MAX_ATTEMPTS):
                result = original([texts[i] for i in missing])
                if result is not None:
                    break
                stats["retries"] += 1
                time.sleep(2 * (attempt + 1))
            if result is None:
                stats["failures"] += 1
                return None
            with _lock:
                stats["misses"] += len(missing)
                for i, vector in zip(missing, result.vectors):
                    cache[keys[i]] = vector
        return embeddings.BatchEmbedResult(
            vectors=[cache[key] for key in keys], model=embeddings.EMBED_IDENTITY, provider="openrouter+cache")

    embeddings.embed_batch = cached_embed_batch
