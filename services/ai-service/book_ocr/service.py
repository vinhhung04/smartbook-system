"""Scan orchestration: prepare -> one model call (+ at most one opt-in
fallback) -> validate -> existing ISBN lookup -> field-level proposals.

Nothing here writes to the catalog; the result only feeds the AI Import
review form. Fallback policy (only when OPENROUTER_BOOK_OCR_FALLBACK_MODEL is
set and today's fallback spend is under BOOK_OCR_FALLBACK_DAILY_BUDGET_USD):
the primary model failed upstream, answered with unusable JSON, or read
neither a title nor an ISBN from any image. A missing optional field or a
disagreement between images never triggers it - a second model's opinion
cannot settle which printed value is right, so conflicts go to staff.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
from typing import Awaitable, Callable

from cache import SummaryCache
from metadata_intelligence.verification import canonical_isbn
from metrics import ai_book_ocr_scans_total

from .config import IMAGE_KINDS, BookOcrSettings, load_settings
from .errors import BookOcrError
from .extractor import Attempt, call_model, default_provider_factory, fallback_budget
from .images import prepare_image
from .prompts import build_prompt
from .reconcile import FORM_FIELDS, build_proposals, lookup_mismatch
from .schemas import (OCR_FIELDS, PROMPT_VERSION, FieldResult, IsbnLookupOutcome, ScanResponse, ScanUsage)
from .validation import validate_extraction

logger = logging.getLogger("uvicorn.error")

LookupFn = Callable[[str], Awaitable[dict]]
USABLE = {"EXTRACTED", "CORROBORATED", "REVIEW_REQUIRED", "INFERRED"}
# OCR field -> name in the flat `metadata` / `fieldEvidence` / missing lists.
METADATA_NAMES = {"publicationYear": "publishedYear", "isbn": "isbn13"}

# Model answers for identical (processed) images: re-scanning the same photos
# re-uses the answer instead of paying for it again. Images are not stored.
extraction_cache = SummaryCache(max_size=100, ttl_seconds=24 * 3600)
_active_scans = 0


def _name(field: str) -> str:
    return METADATA_NAMES.get(field, field)


def _usable(result: FieldResult | None):
    return result.value if result and result.status in USABLE else None


def _reads_core(validated: dict) -> int:
    """How many of title / ISBN have at least one valid reading."""
    fields = validated["fields"]
    return sum(1 for f in ("title", "isbn") if any(o.valid for o in fields[f].observations))


def _cache_key(settings: BookOcrSettings, prepared) -> str:
    parts = [PROMPT_VERSION, settings.model, settings.fallback_model, settings.max_tokens,
             [(p.kind, hashlib.sha256(p.data).hexdigest()) for p in prepared]]
    return "book-ocr:" + hashlib.sha256(json.dumps(parts).encode()).hexdigest()


async def _extract(prepared, settings: BookOcrSettings, provider_factory, uploaded: list[str],
                   barcode: str | None) -> tuple[dict, str, list, bool, list[str]]:
    """(raw model JSON, model that produced it, usage calls, fallback used, warnings)."""
    prompt = build_prompt(uploaded)
    calls, warnings = [], []
    primary = await call_model(provider_factory(settings.model), prepared, prompt, max_tokens=settings.max_tokens,
                               timeout=settings.timeout_seconds, trigger="primary")
    calls.append(primary.usage)
    reason = None
    if primary.error:
        reason = "INVALID_RESPONSE" if primary.error.code in ("AI_INVALID_RESPONSE", "AI_INVALID_SCHEMA") else "UPSTREAM_ERROR"
    elif _reads_core(validate_extraction(primary.raw, uploaded, barcode)) == 0:
        reason = "CRITICAL_FIELDS_UNREADABLE"
    chosen: Attempt = primary
    used_model, fallback_used = settings.model, False
    if reason and settings.fallback_model:
        if fallback_budget.allows(settings.fallback_daily_budget_usd):
            fallback = await call_model(provider_factory(settings.fallback_model), prepared, prompt,
                                        max_tokens=settings.max_tokens, timeout=settings.timeout_seconds,
                                        trigger=f"fallback:{reason}")
            calls.append(fallback.usage)
            fallback_budget.record(fallback.usage.costUsd)
            better = not fallback.error and (primary.raw is None or _reads_core(
                validate_extraction(fallback.raw, uploaded, barcode)) > _reads_core(validate_extraction(primary.raw, uploaded, barcode)))
            if better:
                chosen, used_model, fallback_used = fallback, settings.fallback_model, True
                warnings.append(f"FALLBACK_USED:{reason}")
        else:
            warnings.append("FALLBACK_BUDGET_EXHAUSTED")
    if chosen.raw is None:
        raise primary.error
    return chosen.raw, used_model, calls, fallback_used, warnings


async def _lookup(isbn_field: FieldResult, lookup_isbn: LookupFn | None, timeout: float) -> IsbnLookupOutcome:
    if isbn_field.status == "CONFLICTED":
        return IsbnLookupOutcome(status="SKIPPED_ISBN_CONFLICT")
    isbn = canonical_isbn(_usable(isbn_field))
    if not isbn:
        return IsbnLookupOutcome(status="SKIPPED_NO_VALID_ISBN")
    if lookup_isbn is None:
        return IsbnLookupOutcome(status="DISABLED", isbn=isbn)
    try:
        lookup = await asyncio.wait_for(lookup_isbn(isbn), timeout=timeout)
    except asyncio.TimeoutError:
        return IsbnLookupOutcome(status="TIMEOUT", isbn=isbn)
    except Exception as exc:  # noqa: BLE001 - the OCR result stays usable without it
        logger.warning("book_ocr isbn lookup failed: %s", type(exc).__name__)
        return IsbnLookupOutcome(status="ERROR", isbn=isbn)
    if not isinstance(lookup, dict) or not lookup.get("found"):
        return IsbnLookupOutcome(status="NOT_FOUND", isbn=isbn, lookup=lookup if isinstance(lookup, dict) else None)
    lookup_isbn13 = canonical_isbn(lookup.get("isbn13") or lookup.get("isbn"))
    return IsbnLookupOutcome(status="FOUND", isbn=isbn, lookup=lookup,
                             editionMatches=lookup_isbn13 == isbn if lookup_isbn13 else None)


def _metadata(fields: dict[str, FieldResult], isbn10: str | None) -> dict:
    meta = {_name(f): _usable(fields[f]) for f in (*OCR_FIELDS, "language")}
    for list_field in ("authors", "translators"):
        meta[list_field] = meta[list_field] or []
    meta["isbn10"] = isbn10
    return meta


async def scan_book_images(uploads: dict[str, bytes], *, barcode: str | None = None,
                           lookup_isbn: LookupFn | None = None, provider_factory=None,
                           settings: BookOcrSettings | None = None) -> dict:
    global _active_scans
    settings = settings or load_settings()
    if not settings.enabled:
        raise BookOcrError(404, "BOOK_OCR_DISABLED", "Tính năng nhập sách bằng ảnh đang tắt.")
    unknown = sorted(set(uploads) - set(IMAGE_KINDS))
    if unknown:
        raise BookOcrError(400, "UNKNOWN_IMAGE_SLOT", "Loại ảnh không hợp lệ: " + ", ".join(unknown))
    kinds = [kind for kind in IMAGE_KINDS if kind in uploads]
    if not kinds:
        raise BookOcrError(400, "NO_IMAGES", "Cần ít nhất một ảnh: bìa trước, bìa sau hoặc trang thông tin xuất bản.")
    if len(kinds) > settings.max_images:
        raise BookOcrError(400, "TOO_MANY_IMAGES", f"Tối đa {settings.max_images} ảnh cho mỗi lần quét.")
    if sum(len(uploads[k]) for k in kinds) > settings.max_total_bytes:
        raise BookOcrError(413, "UPLOAD_TOO_LARGE",
                           f"Tổng dung lượng ảnh vượt quá {settings.max_total_bytes // (1024 * 1024)} MB.")
    if _active_scans >= settings.max_concurrency:
        raise BookOcrError(429, "OCR_BUSY", "Hệ thống đang xử lý nhiều lượt quét. Vui lòng thử lại sau vài giây.")
    _active_scans += 1
    started = time.perf_counter()
    outcome = "error"
    try:
        prepared = []
        for kind in kinds:  # one at a time: bounds peak memory on a small VPS
            prepared.append(await asyncio.to_thread(
                prepare_image, kind, uploads[kind], max_file_bytes=settings.max_file_bytes,
                max_pixels=settings.max_pixels, max_edge=settings.max_image_edge))
        key = _cache_key(settings, prepared)
        cached = extraction_cache.get(key)
        if cached:
            raw, used_model, calls, fallback_used, warnings = cached["raw"], cached["model"], [], False, []
        else:
            raw, used_model, calls, fallback_used, warnings = await _extract(
                prepared, settings, provider_factory or default_provider_factory, kinds, barcode)
            extraction_cache.set(key, {"raw": raw, "model": used_model})
        validated = validate_extraction(raw, kinds, barcode)
        fields: dict[str, FieldResult] = validated["fields"]
        isbn_lookup = await _lookup(fields["isbn"], lookup_isbn, settings.lookup_timeout_seconds)
        if isbn_lookup.status in ("TIMEOUT", "ERROR", "NOT_FOUND"):
            warnings.append(f"ISBN_LOOKUP_{isbn_lookup.status}")
        if isbn_lookup.status == "FOUND":
            problem = lookup_mismatch(fields, isbn_lookup.lookup, isbn_lookup.editionMatches)
            if problem:
                warnings.append("ISBN_" + problem)
        proposals = build_proposals(fields, isbn_lookup.lookup if isbn_lookup.status == "FOUND" else None,
                                    isbn_lookup.editionMatches)
        if any(fields[f].status == "CONFLICTED" for f in ("title", "isbn")):
            # The photos may be of two different books: nothing is safe to fill on its own.
            warnings.append("IMAGES_MAY_SHOW_DIFFERENT_BOOKS")
            for item in proposals.values():
                if item.safeToApply:
                    item.safeToApply = False
                    item.reasons.append("IMAGES_MAY_SHOW_DIFFERENT_BOOKS")
        isbn10 = proposals["isbn10"].ocrValue
        metadata = _metadata(fields, isbn10)
        ocr_names = {form: ocr for form, (ocr, _) in FORM_FIELDS.items()}
        conflicted = {_name(f) for f, r in fields.items() if r.status == "CONFLICTED"}
        conflicted |= {_name(ocr_names[p.formField]) for p in proposals.values()
                       if p.status == "CONFLICTED" and ocr_names[p.formField]}
        status = "SUCCESS" if metadata["title"] or metadata["isbn13"] else \
            "PARTIAL" if any(v for k, v in metadata.items() if k != "language") else "NO_DATA"
        outcome = status.lower()
        usage = ScanUsage(
            model=used_model, fallbackUsed=fallback_used, cacheHit=bool(cached), imageCount=len(prepared),
            promptTokens=sum(c.promptTokens or 0 for c in calls), completionTokens=sum(c.completionTokens or 0 for c in calls),
            costUsd=round(sum(c.costUsd for c in calls if c.costUsd is not None), 6)
            if any(c.costUsd is not None for c in calls) else (0.0 if cached else None),
            latencyMs=sum(c.latencyMs for c in calls), calls=calls,
        )
        response = ScanResponse(
            status=status, images=[p.summary() for p in prepared], metadata=metadata, fields=fields,
            fieldEvidence={_name(f): [{"source": o.source, "observedText": o.observedText or o.value}
                                      for o in r.observations if o.valid]
                           for f, r in fields.items() if any(o.valid for o in r.observations)},
            missingFields=[_name(f) for f, r in fields.items() if r.status == "MISSING"],
            conflictedFields=sorted(conflicted), otherCodes=validated["otherCodes"],
            warnings=sorted(set(validated["warnings"] + warnings)), isbnLookup=isbn_lookup, proposals=proposals,
            usage=usage, processingTimeMs=round((time.perf_counter() - started) * 1000),
        )
        logger.info("book_ocr_scan %s", json.dumps({
            "images": len(prepared), "outcome": outcome, "model": used_model, "cacheHit": bool(cached),
            "fallbackUsed": fallback_used, "promptTokens": usage.promptTokens, "completionTokens": usage.completionTokens,
            "costUsd": usage.costUsd, "modelLatencyMs": usage.latencyMs, "totalMs": response.processingTimeMs,
            "isbnLookup": isbn_lookup.status, "conflicts": len(conflicted),
        }))
        return response.model_dump()
    except BookOcrError as error:
        outcome = error.code.lower()
        raise
    finally:
        _active_scans -= 1
        ai_book_ocr_scans_total.labels(outcome=outcome, images=str(len(kinds))).inc()
