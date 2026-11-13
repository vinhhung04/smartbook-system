"""Two-round ISBN/barcode search.

Round 1 - identify the book by its code. Code-capable providers are asked one
at a time, in a configured order. A result only counts when the code printed
on the provider's record equals the scanned code; the first verified hit stops
Round 1. No hit -> the lookup ends with no metadata (no title guessing).

Round 2 - cross-check. Every enabled provider is asked (in parallel), never
stopping early because the metadata already looks complete: by code where the
provider supports it and was not already asked in Round 1, then by the
identified title/author. A title result is accepted only if it is verifiably
the same edition (same code) or, when it carries no comparable code, the same
work (title + authors) - in which case it only contributes work-level fields.

Providers are plain async callables injected by main.py (no import of main),
so this module is unit tested with fakes in test_isbn_rounds.py.
"""
from __future__ import annotations

import asyncio
import logging
import os
import ssl
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Awaitable, Callable

import certifi
import httpx

import isbn_matching
import isbn_progress as progress  # observation only: no-op unless a request opened a progress stream

logger = logging.getLogger(__name__)

# Seconds before the n-th retry is backoff * 2**n. Module-level so tests can zero it.
RETRY_BACKOFF_SECONDS = 0.5

# ── Politeness: never hammer a site, back off as soon as it says no ───────────
# Minimum gap between two requests to the same host, shared by every lookup in
# this process (a lookup can hit one store several times: search + pages).
MIN_REQUEST_INTERVAL_SECONDS = float(os.getenv("BOOK_SOURCE_MIN_INTERVAL_SECONDS", "0.5"))
# A 403/429 pauses that source; repeated blocks double the pause up to the max.
BLOCK_COOLDOWN_SECONDS = float(os.getenv("BOOK_SOURCE_BLOCK_COOLDOWN_SECONDS", "900"))
BLOCK_COOLDOWN_MAX_SECONDS = float(os.getenv("BOOK_SOURCE_BLOCK_COOLDOWN_MAX_SECONDS", "21600"))
BLOCK_STATUSES = {403, 429}

class SourcePaused(RuntimeError):
    """Raised by a provider that must not be called right now (e.g. its spending
    limit is reached). Reported as PAUSED with the message, never retried."""


# One TLS context for every provider call. Building it (loading the CA bundle)
# is synchronous and took 0.4-0.7 s per client on Windows, blocking the event
# loop - so the "parallel" AI lane waited on the sequential providers.
_SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())

_host_next_slot: dict[str, float] = {}
_host_locks: dict[str, asyncio.Lock] = {}
_breakers: dict[str, dict] = {}  # source -> {"until", "untilAt", "strikes", "reason"}


def reset_politeness_state() -> None:
    """Forget throttling and paused sources (tests; also safe at runtime)."""
    _host_next_slot.clear()
    _host_locks.clear()
    _breakers.clear()


def paused_until(source: str) -> dict | None:
    state = _breakers.get(source)
    if state and state["until"] > time.monotonic():
        return state
    return None


def _retry_after_seconds(response: httpx.Response | None) -> float | None:
    value = (response.headers.get("Retry-After") if response is not None else None) or ""
    return float(value) if value.strip().isdigit() else None


def _trip(source: str, status: int, retry_after: float | None) -> None:
    previous = _breakers.get(source) or {"strikes": 0}
    strikes = previous["strikes"] + 1
    pause = retry_after or min(BLOCK_COOLDOWN_SECONDS * (2 ** (strikes - 1)), BLOCK_COOLDOWN_MAX_SECONDS)
    until_at = datetime.now(timezone.utc).timestamp() + pause
    _breakers[source] = {
        "until": time.monotonic() + pause, "strikes": strikes, "reason": f"HTTP {status}",
        "untilAt": datetime.fromtimestamp(until_at, timezone.utc).isoformat(timespec="seconds"),
    }
    logger.warning("Book source %s paused for %ds after HTTP %d (strike %d)", source, pause, status, strikes)


async def _throttle(request: httpx.Request) -> None:
    host = request.url.host
    lock = _host_locks.setdefault(host, asyncio.Lock())
    async with lock:
        wait = _host_next_slot.get(host, 0.0) - time.monotonic()
        if wait > 0:
            await asyncio.sleep(wait)
        _host_next_slot[host] = time.monotonic() + MIN_REQUEST_INTERVAL_SECONDS


CodeSearch = Callable[[httpx.AsyncClient, str], Awaitable[dict | None]]
TitleSearch = Callable[[httpx.AsyncClient, str, str | None], Awaitable[list[dict]]]

