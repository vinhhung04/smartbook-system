"""Semantic index over the book catalog, backing the hybrid search in
assistant_tools.search_books.

Vectors are held in list order, aligned 1:1 with the catalog list handed in by
the caller, and invalidated by a content hash covering both the embedded text
and the embedding model name. That hash is the correctness mechanism: if the
catalog or the model changes, the cache misses and the index is rebuilt.

Like faq_retrieval, nothing here raises - an Ollama outage yields no semantic
scores and the caller keeps its keyword-only behavior.
"""
from __future__ import annotations

import logging
import os

import ollama

import embeddings

logger = logging.getLogger("uvicorn.error")

# Minimum cosine similarity for a book to be considered a semantic hit at all.
# Below this, only a keyword match can pull the book into the result set.
BOOK_SEMANTIC_THRESHOLD = float(os.getenv("BOOK_SEMANTIC_THRESHOLD", "0.6"))

_CACHE_PATH = os.path.join(os.path.dirname(__file__), ".book_index_cache.json")

# (content_hash, vectors) for the most recently built index.
_index: tuple[str, list[list[float]]] | None = None


def book_text(book: dict) -> str:
    """The text embedded for one book. Includes description and summary_vi so a
    question about what a book is *about* can match, which is exactly what plain
    title/author keyword matching cannot do."""
    parts = [
        str(book.get("title") or ""),
        str(book.get("author") or ""),
        str(book.get("category") or ""),
        str(book.get("description") or ""),
        str(book.get("summary_vi") or ""),
    ]
    return " ".join(part.strip() for part in parts if part and part.strip())


def _content_hash(texts: list[str]) -> str:
    return embeddings.content_hash({"model": embeddings.EMBED_MODEL, "texts": texts})


def build_index(books: list[dict], client: ollama.Client | None = None) -> list[list[float]] | None:
    """Return one vector per book, in the same order. None if embedding failed."""
    global _index

    texts = [book_text(book) for book in books]
    if not texts:
        return []

    current_hash = _content_hash(texts)
    if _index is not None and _index[0] == current_hash:
        return _index[1]

    cached = embeddings.read_cache(_CACHE_PATH)
    if cached and cached.get("hash") == current_hash and len(cached.get("vectors") or []) == len(texts):
        _index = (current_hash, cached["vectors"])
        return _index[1]

    vectors = embeddings.embed_batch(texts, client=client)
    if vectors is None:
        # Not memoized: a transient Ollama outage must not disable semantic
        # search for the rest of the process's life. Next call retries.
        logger.warning("book_index: catalog embedding failed, falling back to keyword search")
        return None

    embeddings.write_cache(_CACHE_PATH, {"hash": current_hash, "vectors": vectors})
    _index = (current_hash, vectors)
    return vectors


def semantic_scores(
    books: list[dict],
    query: str,
    client: ollama.Client | None = None,
) -> list[float]:
    """Cosine similarity of `query` against each book, aligned with `books`.
    Returns [] (not zeros) when embeddings are unavailable, so callers can tell
    "no semantic signal" apart from "semantically unrelated"."""
    query = (query or "").strip()
    if not query or not books:
        return []

    query_vector = embeddings.embed_text(query, client=client)
    if not query_vector:
        return []

    vectors = build_index(books, client=client)
    if not vectors or len(vectors) != len(books):
        return []

    return [embeddings.cosine_similarity(query_vector, vector) for vector in vectors]
