"""Live check of every book source in the two-round registry (manual, NOT part of CI).

Run inside the ai-service container (real network):
    docker compose --profile ai exec ai-service python eval/live_book_sources.py
    docker compose --profile ai exec ai-service python eval/live_book_sources.py 8935212359658

Each enabled source gets at most one code search and one title search (plus the
product pages those return). Prints evidence (status, latency, fields, codes)
and always exits 0: an external site being down is a finding, not a test failure.
With codes as arguments it also runs the full two-round lookup for each.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import isbn_rounds  # noqa: E402
from main import IsbnLookupRequest, _book_providers, lookup_book_by_isbn  # noqa: E402

# A code and a title each source is known to carry (checked 2026-11-12).
SAMPLES = {
    "googleBooks": ("9780132350884", "Clean Code"),
    "openLibrary": ("9780132350884", "Clean Code"),
    "dinhTi": ("8935212359658", "Bé ngoan học lễ phép"),
    "tiki": (None, "Nhà giả kim"),
    "nhanam": (None, "Nhà giả kim"),
    "thaiHa": (None, "Chú thỏ muốn đi ngủ"),
    "vanLang": (None, "Tự Đổ Tách Trà Trước Khi Tràn Ly"),
    "webSearch": ("8935235226272", None),
}
FIELDS = ("title", "authors", "translator", "publisher", "publishedDate", "pageCount", "description", "thumbnail")


def summarize(value) -> str:
    if not value:
        return "nothing"
    items = value if isinstance(value, list) else [value]
    first = items[0]
    present = [f for f in FIELDS if first.get(f)]
    return f"{len(items)} record(s); first: {first.get('title')!r} codes={first.get('identifiers')} fields={present}"


async def check_sources() -> None:
    for provider in _book_providers():
        code, title = SAMPLES.get(provider.name, (None, None))
        if provider.disabled_reason:
            print(f"[{provider.name}] DISABLED - {provider.disabled_reason}")
            continue
        for kind, fn, arg in (("code", provider.by_code, code), ("title", provider.by_title, title)):
            if not fn or not arg:
                continue
            call = await isbn_rounds.call_with_retry(
                provider, (lambda c, f=fn, a=arg: f(c, a)) if kind == "code" else (lambda c, f=fn, a=arg: f(c, a, None)))
            at = datetime.now(timezone.utc).isoformat(timespec="seconds")
            detail = summarize(call["value"]) if call["status"] == "OK" else call["error"]
            print(f"[{provider.name}] {kind}={arg!r} -> {call['status']} {call['durationMs']}ms "
                  f"attempts={call['attempts']} at={at} :: {detail}")


async def check_lookups(codes: list[str]) -> None:
    for code in codes:
        result = await lookup_book_by_isbn(IsbnLookupRequest(isbn=code))
        verification = result.get("verification") or {}
        print(json.dumps({
            "code": code, "found": result.get("found"), "title": result.get("title"),
            "authors": result.get("authors"), "round1": verification.get("round1"),
            "foundSources": verification.get("foundSources"), "failedSources": verification.get("failedSources"),
            "rejectedSources": verification.get("rejectedSources"), "fieldSources": result.get("fieldSources"),
            "crossSourceVerified": verification.get("crossSourceVerified"),
            "processingTimeMs": result.get("processingTimeMs"),
        }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(check_sources())
    if len(sys.argv) > 1:
        asyncio.run(check_lookups(sys.argv[1:]))