FOUND_STATUSES = {"SUCCESS"}
FAILED_STATUSES = {"TIMEOUT", "ERROR", "PAUSED"}
REJECTED_STATUSES = {"MISMATCH", "DIFFERENT_EDITION"}


@dataclass(frozen=True)
class BookProvider:
    """One book source. `by_code`/`by_title` return metadata dicts in the
    common lookup shape plus `identifiers` (codes printed on the record) and
    `sourceUrl`. `round1` = may identify a book (its code search is exact and
    verifiable). `disabled_reason` set -> never called, reported as DISABLED."""
    name: str
    by_code: CodeSearch | None = None
    by_title: TitleSearch | None = None
    round1: bool = False
    accepts_raw_barcode: bool = False
    timeout: float = 10.0
    retries: int = 1
    disabled_reason: str | None = None
    user_agent: str | None = None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _is_transient(exc: BaseException) -> bool:
    if isinstance(exc, (asyncio.TimeoutError, httpx.TimeoutException, httpx.TransportError)):
        return True
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code >= 500
    return False


async def call_with_retry(provider: BookProvider, make_call: Callable[[httpx.AsyncClient], Awaitable]) -> dict:
    """Run one provider call with its own client, timeout and bounded retries.
    Never raises. Returns {"status": OK|TIMEOUT|ERROR, "value", "attempts",
    "durationMs", "error"}; only timeouts, network errors and 5xx are retried
    (a 404/429 or a parser bug will not get better by asking again)."""
    started = time.perf_counter()
    paused = paused_until(provider.name)
    if paused:
        # The site blocked us recently: do not knock again until the pause ends.
        return {"status": "PAUSED", "value": None, "attempts": 0, "durationMs": 0,
                "error": f"Tạm dừng đến {paused['untilAt']} sau {paused['reason']}"}
    status, error, attempts = "ERROR", None, 0
    headers = {"User-Agent": provider.user_agent} if provider.user_agent else None
    for attempt in range(provider.retries + 1):
        attempts = attempt + 1
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(provider.timeout), headers=headers, verify=_SSL_CONTEXT,
                                         follow_redirects=True, event_hooks={"request": [_throttle]}) as client:
                value = await asyncio.wait_for(make_call(client), timeout=provider.timeout)
            _breakers.pop(provider.name, None)
            return {"status": "OK", "value": value, "attempts": attempts, "error": None,
                    "durationMs": int((time.perf_counter() - started) * 1000)}
        except BaseException as exc:  # noqa: BLE001 - one provider must never break the lookup
            if isinstance(exc, asyncio.CancelledError):
                raise
            if isinstance(exc, SourcePaused):
                return {"status": "PAUSED", "value": None, "attempts": attempts, "error": str(exc),
                        "durationMs": int((time.perf_counter() - started) * 1000)}
            status = "TIMEOUT" if isinstance(exc, (asyncio.TimeoutError, httpx.TimeoutException)) else "ERROR"
            error = f"{type(exc).__name__}: {str(exc)[:160]}"
            if isinstance(exc, httpx.HTTPStatusError):
                code = exc.response.status_code
                error = f"HTTP {code}"
                if code in BLOCK_STATUSES:
                    _trip(provider.name, code, _retry_after_seconds(exc.response))
                    break
            if not _is_transient(exc) or attempt == provider.retries:
                break
            await asyncio.sleep(RETRY_BACKOFF_SECONDS * (2 ** attempt))
    logger.warning("Book provider %s failed after %d attempt(s): %s", provider.name, attempts, error)
    return {"status": status, "value": None, "attempts": attempts, "error": error,
            "durationMs": int((time.perf_counter() - started) * 1000)}


def _outcome(provider: str, round_no: int, query: str, call: dict, status: str, **extra) -> dict:
    out = {
        "source": provider, "round": round_no, "query": query, "status": status,
        "durationMs": call.get("durationMs", 0), "attempts": call.get("attempts", 0), "retrievedAt": _now(),
    }
    if call.get("error"):
        out["error"] = call["error"]
    out.update({k: v for k, v in extra.items() if v is not None})
    return out


def _stamp(data: dict, round_no: int, query: str, verification: str, confidence: float, retrieved_at: str) -> dict:
    return {**data, "_provenance": {
        "round": round_no, "query": query, "verification": verification,
        "matchConfidence": confidence, "retrievedAt": retrieved_at,
    }}


# ── Round 1 ───────────────────────────────────────────────────────────────────

