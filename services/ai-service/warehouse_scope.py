"""Warehouse scope for stored copilot data (history, snapshots, cache).

Live answers are already scope-safe: every tool calls the analytics /
inventory APIs with the user's own token, and those services filter by the
user's warehouse scope. What they cannot see is data this service STORED
earlier - a chart snapshot, the cached answer of a repeated question, a
reopened conversation. A user whose access to a warehouse was revoked must not
get that warehouse's figures back through them.

Policy (fail-closed, same source as the other services: auth-service's
GET /internal/users/{id}/warehouse-scopes with INTERNAL_SERVICE_KEY):
- a stored turn records the warehouse ids its data came from;
- it is shown / reused only while every one of those ids is still readable;
- otherwise the stored turn is masked when read (the row itself is kept) and a
  chart follow-up re-reads the data through the tools, which apply today's
  scope;
- superuser: always readable; scope unreadable (auth down): treated as "not
  readable" for any turn that holds warehouse data.
"""
from __future__ import annotations

import logging
import os
import time
from typing import Any, Iterable

import httpx

logger = logging.getLogger(__name__)

AUTH_URL = (os.getenv("AUTH_SERVICE_INTERNAL_URL") or os.getenv("AUTH_SERVICE_URL") or "http://auth-service:3002").rstrip("/")
TTL_SECONDS = float(os.getenv("WAREHOUSE_SCOPE_TTL_SECONDS", "30"))
READ_LEVELS = {"READ", "READ_ONLY", "WRITE", "OPERATOR", "FULL"}
WRITE_LEVELS = {"WRITE", "OPERATOR", "FULL"}
_KEYS = ("warehouse_id", "from_warehouse_id", "to_warehouse_id")

_cache: dict[str, tuple[float, tuple]] = {}  # user id -> (read time, (readable, writable))

MASKED_NOTICE = ("Nội dung này chứa số liệu của kho mà tài khoản của bạn hiện không còn quyền xem, nên đã được ẩn. "
                 "Bản ghi gốc vẫn được lưu; hãy hỏi lại để xem dữ liệu trong phạm vi hiện tại.")
UNVERIFIED_NOTICE = ("Không xác minh được quyền kho của tài khoản lúc này, nên nội dung có số liệu theo kho của lượt này "
                     "tạm thời được ẩn.")


class ScopeUnavailable(Exception):
    pass


def warehouse_ids_in(obj: Any, out: set[str] | None = None) -> set[str]:
    """Every warehouse id a stored tool result names (any depth)."""
    out = set() if out is None else out
    if isinstance(obj, dict):
        for key, value in obj.items():
            if key in _KEYS and isinstance(value, str) and value:
                out.add(value)
            elif isinstance(value, (dict, list)):
                warehouse_ids_in(value, out)
    elif isinstance(obj, list):
        for item in obj:
            warehouse_ids_in(item, out)
    return out


async def readable_warehouses(user_ctx, *, client: httpx.AsyncClient | None = None) -> frozenset[str] | None:
    """None = every warehouse (superuser); otherwise the readable ids.
    Raises ScopeUnavailable when the scope cannot be read."""
    if user_ctx is None or not getattr(user_ctx, "user_id", None):
        return frozenset()
    if getattr(user_ctx, "is_superuser", False):
        return None
    return (await _scopes(user_ctx, client))[0]


async def writable_warehouses(user_ctx, *, client: httpx.AsyncClient | None = None) -> frozenset[str] | None:
    """None = every warehouse (superuser); otherwise the ids the user may
    write in (WRITE / OPERATOR / FULL). Raises ScopeUnavailable."""
    if user_ctx is None or not getattr(user_ctx, "user_id", None):
        return frozenset()
    if getattr(user_ctx, "is_superuser", False):
        return None
    return (await _scopes(user_ctx, client))[1]


async def _scopes(user_ctx, client: httpx.AsyncClient | None) -> tuple:
    user_id = str(user_ctx.user_id)
    hit = _cache.get(user_id)
    if hit and time.monotonic() - hit[0] < TTL_SECONDS:
        return hit[1]
    key = os.getenv("INTERNAL_SERVICE_KEY", "").strip()
    if not key:
        raise ScopeUnavailable("INTERNAL_SERVICE_KEY is not set")
    try:
        if client is None:
            async with httpx.AsyncClient(timeout=3.0) as own:
                response = await own.get(f"{AUTH_URL}/internal/users/{user_id}/warehouse-scopes",
                                         headers={"x-internal-service-key": key})
        else:
            response = await client.get(f"{AUTH_URL}/internal/users/{user_id}/warehouse-scopes",
                                        headers={"x-internal-service-key": key})
    except httpx.HTTPError as exc:
        raise ScopeUnavailable(str(exc)) from exc
    if response.status_code == 404:
        value: tuple = (frozenset(), frozenset())
    elif response.status_code != 200:
        raise ScopeUnavailable(f"auth-service answered {response.status_code}")
    else:
        body = (response.json() or {}).get("data") or {}
        if body.get("status") != "ACTIVE" or body.get("deleted"):
            value = (frozenset(), frozenset())
        elif body.get("is_superuser"):
            value = (None, None)
        else:
            def ids(levels):
                return frozenset(str(s.get("warehouse_id")) for s in body.get("scopes") or []
                                 if str(s.get("access_level", "")).upper() in levels and s.get("warehouse_id"))
            value = (ids(READ_LEVELS), ids(WRITE_LEVELS))
    _cache[user_id] = (time.monotonic(), value)
    return value


def covered(ids: Iterable[str], readable: frozenset[str] | None) -> bool:
    ids = set(ids)
    return not ids or readable is None or ids <= readable


async def can_view(user_ctx, ids: Iterable[str]) -> bool:
    """Whether stored data naming these warehouses may be shown to the user now.
    Fail-closed: scope unreadable -> False for any warehouse data."""
    ids = set(ids)
    if not ids:
        return True
    try:
        return covered(ids, await readable_warehouses(user_ctx))
    except ScopeUnavailable:
        logger.warning("warehouse scope unavailable; withholding stored warehouse data")
        return False


def clear_cache() -> None:
    _cache.clear()
