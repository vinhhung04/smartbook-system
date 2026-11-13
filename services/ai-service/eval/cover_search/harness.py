"""Experiment harness: runs the PRODUCTION endpoint function
routes_cover_search.find_book_by_cover() on research queries.

Nothing here re-implements CLIP, OCR, text ranking or fusion. The harness only
replaces, inside this Python process, the two *data sources* the endpoint reads
over the network (catalog via the Gateway, gallery via inventory-service +
ai_db) with the research catalog snapshot, and ablates one signal branch to
obtain the two single-signal baselines:

- method "hybrid":   production endpoint unchanged (both branches live)
- method "ocr_only": _match_visual -> []           (CLIP branch removed)
- method "clip_only": _run_cover_ocr -> no text    (OCR branch removed)

Fusion (_merge_candidates), the 0.80 visual gate, the 0.5 confidence gate and
the top-5 limit therefore remain exactly the production code for every method.

The vision call is observed through a thin provider wrapper that records the
raw JSON the model returned plus OpenRouter's usage (latency, tokens, cost),
so OCR-only and Hybrid can reuse the *same* OCR response for a query (paired
comparison, half the API cost). Query text embeddings go through the repo's
existing eval/embed_cache.py for the same reason.
"""
from __future__ import annotations

import asyncio
import hashlib
import importlib.util
import io
import json
import math
import time
from dataclasses import dataclass, field
from pathlib import Path

from common import AI_SERVICE_DIR, setup_environment

setup_environment()

import cover_embeddings  # noqa: E402
import cover_gallery  # noqa: E402
import embeddings  # noqa: E402
import ingestion  # noqa: E402
import llm_provider  # noqa: E402
import routes_cover_search as rcs  # noqa: E402
import vector_store  # noqa: E402
from starlette.datastructures import Headers, UploadFile  # noqa: E402
from starlette.requests import Request  # noqa: E402

METHODS = ("ocr_only", "clip_only", "hybrid")


