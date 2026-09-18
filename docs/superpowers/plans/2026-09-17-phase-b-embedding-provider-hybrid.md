# Phase B Implementation Plan — Embedding Provider Hybrid

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm cloud fallback (OpenRouter, `qwen/qwen3-embedding-8b`) cho `embeddings.py`, hiện chỉ gọi Ollama và không có đường lùi khi Ollama chết. Thêm circuit breaker để không mỗi request tự ăn trọn `EMBED_TIMEOUT_SECONDS=30` khi Ollama đang down. Sửa một lỗ hổng thiết kế thật trong Phase A: `pg_vector_store.py` lọc theo `embedding_model` bằng cách đọc thẳng hằng số tĩnh `embeddings.EMBED_MODEL`, không phản ánh đúng model vừa embed query khi breaker chuyển sang cloud giữa chừng.

**Architecture:** `embeddings.py` tách thành hai lớp: `OllamaEmbedder`/`CloudEmbedder` (chỉ biết gọi provider của mình, giống `llm_provider.py`'s `OllamaProvider`/`OpenRouterProvider`) và `EmbedCircuitBreaker` (state machine thuần, không I/O) điều phối giữa hai lớp đó. `embed_batch`/`embed_text` đổi kiểu trả về từ `list[float] | None` sang một NamedTuple mang theo `model` đã dùng — đây là thay đổi lan xuống mọi call site và mọi test mock hiện có, vì không có cách nào khác race-safe để caller biết được model nào vừa thực sự embed (xem AD-7 trong spec).

**Tech Stack:** Python 3.14, `ollama` client (đã có), `httpx` (đã có, dùng đồng bộ qua `httpx.Client` — không phải `AsyncClient`, khớp cách `OllamaProvider` đang chạy), `unittest`.

**Spec:** `docs/superpowers/specs/2026-09-16-ai-decision-support-platform-design.md`, mục 4 (Phase B, gồm AD-6 và AD-7).

## Global Constraints

- **Working directory cho mọi lệnh Python:** `services/ai-service/`. Test import phẳng, không phải package.
- **Test framework:** `unittest`. Chạy: `python -m unittest discover` từ `services/ai-service/`.
- **Interface đồng bộ giữ nguyên:** `embed_batch`/`embed_text` **vẫn là hàm sync**, gọi qua `asyncio.to_thread` từ mọi caller — không đổi sang async trong Phase B.
- **Không bao giờ raise.** Cả hai provider lỗi → trả `None`, giống hệt hành vi hiện tại. Đây là convention xuyên suốt `embeddings.py`, `book_index.py`, `faq_retrieval.py`, `pg_vector_store.py` — không được phá.
- **AD-5 (kế thừa từ Phase A, vẫn áp dụng):** `assistant_tools.search_books()` và `faq_retrieval.find_relevant()` giữ nguyên chữ ký và shape trả về. Phase B không chạm vào hai hàm này ở tầng chữ ký — chỉ chạm phần bên trong gọi `embeddings.embed_text`.
- **Provider cloud:** OpenRouter, model `qwen/qwen3-embedding-8b`, endpoint `POST {OPENROUTER_BASE_URL}/embeddings`, tham số `"dimensions": 768` bắt buộc trong mọi request — không được bỏ, nếu bỏ response trả về 4096 chiều và insert vào cột `vector(768)` sẽ lỗi ngay ở tầng Postgres.
- **Không đổi schema.** `vector(768)` giữ nguyên — lý do chọn tham số `dimensions: 768` chính là để tránh phải đổi.
- **Commit message:** tiếng Việt không dấu, kết thúc bằng `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- **Branch:** làm việc trên branch mới `phase-b-embedding-provider`, rẽ từ `hungg` (đã có Phase A). Không push lên `main`.

---

## File Structure

| File | Trạng thái | Trách nhiệm |
|---|---|---|
| `services/ai-service/embeddings.py` | Viết lại | `EmbedResult`/`BatchEmbedResult`, `OllamaEmbedder`, `CloudEmbedder`, `EmbedCircuitBreaker`, `embed_batch`/`embed_text` điều phối |
| `services/ai-service/test_embeddings.py` | Tạo mới | Test circuit breaker (thuần, không network) + test `embed_batch`/`embed_text` điều phối qua fake provider |
| `services/ai-service/vector_store.py` | Sửa | `VectorStore.search_semantic` thêm tham số `embedding_model: str`; `InMemoryVectorStore.search_semantic` lọc theo tham số đó |
| `services/ai-service/pg_vector_store.py` | Sửa | `search_semantic` nhận `embedding_model` qua tham số, bỏ đọc `embeddings.EMBED_MODEL` bên trong |
| `services/ai-service/book_index.py` | Sửa | `semantic_scores` dùng `result.model` từ `embed_text`, truyền vào `search_semantic` |
| `services/ai-service/assistant_tools.py` | Sửa | `_score_and_rank_books` tương tự |
| `services/ai-service/faq_retrieval.py` | Sửa | `_find_relevant_async` tương tự |
| `services/ai-service/ingestion.py` | Sửa | `_ingest_one` dùng `result.model` (không phải `embeddings.EMBED_MODEL`) khi tạo `Chunk` |
| `services/ai-service/test_vector_store.py` | Sửa | Cập nhật test `search_semantic` cho tham số mới |
| `services/ai-service/test_pgvector_store.py` | Sửa | Cập nhật test integration cho tham số mới |
| `services/ai-service/test_book_index.py` | Sửa | Cập nhật mock `embed_text` sang `EmbedResult` |
| `services/ai-service/test_faq_retrieval.py` | Sửa | Cập nhật mock `embed_text` sang `EmbedResult` |
| `services/ai-service/test_ingestion.py` | Sửa | Cập nhật mock `embed_batch` sang `BatchEmbedResult` |
| `.env.example` | Sửa | Thêm biến môi trường mới, sửa comment lỗi thời "OpenRouter doesn't serve this" |
| `docker-compose.yml` | Sửa | Thêm biến môi trường mới vào block `ai-service` |
| `docs/SERVICES/AI_SERVICE.md` | Sửa | Ghi lại kiến trúc circuit breaker + hai provider |

---

## Cảnh báo trước khi bắt đầu

**`embed_batch`/`embed_text` có 5 call site**, không phải 1 — bỏ sót một chỗ là để lại code gọi `list[float]` như thể nó vẫn là kiểu cũ, lỗi runtime âm thầm (không phải ImportError):

```
embeddings.py:50        embed_text() gọi nội bộ embed_batch()
book_index.py:59        semantic_scores()
assistant_tools.py:219  _score_and_rank_books()
faq_retrieval.py:47,82  embed_text() wrapper, rồi _find_relevant_async() gọi wrapper đó
ingestion.py:98         _ingest_one()
```

**`pg_vector_store.search_semantic` có 2 call site** cần thêm tham số `embedding_model`:
```
assistant_tools.py:220 (trong _score_and_rank_books, nhánh semantic)
faq_retrieval.py:97    (trong _find_relevant_async, nhánh semantic)
```

**Không đổi `find_relevant`/`search_books`'s chữ ký công khai** — chỉ đổi những gì chúng gọi bên trong.

---

### Task 1: `EmbedResult`/`BatchEmbedResult` + `EmbedCircuitBreaker` — hàm thuần, TDD

**Files:**
- Modify: `services/ai-service/embeddings.py` (thêm types + breaker, chưa đổi `embed_batch`/`embed_text`)
- Test: `services/ai-service/test_embeddings.py` (tạo mới)

**Interfaces:**
- Consumes: không
- Produces:
  - `class EmbedResult(NamedTuple): vector: list[float]; model: str; provider: str`
  - `class BatchEmbedResult(NamedTuple): vectors: list[list[float]]; model: str; provider: str`
  - `class EmbedCircuitBreaker` với `__init__(self, threshold: int, cooldown_seconds: float, now_fn: Callable[[], float] = time.monotonic)`, method `should_try_primary() -> bool`, `record_success() -> None`, `record_failure() -> None`

- [ ] **Step 1: Viết test thất bại cho circuit breaker**

Tạo `services/ai-service/test_embeddings.py`:

```python
from __future__ import annotations

import unittest

import embeddings


class EmbedCircuitBreakerTest(unittest.TestCase):
    def _clock(self, start: float = 1000.0):
        """Dong ho gia, tu tang khi goi — de test khong phu thuoc thoi gian thuc."""
        state = {"now": start}
        def now():
            return state["now"]
        def advance(seconds: float):
            state["now"] += seconds
        return now, advance

    def test_closed_by_default(self):
        breaker = embeddings.EmbedCircuitBreaker(threshold=3, cooldown_seconds=60)
        self.assertTrue(breaker.should_try_primary())

    def test_stays_closed_below_threshold(self):
        breaker = embeddings.EmbedCircuitBreaker(threshold=3, cooldown_seconds=60)
        breaker.record_failure()
        breaker.record_failure()
        self.assertTrue(breaker.should_try_primary())

    def test_opens_at_threshold(self):
        breaker = embeddings.EmbedCircuitBreaker(threshold=3, cooldown_seconds=60)
        breaker.record_failure()
        breaker.record_failure()
        breaker.record_failure()
        self.assertFalse(breaker.should_try_primary())

    def test_success_resets_failure_count(self):
        breaker = embeddings.EmbedCircuitBreaker(threshold=3, cooldown_seconds=60)
        breaker.record_failure()
        breaker.record_failure()
        breaker.record_success()
        breaker.record_failure()
        breaker.record_failure()
        # Chi 2 that bai lien tiep ke tu lan success — chua cham threshold.
        self.assertTrue(breaker.should_try_primary())

    def test_stays_open_before_cooldown_elapses(self):
        now, advance = self._clock()
        breaker = embeddings.EmbedCircuitBreaker(threshold=1, cooldown_seconds=60, now_fn=now)
        breaker.record_failure()
        advance(30)
        self.assertFalse(breaker.should_try_primary())

    def test_half_opens_after_cooldown_elapses(self):
        now, advance = self._clock()
        breaker = embeddings.EmbedCircuitBreaker(threshold=1, cooldown_seconds=60, now_fn=now)
        breaker.record_failure()
        advance(61)
        # Sau cooldown, mach chuyen HALF_OPEN — cho phep MOT lan thu lai.
        self.assertTrue(breaker.should_try_primary())

    def test_failure_during_half_open_reopens_and_resets_cooldown(self):
        now, advance = self._clock()
        breaker = embeddings.EmbedCircuitBreaker(threshold=1, cooldown_seconds=60, now_fn=now)
        breaker.record_failure()
        advance(61)
        self.assertTrue(breaker.should_try_primary())  # HALF_OPEN, duoc thu
        breaker.record_failure()  # lan thu that bai
        self.assertFalse(breaker.should_try_primary())  # OPEN lai ngay
        advance(61)
        self.assertTrue(breaker.should_try_primary())  # cooldown moi da het

    def test_success_during_half_open_closes_circuit(self):
        now, advance = self._clock()
        breaker = embeddings.EmbedCircuitBreaker(threshold=1, cooldown_seconds=60, now_fn=now)
        breaker.record_failure()
        advance(61)
        self.assertTrue(breaker.should_try_primary())  # HALF_OPEN
        breaker.record_success()
        advance(1)  # rat it thoi gian troi qua, khong phai vi het cooldown
        self.assertTrue(breaker.should_try_primary())  # CLOSED, khong con phu thuoc cooldown


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `cd services/ai-service && python -m unittest test_embeddings -v`
Expected: FAIL — `AttributeError: module 'embeddings' has no attribute 'EmbedCircuitBreaker'`

- [ ] **Step 3: Thêm types + breaker vào `embeddings.py`**

Thêm vào đầu `embeddings.py` (sau các import hiện có, trước `EMBED_MODEL`):

```python
import time
from typing import Callable, NamedTuple


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

    def should_try_primary(self) -> bool:
        if self._state == _BreakerState.CLOSED:
            return True
        if self._state == _BreakerState.OPEN:
            if self._opened_at is not None and self._now() - self._opened_at >= self._cooldown:
                self._state = _BreakerState.HALF_OPEN
                return True
            return False
        return True  # HALF_OPEN: cho phep dung mot lan thu

    def record_success(self) -> None:
        self._consecutive_failures = 0
        self._state = _BreakerState.CLOSED
        self._opened_at = None

    def record_failure(self) -> None:
        self._consecutive_failures += 1
        if self._state == _BreakerState.HALF_OPEN or self._consecutive_failures >= self._threshold:
            self._state = _BreakerState.OPEN
            self._opened_at = self._now()
```

- [ ] **Step 4: Chạy test, xác nhận PASS**

Run: `cd services/ai-service && python -m unittest test_embeddings -v`
Expected: PASS, 8 test.

- [ ] **Step 5: Commit**

```bash
git add services/ai-service/embeddings.py services/ai-service/test_embeddings.py
git commit -m "feat(ai-service): EmbedResult/BatchEmbedResult + circuit breaker state machine

Hai NamedTuple mang theo model da dung, chuan bi cho AD-7 (query phai loc
embedding_model theo model VUA embed, khong phai hang so tinh). Breaker la
state machine thuan, khong tu goi provider nao — embed_batch se dieu phoi
o task sau.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: `OllamaEmbedder` — bọc lại logic Ollama hiện có, không đổi hành vi

Refactor thuần: tách phần gọi `ollama.Client` hiện có trong `embed_batch` ra một class riêng, chưa nối với breaker/cloud.

**Files:**
- Modify: `services/ai-service/embeddings.py`
- Test: `services/ai-service/test_embeddings.py` (thêm)

**Interfaces:**
- Consumes: `ollama.Client`
- Produces: `class OllamaEmbedder` với `name = "ollama"`, method `embed_batch(self, texts: list[str], client: ollama.Client | None = None) -> list[list[float]] | None`

- [ ] **Step 1: Viết test thất bại**

Thêm vào `test_embeddings.py`:

```python
class FakeEmbedResponse:
    def __init__(self, embeddings):
        self.embeddings = embeddings


class FakeOllamaClient:
    def __init__(self, vectors: dict, default=None):
        self._vectors = vectors
        self._default = default

    def embed(self, model, input):
        texts = [input] if isinstance(input, str) else list(input)
        return FakeEmbedResponse(embeddings=[self._vectors.get(t, self._default) for t in texts])


class FailingOllamaClient:
    def embed(self, model, input):
        raise ConnectionError("ollama unreachable")


class OllamaEmbedderTest(unittest.TestCase):
    def test_embeds_batch_via_client(self):
        client = FakeOllamaClient({"a": [1.0, 0.0], "b": [0.0, 1.0]})
        embedder = embeddings.OllamaEmbedder()
        result = embedder.embed_batch(["a", "b"], client=client)
        self.assertEqual(result, [[1.0, 0.0], [0.0, 1.0]])

    def test_empty_input_returns_empty_list(self):
        embedder = embeddings.OllamaEmbedder()
        self.assertEqual(embedder.embed_batch([], client=FakeOllamaClient({})), [])

    def test_failure_returns_none_not_raise(self):
        embedder = embeddings.OllamaEmbedder()
        self.assertIsNone(embedder.embed_batch(["a"], client=FailingOllamaClient()))

    def test_mismatched_vector_count_returns_none(self):
        class ShortResponseClient:
            def embed(self, model, input):
                return FakeEmbedResponse(embeddings=[[1.0, 0.0]])  # 1 vector cho 2 text
        embedder = embeddings.OllamaEmbedder()
        self.assertIsNone(embedder.embed_batch(["a", "b"], client=ShortResponseClient()))
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `cd services/ai-service && python -m unittest test_embeddings.OllamaEmbedderTest -v`
Expected: FAIL — `AttributeError: module 'embeddings' has no attribute 'OllamaEmbedder'`

- [ ] **Step 3: Implement — di chuyển logic từ `embed_batch` hiện tại vào class**

Thêm vào `embeddings.py`, sau `EmbedCircuitBreaker`:

```python
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
```

(Chưa xoá `embed_batch`/`embed_text` cũ ở cuối file — Task 4 mới viết lại chúng để dùng class này. Giữ file build được giữa các task.)

- [ ] **Step 4: Chạy test, xác nhận PASS**

Run: `cd services/ai-service && python -m unittest test_embeddings.OllamaEmbedderTest -v`
Expected: PASS, 4 test.

- [ ] **Step 5: Commit**

```bash
git add services/ai-service/embeddings.py services/ai-service/test_embeddings.py
git commit -m "refactor(ai-service): tach logic Ollama hien co thanh class OllamaEmbedder

Hanh vi khong doi — chi chuyen code tu embed_batch() cu vao mot class de
dung chung interface voi CloudEmbedder (task sau). embed_batch/embed_text
cu van con nguyen, chua goi class nay.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `CloudEmbedder` — gọi OpenRouter thật

**Files:**
- Modify: `services/ai-service/embeddings.py`
- Test: `services/ai-service/test_embeddings.py` (thêm — chỉ test phần dựng request/parse response bằng mock `httpx`, không gọi mạng thật; theo đúng convention của `test_llm_provider.py` — logic mạng thật được verify sống ở Task 6, không unit test)

**Interfaces:**
- Consumes: `httpx`
- Produces: `class CloudEmbedder` với `name = "openrouter"`, `__init__(self, api_key: str, base_url: str, model: str, dimensions: int, timeout: float)`, method `embed_batch(self, texts: list[str]) -> list[list[float]] | None`

- [ ] **Step 1: Viết test thất bại**

Thêm vào `test_embeddings.py`:

```python
from unittest import mock


class CloudEmbedderTest(unittest.TestCase):
    def _embedder(self):
        return embeddings.CloudEmbedder(
            api_key="test-key", base_url="https://openrouter.ai/api/v1",
            model="qwen/qwen3-embedding-8b", dimensions=768, timeout=10,
        )

    def test_sends_dimensions_param_and_parses_response(self):
        fake_response = mock.Mock()
        fake_response.raise_for_status = mock.Mock()
        fake_response.json.return_value = {
            "data": [{"embedding": [0.1, 0.2]}, {"embedding": [0.3, 0.4]}]
        }
        fake_client = mock.MagicMock()
        fake_client.__enter__.return_value = fake_client
        fake_client.post.return_value = fake_response

        with mock.patch("httpx.Client", return_value=fake_client):
            result = self._embedder().embed_batch(["a", "b"])

        self.assertEqual(result, [[0.1, 0.2], [0.3, 0.4]])
        call_kwargs = fake_client.post.call_args.kwargs
        self.assertEqual(call_kwargs["json"]["dimensions"], 768)
        self.assertEqual(call_kwargs["json"]["model"], "qwen/qwen3-embedding-8b")
        self.assertEqual(call_kwargs["json"]["input"], ["a", "b"])
        self.assertEqual(call_kwargs["headers"]["Authorization"], "Bearer test-key")

    def test_empty_input_returns_empty_list(self):
        self.assertEqual(self._embedder().embed_batch([]), [])

    def test_http_error_returns_none_not_raise(self):
        fake_client = mock.MagicMock()
        fake_client.__enter__.return_value = fake_client
        fake_client.post.side_effect = ConnectionError("network down")
        with mock.patch("httpx.Client", return_value=fake_client):
            self.assertIsNone(self._embedder().embed_batch(["a"]))

    def test_mismatched_vector_count_returns_none(self):
        fake_response = mock.Mock()
        fake_response.raise_for_status = mock.Mock()
        fake_response.json.return_value = {"data": [{"embedding": [0.1, 0.2]}]}  # 1 cho 2 text
        fake_client = mock.MagicMock()
        fake_client.__enter__.return_value = fake_client
        fake_client.post.return_value = fake_response
        with mock.patch("httpx.Client", return_value=fake_client):
            self.assertIsNone(self._embedder().embed_batch(["a", "b"]))
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `cd services/ai-service && python -m unittest test_embeddings.CloudEmbedderTest -v`
Expected: FAIL — `AttributeError: module 'embeddings' has no attribute 'CloudEmbedder'`

- [ ] **Step 3: Implement**

Thêm vào `embeddings.py`:

```python
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
            return vectors
        except Exception as exc:
            logger.warning("embeddings: openrouter embedding failed: %s", type(exc).__name__)
            return None
```

- [ ] **Step 4: Chạy test, xác nhận PASS**

Run: `cd services/ai-service && python -m unittest test_embeddings.CloudEmbedderTest -v`
Expected: PASS, 4 test.

- [ ] **Step 5: Commit**

```bash
git add services/ai-service/embeddings.py services/ai-service/test_embeddings.py
git commit -m "feat(ai-service): CloudEmbedder - fallback embedding qua OpenRouter

qwen/qwen3-embedding-8b, dimensions:768 bat buoc trong request de khop cot
vector(768) da co, khong can doi schema (AD-6). httpx.Client dong bo, khop
cach OllamaEmbedder/ollama.Client dang chay — khong doi interface sang async.

Test chi kiem tra dung request/parse response qua mock; goi mang that duoc
verify song o task sau, cung quy uoc voi test_llm_provider.py.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Điều phối `embed_batch`/`embed_text` qua breaker — đổi kiểu trả về

Đây là task thay đổi hợp đồng (contract-breaking trong nội bộ service — không lộ ra ngoài API công khai). Từ task này, `embed_batch`/`embed_text` trả `BatchEmbedResult`/`EmbedResult` thay vì `list | None`.

**Files:**
- Modify: `services/ai-service/embeddings.py`
- Test: `services/ai-service/test_embeddings.py` (thêm)

**Interfaces:**
- Consumes: `OllamaEmbedder`, `CloudEmbedder`, `EmbedCircuitBreaker`
- Produces:
  - `embed_batch(texts: list[str], client: ollama.Client | None = None) -> BatchEmbedResult | None`
  - `embed_text(text: str, client: ollama.Client | None = None) -> EmbedResult | None`
  - `CLOUD_EMBED_MODEL = os.getenv("CLOUD_EMBED_MODEL", "qwen/qwen3-embedding-8b")`
  - `EMBED_BREAKER_THRESHOLD = int(os.getenv("EMBED_BREAKER_THRESHOLD", "3"))`
  - `EMBED_BREAKER_COOLDOWN_SECONDS = float(os.getenv("EMBED_BREAKER_COOLDOWN_SECONDS", "60"))`

- [ ] **Step 1: Viết test thất bại**

Thêm vào `test_embeddings.py`:

```python
class EmbedBatchDispatchTest(unittest.TestCase):
    def setUp(self):
        # Moi test bat dau voi mach dong (Ollama), khong ke thua state tu test truoc.
        embeddings._breaker = embeddings.EmbedCircuitBreaker(
            threshold=embeddings.EMBED_BREAKER_THRESHOLD,
            cooldown_seconds=embeddings.EMBED_BREAKER_COOLDOWN_SECONDS,
        )

    def test_uses_ollama_when_healthy(self):
        client = FakeOllamaClient({"a": [1.0, 0.0]})
        with mock.patch.object(embeddings, "_cloud_embedder") as fake_cloud:
            result = embeddings.embed_batch(["a"], client=client)
        self.assertEqual(result.vectors, [[1.0, 0.0]])
        self.assertEqual(result.provider, "ollama")
        self.assertEqual(result.model, embeddings.EMBED_MODEL)
        fake_cloud.embed_batch.assert_not_called()

    def test_falls_back_to_cloud_when_ollama_fails(self):
        with mock.patch.object(embeddings, "_cloud_embedder") as fake_cloud:
            fake_cloud.embed_batch.return_value = [[0.5, 0.5]]
            result = embeddings.embed_batch(["a"], client=FailingOllamaClient())
        self.assertEqual(result.vectors, [[0.5, 0.5]])
        self.assertEqual(result.provider, "openrouter")
        self.assertEqual(result.model, embeddings.CLOUD_EMBED_MODEL)

    def test_breaker_opens_after_threshold_and_skips_ollama(self):
        with mock.patch.object(embeddings, "_cloud_embedder") as fake_cloud:
            fake_cloud.embed_batch.return_value = [[0.0, 0.0]]
            failing = FailingOllamaClient()
            for _ in range(embeddings.EMBED_BREAKER_THRESHOLD):
                embeddings.embed_batch(["a"], client=failing)
            # Mach da mo — lan goi tiep theo KHONG duoc dung client (se raise
            # neu bi goi, chung minh Ollama bi bo qua hoan toan).
            class RaisingIfCalledClient:
                def embed(self, model, input):
                    raise AssertionError("Ollama khong duoc goi khi mach dang mo")
            embeddings.embed_batch(["a"], client=RaisingIfCalledClient())

    def test_both_providers_fail_returns_none(self):
        with mock.patch.object(embeddings, "_cloud_embedder") as fake_cloud:
            fake_cloud.embed_batch.return_value = None
            self.assertIsNone(embeddings.embed_batch(["a"], client=FailingOllamaClient()))

    def test_empty_input_returns_empty_result_without_calling_any_provider(self):
        with mock.patch.object(embeddings, "_cloud_embedder") as fake_cloud:
            result = embeddings.embed_batch([], client=FakeOllamaClient({}))
        self.assertEqual(result.vectors, [])
        fake_cloud.embed_batch.assert_not_called()

    def test_embed_text_wraps_single_vector(self):
        client = FakeOllamaClient({"a": [1.0, 0.0]})
        result = embeddings.embed_text("a", client=client)
        self.assertEqual(result.vector, [1.0, 0.0])
        self.assertEqual(result.provider, "ollama")

    def test_embed_text_returns_none_when_both_fail(self):
        with mock.patch.object(embeddings, "_cloud_embedder") as fake_cloud:
            fake_cloud.embed_batch.return_value = None
            self.assertIsNone(embeddings.embed_text("a", client=FailingOllamaClient()))
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `cd services/ai-service && python -m unittest test_embeddings.EmbedBatchDispatchTest -v`
Expected: FAIL — `embed_batch` cũ trả `list | None`, không có `.vectors`/`.provider`/`.model`.

- [ ] **Step 3: Viết lại `embed_batch`/`embed_text`, xoá bản cũ**

Trong `embeddings.py`, thêm hằng số mới cạnh `EMBED_MODEL`:

```python
CLOUD_EMBED_MODEL = os.getenv("CLOUD_EMBED_MODEL", "qwen/qwen3-embedding-8b")
CLOUD_EMBED_DIMENSIONS = int(os.getenv("CLOUD_EMBED_DIMENSIONS", "768"))
CLOUD_EMBED_TIMEOUT_SECONDS = float(os.getenv("CLOUD_EMBED_TIMEOUT_SECONDS", "30"))
EMBED_BREAKER_THRESHOLD = int(os.getenv("EMBED_BREAKER_THRESHOLD", "3"))
EMBED_BREAKER_COOLDOWN_SECONDS = float(os.getenv("EMBED_BREAKER_COOLDOWN_SECONDS", "60"))

_OLLAMA_EMBEDDER = OllamaEmbedder()
# Instance nay duoc mock trong test (mock.patch.object(embeddings, "_cloud_embedder"))
# thay vi mock ham/HTTP truc tiep — de test khong phu thuoc httpx.
_cloud_embedder = CloudEmbedder(
    api_key=os.getenv("OPENROUTER_API_KEY", ""),
    base_url=os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
    model=CLOUD_EMBED_MODEL, dimensions=CLOUD_EMBED_DIMENSIONS, timeout=CLOUD_EMBED_TIMEOUT_SECONDS,
)
_breaker = EmbedCircuitBreaker(threshold=EMBED_BREAKER_THRESHOLD, cooldown_seconds=EMBED_BREAKER_COOLDOWN_SECONDS)
```

Xoá `embed_batch`/`embed_text` cũ (phần dùng trực tiếp `ollama.Client`), thay bằng:

```python
def embed_batch(texts: list[str], client: "ollama.Client | None" = None) -> BatchEmbedResult | None:
    """Dieu phoi qua breaker: Ollama khi mach dong, cloud khi mach mo hoac
    Ollama vua that bai. Khong bao gio raise — ca hai provider loi tra None,
    giu dung hop dong cu."""
    if not texts:
        return BatchEmbedResult(vectors=[], model=EMBED_MODEL, provider="none")

    if _breaker.should_try_primary():
        vectors = _OLLAMA_EMBEDDER.embed_batch(texts, client=client)
        if vectors is not None:
            _breaker.record_success()
            return BatchEmbedResult(vectors=vectors, model=EMBED_MODEL, provider="ollama")
        _breaker.record_failure()

    vectors = _cloud_embedder.embed_batch(texts)
    if vectors is not None:
        return BatchEmbedResult(vectors=vectors, model=CLOUD_EMBED_MODEL, provider="openrouter")
    return None


def embed_text(text: str, client: "ollama.Client | None" = None) -> EmbedResult | None:
    result = embed_batch([text], client=client)
    if not result or not result.vectors:
        return None
    return EmbedResult(vector=result.vectors[0], model=result.model, provider=result.provider)
```

**Lưu ý:** `test_breaker_opens_after_threshold_and_skips_ollama` seed `_breaker` mới trong `setUp()` — nhưng module-level `_breaker` là biến toàn cục dùng chung production. Trong `setUp()`, gán thẳng `embeddings._breaker = EmbedCircuitBreaker(...)` (không phải reset method) để mỗi test có trạng thái sạch, tách biệt khỏi test khác — đây là pattern test-only, giống cách `vector_store.set_store()` tồn tại riêng cho test.

- [ ] **Step 4: Chạy test, xác nhận PASS**

Run: `cd services/ai-service && python -m unittest test_embeddings -v`
Expected: PASS, toàn bộ ~24 test trong file (8 breaker + 4 Ollama + 4 Cloud + 8 dispatch).

- [ ] **Step 5: Cập nhật module docstring**

Sửa docstring đầu `embeddings.py` (hiện đang lỗi thời sau khi Phase A xoá `read_cache`/`write_cache`, giờ thêm cloud provider):

```python
"""Embedding co circuit breaker: Ollama la provider chinh (chay offline duoc),
OpenRouter (qwen3-embedding-8b) la fallback khi Ollama loi lien tiep.

Dung boi book_index.py (tim sach), faq_retrieval.py (tim tai lieu noi bo),
ingestion.py (dong bo vector store). Moi ham o day khong bao gio raise —
ca hai provider loi tra None, caller phai tu degrade (vd bo tin hieu
semantic, chi con keyword search).
"""
```

- [ ] **Step 6: Commit**

```bash
git add services/ai-service/embeddings.py services/ai-service/test_embeddings.py
git commit -m "feat(ai-service): embed_batch/embed_text dieu phoi qua circuit breaker

Doi kieu tra ve tu list[float]|None sang BatchEmbedResult/EmbedResult mang
theo model DA THUC SU dung — khong con cach nao khac race-safe de caller biet
model nao vua embed khi breaker chuyen provider giua chung (AD-7). Day la
thay doi noi bo service, khong lo ra ngoai API cong khai; moi call site va
test mock se cap nhat o cac task sau.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: `vector_store.py`/`pg_vector_store.py` — `search_semantic` nhận `embedding_model` qua tham số

**Files:**
- Modify: `services/ai-service/vector_store.py`
- Modify: `services/ai-service/pg_vector_store.py`
- Modify: `services/ai-service/test_vector_store.py`
- Modify: `services/ai-service/test_pgvector_store.py`

**Interfaces:**
- Consumes: không
- Produces: `VectorStore.search_semantic(self, corpus: str, query_vec: list[float], k: int, embedding_model: str, source_ids: list[str] | None = None) -> list[Hit]` — thêm **một tham số bắt buộc mới**, `InMemoryVectorStore`/`PgVectorStore` cùng đổi.

- [ ] **Step 1: Sửa test `InMemoryVectorStore` trước (TDD ngược — test hiện tại phải FAIL trước khi sửa protocol)**

Trong `test_vector_store.py`, tìm các lời gọi `search_semantic(...)` hiện có (không có `embedding_model`), sửa thành có truyền, và thêm test lọc theo model:

```python
    def test_search_semantic_ranks_by_cosine(self):
        self._seed()
        hits = run(self.store.search_semantic(vector_store.CORPUS_BOOK, [1.0, 0.0], k=2, embedding_model="m"))
        self.assertEqual([hit.source_id for hit in hits], ["b1", "b2"])
        self.assertAlmostEqual(hits[0].score, 1.0)

    def test_search_semantic_restricted_to_source_ids(self):
        self._seed()
        hits = run(self.store.search_semantic(
            vector_store.CORPUS_BOOK, [1.0, 0.0], k=5, embedding_model="m", source_ids=["b2"]))
        self.assertEqual([hit.source_id for hit in hits], ["b2"])

    def test_search_semantic_isolates_corpus(self):
        self._seed()
        hits = run(self.store.search_semantic(vector_store.CORPUS_DOC, [1.0, 0.0], k=5, embedding_model="m"))
        self.assertEqual(hits, [])

    def test_search_semantic_filters_by_embedding_model(self):
        """Chunk embed boi model khac phai bi loai — khong duoc tron hai khong
        gian vector khac nhau (AD-3/AD-7)."""
        self._seed()  # _seed dung embedding_model="m" mac dinh
        hits = run(self.store.search_semantic(
            vector_store.CORPUS_BOOK, [1.0, 0.0], k=5, embedding_model="model-khac"))
        self.assertEqual(hits, [])
```

Kiểm tra `_seed()` helper trong file — nếu `Chunk(...)` seed sẵn có `embedding_model="m"` cố định, giữ nguyên; test mới `test_search_semantic_filters_by_embedding_model` dựa vào đúng giá trị đó.

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `cd services/ai-service && python -m unittest test_vector_store -v`
Expected: FAIL — `TypeError: search_semantic() missing 1 required positional argument: 'embedding_model'` (test mới gọi tham số này nhưng implementation chưa nhận).

Chú ý: đây là FAIL vì test ĐI TRƯỚC implementation — đúng thứ tự TDD dù có vẻ ngược (thường sửa implementation trước). Ở đây protocol là hợp đồng dùng chung nhiều nơi nên sửa test trước giúp thấy rõ chữ ký mới cần gì trước khi viết.

- [ ] **Step 3: Sửa `VectorStore` protocol + `InMemoryVectorStore`**

Trong `vector_store.py`, sửa protocol:

```python
    async def search_semantic(
        self, corpus: str, query_vec: list[float], k: int, embedding_model: str,
        source_ids: list[str] | None = None,
    ) -> list[Hit]: ...
```

Sửa `InMemoryVectorStore.search_semantic`:

```python
    async def search_semantic(
        self, corpus: str, query_vec: list[float], k: int, embedding_model: str,
        source_ids: list[str] | None = None,
    ) -> list[Hit]:
        hits = [
            self._hit(doc, row, embeddings.cosine_similarity(query_vec, row["embedding"]))
            for doc, row in self._candidates(corpus, source_ids)
            if row["embedding_model"] == embedding_model
        ]
        hits.sort(key=lambda hit: (-hit.score, hit.source_id))
        return hits[:k]
```

- [ ] **Step 4: Chạy test `test_vector_store.py`, xác nhận PASS**

Run: `cd services/ai-service && python -m unittest test_vector_store -v`
Expected: PASS.

- [ ] **Step 5: Sửa `PgVectorStore.search_semantic` — bỏ đọc `embeddings.EMBED_MODEL`**

Trong `pg_vector_store.py`:

```python
    async def search_semantic(
        self, corpus: str, query_vec: list[float], k: int, embedding_model: str,
        source_ids: list[str] | None = None,
    ) -> list[Hit]:
        if not query_vec:
            return []
        sql = text("""
            SELECT c.id AS chunk_id, c.document_id, d.source_id, c.corpus, c.content,
                   1 - (c.embedding <=> CAST(:query_vec AS vector)) AS score,
                   d.metadata
            FROM ai_document_chunks c
            JOIN ai_documents d ON d.id = c.document_id
            WHERE c.corpus = :corpus
              AND c.embedding_model = :embedding_model
              AND (:filter_sources = FALSE OR d.source_id = ANY(:source_ids))
            ORDER BY c.embedding <=> CAST(:query_vec AS vector)
            LIMIT :k
        """)
        return await self._search(sql, {
            "corpus": corpus, "query_vec": _to_vector_literal(query_vec),
            "embedding_model": embedding_model, "k": k,
            "filter_sources": source_ids is not None,
            "source_ids": list(source_ids or []),
        })
```

Xoá `import embeddings` khỏi `pg_vector_store.py` nếu không còn chỗ nào khác dùng nó trong file (kiểm tra bằng `grep -n "embeddings\." pg_vector_store.py`).

Sửa module docstring đầu file (hiện nói "Moi query loc theo embedding_model dang hoat dong" — vẫn đúng, nhưng thêm một câu về nguồn giá trị):

```python
"""pgvector-backed VectorStore. Chi duoc dung khi DATABASE_URL la Postgres —
vector_store.get_store() lo viec chon.

Moi query semantic loc theo embedding_model CALLER TRUYEN VAO (khong tu doc
hang so tinh) — model nao vua embed cau query thi loc dung model do, vi
circuit breaker (embeddings.py) co the da chuyen sang provider khac giua
chung (AD-7). Chunk embed boi model cu nam trong khong gian vector khac,
dung lan se cho ket qua sai im lang.
"""
```

- [ ] **Step 6: Sửa `test_pgvector_store.py`**

Tìm mọi lời gọi `store.search_semantic(...)` trong file, thêm `embedding_model="test-model"` (khớp giá trị `Chunk(...)` seed sẵn trong file — kiểm tra giá trị chính xác đang dùng, thường là `"test-model"` theo Task 4 cũ của Phase A).

- [ ] **Step 7: Chạy toàn bộ test có `TEST_PG_DSN`**

Run: `cd services/ai-service && TEST_PG_DSN="postgresql+asyncpg://<user>:<pass>@localhost:5432/ai_db" python -m unittest test_pgvector_store -v`
Expected: PASS.

Run không có `TEST_PG_DSN`: `cd services/ai-service && python -m unittest discover 2>&1 | tail -5`
Expected: các test cần Postgres skip sạch, phần còn lại — **sẽ FAIL ở đây** vì `book_index.py`/`assistant_tools.py`/`faq_retrieval.py` chưa cập nhật gọi `search_semantic` với tham số mới. Đây là kỳ vọng đúng — Task 6 sẽ sửa.

- [ ] **Step 8: Commit**

```bash
git add services/ai-service/vector_store.py services/ai-service/pg_vector_store.py services/ai-service/test_vector_store.py services/ai-service/test_pgvector_store.py
git commit -m "feat(ai-service): search_semantic nhan embedding_model qua tham so, khong tu doc hang so tinh

pg_vector_store truoc day doc thang embeddings.EMBED_MODEL (hang so tinh doc
mot lan luc import) de loc — khong phan anh dung model vua embed query khi
circuit breaker chuyen sang cloud giua chung (AD-7). Gio caller phai tu
truyen model that su vua dung.

Call site (book_index.py, assistant_tools.py, faq_retrieval.py) chua cap nhat
— test tong the se fail cho den task sau, ky vong dung.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Cập nhật 4 call site dùng `embed_text`/`embed_batch`/`search_semantic` kiểu mới

**Files:**
- Modify: `services/ai-service/book_index.py`
- Modify: `services/ai-service/assistant_tools.py`
- Modify: `services/ai-service/faq_retrieval.py`
- Modify: `services/ai-service/ingestion.py`
- Modify: `services/ai-service/test_book_index.py`
- Modify: `services/ai-service/test_faq_retrieval.py`
- Modify: `services/ai-service/test_ingestion.py`

**Interfaces:**
- Consumes: `embeddings.EmbedResult`, `embeddings.BatchEmbedResult`, `VectorStore.search_semantic(..., embedding_model: str, ...)`
- Produces: không có API mới — mọi hàm public (`semantic_scores`, `search_books`, `find_relevant`) giữ nguyên chữ ký (AD-5)

- [ ] **Step 1: Sửa `book_index.py::semantic_scores`**

```python
async def semantic_scores(
    books: list[dict],
    query: str,
    client: ollama.Client | None = None,
) -> list[float]:
    query = (query or "").strip()
    if not query or not books:
        return []

    embed_result = await asyncio.to_thread(embeddings.embed_text, query, client)
    if not embed_result:
        return []

    source_ids = [str(book.get("id") or "") for book in books]
    hits = await vector_store.get_store().search_semantic(
        vector_store.CORPUS_BOOK, embed_result.vector, k=len(source_ids),
        embedding_model=embed_result.model,
        source_ids=[sid for sid in source_ids if sid],
    )
    if not hits:
        return []

    by_source = {hit.source_id: hit.score for hit in hits}
    return [by_source.get(source_id, 0.0) for source_id in source_ids]
```

- [ ] **Step 2: Sửa `assistant_tools.py::_score_and_rank_books`**

Tìm đoạn:
```python
    query_vector = await asyncio.to_thread(embeddings.embed_text, query, client)
    semantic = (
        [
            hit for hit in await store.search_semantic(
                vector_store.CORPUS_BOOK, query_vector, k=limit * 3, source_ids=source_ids)
            if hit.score >= book_index.BOOK_SEMANTIC_THRESHOLD
        ]
        if query_vector else []
    )
```

Thay bằng:

```python
    embed_result = await asyncio.to_thread(embeddings.embed_text, query, client)
    semantic = (
        [
            hit for hit in await store.search_semantic(
                vector_store.CORPUS_BOOK, embed_result.vector, k=limit * 3,
                embedding_model=embed_result.model, source_ids=source_ids)
            if hit.score >= book_index.BOOK_SEMANTIC_THRESHOLD
        ]
        if embed_result else []
    )
```

- [ ] **Step 3: Sửa `faq_retrieval.py`**

`embed_text` wrapper hiện có (`def embed_text(text, client=None): return embeddings.embed_text(text, client=client)`) không cần đổi chữ ký — nó chỉ pass-through, kiểu trả về tự động thành `EmbedResult | None`.

Sửa `_find_relevant_async`:

```python
async def _find_relevant_async(query: str, top_k: int, threshold: float, client) -> list[FAQMatch]:
    embed_result = await asyncio.to_thread(embed_text, query, client)
    if not embed_result:
        return []
    store, engine = _per_call_store()
    try:
        semantic = [
            hit for hit in await store.search_semantic(
                vector_store.CORPUS_DOC, embed_result.vector, k=top_k,
                embedding_model=embed_result.model)
            if hit.score >= threshold
        ]
        keyword = await store.search_keyword(vector_store.CORPUS_DOC, query, k=top_k)
        fused = fusion.reciprocal_rank_fusion([semantic, keyword], limit=top_k)
        return [FAQMatch(entry=_entry_from_hit(hit), score=hit.score) for hit in fused]
    finally:
        if engine is not None:
            await engine.dispose()
```

- [ ] **Step 4: Sửa `ingestion.py::_ingest_one`**

Tìm đoạn:
```python
    vectors = await asyncio.to_thread(embeddings.embed_batch, [texts[i] for i in todo])
    if vectors is None:
        logger.warning("ingestion: embed that bai cho %s/%s, bo qua", corpus, source_id)
        return 0, len(texts)

    await store.upsert_chunks([
        Chunk(
            document_id=document_id, corpus=corpus, chunk_index=index,
            content=texts[index], content_hash=chunk_hash(texts[index]),
            embedding=vector, embedding_model=embeddings.EMBED_MODEL,
        )
        for index, vector in zip(todo, vectors)
    ])
```

Thay bằng:

```python
    embed_result = await asyncio.to_thread(embeddings.embed_batch, [texts[i] for i in todo])
    if embed_result is None:
        logger.warning("ingestion: embed that bai cho %s/%s, bo qua", corpus, source_id)
        return 0, len(texts)

    await store.upsert_chunks([
        Chunk(
            document_id=document_id, corpus=corpus, chunk_index=index,
            content=texts[index], content_hash=chunk_hash(texts[index]),
            embedding=vector, embedding_model=embed_result.model,
        )
        for index, vector in zip(todo, embed_result.vectors)
    ])
```

Kiểm tra `chunk_hash` — hàm này dùng `embeddings.EMBED_MODEL` tĩnh trong key hash (`{"model": embeddings.EMBED_MODEL, "text": text}`). Việc này **giữ nguyên, không sửa**: mục đích của `chunk_hash` là phát hiện "nội dung/model cấu hình đổi thì re-embed", không phải gắn nhãn chunk đã lưu — dùng `EMBED_MODEL` tĩnh ở đây là đúng, vì nó phản ánh model *dự kiến* dùng, khiến `plan_chunks` quyết định có cần re-embed hay không dựa trên cấu hình hiện tại, tách biệt khỏi việc model *thực tế* nào đã embed (có thể là cloud nếu breaker đang mở lúc đó).

- [ ] **Step 5: Sửa test — `test_book_index.py`**

Tìm mọi `mock.patch.object(embeddings, "embed_text", return_value=[1.0, 0.0])` (và các biến thể vector khác), thay bằng:

```python
mock.patch.object(embeddings, "embed_text", return_value=embeddings.EmbedResult(vector=[1.0, 0.0], model="test-model", provider="ollama"))
```

Với các chỗ `return_value=None` (test đường lỗi), **giữ nguyên `None`** — không đổi, vì `EmbedResult | None` vẫn nhận `None` khi cả hai provider lỗi.

Làm tương tự với `return_value=[0.0, 1.0]`, `[0.0, 0.0]` — mỗi chỗ bọc lại thành `embeddings.EmbedResult(vector=..., model="test-model", provider="ollama")`.

**Riêng test có seed `InMemoryVectorStore` (từ Phase A, class `HybridSearchTest`)** — các chỗ seed `Chunk(..., embedding_model="test-model")` giữ nguyên; chỉ chỗ mock `embed_text` cần bọc `EmbedResult`, và giá trị `model="test-model"` trong mock phải **khớp đúng** giá trị `embedding_model` đã seed trong `Chunk`, nếu không `InMemoryVectorStore.search_semantic`'s filter mới (Task 5) sẽ loại hết kết quả — đọc kỹ `setUp()` của từng test class để lấy đúng giá trị đang seed.

- [ ] **Step 6: Sửa test — `test_faq_retrieval.py`**

Tương tự Step 5, áp dụng cho mọi `mock.patch.object(embeddings, "embed_text", ...)` trong file. Kiểm tra giá trị `model=` seed trong `Chunk(...)` của `setUp()` khớp với giá trị mock.

- [ ] **Step 7: Sửa test — `test_ingestion.py`**

Tìm `mock.patch.object(embeddings, "embed_batch", ...)` (dòng ~85 theo grep trước đó), sửa `return_value` từ `list[list[float]]` thành `embeddings.BatchEmbedResult(vectors=[...], model="test-model", provider="ollama")`.

Kiểm tra assertion sau đó có đọc `Chunk.embedding_model` — nếu có, xác nhận giá trị khớp `"test-model"` từ mock, không còn là `embeddings.EMBED_MODEL` (test cũ có thể assert so với hằng số này, giờ phải so với giá trị mock trả về).

- [ ] **Step 8: Chạy toàn bộ test**

Run: `cd services/ai-service && python -m unittest discover -v 2>&1 | tail -20`
Expected: PASS toàn bộ, không skip nào ngoài 3 test cần `TEST_PG_DSN`.

Run: `cd services/ai-service && TEST_PG_DSN="postgresql+asyncpg://<user>:<pass>@localhost:5432/ai_db" python -m unittest discover 2>&1 | tail -10`
Expected: PASS toàn bộ, 0 skip.

- [ ] **Step 9: Kiểm tra không còn call site cũ sót lại**

Run: `cd services/ai-service && grep -rn "embeddings\.EMBED_MODEL" --include="*.py" . | grep -v ".venv\|test_"`
Expected: chỉ còn `embeddings.py` (định nghĩa hằng số), `ingestion.py`'s `chunk_hash` (Step 4 đã xác nhận giữ nguyên là đúng) — **không còn** trong `pg_vector_store.py`.

- [ ] **Step 10: Commit**

```bash
git add services/ai-service/book_index.py services/ai-service/assistant_tools.py services/ai-service/faq_retrieval.py services/ai-service/ingestion.py services/ai-service/test_book_index.py services/ai-service/test_faq_retrieval.py services/ai-service/test_ingestion.py
git commit -m "feat(ai-service): 4 call site dung EmbedResult/BatchEmbedResult va truyen embedding_model dong

book_index.semantic_scores, assistant_tools._score_and_rank_books,
faq_retrieval._find_relevant_async, ingestion._ingest_one deu doc
result.model tu embed_text/embed_batch thay vi hang so tinh
embeddings.EMBED_MODEL khi goi search_semantic hoac gan Chunk.embedding_model.

ingestion.chunk_hash VAN dung EMBED_MODEL tinh — do la quyet dinh "co can
re-embed theo cau hinh hien tai", khac voi "model nao THUC SU vua embed",
nen giu nguyen co chu.

search_books/find_relevant giu nguyen chu ky va shape tra ve (AD-5).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Env var + docker-compose + docs

**Files:**
- Modify: `.env.example`
- Modify: `docker-compose.yml`
- Modify: `docs/SERVICES/AI_SERVICE.md`

**Interfaces:**
- Consumes: không
- Produces: không có API mới — chỉ config/docs

- [ ] **Step 1: Sửa `.env.example`**

Tìm đoạn hiện có:
```
# Embedding model for chatbot FAQ + book semantic search (separate from the chat models
# above — always via Ollama; OpenRouter doesn't serve this).
# Requires: docker compose exec ollama ollama pull nomic-embed-text
FAQ_EMBED_MODEL=nomic-embed-text
```

Thay bằng:

```
# Embedding: Ollama la provider chinh (offline duoc), OpenRouter (qwen3-embedding-8b)
# la fallback khi Ollama loi lien tiep — dung chung OPENROUTER_API_KEY o tren.
# Requires: docker compose exec ollama ollama pull nomic-embed-text
FAQ_EMBED_MODEL=nomic-embed-text
# Circuit breaker: bao nhieu loi Ollama lien tiep truoc khi chuyen sang cloud,
# va cooldown truoc khi thu lai Ollama.
EMBED_BREAKER_THRESHOLD=3
EMBED_BREAKER_COOLDOWN_SECONDS=60
# Model fallback qua OpenRouter. dimensions:768 luon gui kem trong request de
# khop cot vector(768) trong ai_document_chunks — model nay mac dinh tra 4096
# chieu, khong duoc bo tham so nay.
CLOUD_EMBED_MODEL=qwen/qwen3-embedding-8b
CLOUD_EMBED_DIMENSIONS=768
CLOUD_EMBED_TIMEOUT_SECONDS=30
```

- [ ] **Step 2: Sửa `docker-compose.yml`**

Trong block `ai-service`, tìm dòng `- FAQ_EMBED_MODEL=${FAQ_EMBED_MODEL:-nomic-embed-text}`, thêm ngay sau:

```yaml
      - EMBED_BREAKER_THRESHOLD=${EMBED_BREAKER_THRESHOLD:-3}
      - EMBED_BREAKER_COOLDOWN_SECONDS=${EMBED_BREAKER_COOLDOWN_SECONDS:-60}
      - CLOUD_EMBED_MODEL=${CLOUD_EMBED_MODEL:-qwen/qwen3-embedding-8b}
      - CLOUD_EMBED_DIMENSIONS=${CLOUD_EMBED_DIMENSIONS:-768}
      - CLOUD_EMBED_TIMEOUT_SECONDS=${CLOUD_EMBED_TIMEOUT_SECONDS:-30}
```

- [ ] **Step 3: Cập nhật `docs/SERVICES/AI_SERVICE.md`**

Thêm một mục mới (tìm chỗ phù hợp gần phần nói về embedding/vector store đã có từ Phase A) mô tả:
- Hai provider, circuit breaker 3 trạng thái, ngưỡng/cooldown mặc định
- `dimensions: 768` là bắt buộc, lý do (khớp schema, không cần migrate)
- Cách kiểm tra breaker đang ở trạng thái nào khi debug (log warning từ `embeddings.py` khi provider lỗi, có `type(exc).__name__`)

- [ ] **Step 4: Commit**

```bash
git add .env.example docker-compose.yml docs/SERVICES/AI_SERVICE.md
git commit -m "docs(ai-service): env var + tai lieu cho circuit breaker embedding

Sua comment loi thoi ".env.example: OpenRouter doesn't serve this [embeddings]"
— da xac nhan OpenRouter co endpoint /embeddings that qua tai lieu chinh thuc.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Xác minh sống qua Docker — OpenRouter thật, breaker thật

Task duy nhất cần `OPENROUTER_API_KEY` thật và stack Docker đang chạy. Không unit test được (giống cách `OpenRouterProvider.chat()` trong `llm_provider.py` không có unit test mạng thật, chỉ verify sống qua eval script).

**Files:** không tạo/sửa file mới — chỉ chạy và quan sát.

- [ ] **Step 1: Build và chạy**

```bash
docker compose -p smartbook-system build ai-service
docker compose -p smartbook-system up -d ai-service
```

- [ ] **Step 2: Xác minh CloudEmbedder gọi được OpenRouter thật, đúng 768 chiều**

```bash
docker compose -p smartbook-system exec ai-service python -c "
import embeddings
result = embeddings._cloud_embedder.embed_batch(['xin chao'])
assert result is not None, 'CloudEmbedder tra ve None — kiem tra OPENROUTER_API_KEY'
assert len(result[0]) == 768, f'Ki vong 768 chieu, nhan duoc {len(result[0])}'
print('OK: CloudEmbedder tra ve vector', len(result[0]), 'chieu')
"
```
Expected: `OK: CloudEmbedder tra ve vector 768 chieu`

- [ ] **Step 3: Xác minh breaker thật — giả lập Ollama chết**

```bash
docker compose -p smartbook-system exec ai-service python -c "
import embeddings

class AlwaysFailClient:
    def embed(self, model, input):
        raise ConnectionError('gia lap Ollama chet')

embeddings._breaker = embeddings.EmbedCircuitBreaker(
    threshold=embeddings.EMBED_BREAKER_THRESHOLD,
    cooldown_seconds=embeddings.EMBED_BREAKER_COOLDOWN_SECONDS,
)
for i in range(embeddings.EMBED_BREAKER_THRESHOLD):
    result = embeddings.embed_batch(['test'], client=AlwaysFailClient())
    print(f'lan {i+1}: provider={result.provider if result else None}')

# Mach da mo — lan nay PHAI di thang qua cloud, khong duoc goi Ollama.
result = embeddings.embed_batch(['test sau khi mach mo'], client=AlwaysFailClient())
assert result is not None, 'Ca hai provider that bai — kiem tra OPENROUTER_API_KEY'
assert result.provider == 'openrouter', f'Ki vong openrouter, nhan duoc {result.provider}'
print('OK: mach mo dung, chuyen sang cloud, provider =', result.provider)
"
```
Expected: 3 lần đầu `provider=None` (cả Ollama giả và không có real Ollama fail — điều chỉnh nếu Ollama thật đang chạy khỏe, có thể cần dùng `OLLAMA_HOST` trỏ sai để giả lập chết thật thay vì chỉ client giả), dòng cuối `OK: mach mo dung, chuyen sang cloud, provider = openrouter`.

**Lưu ý khi chạy:** nếu Ollama thật trong container đang khỏe, `client=AlwaysFailClient()` đã đủ ép `OllamaEmbedder.embed_batch` thất bại (client được truyền thẳng vào, không tạo client thật) — không cần tắt Ollama thật.

- [ ] **Step 4: Xác minh ingest thật ghi đúng `embedding_model` khi qua cloud**

```bash
docker compose -p smartbook-system exec db psql -U "$POSTGRES_USER" -d ai_db -c "
SELECT DISTINCT embedding_model, count(*) FROM ai_document_chunks GROUP BY embedding_model;
"
```
Expected: hiện tại toàn bộ chunk có sẵn từ Phase A đều mang `embedding_model = 'nomic-embed-text'` (Ollama, bình thường vì breaker chưa từng mở trong quá trình ingest thật) — xác nhận cột này tồn tại và có giá trị hợp lệ, không cần chunk nào mang model cloud ở bước này (việc đó chỉ xảy ra khi Ollama thật sự chết trong lúc ingest — ngoài phạm vi verify ở đây).

- [ ] **Step 5: Chạy lại toàn bộ test suite lần cuối trong container (đảm bảo môi trường thật khớp local)**

```bash
docker compose -p smartbook-system exec ai-service python -m unittest discover
```
Expected: PASS, 0 skip (container có `TEST_PG_DSN`-equivalent qua kết nối `db` nội bộ — kiểm tra `DATABASE_URL` trong container đã trỏ đúng Postgres, không phải sqlite).

- [ ] **Step 6: Ghi lại bằng chứng, không cần commit code**

Không có thay đổi file ở task này — nếu mọi bước trên PASS, Phase B coi như hoàn thành về mặt chức năng. Ghi log/output các bước trên vào báo cáo triển khai (không phải file trong repo) để có bằng chứng khi review.

---

## Tiêu chí hoàn thành Phase B

- [ ] `python -m unittest discover` PASS, cả có và không có `TEST_PG_DSN`
- [ ] `grep -rn "embeddings\.EMBED_MODEL" pg_vector_store.py` không ra dòng nào
- [ ] CloudEmbedder gọi OpenRouter thật, trả về đúng 768 chiều (Task 8 Step 2)
- [ ] Circuit breaker mở đúng sau `EMBED_BREAKER_THRESHOLD` lỗi liên tiếp, chuyển cloud, không gọi lại Ollama cho tới khi cooldown hết (Task 8 Step 3)
- [ ] `search_books`/`find_relevant` không đổi chữ ký (AD-5) — xác nhận bằng diff của `assistant_tools.py`/`faq_retrieval.py` chỉ chạm phần thân hàm, không chạm dòng `def`/`async def` của hai hàm này

---

## Self-review

**Spec coverage:**

| Mục spec (AD-6, AD-7, circuit breaker) | Task |
|---|---|
| AD-6: OpenRouter + qwen3-embedding-8b + dimensions:768 | Task 3, 4, 8 |
| AD-7: embed_batch/embed_text trả kèm model, search_semantic nhận embedding_model qua tham số | Task 1, 4, 5, 6 |
| Circuit breaker 3 trạng thái, threshold/cooldown | Task 1, 4, 8 |
| Giữ interface đồng bộ, không raise | Task 2, 3, 4 (kiểm tra rõ trong mọi test "returns None not raise") |
| Env var + docs | Task 7 |

**Type consistency:** `EmbedResult`/`BatchEmbedResult` định nghĩa Task 1, dùng nguyên vẹn xuyên suốt Task 2-6. `search_semantic(..., embedding_model: str, ...)` định nghĩa Task 5 trong `VectorStore` protocol, implement giống hệt ở `InMemoryVectorStore` và `PgVectorStore`, gọi đúng ở cả 2 call site Task 6.

**Rủi ro đã biết, không phải placeholder:**
- Task 6 Step 5-7 yêu cầu đọc giá trị `model=`/`embedding_model=` đang seed trong từng test's `setUp()` để khớp — không chép cứng giá trị vì mỗi file test seed khác nhau (`"test-model"` là quy ước phổ biến trong Phase A nhưng không đảm bảo 100% mọi chỗ, người thực thi phải đọc code thật trước khi sửa).
- Task 8 không tạo file — là bước xác minh sống, giống quy ước "live eval" đã dùng xuyên suốt Phase A cho các thứ không unit-test được (gọi API thật, breaker thật).
