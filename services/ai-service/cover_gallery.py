"""Visual-embedding gallery for "find book by cover photo".

Mirrors book_index.py's two-tier cache shape (in-memory, then a durable
store) but the durable tier is the ai_cover_embeddings Postgres table instead
of a JSON file, since a container filesystem is just as ephemeral as the
in-memory dict across a `docker compose down`/recreate.

Staleness is detected the same way book_index.py detects it: a content hash
over (variant_id, cover_image_url) pairs plus the embedding model name. When
inventory-service's cover set changes, the hash changes, and only the
new/changed rows are re-downloaded and re-embedded — unchanged rows are
reused straight from Postgres.

Rebuild is triggered two ways (see routes_cover_search.py):
- Lazily, at the start of every /find-book-by-cover request (cheap no-op
  when the hash matches).
- Explicitly, via POST /find-book-by-cover/reindex, so a demo/defense can
  warm the gallery on a predictable schedule instead of paying the cost
  live in front of a committee.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
import uuid

import httpx
from sqlalchemy import select

import cover_embeddings
import embeddings
from db import get_session
from db_models import CoverEmbeddingRow

logger = logging.getLogger("uvicorn.error")

# Redeclared locally rather than imported from main.py, matching this codebase's
# own convention (see assistant_tools.py, retrieval.py, agent_permissions.py) —
# routes modules never import main.py, to avoid a circular import (main.py
# constructs the FastAPI app and includes these routers).
INVENTORY_SERVICE_URL = os.getenv("INVENTORY_SERVICE_URL", "http://inventory-service:3001").rstrip("/")
INTERNAL_SERVICE_KEY = os.getenv("INTERNAL_SERVICE_KEY", "smartbook_internal_key").strip()
COVER_FETCH_TIMEOUT_SECONDS = float(os.getenv("COVER_FETCH_TIMEOUT_SECONDS", "10"))

# (hash, gallery rows) for the most recently synced gallery. Each row:
# {variant_id, book_id, title, author, cover_image_url, vector}.
_gallery: tuple[str, list[dict]] | None = None


def _gallery_hash(items: list[dict]) -> str:
    return embeddings.content_hash({
        "model": cover_embeddings.CLIP_MODEL_NAME,
        "items": sorted([[item["variant_id"], item["cover_image_url"]] for item in items]),
    })


async def _fetch_inventory_covers() -> list[dict] | None:
    """GET inventory-service's internal cover feed. None on any failure — callers
    must degrade gracefully (keep serving the OCR-text signal alone)."""
    try:
        async with httpx.AsyncClient(timeout=COVER_FETCH_TIMEOUT_SECONDS) as client:
            response = await client.get(
                f"{INVENTORY_SERVICE_URL}/internal/covers",
                headers={"x-internal-service-key": INTERNAL_SERVICE_KEY},
            )
        if response.status_code >= 400:
            logger.warning("cover_gallery: /internal/covers returned HTTP %d", response.status_code)
            return None
        items = response.json().get("items")
        return items if isinstance(items, list) else []
    except Exception as exc:
        logger.warning("cover_gallery: could not reach inventory-service: %s", type(exc).__name__)
        return None


async def _download_image(url: str) -> bytes | None:
    try:
        async with httpx.AsyncClient(timeout=COVER_FETCH_TIMEOUT_SECONDS, follow_redirects=True) as client:
            response = await client.get(url)
        if response.status_code >= 400 or not response.content:
            return None
        return response.content
    except Exception as exc:
        logger.warning("cover_gallery: could not download cover image: %s", type(exc).__name__)
        return None


async def _sync(items: list[dict]) -> dict:
    """Reconcile the durable table against `items` (inventory-service's current
    cover list): reuse unchanged rows, embed new/changed ones, drop rows for
    variants no longer present. Returns {indexed, reused, removed, duration_ms}
    and refreshes the in-memory cache."""
    global _gallery

    started_at = time.monotonic()
    live_variant_ids = {str(item["variant_id"]) for item in items}
    indexed = 0
    reused = 0
    removed = 0
    rows: list[dict] = []

    async with get_session() as session:
        result = await session.execute(select(CoverEmbeddingRow))
        existing_by_variant = {str(row.variant_id): row for row in result.scalars().all()}

        for item in items:
            variant_id = str(item["variant_id"])
            cover_url = item.get("cover_image_url")
            if not cover_url:
                continue

            existing = existing_by_variant.get(variant_id)
            if existing and existing.cover_image_url == cover_url and existing.model_name == cover_embeddings.CLIP_MODEL_NAME:
                rows.append({
                    "variant_id": variant_id,
                    "book_id": str(existing.book_id),
                    "title": existing.title,
                    "author": existing.author,
                    "cover_image_url": existing.cover_image_url,
                    "vector": existing.embedding,
                })
                reused += 1
                continue

            image_bytes = await _download_image(cover_url)
            if image_bytes is None:
                continue
            vector = await asyncio.to_thread(cover_embeddings.embed_image, image_bytes)
            if vector is None:
                continue

            if existing:
                existing.title = item.get("title")
                existing.author = item.get("author")
                existing.cover_image_url = cover_url
                existing.model_name = cover_embeddings.CLIP_MODEL_NAME
                existing.embedding = vector
            else:
                session.add(CoverEmbeddingRow(
                    # Explicit str -> uuid.UUID, matching agent_store.py's own
                    # convention — the Uuid column type isn't relied on to coerce
                    # a plain string from the inventory-service JSON response.
                    variant_id=uuid.UUID(variant_id),
                    book_id=uuid.UUID(str(item["book_id"])),
                    title=item.get("title"),
                    author=item.get("author"),
                    cover_image_url=cover_url,
                    model_name=cover_embeddings.CLIP_MODEL_NAME,
                    embedding=vector,
                ))
            rows.append({
                "variant_id": variant_id,
                "book_id": str(item["book_id"]),
                "title": item.get("title"),
                "author": item.get("author"),
                "cover_image_url": cover_url,
                "vector": vector,
            })
            indexed += 1

        for variant_id, existing in existing_by_variant.items():
            if variant_id not in live_variant_ids:
                await session.delete(existing)
                removed += 1

        await session.commit()

    _gallery = (_gallery_hash(items), rows)
    duration_ms = round((time.monotonic() - started_at) * 1000)
    logger.info(
        "cover_gallery: synced (indexed=%d reused=%d removed=%d duration_ms=%d)",
        indexed, reused, removed, duration_ms,
    )
    return {"indexed": indexed, "reused": reused, "removed": removed, "duration_ms": duration_ms}


async def get_gallery() -> list[dict]:
    """Lazy path: cheap hash check against inventory-service's live cover list;
    only re-syncs when something actually changed. Returns [] (not raising) if
    inventory-service is unreachable — callers must fall back to the OCR-text
    signal alone."""
    global _gallery

    items = await _fetch_inventory_covers()
    if items is None:
        return _gallery[1] if _gallery else []
    if not items:
        _gallery = ("", [])
        return []

    current_hash = _gallery_hash(items)
    if _gallery is not None and _gallery[0] == current_hash:
        return _gallery[1]

    await _sync(items)
    return _gallery[1] if _gallery else []


async def rebuild() -> dict:
    """Explicit, unconditional resync — used by POST /find-book-by-cover/reindex
    to warm the gallery on demand (e.g. right before a demo) instead of paying
    the cost on the first live request."""
    items = await _fetch_inventory_covers()
    if items is None:
        return {"indexed": 0, "reused": 0, "removed": 0, "duration_ms": 0, "error": "inventory-service unreachable"}
    return await _sync(items)
