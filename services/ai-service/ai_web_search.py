"""AI web search lane of the two-round ISBN search.

OpenRouter Responses API with the `openrouter:web_search` server tool (Exa
engine): the model (qwen/qwen3.7-flash by default) searches the web for the
scanned code and reads the result excerpts. The model is only a READER:

1. Every candidate it returns must be a URL that the search actually cited
   (`url_citation`); an answer with no citation (the model "remembering") is
   rejected.
2. The code must appear in that page's excerpt - next to a label (Mã hàng /
   Mã sản phẩm / ISBN / SKU / EAN / mã vạch) or as the only book code there -
   before the page may identify the book.
3. Every value the model extracted (title, authors, publisher, year, pages)
   must be found in that excerpt; values that are not are dropped.

Spending is capped: every call reserves a slot in Postgres first (daily and
monthly limits, under an advisory lock); when the counter cannot be read the
call is NOT made. Results - found or not - are cached per code.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from sqlalchemy import text

from intent import normalize_text
from isbn_rounds import SourcePaused

logger = logging.getLogger("uvicorn.error")

MODE = os.getenv("ISBN_AI_WEB_MODE", "title").strip().lower()  # title | parallel | fallback | off
MODEL = os.getenv("ISBN_AI_WEB_MODEL", "qwen/qwen3.7-flash")
ENGINE = os.getenv("ISBN_AI_WEB_ENGINE", "exa")
MAX_RESULTS = int(os.getenv("ISBN_AI_WEB_MAX_RESULTS", "8"))
CONTEXT_SIZE = os.getenv("ISBN_AI_WEB_CONTEXT_SIZE", "medium")
# Copying fields off a page needs little thinking; at the model's default effort qwen
# spent ~2.8k reasoning tokens and 2 of 3 live calls ran past 60 s. "" = model default.
REASONING_EFFORT = os.getenv("ISBN_AI_WEB_REASONING_EFFORT", "low").strip()
DAILY_LIMIT = int(os.getenv("ISBN_AI_WEB_DAILY_LIMIT", "50"))
MONTHLY_LIMIT = int(os.getenv("ISBN_AI_WEB_MONTHLY_LIMIT", "900"))
CACHE_DAYS = int(os.getenv("ISBN_AI_WEB_CACHE_DAYS", "7"))
TIMEOUT_SECONDS = float(os.getenv("ISBN_AI_WEB_TIMEOUT_SECONDS", "60"))
DEBUG_DIR = os.getenv("ISBN_AI_WEB_DEBUG_DIR", "").strip()
_BUDGET_LOCK_ID = 7_302_451  # pg_advisory_xact_lock key for the spending counter
PROVIDER_RETRIES = int(os.getenv("ISBN_AI_WEB_PROVIDER_RETRIES", "2"))
RETRY_DELAY_SECONDS = 2.0
TRANSIENT_STATUSES = {429, 500, 502, 503}

# A bare 13-digit query makes Exa return generic barcode-lookup sites (checked live:
# upcitemdb, ean1.de...); naming it a Vietnamese book product code steers it to shop pages.
QUERY_TEMPLATE = os.getenv("ISBN_AI_WEB_QUERY", "{code} sách mã hàng")
PROMPT = (
    "You look up book metadata. Use the web search tool ONCE with exactly this query: {query}\n"
    "Use ONLY the search results, never your own memory. Keep only product or catalogue pages "
    "that show the code {code} on the page.\n"
    "Answer with ONLY this JSON, values copied verbatim from the page (null when the page does not say):\n"
    '{{"results":[{{"url":"...","title":"...","authors":["..."],"translators":["..."],'
    '"publisher":"...","published_year":"...","page_count":"..."}}]}}\n'
    'If no page shows the code, answer {{"results":[]}}.'
)

_LABELS = re.compile(r"(ma\s*hang|ma\s*san\s*pham|ma\s*vach|isbn|sku|ean|gtin|barcode)\W{0,6}$")
_BOOK_CODE = re.compile(r"(?<!\d)(?:97[89]|893)\d{10}(?!\d)")
_SPACED_BOOK_CODE = re.compile(r"(?<!\d)(?:97[89]|893)(?:[\s.\-]?\d){10}(?!\d)")


# ── response parsing ──────────────────────────────────────────────────────────

def _walk(node):
    if isinstance(node, dict):
        yield node
        for value in node.values():
            yield from _walk(value)
    elif isinstance(node, list):
        for item in node:
            yield from _walk(item)


def _url_key(url: str) -> str:
    parts = urlsplit(str(url or "").strip())
    return (parts.netloc.lower().removeprefix("www.") + parts.path.rstrip("/")).lower()


def citations(response: dict) -> dict[str, dict]:
    """{url key: {"url", "title", "content"}} from every url_citation annotation."""
    found: dict[str, dict] = {}
    for node in _walk(response.get("output") or []):
        if node.get("type") != "url_citation":
            continue
        inner = node.get("url_citation") if isinstance(node.get("url_citation"), dict) else node
        url = inner.get("url")
        if not url:
            continue
        entry = found.setdefault(_url_key(url), {"url": url, "title": inner.get("title"), "content": ""})
        content = inner.get("content") or ""
        if content and content not in entry["content"]:
            entry["content"] = (entry["content"] + "\n" + content).strip()
    return found


def output_text(response: dict) -> str:
    if isinstance(response.get("output_text"), str):
        return response["output_text"]
    texts = [node.get("text") for node in _walk(response.get("output") or [])
             if node.get("type") == "output_text" and isinstance(node.get("text"), str)]
    return "\n".join(texts)


def parse_answer(text_value: str) -> list[dict]:
    start, end = text_value.find("{"), text_value.rfind("}")
    if start < 0 or end <= start:
        return []
    try:
        data = json.loads(text_value[start:end + 1])
    except json.JSONDecodeError:
        return []
    results = data.get("results") if isinstance(data, dict) else None
    return [r for r in results or [] if isinstance(r, dict) and r.get("url")]


# ── verification ──────────────────────────────────────────────────────────────

def code_evidence(excerpt: str, code: str) -> str | None:
    """LABELLED (a code label right before it), SOLE (the only book code in the
    excerpt), AMBIGUOUS (other book codes too) or None (absent)."""
    match = re.search(r"(?<!\d)" + r"[\s.\-]?".join(code) + r"(?!\d)", excerpt or "")
    if not match:
        return None
    if _LABELS.search(normalize_text(excerpt[max(0, match.start() - 40):match.start()])):
        return "LABELLED"
    others = {c for c in _BOOK_CODE.findall(excerpt) if c != code}
    return "AMBIGUOUS" if others else "SOLE"


def _norm(value) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", normalize_text(str(value or "")))).strip()


def _grounded(value, page_norm: str) -> bool:
    value_norm = _norm(value)
    return len(value_norm) >= 2 and value_norm in page_norm


def _grounded_title(title, page_norm: str) -> str | None:
    """The title as the page prints it. Models often copy the browser title with the
    site name ("Nhà giả kim – Bến Nghé Books", seen live): drop such a suffix."""
    title = str(title or "").strip()
    while title:
        if _grounded(title, page_norm):
            return title
        parts = re.split(r"\s+[–—|-]\s+", title)
        if len(parts) < 2:
            return None
        title = " - ".join(parts[:-1]).strip()
    return None


def verify(code: str, response: dict) -> dict | None:
    """Metadata of the first answer whose cited page shows the code, keeping only
    grounded values. An answer whose page does not prove the code comes back
    without identifiers (Round 1 then reports it as MISMATCH, never as a match)."""
    cited = citations(response)
    if not cited:
        return None  # the model did not search: never trust a memory answer
    unverified = None
    for result in parse_answer(output_text(response)):
        page = cited.get(_url_key(result["url"]))
        if not page or not page["content"]:
            continue
        page_norm = _norm(page["content"])
        title = _grounded_title(result.get("title"), page_norm)
        if not title:
            continue
        authors = [a for a in result.get("authors") or [] if _grounded(a, page_norm)]
        translators = [t for t in result.get("translators") or [] if _grounded(t, page_norm)]
        year = str(result.get("published_year") or "").strip()
        pages = "".join(filter(str.isdigit, str(result.get("page_count") or "")))
        evidence = code_evidence(page["content"], code)
        metadata = {
            "title": str(title).strip(), "subtitle": None, "authors": authors, "translator": translators,
            "publisher": result.get("publisher") if _grounded(result.get("publisher"), page_norm) else None,
            "publishedDate": year if year and year in page["content"] else None,
            "description": None, "categories": [], "language": None,
            "pageCount": int(pages) if pages and re.search(rf"(?<!\d){pages}(?!\d)", page["content"]) else None,
            "thumbnail": None,
            "identifiers": [code] if evidence in ("LABELLED", "SOLE") else [],
            "sourceUrl": page["url"], "sourceFetchMode": "ai-web-search",
            "_codeEvidence": evidence, "_aiModel": MODEL,
        }
        if metadata["identifiers"]:
            return metadata
        unverified = unverified or metadata
    return unverified


# ── spending limit and cache (Postgres) ───────────────────────────────────────

async def _cache_get(code: str) -> tuple[bool, dict | None]:
    try:
        from db import get_session
        async with get_session() as session:
            row = (await session.execute(
                text("SELECT payload FROM ai_web_search_cache WHERE code = :code AND expires_at > :now"),
                {"code": code, "now": datetime.now(timezone.utc)},
            )).first()
        return (True, json.loads(row[0])) if row else (False, None)
    except Exception as exc:  # noqa: BLE001 - a cache miss, never a failure
        logger.warning("AI web search cache read skipped: %s", type(exc).__name__)
        return False, None


async def _cache_put(code: str, metadata: dict | None) -> None:
    try:
        from db import get_session
        async with get_session() as session:
            await session.execute(text(
                "INSERT INTO ai_web_search_cache (code, payload, expires_at) VALUES (:code, :payload, :expires) "
                "ON CONFLICT (code) DO UPDATE SET payload = EXCLUDED.payload, expires_at = EXCLUDED.expires_at"),
                {"code": code, "payload": json.dumps(metadata, ensure_ascii=False),
                 "expires": datetime.now(timezone.utc) + timedelta(days=CACHE_DAYS)})
            await session.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("AI web search cache write skipped: %s", type(exc).__name__)


async def reserve_call(code: str) -> int:
    """Count this call against the limits BEFORE making it. Raises SourcePaused
    when a limit is reached or the counter cannot be read (fail closed)."""
    now = datetime.now(timezone.utc)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    month_start = day_start.replace(day=1)
    try:
        from db import get_session
        async with get_session() as session:
            await session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": _BUDGET_LOCK_ID})
            today, month = (await session.execute(text(
                "SELECT count(*) FILTER (WHERE called_at >= :day), count(*) FROM ai_web_search_calls "
                "WHERE called_at >= :month"), {"day": day_start, "month": month_start})).one()
            if today >= DAILY_LIMIT:
                raise SourcePaused(f"Hết hạn mức AI web search hôm nay ({today}/{DAILY_LIMIT})")
            if month >= MONTHLY_LIMIT:
                raise SourcePaused(f"Hết hạn mức AI web search tháng này ({month}/{MONTHLY_LIMIT})")
            call_id = (await session.execute(text(
                "INSERT INTO ai_web_search_calls (code, called_at, model, status) "
                "VALUES (:code, :now, :model, 'RESERVED') RETURNING id"),
                {"code": code, "now": now, "model": MODEL})).scalar_one()
            await session.commit()
            return int(call_id)
    except SourcePaused:
        raise
    except Exception as exc:  # noqa: BLE001 - cannot prove we are under the limit: do not spend
        raise SourcePaused(f"Không kiểm tra được hạn mức AI web search ({type(exc).__name__})") from exc


async def _finish_call(call_id: int, status: str, usage: dict | None) -> None:
    try:
        from db import get_session
        async with get_session() as session:
            await session.execute(text(
                "UPDATE ai_web_search_calls SET status = :status, usage = :usage WHERE id = :id"),
                {"id": call_id, "status": status, "usage": json.dumps(usage or {})})
            await session.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("AI web search call log not updated: %s", type(exc).__name__)


async def usage_summary() -> dict:
    now = datetime.now(timezone.utc)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    from db import get_session
    async with get_session() as session:
        today, month = (await session.execute(text(
            "SELECT count(*) FILTER (WHERE called_at >= :day), count(*) FROM ai_web_search_calls "
            "WHERE called_at >= :month"), {"day": day_start, "month": day_start.replace(day=1)})).one()
    return {"today": int(today), "dailyLimit": DAILY_LIMIT, "month": int(month), "monthlyLimit": MONTHLY_LIMIT}


# ── the provider ──────────────────────────────────────────────────────────────

async def call_openrouter(client: httpx.AsyncClient, code: str, api_key: str, base_url: str,
                          timeout: float = TIMEOUT_SECONDS, prompt: str | None = None) -> dict:
    body = {
        "model": MODEL,
        "input": prompt or PROMPT.format(code=code, query=QUERY_TEMPLATE.format(code=code)),
        "tools": [{"type": "openrouter:web_search", "parameters": {
            "engine": ENGINE, "max_results": MAX_RESULTS, "search_context_size": CONTEXT_SIZE, "max_uses": 1,
        }}],
    }
    if REASONING_EFFORT:
        body["reasoning"] = {"effort": REASONING_EFFORT}
    resp = await client.post(f"{base_url}/responses", json=body,
                             headers={"Authorization": f"Bearer {api_key}"}, timeout=timeout)
    if resp.status_code >= 400:
        # Keep OpenRouter's explanation (rate limit, provider error...) - never the key.
        logger.warning("ai web search %s: OpenRouter HTTP %d: %s", code, resp.status_code, resp.text[:500])
    resp.raise_for_status()
    return resp.json()


async def _paid_call(client: httpx.AsyncClient, code: str, prompt: str | None, tag: str):
    """One reserved (counted) OpenRouter call with bounded retries.
    Returns (response, call_id); the caller closes the call row."""
    from llm_provider import openrouter_connection
    api_key, base_url = openrouter_connection()
    call_id = await reserve_call(code)
    deadline = asyncio.get_running_loop().time() + TIMEOUT_SECONDS  # all attempts share one budget
    for attempt in range(PROVIDER_RETRIES + 1):
        try:
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 1:
                raise asyncio.TimeoutError("AI web search time budget used up")
            response = await call_openrouter(client, code, api_key, base_url, timeout=remaining, prompt=prompt)
            break
        except asyncio.CancelledError:
            # Cut off by the round's own timeout: close the reserved row instead of leaving RESERVED.
            await asyncio.shield(_finish_call(call_id, "TIMEOUT", {"attempts": attempt + 1}))
            raise
        except Exception as exc:
            # OpenRouter answers "Provider returned error" 429 intermittently (seen live,
            # not billed): retry within the SAME reserved slot, briefly, then give up.
            transient = isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code in TRANSIENT_STATUSES
            if transient and attempt < PROVIDER_RETRIES:
                await asyncio.sleep(RETRY_DELAY_SECONDS * (attempt + 1))
                continue
            detail = {"error": type(exc).__name__, "attempts": attempt + 1}
            if isinstance(exc, httpx.HTTPStatusError):
                detail.update(httpStatus=exc.response.status_code, body=exc.response.text[:500])
            await _finish_call(call_id, "ERROR", detail)
            raise
    if DEBUG_DIR:
        Path(DEBUG_DIR).mkdir(parents=True, exist_ok=True)
        Path(DEBUG_DIR, f"ai-web-{tag}-{code}.json").write_text(
            json.dumps(response, ensure_ascii=False, indent=2), encoding="utf-8")
    return response, call_id


async def ai_by_code(client: httpx.AsyncClient, code: str) -> dict | None:
    """isbn_rounds code search (modes parallel / fallback). Cache first, then a reserved call."""
    hit, cached = await _cache_get(code)
    if hit:
        return cached
    response, call_id = await _paid_call(client, code, None, "code")
    metadata = verify(code, response)
    status = "FOUND" if metadata and metadata["identifiers"] else ("UNVERIFIED" if metadata else "NOT_FOUND")
    await _finish_call(call_id, status, response.get("usage"))
    await _cache_put(code, metadata)
    logger.info("ai web search %s: %s (%d citations)", code, status, len(citations(response)))
    return metadata


# ── title mode: search by the identified book's title (Round 2) ───────────────
# Exa is a semantic engine: hopeless for a bare 13-digit code (0 matching pages in
# 3 live calls), but made for "Đắc Nhân Tâm Dale Carnegie". Round 1 finds the title
# from the code; this searches the open web by that title for cross-checking.

TITLE_QUERY_TEMPLATE = os.getenv("ISBN_AI_WEB_TITLE_QUERY", "{title} {author} sách")
TITLE_PROMPT = (
    "You collect book metadata for a library. Use the web search tool ONCE with exactly this query: {query}\n"
    "Use ONLY the search results, never your own memory. The library holds the edition with product "
    "code {code}: list pages about THIS book (same title and author), and put first the pages that show "
    "the code {code}.\n"
    "Answer with ONLY this JSON, values copied verbatim from each page (null when the page does not say):\n"
    '{{"results":[{{"url":"...","title":"...","authors":["..."],"translators":["..."],'
    '"publisher":"...","published_year":"...","page_count":"..."}}]}}\n'
    'If no page is about this book, answer {{"results":[]}}.'
)


def page_codes(excerpt: str, code: str) -> list[str]:
    """Codes this page states for itself: labelled book codes (Mã hàng / ISBN /
    SKU...), plus the scanned code when it is the only book code on the page."""
    codes = []
    for match in _SPACED_BOOK_CODE.finditer(excerpt or ""):  # "ISBN: 978-604-..." too
        if _LABELS.search(normalize_text(excerpt[max(0, match.start() - 40):match.start()])):
            codes.append(re.sub(r"\D", "", match.group(0)))
    if code not in codes and code_evidence(excerpt, code) == "SOLE":
        codes.append(code)
    return list(dict.fromkeys(codes))


def title_candidates(code: str, response: dict) -> list[dict]:
    """Grounded candidates for isbn_rounds' title search. Each carries the codes
    its page states, so the round can tell: same code -> CODE_MATCH (all fields),
    another code -> DIFFERENT_EDITION (rejected), no code -> title + author match
    (work-level fields only)."""
    cited = citations(response)
    if not cited:
        return []  # no search happened: never trust a memory answer
    out = []
    for result in parse_answer(output_text(response)):
        page = cited.get(_url_key(result["url"]))
        if not page or not page["content"]:
            continue
        page_norm = _norm(page["content"])
        title = _grounded_title(result.get("title"), page_norm)
        if not title:
            continue
        authors = [a for a in result.get("authors") or [] if _grounded(a, page_norm)]
        parts = re.split(r"\s+[–—|-]\s+", title)
        if len(parts) > 1 and _norm(parts[-1]) in {_norm(a) for a in authors}:
            title = " - ".join(parts[:-1])  # page heading "Nhà Giả Kim - Paulo Coelho" (seen live)
        year = str(result.get("published_year") or "").strip()
        pages = "".join(filter(str.isdigit, str(result.get("page_count") or "")))
        out.append({
            "title": title, "subtitle": None,
            "authors": authors,
            "translator": [t for t in result.get("translators") or [] if _grounded(t, page_norm)],
            "publisher": result.get("publisher") if _grounded(result.get("publisher"), page_norm) else None,
            "publishedDate": year if year and year in page["content"] else None,
            "description": None, "categories": [], "language": None,
            "pageCount": int(pages) if pages and re.search(rf"(?<!\d){pages}(?!\d)", page["content"]) else None,
            "thumbnail": None,
            "identifiers": page_codes(page["content"], code),
            "sourceUrl": page["url"], "sourceFetchMode": "ai-web-search", "_aiModel": MODEL,
        })
    # Pages stating the scanned code first: the round takes the first CODE_MATCH.
    return sorted(out, key=lambda c: code not in c["identifiers"])


async def ai_by_title(client: httpx.AsyncClient, code: str, title: str, author: str | None) -> list[dict]:
    """isbn_rounds title search (mode title). One reserved call per scanned code, cached."""
    cache_key = f"title:{code}"
    hit, cached = await _cache_get(cache_key)
    if hit:
        return cached or []
    query = re.sub(r"\s+", " ", TITLE_QUERY_TEMPLATE.format(title=title, author=author or "", code=code)).strip()
    response, call_id = await _paid_call(client, code, TITLE_PROMPT.format(query=query, code=code), "title")
    candidates = title_candidates(code, response)
    status = ("FOUND" if any(code in c["identifiers"] for c in candidates)
              else "PARTIAL" if candidates else "NOT_FOUND")
    await _finish_call(call_id, status, response.get("usage"))
    await _cache_put(cache_key, candidates)
    logger.info("ai web search by title %s (%r): %s, %d candidate(s), %d citations",
                code, query, status, len(candidates), len(citations(response)))
    return candidates


def title_search_for(code: str):
    """A by_title callable bound to the scanned code (isbn_rounds passes title/author only)."""
    async def search(client: httpx.AsyncClient, title: str, author: str | None) -> list[dict]:
        return await ai_by_title(client, code, title, author)
    search.__name__ = "aiWebSearch_by_title"
    return search
