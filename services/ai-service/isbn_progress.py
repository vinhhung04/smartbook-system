"""Per-request progress telemetry for the ISBN lookup, streamed as SSE.

Observation only: `emit()` is a no-op unless the current request opened a
progress channel, it never raises, and nothing here changes which sources are
asked, in what order, with which timeouts, retries, cooldowns or cache - the
lookup runs exactly as it does behind the plain JSON endpoints.

Isolation: the sink lives in a ContextVar set only for the task that runs one
request's lookup. asyncio copies the context into every task that lookup
creates (Round 2's gather, the AI web-search lane), so their events reach the
same request and never another one.

Events carry statuses, counts, durations and reason codes only - never raw
exception text or provider response bodies.
"""
from __future__ import annotations

import asyncio
import itertools
import json
import logging
import re
import time
from contextvars import ContextVar
from typing import Any, AsyncIterator, Awaitable, Callable

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder

logger = logging.getLogger(__name__)

_sink: ContextVar[Callable[[dict], None] | None] = ContextVar("isbn_progress_sink", default=None)

# Lookups whose client went away keep running to completion (so the result is
# cached exactly as a plain request would cache it); this only holds their
# references until they finish.
_detached: set[asyncio.Task] = set()

HEARTBEAT_SECONDS = 10.0

# Error strings that are ours and safe to show: "HTTP 403", or the pause note
# written by isbn_rounds.call_with_retry. Anything else is reduced to the status.
_PUBLIC_ERROR = re.compile(r"^(HTTP \d{3}|Tạm dừng đến \S+ sau HTTP \d{3})$")
_OUTCOME_KEYS = ("source", "round", "query", "status", "durationMs", "attempts", "verification",
                 "matchConfidence", "reason")


def emit(event_type: str, **data: Any) -> None:
    """Report one progress event to the current request's channel, if any."""
    sink = _sink.get()
    if sink is None:
        return
    try:
        sink({"type": event_type, **{key: value for key, value in data.items() if value is not None}})
    except Exception:  # telemetry must never break a lookup
        logger.debug("progress event dropped", exc_info=True)


def active() -> bool:
    return _sink.get() is not None


def public_outcome(outcome: dict) -> dict:
    """A source outcome (isbn_rounds._outcome/_skipped) reduced to safe fields."""
    out = {key: outcome[key] for key in _OUTCOME_KEYS if outcome.get(key) not in (None, "")}
    url = outcome.get("sourceUrl")
    if isinstance(url, str) and url.startswith(("http://", "https://")):
        out["sourceUrl"] = url
    error = outcome.get("error")
    if isinstance(error, str) and _PUBLIC_ERROR.match(error):
        out["errorCode"] = error
    return out


def source_started(round_no: int, source: str, query: str) -> None:
    emit("source", state="started", round=round_no, source=source, query=query)


def source_done(outcome: dict) -> None:
    if active():
        emit("source", state="done", **public_outcome(outcome))


def stage(name: str, state: str, **detail: Any) -> None:
    emit("stage", stage=name, state=state, detail=detail or None)


def _forget(task: asyncio.Task) -> None:
    _detached.discard(task)
    if not task.cancelled() and task.exception() is not None:  # marks it retrieved when nobody listened
        logger.debug("detached ISBN lookup failed: %s", type(task.exception()).__name__)


def _sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(jsonable_encoder(data), ensure_ascii=False)}\n\n"


def _public_error(exc: BaseException) -> dict:
    if isinstance(exc, HTTPException) and isinstance(exc.detail, str):
        return {"status": exc.status_code, "message": exc.detail}
    return {"status": 500, "message": "Tra cứu thất bại"}


async def stream(run: Callable[[], Awaitable[dict]], heartbeat: float = HEARTBEAT_SECONDS) -> AsyncIterator[str]:
    """SSE body: `progress` events while `run()` works, then exactly one `result`
    (the same JSON the plain endpoint returns) or `error` event."""
    queue: asyncio.Queue[dict] = asyncio.Queue()
    sequence = itertools.count(1)
    started = time.perf_counter()

    def sink(event: dict) -> None:
        queue.put_nowait({**event, "seq": next(sequence), "t": int((time.perf_counter() - started) * 1000)})

    token = _sink.set(sink)
    try:
        task = asyncio.create_task(run())  # copies the context: the sink travels with this request only
    finally:
        _sink.reset(token)
    _detached.add(task)
    task.add_done_callback(_forget)

    getter: asyncio.Future | None = None
    try:
        yield ": open\n\n"
        while True:
            if getter is None:
                getter = asyncio.ensure_future(queue.get())
            done, _ = await asyncio.wait({getter, task}, timeout=heartbeat, return_when=asyncio.FIRST_COMPLETED)
            if getter in done:
                yield _sse("progress", getter.result())
                getter = None
                continue
            if task in done:
                break
            yield ": ping\n\n"
        while not queue.empty():
            yield _sse("progress", queue.get_nowait())
        error = task.exception()
        if error is None:
            yield _sse("result", task.result())
        else:
            logger.warning("ISBN lookup stream failed: %s", type(error).__name__)
            yield _sse("error", _public_error(error))
    finally:
        if getter is not None:
            getter.cancel()
        # A client that disconnected does not cancel the lookup: it finishes and is
        # cached as a plain request would be, so a retry is answered from the cache.
