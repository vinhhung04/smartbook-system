"""Feature A - AI Visual Evidence Verification, by an independent second model.

A second OpenRouter vision model, from a different family than the OCR model
(default google/gemini-3.1-flash-lite vs. the qwen OCR model), transcribes the
printed text of each image WITHOUT being told what the OCR model read - a blind
re-read, so it cannot simply agree with a suggested answer. Code then checks
each OCR reading against that independent transcription of the same image.
validation.py names the gap this closes: `observedText` is the OCR model's own
transcription, never independent image evidence.

The verifier also returns a box per transcribed line (Gemini's box_2d,
[ymin, xmin, ymax, xmax] on a 0-1000 grid). Those boxes are only where THAT
model says it read the line - measured close on a synthetic cover (IoU 0.82-0.97)
but never pixel-checked - so the UI must label them as the verifier's own
indication, not as verified positions. A malformed box is dropped; the line
text still counts. `description` is not checked - the verifier is asked for
only the start of long paragraphs (see the prompt), so a long blurb could only
ever come out partially matched.

Cost control mirrors the optional OCR fallback model: a per-process daily USD
cap, and a cache keyed by the exact processed images so re-scanning the same
photos never pays twice. Any failure leaves the scan result intact with no
visual evidence and a warning code - verification is advisory, never blocking.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import time
from typing import Literal

from cache import SummaryCache
from llm_provider import VisionImage

from .extractor import FallbackBudget
from .normalization import fold
from .schemas import UsageCall

logger = logging.getLogger("uvicorn.error")

VERIFY_PROMPT_VERSION = "book-ocr-verify-v2"
UNCHECKED_FIELDS = {"description"}
VisualStatus = Literal["VERIFIED", "PARTIALLY_VERIFIED", "UNVERIFIED", "ILLEGIBLE"]

verification_cache = SummaryCache(max_size=100, ttl_seconds=24 * 3600)
verify_budget = FallbackBudget()


def build_verify_prompt(labels: list[str]) -> str:
    return (
        "You are a careful transcriber. For EACH image below (its label is given before it), "
        "list the printed lines of text you can read on it, exactly as printed: keep Vietnamese "
        "tone marks, letters and digits as they appear. One entry per printed line, with its "
        "bounding box as box_2d = [ymin, xmin, ymax, xmax], integers 0-1000 relative to that "
        "image's height and width. "
        "Do not translate, correct, complete or guess - leave out anything you cannot read. "
        "For long paragraphs (back-cover blurbs) list only their first two lines. "
        "If an image is too blurry or dark to read at all, set legible to false and lines to [].\n"
        f"Image labels: {', '.join(labels)}\n"
        'Answer with JSON only: {"images": [{"source": "<label>", "legible": true, '
        '"lines": [{"text": "<printed line>", "box_2d": [ymin, xmin, ymax, xmax]}]}]}'
    )


def _cache_key(model: str, max_tokens: int, prepared) -> str:
    parts = [VERIFY_PROMPT_VERSION, model, max_tokens, [(p.kind, hashlib.sha256(p.data).hexdigest()) for p in prepared]]
    return "book-ocr-verify:" + hashlib.sha256(json.dumps(parts).encode()).hexdigest()


def _parse_box(raw) -> dict | None:
    """box_2d [ymin, xmin, ymax, xmax] on 0-1000 -> {x, y, width, height} fractions
    of the image, or None when it is not a usable rectangle."""
    if not isinstance(raw, list) or len(raw) != 4:
        return None
    if not all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in raw):
        return None
    ymin, xmin, ymax, xmax = (min(1000.0, max(0.0, float(v))) for v in raw)
    if ymax <= ymin or xmax <= xmin:
        return None
    return {"x": round(xmin / 1000, 4), "y": round(ymin / 1000, 4),
            "width": round((xmax - xmin) / 1000, 4), "height": round((ymax - ymin) / 1000, 4)}


def _parse_readings(parsed: dict, allowed: set[str]) -> dict[str, dict]:
    """{kind: {"legible": bool, "lines": [{"text", "box"}]}}"""
    readings: dict[str, dict] = {}
    for item in parsed.get("images") or []:
        if not isinstance(item, dict) or item.get("source") not in allowed:
            continue
        lines = []
        for line in item.get("lines") or []:
            text = line.get("text") if isinstance(line, dict) else None
            if isinstance(text, str) and text.strip():
                lines.append({"text": text.strip()[:500], "box": _parse_box(line.get("box_2d"))})
        readings[item["source"]] = {"legible": item.get("legible") is not False, "lines": lines[:200]}
    return readings


async def read_images(prepared, settings, provider_factory) -> tuple[dict[str, dict], list[UsageCall], list[str]]:
    """({image kind: {"legible", "lines"}}, usage calls, warning codes). Never
    raises: an empty readings dict means "nothing verified", never "rejected"."""
    model = settings.verify_model
    if not model:
        return {}, [], ["VISUAL_VERIFICATION_NOT_CONFIGURED"]
    if model == settings.model:
        # Re-reading with the OCR model itself would be the model agreeing with itself.
        return {}, [], ["VISUAL_VERIFICATION_SAME_MODEL"]
    key = _cache_key(model, settings.verify_max_tokens, prepared)
    cached = verification_cache.get(key)
    if cached is not None:
        return cached, [], []
    if not verify_budget.allows(settings.verify_daily_budget_usd):
        return {}, [], ["VISUAL_VERIFICATION_BUDGET_EXHAUSTED"]
    labels = [p.kind for p in prepared]
    started = time.perf_counter()
    try:
        provider = provider_factory(model)
        parsed, usage = await asyncio.wait_for(
            provider.analyze_images([VisionImage(label=p.kind, data=p.data, mime=p.mime) for p in prepared],
                                    build_verify_prompt(labels), max_tokens=settings.verify_max_tokens,
                                    timeout=settings.timeout_seconds, feature="book_ocr_verify"),
            timeout=settings.timeout_seconds + 10,
        )
    except Exception as exc:  # noqa: BLE001 - advisory step: any failure only drops the evidence
        spent = getattr(exc, "usage", None)
        cost = getattr(spent, "cost_usd", None)
        if cost is not None:
            verify_budget.record(cost)
        logger.warning("book_ocr verify model=%s failed: %s", model, type(exc).__name__)
        return {}, [UsageCall(model=model, trigger="verify", status="ERROR",
                              latencyMs=round((time.perf_counter() - started) * 1000),
                              promptTokens=getattr(spent, "prompt_tokens", None),
                              completionTokens=getattr(spent, "completion_tokens", None),
                              costUsd=cost, error=type(exc).__name__)], ["VISUAL_VERIFICATION_UNAVAILABLE"]
    verify_budget.record(usage.cost_usd)
    readings = _parse_readings(parsed, set(labels))
    verification_cache.set(key, readings)
    return readings, [UsageCall(model=usage.model or model, trigger="verify", status="OK", latencyMs=round(usage.latency_ms),
                                promptTokens=usage.prompt_tokens, completionTokens=usage.completion_tokens,
                                costUsd=usage.cost_usd)], []


def _tokens(value) -> list[str]:
    return re.findall(r"\w+", fold(str(value)))


def verify_value(value, reading: dict | None) -> dict:
    """Checks `value`'s words (fold-normalized: case/diacritic-insensitive, the
    same fuzzy key used across book_ocr) against the second model's own,
    independent transcription of the SAME image. `readText` is the line(s) of
    that transcription that matched, so staff can see what it read; `boxes` are
    where the verifier says those lines are (only lines it gave a valid box)."""
    unread = {"status": "ILLEGIBLE", "readText": None, "boxes": []}
    entries = (reading or {}).get("lines") or []
    if not reading or not reading.get("legible") or not entries:
        return unread
    target = _tokens(value)
    if not target:
        return unread
    lines = [entry["text"] for entry in entries]
    available = {token for line in lines for token in _tokens(line)}
    matched = [token for token in target if token in available]
    if not matched:
        return {"status": "UNVERIFIED", "readText": None, "boxes": []}
    # The fewest lines that cover the matched words, best line first - so a line that
    # merely shares one common word ("Nhà" in "NXB Hội Nhà Văn") is not shown.
    remaining, chosen = set(matched), []
    while remaining:
        best = max(range(len(lines)), key=lambda i: len(remaining & set(_tokens(lines[i]))))
        covered = remaining & set(_tokens(lines[best]))
        if not covered:
            break
        chosen.append(best)
        remaining -= covered
    status: VisualStatus = "VERIFIED" if len(matched) == len(target) else "PARTIALLY_VERIFIED"
    shown = sorted(chosen)[:3]
    return {"status": status, "readText": " / ".join(lines[i] for i in shown)[:300] or None,
            "boxes": [entries[i]["box"] for i in shown if entries[i].get("box")]}