def _load_embed_cache(cache_path: Path):
    spec = importlib.util.spec_from_file_location("embed_cache", AI_SERVICE_DIR / "eval" / "embed_cache.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.CACHE_PATH = str(cache_path)
    return module


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def production_config() -> dict:
    """The production parameters in force for this process (read from the
    imported modules, so a non-default env var would show up here)."""
    return {
        "clip_model": cover_embeddings.CLIP_MODEL_NAME,
        "vision_model": llm_provider.VISION_MODEL,
        "embed_identity": embeddings.EMBED_IDENTITY,
        "visual_threshold": rcs.COVER_SEARCH_VISUAL_THRESHOLD,
        "min_confidence": rcs.COVER_SEARCH_MIN_CONFIDENCE,
        "visual_weight": rcs.COVER_SEARCH_VISUAL_WEIGHT,
        "result_limit": rcs.COVER_SEARCH_RESULT_LIMIT,
        "ocr_max_tokens": rcs.COVER_OCR_MAX_TOKENS,
        "ocr_timeout_s": rcs.COVER_OCR_TIMEOUT_SECONDS,
        "ocr_prompt_sha256": hashlib.sha256(rcs.PROMPT_COVER_OCR.encode("utf-8")).hexdigest(),
        "keyword_mode": vector_store.KEYWORD_MODE,
        "vector_store": type(vector_store.get_store()).__name__ + " (research deviation, see PHASE_0 §5 / pg_fts_emulation.py)",
    }


# ---------------------------------------------------------------- OCR cache

class OcrCache:
    """Append-only JSONL of raw vision responses keyed by
    sha256(image) + model + sha256(prompt). Never overwritten: a second call for
    the same key is only made when the first one is absent."""

    def __init__(self, path: Path):
        self.path = path
        self.entries: dict[str, dict] = {}
        if path.exists():
            for line in path.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    entry = json.loads(line)
                    self.entries[entry["key"]] = entry

    @staticmethod
    def key(image_bytes: bytes, model: str, prompt: str) -> str:
        return f"{sha256_bytes(image_bytes)}|{model}|{hashlib.sha256(prompt.encode('utf-8')).hexdigest()[:16]}"

    def add(self, entry: dict) -> None:
        self.entries[entry["key"]] = entry
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.path, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")


class _ReplayedTimeout(Exception):
    pass


class RecordingVisionProvider:
    """Stands in for llm_provider.OpenRouterProvider inside routes_cover_search
    only. mode='live' calls the real provider and records; mode='replay' only
    serves recorded responses (a missing entry raises, which the production
    code turns into 'no OCR signal' — the harness flags that query as
    OCR_NOT_AVAILABLE so it is never silently scored)."""

    def __init__(self, model: str, cache: OcrCache, mode: str, budget_calls: int | None = None,
                 budget_usd: float | None = None, spent_usd_before: float = 0.0):
        self.model = model
        self.cache = cache
        self.mode = mode
        self.budget_calls = budget_calls
        self.budget_usd = budget_usd
        # Provider-reported cost of every call ever recorded in the cache (all runs).
        self.spent_usd = spent_usd_before
        self.live_calls = 0
        self.last: dict | None = None

    async def analyze_image(self, image_bytes, prompt, *, max_tokens, timeout, feature="vision", temperature=0.0):
        key = OcrCache.key(image_bytes, self.model, prompt)
        cached = self.cache.entries.get(key)
        if cached is not None:
            self.last = {**cached, "served_from": "cache"}
            if cached["outcome"] == "ok":
                return cached["data"], None
            if cached["outcome"] == "timeout":
                raise _ReplayedTimeout(cached.get("error"))
            raise llm_provider.VisionResponseError(cached.get("error") or "replayed failure")
        if self.mode != "live":
            self.last = {"outcome": "not_available", "served_from": "none"}
            raise RuntimeError("OCR response not recorded for this image (replay mode)")
        if self.budget_calls is not None and self.live_calls >= self.budget_calls:
            self.last = {"outcome": "budget_exhausted", "served_from": "none"}
            raise RuntimeError("research API call budget exhausted")
        if self.budget_usd is not None and self.spent_usd >= self.budget_usd:
            self.last = {"outcome": "budget_exhausted", "served_from": "none"}
            raise RuntimeError("research API USD budget exhausted")

        self.live_calls += 1
        real = llm_provider.get_openrouter_provider(self.model)
        started = time.perf_counter()
        entry = {"key": key, "model": self.model, "image_sha256": sha256_bytes(image_bytes),
                 "recorded_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        try:
            data, usage = await real.analyze_image(
                image_bytes, prompt, max_tokens=max_tokens, timeout=timeout,
                feature=feature, temperature=temperature)
            entry.update(outcome="ok", data=data, usage=_usage_dict(usage))
            self.spent_usd += usage.cost_usd or 0.0
        except Exception as exc:  # noqa: BLE001 - classify, record, re-raise for production handling
            import httpx
            usage = getattr(exc, "usage", None)
            outcome = "timeout" if isinstance(exc, (httpx.TimeoutException, TimeoutError)) else (
                "invalid_json" if isinstance(exc, llm_provider.VisionResponseError) else "api_error")
            entry.update(outcome=outcome, error=f"{type(exc).__name__}: {str(exc)[:300]}",
                         usage=_usage_dict(usage) if usage else None)
            self.spent_usd += (usage.cost_usd or 0.0) if usage else 0.0
            entry["wall_ms"] = round((time.perf_counter() - started) * 1000, 1)
            self.cache.add(entry)
            self.last = {**entry, "served_from": "live"}
            raise
        entry["wall_ms"] = round((time.perf_counter() - started) * 1000, 1)
        self.cache.add(entry)
        self.last = {**entry, "served_from": "live"}
        return data, usage


def _usage_dict(usage) -> dict:
    return {
        "provider": usage.provider, "model": usage.model, "latency_ms": usage.latency_ms,
        "prompt_tokens": usage.prompt_tokens, "completion_tokens": usage.completion_tokens,
        "cost_usd": usage.cost_usd, "error": getattr(usage, "error", None),
    }


# ---------------------------------------------------------------- gallery

def build_gallery(catalog_rows: list[dict], image_loader, cache_path: Path) -> tuple[list[dict], dict]:
    """One gallery row per catalog edition, embedded with the production
    cover_embeddings.embed_image(). Vectors are cached by image sha256+model."""
    cache: dict[str, list[float]] = {}
    if cache_path.exists():
        cache = json.loads(cache_path.read_text(encoding="utf-8"))
    rows, failures, times = [], [], []
    for row in catalog_rows:
        data = image_loader(row["gallery_asset_id"])
        key = f"{cover_embeddings.CLIP_MODEL_NAME}|{sha256_bytes(data)}"
        vector = cache.get(key)
        if vector is None:
            started = time.perf_counter()
            vector = cover_embeddings.embed_image(data)
            times.append((time.perf_counter() - started) * 1000)
            if vector is None:
                failures.append(row["edition_id"])
                continue
            cache[key] = vector
        rows.append({
            "variant_id": row["edition_id"], "book_id": row["book_id"],
            "title": row["title"], "author": row["author"],
            "cover_image_url": f"research://{row['gallery_asset_id']}", "vector": vector,
        })
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(cache), encoding="utf-8")
    return rows, {"gallery_rows": len(rows), "embed_failures": failures, "new_embeddings": len(times)}


KEYWORD_STORES = ("pg_emulation", "inmemory_repo")


async def index_catalog_text(books: list[dict], embed_cache, keyword_store: str = "pg_emulation") -> dict:
    """Production ingestion.ingest_books() into a fresh InMemoryVectorStore.
    The document texts are first embedded in ONE batched call (through the
    disk cache) so indexing costs one API request instead of one per book."""
    if keyword_store == "pg_emulation":
        from pg_fts_emulation import PgSemanticsInMemoryStore
        vector_store.set_store(PgSemanticsInMemoryStore())
    else:
        vector_store.set_store(vector_store.InMemoryVectorStore())
    import book_index
    texts = [book_index.book_text(book) for book in books]
    if embeddings.embed_batch(texts) is None:
        raise RuntimeError("catalog text embedding failed - OCR text ranking would silently lose its semantic branch")
    return await ingestion.ingest_books(books)


# ---------------------------------------------------------------- one query

@dataclass
class QueryOutcome:
    record: dict = field(default_factory=dict)


def _fake_request() -> Request:
    return Request({"type": "http", "method": "POST", "path": "/find-book-by-cover",
                    "headers": [(b"authorization", b"Bearer research-harness")]})


def _upload(image_bytes: bytes, filename: str, mime: str) -> UploadFile:
    return UploadFile(file=io.BytesIO(image_bytes), filename=filename, headers=Headers({"content-type": mime}))


class Harness:
    def __init__(self, books: list[dict], gallery: list[dict], vision: RecordingVisionProvider):
        self.books = books
        self.gallery = gallery
        self.vision = vision
        self._orig_match_visual = rcs._match_visual
        self._orig_run_cover_ocr = rcs._run_cover_ocr
        self._orig_embed_image = cover_embeddings.embed_image
        self._clip_ms: float | None = None
        self._clip_failed = False
        self._ocr_branch_ms: float | None = None
        self._clip_branch_ms: float | None = None
        self._install()

    def _install(self) -> None:
        books = self.books
        gallery = self.gallery

        async def fetch_catalog(_auth):
            return books

        async def get_gallery():
            return gallery

        rcs._fetch_catalog = fetch_catalog
        cover_gallery.get_gallery = get_gallery
        rcs.get_openrouter_provider = lambda model: self.vision

        harness = self
        original_embed = self._orig_embed_image

        def timed_embed(image_bytes):
            started = time.perf_counter()
            vector = original_embed(image_bytes)
            harness._clip_ms = (time.perf_counter() - started) * 1000
            harness._clip_failed = vector is None
            return vector

        cover_embeddings.embed_image = timed_embed

    def _set_method(self, method: str) -> None:
        harness = self
        orig_visual, orig_ocr = self._orig_match_visual, self._orig_run_cover_ocr

        async def timed_visual(image_bytes):
            started = time.perf_counter()
            try:
                return await orig_visual(image_bytes)
            finally:
                harness._clip_branch_ms = (time.perf_counter() - started) * 1000

        async def timed_ocr(image_bytes):
            started = time.perf_counter()
            try:
                return await orig_ocr(image_bytes)
            finally:
                harness._ocr_branch_ms = (time.perf_counter() - started) * 1000

        async def no_visual(_image_bytes):
            return []

        async def no_ocr(_image_bytes):
            return {"title": None, "author": None}

        rcs._match_visual = no_visual if method == "ocr_only" else timed_visual
        rcs._run_cover_ocr = no_ocr if method == "clip_only" else timed_ocr

    async def run(self, method: str, image_bytes: bytes, filename: str, mime: str) -> dict:
        if method not in METHODS:
            raise ValueError(method)
        self._set_method(method)
        self._clip_ms = self._clip_branch_ms = self._ocr_branch_ms = None
        self._clip_failed = False
        self.vision.last = None
        started = time.perf_counter()
        error = None
        try:
            response = await rcs.find_book_by_cover(_fake_request(), _upload(image_bytes, filename, mime))
        except Exception as exc:  # noqa: BLE001 - recorded, never dropped
            response, error = None, f"{type(exc).__name__}: {exc}"
        wall_ms = (time.perf_counter() - started) * 1000
        vision = self.vision.last if method != "clip_only" else None
        return {
            "method": method,
            "response": _strip_response(response),
            "endpoint_error": error,
            "wall_ms": round(wall_ms, 1),
            "clip_embed_ms": None if self._clip_ms is None else round(self._clip_ms, 1),
            "clip_branch_ms": None if self._clip_branch_ms is None else round(self._clip_branch_ms, 1),
            "ocr_branch_ms": None if self._ocr_branch_ms is None else round(self._ocr_branch_ms, 1),
            "clip_failed": self._clip_failed if method != "ocr_only" else None,
            "vision": _vision_summary(vision),
        }


def _vision_summary(vision: dict | None) -> dict | None:
    if not vision:
        return None
    usage = vision.get("usage") or {}
    return {
        "outcome": vision.get("outcome"),
        "served_from": vision.get("served_from"),
        "raw": vision.get("data"),
        "error": vision.get("error"),
        "api_latency_ms": usage.get("latency_ms"),
        "wall_ms": vision.get("wall_ms"),
        "prompt_tokens": usage.get("prompt_tokens"),
        "completion_tokens": usage.get("completion_tokens"),
        "cost_usd": usage.get("cost_usd"),
        "model_answered": usage.get("model"),
    }


def _strip_response(response: dict | None) -> dict | None:
    if response is None:
        return None
    return {
        "match_found": response["match_found"],
        "signals": response["signals"],
        "candidates": [
            {"id": c.get("id"), "variant_id": c.get("variant_id"), "title": c.get("title"),
             "confidence": c.get("confidence"), "evidence": c.get("evidence")}
            for c in response["candidates"]
        ],
    }


def raw_clip_ranking(query_vector: list[float], gallery: list[dict]) -> list[dict]:
    """DIAGNOSTIC ONLY (not a method): the un-gated CLIP ranking at book level
    (best edition per book), to separate 'wrong neighbour' from 'right
    neighbour removed by the 0.80 gate'."""
    best: dict[str, float] = {}
    for row in gallery:
        score = embeddings.cosine_similarity(query_vector, row["vector"])
        if score > best.get(row["book_id"], -math.inf):
            best[row["book_id"]] = score
    return [{"book_id": b, "score": round(s, 4)} for b, s in sorted(best.items(), key=lambda kv: -kv[1])]


def run_async(coro):
    return asyncio.run(coro)
