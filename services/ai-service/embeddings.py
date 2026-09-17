"""Embedding co circuit breaker: Ollama la provider chinh (chay offline duoc),
OpenRouter (qwen3-embedding-8b) la fallback khi Ollama loi lien tiep.

Dung boi book_index.py (tim sach), faq_retrieval.py (tim tai lieu noi bo),
ingestion.py (dong bo vector store). Moi ham o day khong bao gio raise —
ca hai provider loi tra None, caller phai tu degrade (vd bo tin hieu
semantic, chi con keyword search).
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import threading
import time
from typing import Callable, NamedTuple

import ollama

logger = logging.getLogger("uvicorn.error")


class EmbedResult(NamedTuple):
    vector: list[float]
    model: str
    provider: str


class BatchEmbedResult(NamedTuple):
    vectors: list[list[float]]
    model: str
    provider: str


class _BreakerState:
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


class EmbedCircuitBreaker:
    """State may thuan cho viec chon Ollama hay cloud, khong tu goi provider nao.

    CLOSED (Ollama) -> [threshold loi lien tiep] -> OPEN (cloud, dem cooldown)
    -> [het cooldown] -> HALF_OPEN (cho mot lan thu Ollama) -> CLOSED neu thanh
    cong / OPEN lai neu van loi.

    now_fn injectable de test khong phu thuoc thoi gian thuc troi qua that.

    Thread-safe: ca 4 call site goi embed_batch/embed_text qua asyncio.to_thread,
    tuc la chay song song tren OS thread that chu khong phai coroutine luan phien.
    Moi truy cap _state deu di qua _lock, va lan thu HALF_OPEN duoc TIEU THU boi
    dung MOT caller — caller nao lat OPEN -> HALF_OPEN thi nhan True, moi caller
    con lai nhan False cho toi khi record_success/record_failure giai quyet lan
    thu do. Neu khong, ca N request dong thoi cung dam vao mot Ollama dang chet
    moi chu ky cooldown (thundering herd) — dung thu ma circuit breaker sinh ra
    de tranh.
    """

    def __init__(
        self, threshold: int, cooldown_seconds: float,
        now_fn: Callable[[], float] = time.monotonic,
    ) -> None:
        self._threshold = threshold
        self._cooldown = cooldown_seconds
        self._now = now_fn
        self._consecutive_failures = 0
        self._state = _BreakerState.CLOSED
        self._opened_at: float | None = None
        self._lock = threading.Lock()

    def should_try_primary(self) -> bool:
        with self._lock:
            if self._state == _BreakerState.CLOSED:
                return True
            if self._state == _BreakerState.OPEN:
                if self._opened_at is not None and self._now() - self._opened_at >= self._cooldown:
                    self._state = _BreakerState.HALF_OPEN
                    return True  # caller nay gianh duoc lan thu duy nhat
                return False
            # HALF_OPEN: lan thu da co caller khac gianh, chua nga ngu -> di cloud.
            return False

    def is_open(self) -> bool:
        """Doc thuan, khong doi state. Khac should_try_primary() (co side effect
        lat OPEN -> HALF_OPEN). Dung de biet co duoc phep goi cloud hay khong."""
        with self._lock:
            return self._state == _BreakerState.OPEN

    def record_success(self) -> None:
        with self._lock:
            self._consecutive_failures = 0
            self._state = _BreakerState.CLOSED
            self._opened_at = None

    def record_failure(self) -> None:
        with self._lock:
            self._consecutive_failures += 1
            if self._state == _BreakerState.HALF_OPEN or self._consecutive_failures >= self._threshold:
                self._state = _BreakerState.OPEN
                self._opened_at = self._now()


OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://ollama:11434")
# Dedicated embedding model, separate from the chat models (SUMMARY_MODEL /
# ASSISTANT_MODEL). FAQ_EMBED_MODEL is the documented name in docker-compose
# and .env.example; EMBED_MODEL overrides it if both are set.
EMBED_MODEL = os.getenv("EMBED_MODEL") or os.getenv("FAQ_EMBED_MODEL", "nomic-embed-text")
# Hard bound on any single embedding call. Without it, the first index build
# after a catalog change could block an assistant turn indefinitely on a
# CPU-only Ollama; a timeout just means no semantic signal for that turn.
EMBED_TIMEOUT_SECONDS = float(os.getenv("EMBED_TIMEOUT_SECONDS", "30"))
CLOUD_EMBED_MODEL = os.getenv("CLOUD_EMBED_MODEL", "qwen/qwen3-embedding-8b")
CLOUD_EMBED_DIMENSIONS = int(os.getenv("CLOUD_EMBED_DIMENSIONS", "768"))
CLOUD_EMBED_TIMEOUT_SECONDS = float(os.getenv("CLOUD_EMBED_TIMEOUT_SECONDS", "30"))
EMBED_BREAKER_THRESHOLD = int(os.getenv("EMBED_BREAKER_THRESHOLD", "3"))
EMBED_BREAKER_COOLDOWN_SECONDS = float(os.getenv("EMBED_BREAKER_COOLDOWN_SECONDS", "60"))


class OllamaEmbedder:
    """Provider mac dinh, chay offline duoc. Logic y het embed_batch cu truoc
    Phase B — chi chuyen vao class de dung chung interface voi CloudEmbedder."""

    name = "ollama"

    def embed_batch(self, texts: list[str], client: "ollama.Client | None" = None) -> list[list[float]] | None:
        if not texts:
            return []
        try:
            active_client = client or ollama.Client(host=OLLAMA_HOST, timeout=EMBED_TIMEOUT_SECONDS)
            response = active_client.embed(model=EMBED_MODEL, input=texts)
            vectors = response.embeddings
            if len(vectors) != len(texts):
                logger.warning("embeddings: expected %d vectors, got %d", len(texts), len(vectors))
                return None
            return [list(vector) for vector in vectors]
        except Exception as exc:
            logger.warning("embeddings: ollama embedding failed: %s", type(exc).__name__)
            return None


class CloudEmbedder:
    """Fallback qua OpenRouter khi Ollama chet. `dimensions` LUON gui trong
    request de cat vector ve dung 768 chieu, khop cot vector(768) da co —
    khong duoc bo, model qwen3-embedding-8b mac dinh tra 4096 chieu."""

    name = "openrouter"

    def __init__(
        self, api_key: str, base_url: str, model: str, dimensions: int, timeout: float,
    ) -> None:
        self._api_key = api_key
        self._base_url = (base_url or "https://openrouter.ai/api/v1").rstrip("/")
        self._model = model
        self._dimensions = dimensions
        self._timeout = timeout

    def embed_batch(self, texts: list[str]) -> list[list[float]] | None:
        if not texts:
            return []
        if not self._api_key:
            # Khong co key thi request chac chan 401 — nhung van gui di la day
            # nguyen van query/tai lieu cua nguoi dung ra ngoai, tren dung cai
            # duong ma operator tin la "chi Ollama" vi ho chua bao gio cau hinh
            # key. Dung lai truoc khi mo bat ky ket noi nao.
            logger.warning("embeddings: OPENROUTER_API_KEY not set, cloud fallback disabled")
            return None
        import httpx

        try:
            with httpx.Client(timeout=self._timeout) as client:
                response = client.post(
                    f"{self._base_url}/embeddings",
                    headers={"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"},
                    json={"model": self._model, "input": texts, "dimensions": self._dimensions},
                )
                response.raise_for_status()
                data = response.json()
            vectors = [item["embedding"] for item in data.get("data", [])]
            if len(vectors) != len(texts):
                logger.warning("embeddings: openrouter expected %d vectors, got %d", len(texts), len(vectors))
                return None
            wrong_dim = next((len(v) for v in vectors if len(v) != self._dimensions), None)
            if wrong_dim is not None:
                # Neu lot qua day, loi chi lo ra rat muon duoi dang loi Postgres
                # "CAST ... AS vector" bi nuot — bao ngay tai day de dung.
                logger.warning(
                    "embeddings: openrouter expected %d dimensions, got %d",
                    self._dimensions, wrong_dim)
                return None
            return vectors
        except Exception as exc:
            logger.warning("embeddings: openrouter embedding failed: %s", type(exc).__name__)
            return None


_OLLAMA_EMBEDDER = OllamaEmbedder()
# Instance nay duoc mock trong test (mock.patch.object(embeddings, "_cloud_embedder"))
# thay vi mock ham/HTTP truc tiep — de test khong phu thuoc httpx.
_cloud_embedder = CloudEmbedder(
    api_key=os.getenv("OPENROUTER_API_KEY", ""),
    base_url=os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
    model=CLOUD_EMBED_MODEL, dimensions=CLOUD_EMBED_DIMENSIONS, timeout=CLOUD_EMBED_TIMEOUT_SECONDS,
)
_breaker = EmbedCircuitBreaker(threshold=EMBED_BREAKER_THRESHOLD, cooldown_seconds=EMBED_BREAKER_COOLDOWN_SECONDS)


def embed_batch(
    texts: list[str], client: "ollama.Client | None" = None,
    allow_cloud_fallback: bool = True,
) -> BatchEmbedResult | None:
    """Dieu phoi qua breaker: Ollama khi mach dong, cloud CHI khi mach da thuc
    su mo. Khong bao gio raise — ca hai provider loi tra None, giu dung hop
    dong cu.

    allow_cloud_fallback=False (ingestion.py dung) => Ollama-only: Ollama loi
    thi tra None ngay, khong dung toi cloud du mach dang o trang thai nao. Ghi
    mot chunk bang model cloud se lam content_hash (tinh theo hang so EMBED_MODEL)
    lech voi embedding_model da luu, va lan ingest sau se bo qua chunk do vi hash
    trung — tai lieu bien mat vinh vien khoi semantic search. Bo qua tai lieu roi
    ingest lai sau (dung hanh vi truoc Phase B) thi tu chua lanh duoc.
    """
    if not texts:
        return BatchEmbedResult(vectors=[], model=EMBED_MODEL, provider="none")

    if _breaker.should_try_primary():
        vectors = _OLLAMA_EMBEDDER.embed_batch(texts, client=client)
        if vectors is not None:
            _breaker.record_success()
            return BatchEmbedResult(vectors=vectors, model=EMBED_MODEL, provider="ollama")
        _breaker.record_failure()
        # Chi leo len cloud neu chinh lan loi nay lam mach MO (cham threshold).
        # Mot lan loi le te duoi threshold thi that bai luon, dung theo thu tu
        # spec mo ta ("3 loi lien tiep -> mo mach, chuyen cloud" — chuyen cloud
        # SAU khi mo mach, khong phai moi lan chop tat).
        if not allow_cloud_fallback or not _breaker.is_open():
            return None
    else:
        # Mach da mo tu truoc (hoac lan thu HALF_OPEN da co caller khac gianh)
        # -> di thang cloud.
        if not allow_cloud_fallback:
            return None

    vectors = _cloud_embedder.embed_batch(texts)
    if vectors is not None:
        return BatchEmbedResult(vectors=vectors, model=CLOUD_EMBED_MODEL, provider="openrouter")
    return None


def embed_text(
    text: str, client: "ollama.Client | None" = None,
    allow_cloud_fallback: bool = True,
) -> EmbedResult | None:
    result = embed_batch([text], client=client, allow_cloud_fallback=allow_cloud_fallback)
    if not result or not result.vectors:
        return None
    return EmbedResult(vector=result.vectors[0], model=result.model, provider=result.provider)


def cosine_similarity(a: list[float], b: list[float]) -> float:
    if len(a) != len(b) or not a:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def content_hash(payload) -> str:
    """Stable hash of the embedded source content, so a cache built from older
    content is detected and rebuilt instead of silently reused."""
    text = json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
