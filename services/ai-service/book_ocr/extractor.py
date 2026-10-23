"""One multimodal OpenRouter call per attempt, with upstream failures mapped to
readable BookOcrErrors. No re-asking the model just to fix JSON formatting:
an unusable answer is an error (or, if configured, the one fallback call)."""
from __future__ import annotations

import asyncio
import datetime
import logging
import time
from dataclasses import dataclass

import httpx

from llm_provider import OpenRouterProvider, VisionImage, VisionResponseError, openrouter_connection

from .errors import BookOcrError
from .images import PreparedImage
from .schemas import UsageCall

logger = logging.getLogger("uvicorn.error")


def default_provider_factory(model: str) -> OpenRouterProvider:
    """A provider WITHOUT the global OPENROUTER_FALLBACK_MODEL: book OCR only
    ever calls the model it was configured with (see service fallback policy)."""
    try:
        api_key, base_url = openrouter_connection()
    except ValueError:
        raise BookOcrError(503, "AI_NOT_CONFIGURED", "Dịch vụ AI OCR chưa được cấu hình (thiếu OpenRouter API key).")
    return OpenRouterProvider(api_key=api_key, base_url=base_url, model=model, fallback_model=None)


@dataclass
class Attempt:
    raw: dict | None
    usage: UsageCall
    error: BookOcrError | None = None


def map_upstream_error(exc: Exception) -> BookOcrError:
    if isinstance(exc, BookOcrError):
        return exc
    if isinstance(exc, (asyncio.TimeoutError, httpx.TimeoutException)):
        return BookOcrError(504, "AI_TIMEOUT", "AI đọc ảnh quá lâu và đã bị ngắt. Vui lòng thử lại hoặc dùng ảnh rõ hơn.")
    if isinstance(exc, httpx.HTTPStatusError):
        if exc.response.status_code == 429:
            return BookOcrError(429, "AI_RATE_LIMITED", "Dịch vụ AI đang quá tải. Vui lòng thử lại sau ít phút.")
        return BookOcrError(502, "AI_UPSTREAM_ERROR", "Dịch vụ AI tạm thời lỗi. Vui lòng thử lại sau.")
    if isinstance(exc, VisionResponseError):
        return BookOcrError(502, "AI_INVALID_RESPONSE", "AI không trả về kết quả đúng định dạng. Vui lòng thử lại.")
    if isinstance(exc, httpx.TransportError):
        return BookOcrError(502, "AI_UPSTREAM_ERROR", "Không kết nối được dịch vụ AI. Vui lòng thử lại sau.")
    return BookOcrError(502, "AI_UPSTREAM_ERROR", "Dịch vụ AI tạm thời lỗi. Vui lòng thử lại sau.")


async def call_model(provider, images: list[PreparedImage], prompt: str, *, max_tokens: int,
                     timeout: float, trigger: str) -> Attempt:
    started = time.perf_counter()
    vision_images = [VisionImage(label=image.kind, data=image.data, mime=image.mime) for image in images]
    try:
        # The provider retries a fast 429/5xx once; this bound keeps a slow
        # timeout from being waited out twice.
        parsed, usage = await asyncio.wait_for(
            provider.analyze_images(vision_images, prompt, max_tokens=max_tokens, timeout=timeout, feature="book_ocr"),
            timeout=timeout + 10,
        )
    except Exception as exc:  # noqa: BLE001 - every failure becomes a typed attempt
        error = map_upstream_error(exc)
        spent = getattr(exc, "usage", None)
        logger.warning("book_ocr model=%s trigger=%s failed: %s", provider.model, trigger, error.code)
        return Attempt(raw=None, error=error, usage=UsageCall(
            model=getattr(spent, "model", None) or provider.model, trigger=trigger,
            status="INVALID_RESPONSE" if error.code == "AI_INVALID_RESPONSE" else "ERROR",
            latencyMs=round((time.perf_counter() - started) * 1000),
            promptTokens=getattr(spent, "prompt_tokens", None), completionTokens=getattr(spent, "completion_tokens", None),
            costUsd=getattr(spent, "cost_usd", None), error=error.code))
    call = UsageCall(model=usage.model, trigger=trigger, status="OK", latencyMs=round(usage.latency_ms),
                     promptTokens=usage.prompt_tokens, completionTokens=usage.completion_tokens, costUsd=usage.cost_usd)
    if not isinstance(parsed.get("observations"), dict):
        call.status, call.error = "INVALID_RESPONSE", "AI_INVALID_SCHEMA"
        return Attempt(raw=None, usage=call, error=BookOcrError(
            502, "AI_INVALID_SCHEMA", "AI trả về dữ liệu sai cấu trúc. Vui lòng thử lại."))
    return Attempt(raw=parsed, usage=call)


class FallbackBudget:
    """Process-local daily USD cap for the optional fallback model. A call
    whose cost OpenRouter did not report is counted at `unknown_cost_usd` so
    an unreported price can never make the cap unlimited."""

    def __init__(self, unknown_cost_usd: float = 0.01) -> None:
        self._day: datetime.date | None = None
        self._spent = 0.0
        self._unknown = unknown_cost_usd

    def _roll(self) -> None:
        today = datetime.date.today()
        if self._day != today:
            self._day, self._spent = today, 0.0

    def allows(self, daily_budget_usd: float) -> bool:
        self._roll()
        return self._spent < daily_budget_usd

    def record(self, cost_usd: float | None) -> None:
        self._roll()
        self._spent += cost_usd if cost_usd is not None else self._unknown


fallback_budget = FallbackBudget()