def _code_result(provider: BookProvider, call: dict, round_no: int, targets: set[str]) -> tuple[dict | None, dict]:
    """(verified identity data | None, outcome) for one code search call."""
    if call["status"] != "OK":
        return None, _outcome(provider.name, round_no, "code", call, call["status"])
    data = call["value"]
    if not data or not data.get("title"):
        return None, _outcome(provider.name, round_no, "code", call, "NOT_FOUND")
    verdict = isbn_matching.compare_codes(data.get("identifiers"), targets)
    if verdict != "MATCH":
        # Wrong code, or a page that does not show the code at all: not proof of identity.
        return None, _outcome(provider.name, round_no, "code", call, "MISMATCH",
                              sourceUrl=data.get("sourceUrl"), reason=f"CODE_{verdict}")
    outcome = _outcome(provider.name, round_no, "code", call, "SUCCESS", sourceUrl=data.get("sourceUrl"),
                       verification="CODE_MATCH", matchConfidence=1.0)
    return _stamp(data, round_no, "code", "CODE_MATCH", 1.0, outcome["retrievedAt"]), outcome


def _skipped(name: str, reason: str, status: str = "SKIPPED") -> dict:
    return {"source": name, "round": 1, "query": "code", "status": status, "reason": reason,
            "durationMs": 0, "attempts": 0}


async def run_round1(providers: list[BookProvider], code: str, targets: set[str], valid_isbn: bool,
                     parallel: BookProvider | None = None, parallel_after: str | None = None) -> dict:
    """Sequential, stop at the first verified code match.

    `parallel` (the AI web search lane) runs concurrently with the sequential
    providers, started once `parallel_after` (the library catalog) has missed -
    a book already in the catalog never costs an AI call. A sequential match
    wins; the lane only identifies the book when no sequential provider did.
    Returns {"identity", "data", "outcomes", "parallelTask"} - parallelTask is
    the still-running lane when a sequential provider matched (Round 2 uses it)."""
    outcomes: list[dict] = []
    identity, identity_data = None, None
    lane: asyncio.Task | None = None

    def start_lane() -> None:
        nonlocal lane
        if parallel is None or lane is not None or identity is not None:
            return
        if parallel.disabled_reason or (not valid_isbn and not parallel.accepts_raw_barcode):
            return
        lane = asyncio.create_task(call_with_retry(parallel, lambda client: parallel.by_code(client, code)))
        progress.source_started(1, parallel.name, "code")

    def record(outcome: dict) -> None:
        outcomes.append(outcome)
        progress.source_done(outcome)

    progress.stage("round1", "started", order=[p.name for p in providers] + ([parallel.name] if parallel else []))
    if parallel_after is None:
        start_lane()
    for provider in providers:
        if identity:
            record(_skipped(provider.name, "ROUND1_ALREADY_MATCHED"))
            continue
        if provider.disabled_reason:
            record(_skipped(provider.name, provider.disabled_reason, "DISABLED"))
        elif not valid_isbn and not provider.accepts_raw_barcode:
            record(_skipped(provider.name, "CODE_NOT_SUPPORTED"))
        else:
            progress.source_started(1, provider.name, "code")
            call = await call_with_retry(provider, lambda client, p=provider: p.by_code(client, code))
            data, outcome = _code_result(provider, call, 1, targets)
            record(outcome)
            if data:
                identity, identity_data = provider.name, data
        if provider.name == parallel_after:
            start_lane()
    start_lane()  # parallel_after not in the list

    if parallel is not None and lane is None:
        if parallel.disabled_reason:
            record(_skipped(parallel.name, parallel.disabled_reason, "DISABLED"))
        elif identity == parallel_after:
            record(_skipped(parallel.name, "BOOK_IN_CATALOG"))
        else:
            record(_skipped(parallel.name, "CODE_NOT_SUPPORTED"))
    elif lane is not None and identity is None:
        data, outcome = _code_result(parallel, await lane, 1, targets)
        record(outcome)
        if data:
            identity, identity_data = parallel.name, data
        lane = None
    # A lane still running here (a sequential source matched) reports in Round 2.
    progress.stage("round1", "done", matchedSource=identity)
    return {"identity": identity, "data": identity_data, "outcomes": outcomes,
            "parallelTask": lane, "parallelProvider": parallel}


# ── Round 2 ───────────────────────────────────────────────────────────────────

def _judge_title_candidate(identity: dict, candidate: dict, targets: set[str]) -> tuple[str, float]:
    if not candidate or not candidate.get("title"):
        return "NONE", 0.0
    verdict = isbn_matching.compare_codes(candidate.get("identifiers"), targets)
    if verdict == "MATCH":
        return "CODE_MATCH", 1.0
    if verdict == "MISMATCH":
        same = isbn_matching.title_similarity(identity.get("title"), candidate.get("title")) >= 0.9
        return ("DIFFERENT_EDITION" if same else "NONE"), 0.0
    confidence = isbn_matching.same_work_confidence(identity, candidate)
    return ("TITLE_MATCH", confidence) if confidence else ("NONE", 0.0)


