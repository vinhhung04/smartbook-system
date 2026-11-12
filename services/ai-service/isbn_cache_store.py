"""Persistent "last known good" store for ISBN lookups (table ai_isbn_lookup_cache).

The in-memory cache (cache.isbn_lookup_cache) is lost on every restart. Here a
found lookup is kept for KEEP_SECONDS in the service's own Postgres with a
separate refresh time: before it, the stored result is served as is; after it,
the caller looks the code up again and falls back to the stored result only if
that new lookup finds nothing (sources down or blocking us). Best effort: any
database problem is logged and treated as a miss - never fails a lookup.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

logger = logging.getLogger("uvicorn.error")

ENABLED = os.getenv("ISBN_PERSISTENT_CACHE", "true").lower() == "true"
KEEP_SECONDS = int(os.getenv("ISBN_PERSISTENT_CACHE_KEEP_SECONDS", str(30 * 24 * 3600)))
DEFAULT_REFRESH_SECONDS = 7 * 24 * 3600


async def get(key: str) -> tuple[dict | None, bool]:
    """(stored lookup or None, still fresh?)."""
    if not ENABLED or not key:
        return None, False
    try:
        from db import get_session
        now = datetime.now(timezone.utc)
        async with get_session() as session:
            row = (await session.execute(
                text("SELECT payload, refresh_after FROM ai_isbn_lookup_cache "
                     "WHERE cache_key = :key AND expires_at > :now"),
                {"key": key, "now": now},
            )).first()
        if not row:
            return None, False
        refresh_after = row[1]
        if refresh_after is not None and refresh_after.tzinfo is None:
            refresh_after = refresh_after.replace(tzinfo=timezone.utc)
        return json.loads(row[0]), bool(refresh_after and refresh_after > now)
    except Exception as exc:  # noqa: BLE001
        logger.warning("ISBN persistent cache read skipped: %s", type(exc).__name__)
        return None, False


async def put(key: str, payload: dict, refresh_seconds: int | None) -> None:
    if not ENABLED or not key:
        return
    now = datetime.now(timezone.utc)
    params = {
        "key": key, "payload": json.dumps(payload, ensure_ascii=False, default=str),
        "expires": now + timedelta(seconds=KEEP_SECONDS),
        "refresh": now + timedelta(seconds=refresh_seconds or DEFAULT_REFRESH_SECONDS),
    }
    try:
        from db import get_session
        async with get_session() as session:
            await session.execute(
                text(
                    "INSERT INTO ai_isbn_lookup_cache (cache_key, payload, expires_at, refresh_after, updated_at) "
                    "VALUES (:key, :payload, :expires, :refresh, now()) "
                    "ON CONFLICT (cache_key) DO UPDATE SET payload = EXCLUDED.payload, "
                    "expires_at = EXCLUDED.expires_at, refresh_after = EXCLUDED.refresh_after, updated_at = now()"
                ),
                params,
            )
            await session.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("ISBN persistent cache write skipped: %s", type(exc).__name__)
