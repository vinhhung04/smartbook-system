"""Dong bo corpus BOOK_METADATA voi catalog cua inventory-service.

Truoc day corpus sach chi duoc nap luc khoi dong qua GET /api/books — endpoint
do doi JWT nguoi dung that, ma startup hook khong co token nao, nen corpus luon
rong (task_5448fb5f) va search_books / public discover chi con keyword tren
nhung quyen da duoc ingest thu cong bang reindex_embeddings.py.

Gio ai-service doc thang feed noi bo cua inventory-service
(GET /internal/catalog/books, xac thuc service-to-service bang
x-internal-service-key, khong lien quan JWT nguoi dung) va dong bo dinh ky:

- Phan trang keyset (`after` = id cuoi trang truoc) cho toi khi het catalog.
- Incremental: quyen co text + metadata + hash chunk (gom embedding identity)
  khong doi thi khong ghi gi, khong goi embedding.
- Quyen bi xoa / ngung hoat dong (khong con trong lan quet DAY DU) bi go khoi
  corpus. Lan quet loi giua chung thi KHONG xoa gi.
- Retry co backoff cho loi tam thoi (timeout, 5xx, 429); 401/403 khong retry vi
  do la cau hinh sai khoa, retry chi ton thoi gian.
- Embedding provider loi lien tiep thi dung goi embedding cho phan con lai cua
  lan chay nay (khong dap OpenRouter hang tram lan); lan sau tu thu lai vi hash
  chunk van lech.
- Khong bao gio raise ra ngoai vong lap: loi chi lam lan chay do "failed".
- Idempotent: upsert theo (corpus, source_id) va (document_id, chunk_index)
  (rang buoc UNIQUE trong schema.sql), nen chay lai/chay chong khong tao ban sao.
"""
from __future__ import annotations

import asyncio
import hmac
import logging
import os
import time
from typing import Any, Awaitable, Callable

import httpx

import book_index
import ingestion
import vector_store
from metrics import (
    ai_catalog_sync_catalog_books,
    ai_catalog_sync_documents_total,
    ai_catalog_sync_last_success_timestamp_seconds,
    ai_catalog_sync_runs_total,
)

logger = logging.getLogger("uvicorn.error")

INVENTORY_SERVICE_URL = os.getenv("INVENTORY_SERVICE_URL", "http://inventory-service:3001").rstrip("/")
CATALOG_FEED_PATH = "/internal/catalog/books"
CATALOG_SYNC_INTERVAL_SECONDS = float(os.getenv("CATALOG_SYNC_INTERVAL_SECONDS", "300"))
CATALOG_SYNC_PAGE_SIZE = int(os.getenv("CATALOG_SYNC_PAGE_SIZE", "200"))
CATALOG_SYNC_TIMEOUT_SECONDS = float(os.getenv("CATALOG_SYNC_TIMEOUT_SECONDS", "10"))
CATALOG_SYNC_MAX_ATTEMPTS = int(os.getenv("CATALOG_SYNC_MAX_ATTEMPTS", "3"))
CATALOG_SYNC_RETRY_BASE_SECONDS = float(os.getenv("CATALOG_SYNC_RETRY_BASE_SECONDS", "1"))
# Sau ngan nay lan embed that bai LIEN TIEP trong mot lan chay, ngung goi
# embedding cho cac quyen con lai (van ghi document va van go quyen da xoa).
CATALOG_SYNC_EMBED_FAILURE_LIMIT = int(os.getenv("CATALOG_SYNC_EMBED_FAILURE_LIMIT", "3"))
# Chan tren so trang: mot feed loi tra next_cursor vo han khong duoc treo vong lap.
CATALOG_SYNC_MAX_PAGES = 10_000

_RETRYABLE_STATUS = {429, 500, 502, 503, 504}


class CatalogFetchError(Exception):
    """Khong lay duoc TOAN BO catalog — lan dong bo phai dung, khong duoc xoa gi."""


def _internal_key() -> str:
    return os.getenv("INTERNAL_SERVICE_KEY", "").strip()


def is_valid_internal_key(provided: str | None) -> bool:
    """So sanh hang-thoi-gian cho cac endpoint noi bo cua chinh ai-service.
    Khoa rong (chua cau hinh) tu choi moi caller."""
    expected = _internal_key()
    return bool(expected) and hmac.compare_digest(str(provided or "").strip(), expected)


async def _sleep(seconds: float) -> None:
    # Tach rieng de test patch, khong phai cho that.
    await asyncio.sleep(seconds)


