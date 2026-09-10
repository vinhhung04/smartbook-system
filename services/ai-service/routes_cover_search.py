"""Find a book by photographing its cover ("Shazam for books").

Combines two independently-measurable signals into one ranked result list —
never an LLM's self-assessed confidence, matching this codebase's existing
evidence-first convention (see main.py's ISBN metadata fusion):

- visual: cosine similarity between the query photo's CLIP embedding and each
  catalog cover's precomputed embedding (cover_gallery.py / cover_embeddings.py).
- ocr_text: Ollama's vision model reads the title/author off the cover, then
  that text is scored against the catalog by assistant_tools._score_and_rank_books
  (reused as-is, not reimplemented).

A new router module (not main.py) — this feature has its own prompt/parsing/
merge logic that doesn't belong mixed into main.py's existing ~229KB, following
the precedent set by routes_actions.py/routes_conversations.py.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re

import httpx
import ollama
from fastapi import APIRouter, File, HTTPException, Request, UploadFile

import assistant_tools
import cover_embeddings
import cover_gallery
import embeddings

logger = logging.getLogger("uvicorn.error")

router = APIRouter(tags=["cover-search"])

# Redeclared locally per this codebase's own convention (see assistant_tools.py,
# retrieval.py, agent_permissions.py) — route modules never import main.py, to
# avoid a circular import (main.py constructs the app and includes this router).
GATEWAY_URL = os.getenv("SMARTBOOK_GATEWAY_URL", "http://api-gateway:3000").rstrip("/")
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://ollama:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llava")
CATALOG_FETCH_TIMEOUT_SECONDS = float(os.getenv("CATALOG_FETCH_TIMEOUT_SECONDS", "15"))
# Bounds a single llava generation. Confirmed in testing: uncapped, a photo
# with no legible title/author can make llava ramble 1500+ tokens instead of
# stopping at the JSON, taking minutes on CPU-only Ollama. 200 tokens is far
# more than a two-field JSON object needs.
COVER_OCR_MAX_TOKENS = int(os.getenv("COVER_OCR_MAX_TOKENS", "200"))
COVER_OCR_TIMEOUT_SECONDS = float(os.getenv("COVER_OCR_TIMEOUT_SECONDS", "90"))

COVER_SEARCH_VISUAL_THRESHOLD = float(os.getenv("COVER_SEARCH_VISUAL_THRESHOLD", "0.80"))
COVER_SEARCH_MIN_CONFIDENCE = float(os.getenv("COVER_SEARCH_MIN_CONFIDENCE", "0.5"))
COVER_SEARCH_VISUAL_WEIGHT = float(os.getenv("COVER_SEARCH_VISUAL_WEIGHT", "0.6"))
COVER_SEARCH_RESULT_LIMIT = int(os.getenv("COVER_SEARCH_RESULT_LIMIT", "5"))

PROMPT_COVER_OCR = (
    "Nhìn vào ảnh chụp bìa sách này. Đọc tên sách và tên tác giả in trên bìa. "
    'Trả về DUY NHẤT JSON, không markdown, không giải thích, theo định dạng: '
    '{"title": "...", "author": "..."}. Nếu không đọc được, đặt giá trị null.'
)


def _extract_title_author(raw: str) -> dict:
    """Local copy of main.py's _extract_json's 3-strategy parse (direct →
    fenced ```json``` block → first {...} object), with a fallback shaped for
    this endpoint's own two fields instead of main.py's ISBN-lookup fallback.
    Duplicated rather than imported to avoid a circular import with main.py."""
    for candidate in (
        raw.strip(),
        (re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, re.DOTALL) or [None, None])[1],
        (re.search(r"\{.*?\}", raw, re.DOTALL) or [None])[0],
    ):
        if not candidate:
            continue
        try:
            data = json.loads(candidate)
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError:
            continue
    return {"title": None, "author": None}


def _run_cover_ocr(image_bytes: bytes) -> dict:
    """Blocking Ollama vision call — must run via asyncio.to_thread.

    Confirmed in testing: without num_predict, llava can ramble for 1500+
    tokens on a photo that isn't a book cover (nothing to "read" pins it into
    a long free-form description instead of stopping at the JSON), taking
    minutes on CPU. The answer only needs a two-field JSON object, so the cap
    is generous but bounded; the client-level timeout is the hard backstop —
    on either limit this degrades to "no OCR signal", not a hung request."""
    try:
        client = ollama.Client(host=OLLAMA_HOST, timeout=COVER_OCR_TIMEOUT_SECONDS)
        response = client.generate(
            model=OLLAMA_MODEL,
            prompt=PROMPT_COVER_OCR,
            images=[image_bytes],
            options={"temperature": 0, "num_predict": COVER_OCR_MAX_TOKENS},
        )
        data = _extract_title_author(response.get("response", ""))
    except Exception as exc:
        logger.warning("cover_search: OCR failed: %s", type(exc).__name__)
        data = {"title": None, "author": None}

    title = str(data.get("title") or "").strip() or None
    author = str(data.get("author") or "").strip() or None
    return {"title": title, "author": author}


async def _fetch_catalog(auth_header: str | None) -> list[dict]:
    """Full catalog via the Gateway, forwarding the caller's own token — same
    permission scope the caller already has, no service-to-service secret
    needed here (unlike cover_gallery's background gallery builder)."""
    headers = {"Authorization": auth_header} if auth_header else {}
    try:
        async with httpx.AsyncClient(timeout=CATALOG_FETCH_TIMEOUT_SECONDS) as client:
            response = await client.get(f"{GATEWAY_URL}/api/books", headers=headers)
        if response.status_code >= 400:
            logger.warning("cover_search: /api/books returned HTTP %d", response.status_code)
            return []
        data = response.json()
        return data if isinstance(data, list) else []
    except Exception as exc:
        logger.warning("cover_search: catalog fetch failed: %s", type(exc).__name__)
        return []


async def _match_visual(image_bytes: bytes) -> list[dict]:
    """Cosine similarity of the query photo against every gallery cover.
    Returns [] (not raising) on any failure — the OCR-text signal alone still
    works."""
    gallery = await cover_gallery.get_gallery()
    if not gallery:
        return []

    query_vector = await asyncio.to_thread(cover_embeddings.embed_image, image_bytes)
    if query_vector is None:
        return []

    scored = [
        {**item, "score": embeddings.cosine_similarity(query_vector, item["vector"])}
        for item in gallery
    ]
    scored.sort(key=lambda item: -item["score"])
    return scored


def _merge_candidates(books: list[dict], ocr_matches: list[dict], visual_matches: list[dict]) -> list[dict]:
    """Dedupe on book_id, fuse the two signals into one confidence number.
    Weighted average (visual*WEIGHT + ocr*(1-WEIGHT)) when both signals fire
    for the same book; the raw signal score when only one does — both are
    measurable evidence, never an LLM's self-assessment."""
    books_by_id = {str(book.get("id")): book for book in books if isinstance(book, dict)}

    best_visual_by_book: dict[str, dict] = {}
    for match in visual_matches:
        if match["score"] < COVER_SEARCH_VISUAL_THRESHOLD:
            continue
        book_id = match["book_id"]
        current_best = best_visual_by_book.get(book_id)
        if current_best is None or match["score"] > current_best["score"]:
            best_visual_by_book[book_id] = match

    ocr_by_book = {str(match["id"]): match for match in ocr_matches}

    candidates = []
    for book_id in set(best_visual_by_book) | set(ocr_by_book):
        book = books_by_id.get(book_id)
        if book is None:
            # Gallery/OCR pointed at a book that's no longer live in the catalog
            # (e.g. deactivated between the gallery's last sync and now).
            continue

        visual = best_visual_by_book.get(book_id)
        ocr = ocr_by_book.get(book_id)
        evidence = []
        if visual:
            evidence.append({
                "signal": "visual",
                "score": round(visual["score"], 3),
                "label": f"Ảnh bìa khớp {round(visual['score'] * 100)}%",
            })
        if ocr:
            evidence.append({
                "signal": "ocr_text",
                "score": round(ocr.get("score", 0.0), 3),
                "label": f"Khớp văn bản: {ocr.get('title')}",
            })

        if visual and ocr:
            confidence = visual["score"] * COVER_SEARCH_VISUAL_WEIGHT + ocr.get("score", 0.0) * (1 - COVER_SEARCH_VISUAL_WEIGHT)
        elif visual:
            confidence = visual["score"]
        else:
            confidence = ocr.get("score", 0.0)

        candidates.append({
            **book,
            # The exact edition whose cover photo matched, when we have one —
            # more precise than the catalog's arbitrary "first variant" default.
            "variant_id": visual["variant_id"] if visual else book.get("variant_id"),
            "confidence": round(confidence, 3),
            "evidence": evidence,
        })

    candidates.sort(key=lambda item: -item["confidence"])
    return candidates


@router.post("/find-book-by-cover")
async def find_book_by_cover(request: Request, file: UploadFile = File(...)):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File phải là ảnh (image/*).")
    image_bytes = file.file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="File ảnh rỗng.")

    auth_header = request.headers.get("authorization")

    ocr_data, books, visual_matches = await asyncio.gather(
        asyncio.to_thread(_run_cover_ocr, image_bytes),
        _fetch_catalog(auth_header),
        _match_visual(image_bytes),
    )

    ocr_query = " ".join(filter(None, [ocr_data.get("title"), ocr_data.get("author")])).strip()
    ocr_matches: list[dict] = []
    if ocr_query and books:
        ocr_matches = await asyncio.to_thread(
            assistant_tools._score_and_rank_books, books, ocr_query, COVER_SEARCH_RESULT_LIMIT
        )

    candidates = _merge_candidates(books, ocr_matches, visual_matches)
    candidates = [c for c in candidates if c["confidence"] >= COVER_SEARCH_MIN_CONFIDENCE][:COVER_SEARCH_RESULT_LIMIT]

    return {
        "match_found": bool(candidates),
        "candidates": candidates,
        "signals": {
            "ocr_extracted": ocr_data if ocr_query else None,
            "visual_gallery_size": len(visual_matches),
        },
    }


@router.post("/find-book-by-cover/reindex")
async def reindex_cover_gallery():
    return await cover_gallery.rebuild()
