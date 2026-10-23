"""Book OCR settings, read from env on each call so tests can patch env.

Defaults are sized for qwen/qwen3.7-flash on OpenRouter:
- 1600 px long edge keeps 6-7 pt copyright-page text legible on a phone
  photo of an A5 page (~75 px/cm) while costing far fewer image tokens than
  a 12 MP original.
- 1800 output tokens fit a full JSON answer for three images including a
  long back-cover blurb; the extraction prompt asks for nothing else.
- MAX_TOTAL_MB defaults to 8 MB, the API Gateway's own request cap
  (GATEWAY_MAX_REQUEST_BYTES); the web client resizes before upload.
"""
from __future__ import annotations

import os
from dataclasses import dataclass

IMAGE_KINDS = ("front_cover", "back_cover", "copyright_page")


def _int(name: str, default: int, low: int, high: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        return default
    return max(low, min(high, value))


def _float(name: str, default: float, low: float, high: float) -> float:
    try:
        value = float(os.getenv(name, str(default)))
    except ValueError:
        return default
    return max(low, min(high, value))


@dataclass(frozen=True)
class BookOcrSettings:
    enabled: bool
    model: str
    fallback_model: str | None
    max_images: int
    max_tokens: int
    timeout_seconds: float
    max_file_bytes: int
    max_total_bytes: int
    max_image_edge: int
    max_pixels: int
    lookup_timeout_seconds: float
    fallback_daily_budget_usd: float
    max_concurrency: int


def load_settings() -> BookOcrSettings:
    mb = 1024 * 1024
    return BookOcrSettings(
        enabled=os.getenv("BOOK_OCR_ENABLED", "true").strip().lower() in ("1", "true", "on", "yes"),
        model=os.getenv("OPENROUTER_BOOK_OCR_MODEL", "").strip() or "qwen/qwen3.7-flash",
        # Never derived from OPENROUTER_FALLBACK_MODEL or any built-in list:
        # empty means no second model is ever called.
        fallback_model=os.getenv("OPENROUTER_BOOK_OCR_FALLBACK_MODEL", "").strip() or None,
        max_images=_int("BOOK_OCR_MAX_IMAGES", 3, 1, 3),
        max_tokens=_int("BOOK_OCR_MAX_TOKENS", 1800, 300, 4000),
        timeout_seconds=_float("BOOK_OCR_TIMEOUT_SECONDS", 45, 5, 120),
        max_file_bytes=int(_float("BOOK_OCR_MAX_FILE_MB", 8, 0.1, 20) * mb),
        max_total_bytes=int(_float("BOOK_OCR_MAX_TOTAL_MB", 8, 0.1, 40) * mb),
        max_image_edge=_int("BOOK_OCR_MAX_IMAGE_EDGE", 1600, 640, 3000),
        # Hard ceiling checked from the header BEFORE decoding (decompression bombs).
        max_pixels=_int("BOOK_OCR_MAX_PIXELS", 40_000_000, 1_000_000, 80_000_000),
        lookup_timeout_seconds=_float("BOOK_OCR_LOOKUP_TIMEOUT_SECONDS", 35, 1, 90),
        fallback_daily_budget_usd=_float("BOOK_OCR_FALLBACK_DAILY_BUDGET_USD", 0.5, 0, 100),
        max_concurrency=_int("BOOK_OCR_MAX_CONCURRENCY", 2, 1, 8),
    )