async def _fetch_page(client: httpx.AsyncClient, after: str | None) -> dict:
    params: dict[str, Any] = {"limit": CATALOG_SYNC_PAGE_SIZE}
    if after:
        params["after"] = after
    last_error = "unknown"
    for attempt in range(1, CATALOG_SYNC_MAX_ATTEMPTS + 1):
        try:
            response = await client.get(
                f"{INVENTORY_SERVICE_URL}{CATALOG_FEED_PATH}",
                params=params,
                headers={"x-internal-service-key": _internal_key()},
            )
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            last_error = type(exc).__name__
        else:
            if response.status_code in (401, 403):
                raise CatalogFetchError(
                    f"inventory-service tu choi khoa noi bo (HTTP {response.status_code}) - "
                    "kiem tra INTERNAL_SERVICE_KEY hai phia")
            if response.status_code in _RETRYABLE_STATUS:
                last_error = f"HTTP {response.status_code}"
            elif response.status_code >= 400:
                raise CatalogFetchError(f"{CATALOG_FEED_PATH} tra ve HTTP {response.status_code}")
            else:
                try:
                    payload = response.json()
                except ValueError as exc:
                    raise CatalogFetchError("feed catalog khong phai JSON") from exc
                if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
                    raise CatalogFetchError("feed catalog sai dinh dang (thieu items)")
                return payload
        if attempt < CATALOG_SYNC_MAX_ATTEMPTS:
            delay = CATALOG_SYNC_RETRY_BASE_SECONDS * (2 ** (attempt - 1))
            logger.warning(
                "catalog_sync: trang after=%s loi %s, thu lai lan %d sau %.1fs",
                after, last_error, attempt + 1, delay)
            await _sleep(delay)
    raise CatalogFetchError(f"het {CATALOG_SYNC_MAX_ATTEMPTS} lan thu: {last_error}")


async def fetch_catalog_books(client: httpx.AsyncClient | None = None) -> list[dict]:
    """Toan bo sach dang hoat dong, qua moi trang. Raise CatalogFetchError neu
    khong lay du — caller khong duoc coi mot danh sach thieu la catalog that."""
    if not _internal_key():
        raise CatalogFetchError("INTERNAL_SERVICE_KEY chua duoc cau hinh")
    owns_client = client is None
    client = client or httpx.AsyncClient(timeout=httpx.Timeout(CATALOG_SYNC_TIMEOUT_SECONDS))
    books: list[dict] = []
    seen_cursors: set[str] = set()
    after: str | None = None
    try:
        for _ in range(CATALOG_SYNC_MAX_PAGES):
            payload = await _fetch_page(client, after)
            books.extend(item for item in payload["items"] if isinstance(item, dict) and item.get("id"))
            next_cursor = payload.get("next_cursor")
            if not next_cursor:
                return books
            next_cursor = str(next_cursor)
            if next_cursor in seen_cursors:
                raise CatalogFetchError(f"feed catalog lap con tro {next_cursor}")
            seen_cursors.add(next_cursor)
            after = next_cursor
        raise CatalogFetchError(f"vuot qua {CATALOG_SYNC_MAX_PAGES} trang")
    finally:
        if owns_client:
            await client.aclose()


def _is_unchanged(state: vector_store.DocumentState | None, title: str, text: str, metadata: dict) -> bool:
    if state is None:
        return False
    expected_hash = ingestion.chunk_hash(text)
    return (
        state.content_hash == expected_hash
        and (state.title or "") == title
        and state.metadata == metadata
        and state.chunk_hashes == {0: expected_hash}
    )


_lock = asyncio.Lock()
_status: dict[str, Any] = {
    "running": False,
    "last_started_at": None,
    "last_finished_at": None,
    "last_success_at": None,
    "last_outcome": None,
    "last_error": None,
    "last_stats": None,
    "consecutive_failures": 0,
}


def get_status() -> dict:
    return dict(_status)


def _empty_stats() -> dict:
    return {
        "catalog_books": 0, "embedded": 0, "unchanged": 0, "updated_without_embedding": 0,
        "embed_failed": 0, "embed_deferred": 0, "errors": 0, "removed": 0,
        "removal_skipped": False,
    }