async def _round2_provider(provider: BookProvider, identity: dict, code: str, targets: set[str],
                           ask_code: bool) -> tuple[dict | None, dict]:
    """(verified metadata | None, outcome) for one provider."""
    last_call, rejected_url = {"durationMs": 0, "attempts": 0}, None
    total_ms, total_attempts = 0, 0
    if ask_code and provider.by_code:
        progress.source_started(2, provider.name, "code")
        call = await call_with_retry(provider, lambda client: provider.by_code(client, code))
        total_ms, total_attempts, last_call = call["durationMs"], call["attempts"], call
        data = call["value"] if call["status"] == "OK" else None
        if data and data.get("title") and isbn_matching.compare_codes(data.get("identifiers"), targets) == "MATCH":
            outcome = _outcome(provider.name, 2, "code", call, "SUCCESS", sourceUrl=data.get("sourceUrl"),
                               verification=data.get("_verification") or "CODE_MATCH", matchConfidence=1.0)
            data = isbn_matching.align_title(identity.get("title"), data)
            return _stamp(data, 2, "code", outcome["verification"], 1.0, outcome["retrievedAt"]), outcome
        if call["status"] != "OK" and not provider.by_title:
            return None, _outcome(provider.name, 2, "code", call, call["status"])

    if not provider.by_title:
        return None, _outcome(provider.name, 2, "code", last_call, "NOT_FOUND")

    author = (identity.get("authors") or [None])[0]
    progress.source_started(2, provider.name, "title")
    call = await call_with_retry(provider, lambda client: provider.by_title(client, identity["title"], author))
    call = {**call, "durationMs": total_ms + call["durationMs"], "attempts": total_attempts + call["attempts"]}
    if call["status"] != "OK":
        return None, _outcome(provider.name, 2, "title", call, call["status"])
    best: tuple[str, float, dict] | None = None
    for candidate in call["value"] or []:
        verdict, confidence = _judge_title_candidate(identity, candidate, targets)
        if verdict == "CODE_MATCH":
            best = (verdict, confidence, candidate)
            break
        if verdict == "TITLE_MATCH" and (best is None or confidence > best[1]):
            best = (verdict, confidence, candidate)
        elif verdict == "DIFFERENT_EDITION" and rejected_url is None:
            rejected_url = candidate.get("sourceUrl")
    if best is None:
        status = "DIFFERENT_EDITION" if rejected_url else "NOT_FOUND"
        return None, _outcome(provider.name, 2, "title", call, status, sourceUrl=rejected_url)
    verdict, confidence, candidate = best
    data = candidate if verdict == "CODE_MATCH" else isbn_matching.work_fields_only(candidate)
    if (verdict == "TITLE_MATCH" and identity.get("authors") and data.get("authors")
            and isbn_matching.authors_match(identity.get("authors"), data.get("authors")) is None):
        # Names that cannot be compared (e.g. "新海誠" vs "Shinkai Makoto") would
        # only show up as a false conflict: keep the title match, not its authors.
        data = {**data, "authors": []}
    data = isbn_matching.align_title(identity.get("title"), data)
    outcome = _outcome(provider.name, 2, "title", call, "SUCCESS", sourceUrl=candidate.get("sourceUrl"),
                       verification=verdict, matchConfidence=confidence)
    return _stamp(data, 2, "title", verdict, confidence, outcome["retrievedAt"]), outcome


