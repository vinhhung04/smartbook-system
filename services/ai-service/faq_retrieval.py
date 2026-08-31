"""Semantic search over the static FAQ set (faq_data.FAQ_ENTRIES).

Backs the /chat GENERAL_QUERY branch: when a message matches none of the 11
fixed intents, retrieval.py asks this module for related FAQ entries instead of
returning an empty context. Never raises — an Ollama outage just means no match,
and the caller keeps its previous fallback behavior.
"""
from __future__ import annotations

import logging
import os
from typing import NamedTuple

import ollama

import embeddings
from faq_data import FAQ_ENTRIES

logger = logging.getLogger("uvicorn.error")

FAQ_EMBED_MODEL = embeddings.EMBED_MODEL
FAQ_MATCH_THRESHOLD = float(os.getenv("FAQ_MATCH_THRESHOLD", "0.75"))
FAQ_TOP_K = int(os.getenv("FAQ_TOP_K", "3"))

_CACHE_PATH = os.path.join(os.path.dirname(__file__), ".faq_embeddings_cache.json")

_faq_vectors: list[tuple[dict, list[float]]] | None = None


class FAQMatch(NamedTuple):
    entry: dict
    score: float


def _content_hash() -> str:
    # The model name is part of the key: vectors from a different embedding model
    # have a different dimensionality, and cosine_similarity scores mismatched
    # lengths as 0.0 - so a model swap would silently return "nothing matches"
    # forever instead of rebuilding the index.
    return embeddings.content_hash({
        "model": embeddings.EMBED_MODEL,
        "entries": [{"id": e["id"], "question": e["question"], "answer": e["answer"]} for e in FAQ_ENTRIES],
    })


def embed_text(text: str, client: ollama.Client | None = None) -> list[float] | None:
    return embeddings.embed_text(text, client=client)


def _load_faq_vectors(client: ollama.Client | None = None) -> list[tuple[dict, list[float]]]:
    global _faq_vectors
    if _faq_vectors is not None:
        return _faq_vectors

    current_hash = _content_hash()
    cached = embeddings.read_cache(_CACHE_PATH)
    if (
        cached
        and cached.get("hash") == current_hash
        and len(cached.get("vectors") or []) == len(FAQ_ENTRIES)
    ):
        _faq_vectors = list(zip(FAQ_ENTRIES, cached["vectors"]))
        return _faq_vectors

    vectors = embeddings.embed_batch([entry["question"] for entry in FAQ_ENTRIES], client=client)
    if vectors is None:
        # Deliberately not memoized: a transient Ollama outage at the first
        # query must not disable FAQ search for the rest of the process's life.
        # Return "no vectors" for this call only; the next call retries.
        logger.warning("faq_retrieval: FAQ embedding load failed, will retry on next query")
        return [(entry, []) for entry in FAQ_ENTRIES]

    embeddings.write_cache(_CACHE_PATH, {"hash": current_hash, "vectors": vectors})
    _faq_vectors = list(zip(FAQ_ENTRIES, vectors))
    return _faq_vectors


def find_relevant(
    query: str,
    top_k: int = FAQ_TOP_K,
    threshold: float = FAQ_MATCH_THRESHOLD,
    client: ollama.Client | None = None,
) -> list[FAQMatch]:
    """Semantic search over the static FAQ set. Never raises: returns [] if
    Ollama is unreachable or nothing clears the similarity threshold — callers
    fall back to the existing GENERAL_QUERY behavior in that case."""
    query = (query or "").strip()
    if not query:
        return []

    query_vector = embed_text(query, client=client)
    if not query_vector:
        return []

    matches = [
        FAQMatch(entry=entry, score=embeddings.cosine_similarity(query_vector, vector))
        for entry, vector in _load_faq_vectors(client=client)
        if vector
    ]
    matches = [match for match in matches if match.score >= threshold]
    matches.sort(key=lambda match: match.score, reverse=True)
    return matches[:top_k]