async def _apply(books: list[dict], stats: dict) -> None:
    store = vector_store.get_store()
    existing = await store.list_documents(vector_store.CORPUS_BOOK)
    wanted: set[str] = set()
    consecutive_embed_failures = 0

    for book in books:
        source_id = str(book["id"])
        text = book_index.book_text(book)
        if not text.strip():
            continue
        wanted.add(source_id)
        title = str(book.get("title") or "")
        metadata = ingestion.book_metadata(book)
        if _is_unchanged(existing.get(source_id), title, text, metadata):
            stats["unchanged"] += 1
            continue
        if consecutive_embed_failures >= CATALOG_SYNC_EMBED_FAILURE_LIMIT:
            # Provider dang loi: de quyen nay cho lan sau, khong ghi gi ca de
            # hash document cu van phan anh dung vector dang co.
            stats["embed_deferred"] += 1
            continue
        try:
            outcome = await ingestion._ingest_one(
                store, vector_store.CORPUS_BOOK, source_id, title, text, [text], metadata)
        except Exception as exc:
            stats["errors"] += 1
            logger.warning("catalog_sync: loi khi ingest book %s: %s", source_id, type(exc).__name__)
            continue
        if outcome.embed_failed:
            stats["embed_failed"] += 1
            consecutive_embed_failures += 1
        else:
            consecutive_embed_failures = 0
            if outcome.embedded:
                stats["embedded"] += 1
            else:
                # Chi metadata/title doi (vd ISBN), vector van dung.
                stats["updated_without_embedding"] += 1

    stale = sorted(source_id for source_id in existing if source_id not in wanted)
    if stale and not wanted:
        # Catalog tra ve 0 quyen trong khi corpus dang co du lieu: nhieu kha nang
        # la inventory tro nham DB hon la thu vien that su rong. Khong xoa hang
        # loat dua tren mot tin hieu dang ngo nhu vay.
        stats["removal_skipped"] = True
        logger.warning(
            "catalog_sync: catalog rong nhung corpus co %d quyen - bo qua buoc go bo", len(stale))
    elif stale:
        stats["removed"] = await store.delete_documents(vector_store.CORPUS_BOOK, stale)


async def sync_book_corpus(
    fetch: Callable[[], Awaitable[list[dict]]] | None = None,
) -> dict:
    """Mot lan dong bo. Tra ve ban sao status (khong raise). Neu dang co mot
    lan chay khac, tra ve ngay voi outcome "skipped_busy"."""
    if _lock.locked():
        return {**get_status(), "skipped": "busy"}
    async with _lock:
        started = time.time()
        _status.update(running=True, last_started_at=started)
        stats = _empty_stats()
        outcome = "failed"
        error: str | None = None
        try:
            books = await (fetch or fetch_catalog_books)()
            stats["catalog_books"] = len(books)
            await _apply(books, stats)
            degraded = (
                stats["embed_failed"] or stats["embed_deferred"] or stats["errors"]
                or stats["removal_skipped"]
            )
            outcome = "degraded" if degraded else "ok"
        except CatalogFetchError as exc:
            error = str(exc)
        except Exception as exc:  # noqa: BLE001 - background job must survive anything
            error = type(exc).__name__
        finished = time.time()

        ai_catalog_sync_runs_total.labels(outcome=outcome).inc()
        for action in ("embedded", "unchanged", "removed", "embed_failed", "errors"):
            if stats[action]:
                ai_catalog_sync_documents_total.labels(action=action).inc(stats[action])
        if outcome != "failed":
            ai_catalog_sync_last_success_timestamp_seconds.set(finished)
            ai_catalog_sync_catalog_books.set(stats["catalog_books"])

        _status.update(
            running=False, last_finished_at=finished, last_outcome=outcome,
            last_error=error, last_stats=stats,
            last_success_at=finished if outcome != "failed" else _status["last_success_at"],
            consecutive_failures=0 if outcome != "failed" else _status["consecutive_failures"] + 1,
        )
        log = logger.info if outcome == "ok" else logger.warning
        log(
            "catalog_sync: outcome=%s duration_ms=%.0f catalog=%d embedded=%d unchanged=%d "
            "meta_only=%d removed=%d embed_failed=%d deferred=%d errors=%d error=%s",
            outcome, (finished - started) * 1000, stats["catalog_books"], stats["embedded"],
            stats["unchanged"], stats["updated_without_embedding"], stats["removed"],
            stats["embed_failed"], stats["embed_deferred"], stats["errors"], error,
        )
        return get_status()


def next_delay_seconds(consecutive_failures: int) -> float:
    """Lan dau loi (vd inventory chua len kip luc khoi dong) thu lai nhanh,
    roi gian dan, nhung khong bao gio thua hon chu ky binh thuong."""
    if consecutive_failures <= 0:
        return CATALOG_SYNC_INTERVAL_SECONDS
    return min(CATALOG_SYNC_INTERVAL_SECONDS, 15.0 * (2 ** (consecutive_failures - 1)))


async def sync_loop() -> None:
    """Chay ngay mot lan, sau do dinh ky. CATALOG_SYNC_INTERVAL_SECONDS<=0 thi
    chi chay mot lan (con lai trigger qua POST /internal/catalog-sync)."""
    while True:
        status = await sync_book_corpus()
        if CATALOG_SYNC_INTERVAL_SECONDS <= 0 and status.get("last_outcome") != "failed":
            return
        delay = next_delay_seconds(status.get("consecutive_failures") or 0)
        await _sleep(delay if delay > 0 else 15.0)
