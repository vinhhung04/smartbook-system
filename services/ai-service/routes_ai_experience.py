"""Phase F endpoints shared by both AI experiences:

GET  /capabilities      the caller's role-aware AI experience (ai_core.capabilities)
POST /vision/identify   identify a book from a cover photo, streaming the real
                        stages (SSE) or, with ?stream=false, one JSON body

Identification reuses routes_cover_search as-is - its OCR call, CLIP gallery
match, catalog fetch with the caller's token and _merge_candidates fusion - and
adds what a conversation needs: safe image intake (image_input), a decision
(vision_context.decide), per-candidate evidence, public branch availability,
and an owner-bound context id the next chat / assistant turn can refer to.
Nothing is written to the catalog. The image is not stored or logged.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import StreamingResponse

import assistant_tools
import image_input
import routes_cover_search as rcs
import vision_context
from ai_core import capabilities
from ai_core import policy as ai_policy
from cache import RateLimiter

logger = logging.getLogger("uvicorn.error")
router = APIRouter(tags=["ai-experience"])

# Photos cost an OCR call each: a tighter budget than chat (15/min, 100/h).
vision_rate_limiter = RateLimiter(
    requests_per_minute=int(os.getenv("VISION_RATE_PER_MINUTE", "6")),
    requests_per_hour=int(os.getenv("VISION_RATE_PER_HOUR", "40")),
)
VISUAL_TIMEOUT_SECONDS = float(os.getenv("COVER_VISUAL_TIMEOUT_SECONDS", "15"))
CATALOG_TIMEOUT_SECONDS = float(os.getenv("CATALOG_FETCH_TIMEOUT_SECONDS", "15")) + 2
EXTERNAL_PROCESSING_NOTICE = (
    "Ảnh bìa được gửi tới nhà cung cấp AI bên ngoài (OpenRouter) để đọc chữ trên bìa; so khớp hình ảnh chạy trong "
    "hệ thống SmartBook. SmartBook không lưu ảnh và không gửi kèm thông tin tài khoản của bạn. Chỉ chụp bìa sách, "
    "tránh chụp giấy tờ hoặc thông tin cá nhân.")


def multimodal_info(user_ctx) -> dict:
    return {
        "enabled": user_ctx is not None and capabilities.allows(user_ctx, "book.identify_image"),
        "max_bytes": image_input.MAX_IMAGE_BYTES,
        "formats": sorted(image_input.ALLOWED_FORMATS.values()),
        "notice": EXTERNAL_PROCESSING_NOTICE,
    }


@router.get("/capabilities")
async def get_capabilities(request: Request):
    auth_header = request.headers.get("authorization")
    user_ctx = await ai_policy.get_user_context(auth_header) if auth_header else None
    return {**capabilities.describe(user_ctx), "multimodal": multimodal_info(user_ctx)}


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"


async def _visual(image: bytes) -> tuple[list[dict], str]:
    try:
        matches = await asyncio.wait_for(rcs._match_visual(image), timeout=VISUAL_TIMEOUT_SECONDS)
        return matches, "ok" if matches else "unavailable"
    except asyncio.TimeoutError:
        return [], "timeout"
    except Exception as exc:  # noqa: BLE001 - the text signal alone still answers
        logger.warning("vision_identify: visual branch failed: %s", type(exc).__name__)
        return [], "error"


async def _catalog(auth_header: str | None) -> list[dict]:
    try:
        return await asyncio.wait_for(rcs._fetch_catalog(auth_header), timeout=CATALOG_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        return []


async def _public_availability(book_ids: list[str]) -> dict[str, dict]:
    """Copies at public pickup branches + the public borrow count (the same
    figures the website shows) - no personal or internal-warehouse data."""
    from routes_public_discover import _fetch_public_books
    try:
        rows = await _fetch_public_books([b for b in book_ids if b])
    except Exception as exc:  # noqa: BLE001 - availability is optional context
        logger.warning("vision_identify: public availability unavailable: %s", type(exc).__name__)
        return {}
    out = {}
    for book_id, row in rows.items():
        out[book_id] = {
            "available_quantity": row.get("available_quantity"),
            "availability_status": row.get("availability_status"),
            "branches": [{"name": b.get("warehouse_name"), "available_quantity": b.get("available_quantity")}
                         for b in row.get("pickup_branches") or []],
            "borrow_count": (row.get("signals") or {}).get("borrow_count"),
            "retrieved_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        }
    return out


async def identify_events(image: bytes, auth_header: str | None, user_ctx):
    """(event, payload) pairs: real stage transitions, then the recognition."""
    yield "status", {"stage": "analyzing", "steps": ["reading_text", "visual_matching", "loading_catalog"]}
    tasks = {
        asyncio.create_task(rcs._run_cover_ocr(image, report_error=True)): "text_read",
        asyncio.create_task(_visual(image)): "visual_done",
        asyncio.create_task(_catalog(auth_header)): "catalog_loaded",
    }
    results: dict[str, object] = {}
    pending = set(tasks)
    while pending:
        done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            stage = tasks[task]
            results[stage] = task.result()
            ok = bool(results[stage][0]) if stage == "visual_done" else (
                not results[stage].get("error") if stage == "text_read" else bool(results[stage]))
            yield "status", {"stage": stage, "ok": ok}

    ocr = results["text_read"]
    visual, visual_status = results["visual_done"]
    books = results["catalog_loaded"]
    yield "status", {"stage": "matching_catalog"}
    ocr_query = " ".join(filter(None, [ocr.get("title"), ocr.get("author")])).strip()
    ocr_matches = (await assistant_tools._score_and_rank_books(books, ocr_query, rcs.COVER_SEARCH_RESULT_LIMIT)
                   if ocr_query and books else [])
    merged = rcs._merge_candidates(books, ocr_matches, visual)
    merged = [c for c in merged if c["confidence"] >= rcs.COVER_SEARCH_MIN_CONFIDENCE][:rcs.COVER_SEARCH_RESULT_LIMIT]
    status, reasons = vision_context.decide(merged)
    views = [vision_context.candidate_view(c, i + 1, ocr) for i, c in enumerate(merged)]
    availability = await _public_availability([v["book_id"] for v in views]) if views else {}
    for view in views:
        view["availability"] = availability.get(view["book_id"])
    signals = {
        "ocr_status": "error" if ocr.get("error") else ("ok" if ocr_query else "no_text"),
        "visual_status": visual_status, "gallery_size": len(visual),
        "catalog_status": "ok" if books else "unavailable",
    }
    ocr_public = {"title": ocr.get("title"), "author": ocr.get("author")}
    attachment_id = vision_context.save(user_ctx, status, views, ocr_public)
    logger.info("vision_identify user=%s status=%s candidates=%d ocr=%s visual=%s catalog=%s",
                getattr(user_ctx, "user_id", "?"), status, len(views), signals["ocr_status"], visual_status,
                signals["catalog_status"])
    yield "recognition", {
        "attachment_id": attachment_id, "status": status, "reasons": reasons, "candidates": views,
        "ocr": ocr_public, "signals": signals,
        "explanation": vision_context.explain(status, reasons, views, ocr_public, signals),
        "expires_in_seconds": vision_context.CONTEXT_TTL_SECONDS,
    }


@router.post("/vision/identify")
async def vision_identify(
    request: Request,
    file: UploadFile = File(...),
    external_processing_ack: str = Form("false"),
    stream: bool = Query(True),
):
    auth_header = request.headers.get("authorization")
    user_ctx = await ai_policy.get_user_context(auth_header)  # 401 / 503 fail-closed
    await ai_policy.enforce_rate_limit(request, user_ctx, vision_rate_limiter)
    if not capabilities.allows(user_ctx, "book.identify_image"):
        raise HTTPException(status_code=403, detail="Tài khoản của bạn không có quyền nhận diện sách từ ảnh.")
    if external_processing_ack.strip().lower() not in ("true", "1", "yes"):
        raise HTTPException(status_code=428, detail=EXTERNAL_PROCESSING_NOTICE)
    raw = await image_input.read_upload(file)
    image_input.validate(raw)
    image = image_input.normalize(raw)
    del raw  # the original (with its EXIF) is not kept past this point

    if not stream:
        final: dict | None = None
        async for event, payload in identify_events(image, auth_header, user_ctx):
            if event == "recognition":
                final = payload
        return final

    async def events():
        yield _sse("status", {"stage": "received"})
        try:
            async for event, payload in identify_events(image, auth_header, user_ctx):
                yield _sse(event, payload)
        except Exception as exc:  # noqa: BLE001 - reported to the client as a retryable failure
            logger.warning("vision_identify failed: %s", type(exc).__name__)
            yield _sse("error", {"message": "Không phân tích được ảnh lúc này. Vui lòng thử lại."})
        yield _sse("done", {})

    return StreamingResponse(events(), media_type="text/event-stream")


# ── the photo inside a later chat / assistant turn ──────────────────────────

async def resolve_turn_image(attachment_id: str | None, book_id: str | None, image_turn: bool, user_ctx,
                             message: str) -> dict | None:
    """The recognised-photo context of one turn, or None.

    The context is server-side and owner-bound: an unknown, expired or foreign
    attachment is a 410, and a book_id that is not one of that photo's
    verified candidates is a 400 - a client cannot point the AI at a book it
    chose itself. The photo is used only when the turn refers to it (sent
    with it, a chosen candidate, or "sách này / cuốn trong ảnh / đây là…"), so
    a new topic does not silently reuse an old book."""
    if not attachment_id:
        return None
    if user_ctx is None:
        raise HTTPException(status_code=401, detail="Cần đăng nhập để hỏi về ảnh đã gửi.")
    entry = vision_context.load(attachment_id, user_ctx)
    if entry is None:
        raise HTTPException(status_code=410, detail="Ảnh đã hết hạn hoặc không thuộc phiên của bạn. Vui lòng gửi lại ảnh.")
    if book_id and not any(c["book_id"] == str(book_id) for c in entry["candidates"]):
        raise HTTPException(status_code=400, detail="Sách được chọn không nằm trong kết quả nhận diện của ảnh này.")
    from intent import normalize_text
    used = bool(image_turn or book_id or vision_context.refers_to_photo(normalize_text(message)))
    selected = vision_context.select(entry, book_id) if used else None
    ctx = {"attachment_id": attachment_id, "status": entry["status"], "used": used, "book": selected,
           "candidates": entry["candidates"] if used and not selected else [], "ocr": entry["ocr"]}
    if selected:
        ctx["availability"] = (await _public_availability([selected["book_id"]])).get(selected["book_id"])
    return ctx


def image_prompt_block(ctx: dict | None) -> str:
    """The recognised photo as system-built context for the model (never the image)."""
    if not ctx or not ctx.get("used"):
        return ""
    lines = ["\n## Ngữ cảnh ảnh bìa người dùng đã gửi (do hệ thống nhận diện bằng OCR + so khớp ảnh, không phải do "
             "người dùng tự khai)"]
    book = ctx.get("book")
    if book:
        lines.append(f"- Sách đang được nói tới (“sách này”): {book.get('title')}"
                     + (f" — tác giả {', '.join(book.get('authors') or [])}" if book.get("authors") else "")
                     + (f" — ISBN {book['isbn']}" if book.get("isbn") else "")
                     + (f" — NXB {book['publisher']}" if book.get("publisher") else ""))
        lines.append(f"- Trạng thái nhận diện: {ctx.get('status')} (cơ sở: {book.get('match_basis')})")
        avail = ctx.get("availability")
        if avail:
            branches = "; ".join(f"{b['name']}: {b['available_quantity']} bản" for b in avail.get("branches") or [])
            lines.append(f"- Danh mục công khai (truy xuất lúc {avail.get('retrieved_at')}): {avail.get('available_quantity')} "
                         f"bản sẵn sàng tại chi nhánh nhận sách" + (f" ({branches})" if branches else "")
                         + (f"; lượt mượn công khai: {avail['borrow_count']}" if avail.get("borrow_count") is not None
                            else ""))
        else:
            lines.append("- Không đọc được tình trạng tại chi nhánh lúc này: nói rõ là chưa có dữ liệu, không đoán.")
    elif ctx.get("status") == vision_context.NO_MATCH:
        lines.append("- Không nhận diện được sách trong ảnh. Nói rõ điều đó; gợi ý chụp lại hoặc tìm theo tên/ISBN."
                     + (f" OCR đọc được: {ctx['ocr'].get('title')}" if (ctx.get("ocr") or {}).get("title") else ""))
    else:
        names = "; ".join(c.get("title") or "?" for c in ctx.get("candidates") or [])
        lines.append(f"- Chưa xác định chắc chắn. Các khả năng: {names}. Không chọn hộ người dùng; đề nghị họ chọn đúng sách.")
    lines.append("- Chỉ dùng thông tin ở trên cho sách trong ảnh; không suy đoán thêm thông tin không có ở đây.")
    return "\n".join(lines) + "\n"