async def run_round2(providers: list[BookProvider], round1: dict, code: str, targets: set[str]) -> dict:
    """Ask every enabled provider. Returns {"metadata": {source: data}, "outcomes": [...]}."""
    identity_name, identity = round1["identity"], round1["data"]
    asked_by_code = {o["source"] for o in round1["outcomes"] if o["status"] not in ("SKIPPED", "DISABLED")}
    metadata = {identity_name: identity}
    outcomes: list[dict] = []
    tasks, names = [], []

    async def reported(coro):
        data, outcome = await coro
        progress.source_done(outcome)
        return data, outcome

    disabled = []
    for provider in providers:
        if provider.name == identity_name:
            continue
        if provider.disabled_reason:
            disabled.append({"source": provider.name, "round": 2, "query": "-", "status": "DISABLED",
                             "reason": provider.disabled_reason, "durationMs": 0, "attempts": 0})
            outcomes.append(disabled[-1])
            continue
        ask_code = provider.name not in asked_by_code
        if not ask_code and not provider.by_title:
            continue  # already asked by code in Round 1 and has no title search
        tasks.append(reported(_round2_provider(provider, identity, code, targets, ask_code)))
        names.append(provider.name)
    lane, lane_provider = round1.get("parallelTask"), round1.get("parallelProvider")
    if lane is not None:
        async def lane_result():
            data, outcome = _code_result(lane_provider, await lane, 2, targets)
            if data:
                data = isbn_matching.align_title(identity.get("title"), data)
            return data, outcome
        tasks.append(reported(lane_result()))
        names.append(lane_provider.name)
    progress.stage("round2", "started", sources=names, identifiedBy=identity_name)
    for outcome in disabled:
        progress.source_done(outcome)
    results = await asyncio.gather(*tasks, return_exceptions=True)
    for name, result in zip(names, results):
        if isinstance(result, BaseException):  # defensive: _round2_provider never raises
            outcomes.append({"source": name, "round": 2, "query": "-", "status": "ERROR",
                             "error": type(result).__name__, "durationMs": 0, "attempts": 0})
            continue
        data, outcome = result
        outcomes.append(outcome)
        if data:
            metadata[name] = data
    progress.stage("round2", "done", found=len(metadata) - 1)
    return {"metadata": metadata, "outcomes": outcomes}


# ── Summary ───────────────────────────────────────────────────────────────────

def merge_outcomes(round1: dict, round2: dict | None) -> dict[str, dict]:
    """Final per-source status: a Round 2 answer supersedes the Round 1 one,
    except for the identifying source, whose Round 1 match stands."""
    final = {o["source"]: o for o in round1["outcomes"]}
    for outcome in (round2 or {}).get("outcomes", []):
        previous = final.get(outcome["source"])
        if previous and previous["status"] == "SUCCESS":
            continue
        if previous and outcome["status"] == "NOT_FOUND" and previous["status"] in REJECTED_STATUSES:
            continue
        final[outcome["source"]] = outcome
    return final


def build_verification(round1: dict, round2: dict | None, statuses: dict[str, dict],
                       field_evidence: dict, round1_order: list[str]) -> tuple[dict, dict]:
    """(verification summary, fieldSources) for the response."""
    found = sorted(s for s, o in statuses.items() if o["status"] in FOUND_STATUSES)
    failed = sorted(s for s, o in statuses.items() if o["status"] in FAILED_STATUSES)
    rejected = sorted(s for s, o in statuses.items() if o["status"] in REJECTED_STATUSES)
    not_found = sorted(s for s, o in statuses.items() if o["status"] == "NOT_FOUND")
    disabled = sorted(s for s, o in statuses.items() if o["status"] == "DISABLED")
    checked = [s for s, o in statuses.items() if o["status"] not in ("DISABLED", "SKIPPED", "PAUSED")]

    field_sources: dict[str, list[str]] = {}
    verified_fields, conflicted = [], []
    for field, evidence in (field_evidence or {}).items():
        candidates = evidence.get("candidates") or []
        if candidates:
            field_sources[field] = list(candidates[0].get("sources") or [])
        elif evidence.get("selectedSource"):
            field_sources[field] = [c["source"] for c in evidence.get("confirmations") or []]
        if len(field_sources.get(field, [])) >= 2:
            verified_fields.append(field)
        if (evidence.get("selectionReason") or {}).get("conflictCount"):
            conflicted.append(field)

    summary = {
        "round1": {
            "order": round1_order,
            "matchedSource": round1["identity"],
            "matchedUrl": (round1["data"] or {}).get("sourceUrl"),
            "attempts": [
                {k: o.get(k) for k in ("source", "status", "durationMs", "attempts", "reason", "error") if o.get(k) is not None}
                for o in round1["outcomes"]
            ],
        },
        "round2Ran": round2 is not None,
        "totalSourcesChecked": len(checked),
        "sourcesFound": len(found),
        "sourcesNotFound": len(not_found),
        "sourcesFailed": len(failed),
        "sourcesRejected": len(rejected),
        "foundSources": found,
        "notFoundSources": not_found,
        "failedSources": failed,
        "rejectedSources": rejected,
        "disabledSources": disabled,
        "verifiedFields": sorted(verified_fields),
        "conflictedFields": sorted(conflicted),
        "crossSourceVerified": {"title", "authors"} <= set(verified_fields) or (
            "title" in verified_fields and len(found) >= 2 and not (field_evidence.get("authors") or {}).get("selectedSource")
        ),
    }
    return summary, field_sources
