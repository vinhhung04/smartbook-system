"""Anonymous "Không biết nên đọc gì?" for the public website.

The reader describes what they want in their own words; the answer is a list
of books that EXIST in the SmartBook catalog, never generated text:

1. Retrieval reuses the hybrid search the assistant already uses (pgvector
   cosine above book_index.BOOK_SEMANTIC_THRESHOLD + Postgres full-text,
   merged with fusion.reciprocal_rank_fusion, judged by retrieval_confidence).
   No LLM is called, so nothing can be hallucinated.
2. Grounding: every hit is re-read from inventory-service's public catalog
   (/public/catalog/books?ids=...). A vector-store row for a deleted,
   deactivated or placeholder book simply doesn't come back and is dropped.
   The returned book objects are the public catalog's own whitelisted shape.

Cost control (each query costs one OpenRouter embedding call): the gateway
rate-limits /public/discover per client IP, this module caps the total
anonymous budget across everyone and caches identical queries.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time

import httpx
from fastapi import APIRouter, HTTPException, Query

import book_index
import embeddings
import fusion
import retrieval_confidence
import vector_store
from cache import RateLimiter
from intent import normalize_text

logger = logging.getLogger("uvicorn.error")

router = APIRouter(tags=["public-discover"])

INVENTORY_SERVICE_URL = os.getenv("INVENTORY_SERVICE_URL", "http://inventory-service:3001").rstrip("/")
DISCOVER_RESULT_LIMIT = int(os.getenv("PUBLIC_DISCOVER_RESULT_LIMIT", "12"))
DISCOVER_CACHE_TTL_SECONDS = int(os.getenv("PUBLIC_DISCOVER_CACHE_TTL_SECONDS", "600"))
DISCOVER_CACHE_MAX = 300
CATALOG_TIMEOUT_SECONDS = float(os.getenv("PUBLIC_DISCOVER_CATALOG_TIMEOUT_SECONDS", "8"))
MIN_QUERY_CHARS = 3
MAX_QUERY_CHARS = 200

# Library-wide ceiling on embedding calls from anonymous visitors (cache hits
# don't count). Per-visitor limits live at the gateway, where the real client
# IP is known; here every request arrives from the gateway's address.
_budget = RateLimiter(
    requests_per_minute=int(os.getenv("PUBLIC_DISCOVER_GLOBAL_RPM", "30")),
    requests_per_hour=int(os.getenv("PUBLIC_DISCOVER_GLOBAL_RPH", "300")),
)
_cache: dict[str, tuple[float, dict]] = {}


def _cache_get(key: str) -> dict | None:
    entry = _cache.get(key)
    if entry and entry[0] > time.monotonic():
        return entry[1]
    _cache.pop(key, None)
    return None


def _cache_set(key: str, value: dict) -> None:
    if len(_cache) >= DISCOVER_CACHE_MAX:
        now = time.monotonic()
        for stale in [k for k, (expires, _) in _cache.items() if expires <= now]:
            _cache.pop(stale, None)
        if len(_cache) >= DISCOVER_CACHE_MAX:
            _cache.pop(next(iter(_cache)))
    _cache[key] = (time.monotonic() + DISCOVER_CACHE_TTL_SECONDS, value)


async def _fetch_public_books(ids: list[str]) -> dict[str, dict]:
    """The grounding step: only books the public catalog returns survive."""
    if not ids:
        return {}
    async with httpx.AsyncClient(timeout=CATALOG_TIMEOUT_SECONDS) as client:
        response = await client.get(
            f"{INVENTORY_SERVICE_URL}/public/catalog/books",
            params={"ids": ",".join(ids), "pageSize": str(len(ids))},
        )
    response.raise_for_status()
    rows = response.json().get("data") or []
    return {str(row["id"]): row for row in rows if isinstance(row, dict) and row.get("id")}


def ground_results(fused: list, semantic: list, keyword: list, books_by_id: dict[str, dict], limit: int) -> list[dict]:
    """Keep fused order, drop anything the catalog didn't confirm, and say which
    measurable signal matched each book (never an LLM's opinion)."""
    semantic_ids = {hit.source_id for hit in semantic}
    keyword_ids = {hit.source_id for hit in keyword}
    results = []
    for hit in fused:
        book = books_by_id.get(hit.source_id)
        if book is None:
            continue
        matched = []
        if hit.source_id in semantic_ids:
            matched.append("semantic")
        if hit.source_id in keyword_ids:
            matched.append("keyword")
        results.append({"book": book, "matched": matched})
        if len(results) >= limit:
            break
    return results


async def discover(query: str) -> dict:
    store = vector_store.get_store()
    embed_result = await asyncio.to_thread(embeddings.embed_text, query)
    k = DISCOVER_RESULT_LIMIT * 3
    semantic = (
        [
            hit for hit in await store.search_semantic(
                vector_store.CORPUS_BOOK, embed_result.vector, k=k, embedding_model=embed_result.model)
            if hit.score >= book_index.BOOK_SEMANTIC_THRESHOLD
        ]
        if embed_result is not None else []
    )
    keyword = await store.search_keyword(vector_store.CORPUS_BOOK, query, k=k)
    fused = fusion.reciprocal_rank_fusion([semantic, keyword], limit=k)

    signals = retrieval_confidence.extract_signals(
        vector_store.CORPUS_BOOK, semantic, keyword, fused, semantic_available=embed_result is not None)
    confidence = retrieval_confidence.evaluate(signals, retrieval_confidence.BOOK_CONFIDENCE)
    retrieval_confidence.log_decision(confidence)

    if confidence.decision == retrieval_confidence.NO_EVIDENCE:
        return {"status": confidence.decision, "semantic_used": embed_result is not None, "results": []}

    books_by_id = await _fetch_public_books(list(dict.fromkeys(hit.source_id for hit in fused))[:48])
    return {
        "status": confidence.decision,
        "semantic_used": embed_result is not None,
        "results": ground_results(fused, semantic, keyword, books_by_id, DISCOVER_RESULT_LIMIT),
    }


@router.get("/public/discover")
async def public_discover(q: str = Query("", max_length=MAX_QUERY_CHARS * 2)):
    query = " ".join(str(q or "").split())
    if len(query) < MIN_QUERY_CHARS:
        raise HTTPException(status_code=400, detail="Hãy mô tả ít nhất vài chữ về cuốn sách bạn muốn đọc.")
    query = query[:MAX_QUERY_CHARS]

    cache_key = normalize_text(query)
    cached = _cache_get(cache_key)
    if cached is not None:
        return {**cached, "query": query, "cached": True}

    allowed, _reason = await _budget.acquire("public-discover")
    if not allowed:
        raise HTTPException(status_code=429, detail="Gợi ý bằng AI đang quá tải. Thử tìm theo từ khóa.")

    try:
        payload = await discover(query)
    except Exception as exc:  # noqa: BLE001 - degrade to keyword search on the client
        logger.warning("public_discover failed: %s", type(exc).__name__)
        raise HTTPException(status_code=503, detail="Gợi ý bằng AI tạm thời không khả dụng.") from exc

    _cache_set(cache_key, payload)
    return {**payload, "query": query, "cached": False}
