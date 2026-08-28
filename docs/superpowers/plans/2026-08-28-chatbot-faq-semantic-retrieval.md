# Chatbot FAQ Semantic Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `/chat` (the chatbot used by every role, including CUSTOMER) can't match a message to one of its 11 fixed intents, search a curated FAQ set by semantic similarity instead of returning nothing.

**Architecture:** A new `faq_retrieval.py` module embeds a static, git-tracked FAQ list (`faq_data.py`) via Ollama (`nomic-embed-text`) once, caches the vectors on disk, and does in-memory cosine similarity search — no vector DB. `retrieval.py`'s existing `GENERAL_QUERY` branch calls it and returns the same `{summary, raw, sources, warnings, retrieved_at}` envelope every other intent already returns, so the rest of the pipeline (grounding check, source-line footer) needs no changes.

**Tech Stack:** Python (FastAPI service), `ollama` Python client (already a dependency), stdlib only otherwise (no numpy/pgvector/FAISS).

**Spec:** [docs/superpowers/specs/2026-08-28-chatbot-faq-semantic-retrieval-design.md](../specs/2026-08-28-chatbot-faq-semantic-retrieval-design.md)

## Global Constraints

- No vector DB (pgvector/FAISS/Chroma) — FAQ set is ~10-100 entries, in-memory cosine similarity is enough.
- Embedding via Ollama (`nomic-embed-text`), not a new Python ML dependency (no `sentence-transformers`/`torch`).
- FAQ content lives in a static, git-reviewed file — no admin UI.
- Ollama/embedding failures must degrade to the existing `GENERAL_QUERY` fallback behavior, never raise out of `/chat`.
- All user-facing FAQ text is Vietnamese, matching the existing reply style.
- **Implementation deviation from the spec's wording:** the spec says vectors are kept as "numpy array"; this plan uses plain `list[float]` instead — same in-memory, no-vector-DB design, just without adding a numpy dependency for ~10-100 short vectors. Cosine similarity in pure Python is trivial at this scale.
- Any sync `ollama.Client` call made from inside an `async def` must be wrapped in `asyncio.to_thread(...)` — this is the existing convention in `main.py` (see `_chat_with_ollama`, `main.py:3291-3309`) and must be followed in `retrieval.py` too, since `retrieve_context` is async but the Ollama embedding call is a blocking network call.

---

### Task 1: FAQ content data

**Files:**
- Create: `services/ai-service/faq_data.py`
- Test: `services/ai-service/test_faq_retrieval.py` (new file — this task adds only the `FAQDataTests` class; Task 2 appends more to the same file)

**Interfaces:**
- Produces: `FAQ_ENTRIES: list[dict]` — each dict has string keys `id`, `category`, `question`, `answer`, all non-empty. `id` values are unique across the list.

- [ ] **Step 1: Write the failing test**

Create `services/ai-service/test_faq_retrieval.py`:

```python
from __future__ import annotations

import unittest

from faq_data import FAQ_ENTRIES


class FAQDataTests(unittest.TestCase):
    def test_entries_have_required_fields(self):
        for entry in FAQ_ENTRIES:
            with self.subTest(entry=entry.get("id")):
                self.assertTrue(entry.get("id"))
                self.assertTrue(entry.get("category"))
                self.assertTrue(entry.get("question"))
                self.assertTrue(entry.get("answer"))

    def test_ids_are_unique(self):
        ids = [entry["id"] for entry in FAQ_ENTRIES]
        self.assertEqual(len(ids), len(set(ids)))

    def test_has_at_least_ten_entries(self):
        self.assertGreaterEqual(len(FAQ_ENTRIES), 10)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `services/ai-service/`): `python -m pytest test_faq_retrieval.py -v`
Expected: FAIL / ERROR — `ModuleNotFoundError: No module named 'faq_data'`

- [ ] **Step 3: Write the FAQ data file**

Create `services/ai-service/faq_data.py`. Content is grounded in the real membership-tier and business-process data already in the codebase (`services/borrow-service/prisma/seed.js:27-91`, `README.md` business-domain sections) so answers are actually correct, not invented:

```python
from __future__ import annotations

FAQ_ENTRIES: list[dict] = [
    {
        "id": "membership-loan-limit",
        "category": "borrow",
        "question": "Mỗi hạng thành viên được mượn tối đa bao nhiêu sách và trong bao lâu?",
        "answer": (
            "Số sách và thời hạn mượn phụ thuộc vào hạng thành viên: Thẻ Đọc (BASIC) mượn tối đa "
            "3 cuốn trong 14 ngày, Bạc Sĩ (SILVER) mượn 5 cuốn trong 21 ngày, Vàng Hoàng (GOLD) "
            "mượn 8 cuốn trong 30 ngày, Thượng Đế (VIP) mượn 15 cuốn trong 60 ngày."
        ),
    },
    {
        "id": "fine-calculation",
        "category": "fine",
        "question": "Phí phạt trả sách trễ hạn được tính như thế nào?",
        "answer": (
            "Phí phạt tính theo số ngày trễ nhân với mức phạt mỗi ngày của hạng thành viên: Thẻ Đọc "
            "5.000 VND/ngày, Bạc Sĩ 3.000 VND/ngày, Vàng Hoàng 2.000 VND/ngày, Thượng Đế 1.000 VND/ngày. "
            "Hạng thành viên càng cao thì mức phạt mỗi ngày càng thấp."
        ),
    },
    {
        "id": "renewal-count",
        "category": "borrow",
        "question": "Tôi có thể gia hạn sách đã mượn không?",
        "answer": (
            "Có. Số lần gia hạn tối đa theo hạng thành viên: Thẻ Đọc 1 lần, Bạc Sĩ 2 lần, Vàng Hoàng "
            "3 lần, Thượng Đế 5 lần. Mỗi lần gia hạn thường kéo dài thêm khoảng một nửa thời hạn mượn gốc."
        ),
    },
    {
        "id": "reservation-hold",
        "category": "reservation",
        "question": "Đặt trước sách xong thì giữ chỗ trong bao lâu?",
        "answer": (
            "Thời gian giữ chỗ khác nhau theo hạng thành viên, từ 24 giờ (Thẻ Đọc) đến 72 giờ (Thượng Đế). "
            "Sau khi sách sẵn sàng và có mã pickup, nếu quá thời hạn mà không đến nhận, đặt trước sẽ tự "
            "động hết hạn."
        ),
    },
    {
        "id": "lost-item-fee",
        "category": "fine",
        "question": "Làm mất sách đang mượn thì phải đền bao nhiêu?",
        "answer": (
            "Phí đền sách mất được tính bằng giá trị sách nhân với hệ số đền bù theo hạng thành viên: "
            "Thẻ Đọc x1.5, Bạc Sĩ x1.3, Vàng Hoàng x1.2, Thượng Đế x1.0. Hạng thành viên càng cao thì "
            "hệ số đền bù càng thấp."
        ),
    },
    {
        "id": "goods-receipt-process",
        "category": "warehouse",
        "question": "Quy trình nhập kho khi hàng từ nhà cung cấp về hoạt động như thế nào?",
        "answer": (
            "Nhân viên tạo goods receipt ở trạng thái draft khi nhận hàng, đối chiếu với purchase order, "
            "sau đó 'post' phiếu để chính thức cộng tồn kho. Tồn kho chỉ được cập nhật sau khi goods "
            "receipt được post, không tự động cộng ngầm."
        ),
    },
    {
        "id": "purchase-order-flow",
        "category": "purchasing",
        "question": "Purchase request và purchase order khác nhau như thế nào?",
        "answer": (
            "Khi tồn kho thấp, nhân viên tạo purchase request; sau khi được duyệt, purchase request trở "
            "thành purchase order và được gửi cho nhà cung cấp xác nhận. Đây là hai bước tách biệt để "
            "đảm bảo có kiểm soát trước khi đặt hàng thật."
        ),
    },
    {
        "id": "supplier-portal",
        "category": "purchasing",
        "question": "Nhà cung cấp xác nhận đơn hàng bằng cách nào nếu chưa có tài khoản?",
        "answer": (
            "Nhà cung cấp chưa có tài khoản có thể dùng Supplier Portal công khai qua đường link kèm "
            "token do nhân viên gửi (không cần đăng nhập) để xác nhận đơn hàng, nộp hóa đơn/phiếu giao "
            "hàng, hoặc báo thiếu hàng."
        ),
    },
    {
        "id": "storage-suggestion-ai",
        "category": "warehouse",
        "question": "AI hỗ trợ gợi ý vị trí lưu trữ sách trong kho như thế nào?",
        "answer": (
            "Hệ thống có tính năng Storage/Reslotting Suggestion gợi ý vị trí lưu trữ tối ưu khi xếp "
            "hàng vào kệ (putaway) và đề xuất tái sắp xếp kệ hiện có, dựa trên dữ liệu tồn kho và hoạt "
            "động kho."
        ),
    },
    {
        "id": "ai-assistant-scope",
        "category": "general",
        "question": "Trợ lý AI (chatbot) trong hệ thống hỗ trợ được những gì?",
        "answer": (
            "Chatbot có thể tra cứu tồn kho, sách quá hạn, xu hướng mượn trả, phí phạt, gợi ý đặt hàng, "
            "và trả lời các câu hỏi thường gặp về chính sách mượn/trả, phí phạt, quy trình kho. Với các "
            "câu hỏi cần quyết định phức tạp hơn dành cho quản lý/quản kho, hãy dùng trang AI Assistant."
        ),
    },
]
```

*(This is a starter set of 10 entries covering the core policies already defined in the codebase. Expand it later by appending more `{id, category, question, answer}` dicts in the same format — `test_has_at_least_ten_entries` and `test_ids_are_unique` will keep guarding basic quality as it grows.)*

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest test_faq_retrieval.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add services/ai-service/faq_data.py services/ai-service/test_faq_retrieval.py
git commit -m "feat(ai-service): add starter FAQ content for chatbot semantic retrieval"
```

---

### Task 2: FAQ semantic retrieval module

**Files:**
- Create: `services/ai-service/faq_retrieval.py`
- Modify: `services/ai-service/test_faq_retrieval.py` (append `FindRelevantTests`)

**Interfaces:**
- Consumes: `FAQ_ENTRIES: list[dict]` from `faq_data.py` (Task 1).
- Produces:
  - `class FAQMatch(NamedTuple)` with fields `entry: dict`, `score: float`.
  - `find_relevant(query: str, top_k: int = FAQ_TOP_K, threshold: float = FAQ_MATCH_THRESHOLD, client: ollama.Client | None = None) -> list[FAQMatch]` — never raises; returns `[]` on any embedding failure or when nothing clears `threshold`.
  - Module constants `FAQ_EMBED_MODEL` (env `FAQ_EMBED_MODEL`, default `"nomic-embed-text"`), `FAQ_MATCH_THRESHOLD` (default `0.75`), `FAQ_TOP_K` (default `3`).
  - Internal (used by tests directly): `_faq_vectors` (module-level cache, `None` until first load), `_CACHE_PATH` (on-disk cache file path), `_load_faq_vectors(client=None)`.

- [ ] **Step 1: Write the failing tests**

Append to `services/ai-service/test_faq_retrieval.py` (add these imports to the top of the file and this new class at the end, before `if __name__ == "__main__":`):

```python
import os

import faq_retrieval


class FakeEmbedResponse:
    def __init__(self, embeddings):
        self.embeddings = embeddings


class FakeOllamaClient:
    """Deterministic fake: maps known text -> fixed vector, so cosine
    similarity in assertions is exact and doesn't depend on a real model."""

    def __init__(self, vectors: dict, default=None):
        self._vectors = vectors
        self._default = default

    def embed(self, model, input):
        texts = [input] if isinstance(input, str) else list(input)
        result = []
        for text in texts:
            vector = self._vectors.get(text, self._default)
            if vector is None:
                raise RuntimeError(f"no fake vector configured for: {text!r}")
            result.append(vector)
        return FakeEmbedResponse(embeddings=result)


class FailingOllamaClient:
    def embed(self, model, input):
        raise ConnectionError("ollama unreachable")


def _reset_module_state():
    faq_retrieval._faq_vectors = None
    if os.path.exists(faq_retrieval._CACHE_PATH):
        os.remove(faq_retrieval._CACHE_PATH)


class FindRelevantTests(unittest.TestCase):
    def setUp(self):
        _reset_module_state()
        # One-hot vectors per FAQ question so similarity is unambiguous: a
        # query vector equal to entry N's vector matches only entry N.
        self.vectors = {
            entry["question"]: [1.0 if i == idx else 0.0 for i in range(len(FAQ_ENTRIES))]
            for idx, entry in enumerate(FAQ_ENTRIES)
        }
        self.first_entry = FAQ_ENTRIES[0]

    def tearDown(self):
        _reset_module_state()

    def test_query_matching_first_faq_returns_it_above_threshold(self):
        client = FakeOllamaClient(self.vectors, default=self.vectors[self.first_entry["question"]])
        matches = faq_retrieval.find_relevant("cau hoi bat ky", client=client)
        self.assertTrue(matches)
        self.assertEqual(matches[0].entry["id"], self.first_entry["id"])
        self.assertGreaterEqual(matches[0].score, faq_retrieval.FAQ_MATCH_THRESHOLD)

    def test_unrelated_query_returns_no_match(self):
        orthogonal = [0.0] * len(FAQ_ENTRIES)
        client = FakeOllamaClient(self.vectors, default=orthogonal)
        matches = faq_retrieval.find_relevant("cau hoi khong lien quan gi ca", client=client)
        self.assertEqual(matches, [])

    def test_ollama_failure_returns_empty_list_not_exception(self):
        matches = faq_retrieval.find_relevant("bat ky cau hoi nao", client=FailingOllamaClient())
        self.assertEqual(matches, [])

    def test_cache_reused_on_second_load_without_reembedding(self):
        client = FakeOllamaClient(self.vectors, default=self.vectors[self.first_entry["question"]])
        first_load = faq_retrieval._load_faq_vectors(client=client)
        self.assertEqual(len(first_load), len(FAQ_ENTRIES))
        self.assertTrue(os.path.exists(faq_retrieval._CACHE_PATH))

        faq_retrieval._faq_vectors = None
        # FailingOllamaClient would raise on any embed() call — if this still
        # returns full vectors, they came from the on-disk cache, not a
        # fresh embedding call.
        second_load = faq_retrieval._load_faq_vectors(client=FailingOllamaClient())
        self.assertEqual(len(second_load), len(FAQ_ENTRIES))
        self.assertTrue(all(vector for _, vector in second_load))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest test_faq_retrieval.py -v`
Expected: FAIL / ERROR — `ModuleNotFoundError: No module named 'faq_retrieval'`

- [ ] **Step 3: Write the implementation**

Create `services/ai-service/faq_retrieval.py`:

```python
from __future__ import annotations

import hashlib
import json
import logging
import math
import os
from typing import NamedTuple

import ollama

from faq_data import FAQ_ENTRIES

logger = logging.getLogger(__name__)

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://ollama:11434")
FAQ_EMBED_MODEL = os.getenv("FAQ_EMBED_MODEL", "nomic-embed-text")
FAQ_MATCH_THRESHOLD = float(os.getenv("FAQ_MATCH_THRESHOLD", "0.75"))
FAQ_TOP_K = int(os.getenv("FAQ_TOP_K", "3"))

_CACHE_PATH = os.path.join(os.path.dirname(__file__), ".faq_embeddings_cache.json")

_faq_vectors: list[tuple[dict, list[float]]] | None = None


class FAQMatch(NamedTuple):
    entry: dict
    score: float


def _content_hash() -> str:
    payload = json.dumps(
        [{"id": e["id"], "question": e["question"], "answer": e["answer"]} for e in FAQ_ENTRIES],
        sort_keys=True,
        ensure_ascii=False,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _read_cache() -> dict | None:
    if not os.path.exists(_CACHE_PATH):
        return None
    try:
        with open(_CACHE_PATH, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        return None


def _write_cache(hash_: str, vectors: list[list[float]]) -> None:
    try:
        with open(_CACHE_PATH, "w", encoding="utf-8") as fh:
            json.dump({"hash": hash_, "vectors": vectors}, fh)
    except OSError:
        logger.warning("faq_retrieval: could not write embedding cache to %s", _CACHE_PATH)


def _embed_batch(texts: list[str], client: ollama.Client | None = None) -> list[list[float]] | None:
    """Embed multiple strings in one Ollama call. Returns None on any
    failure — callers must degrade gracefully, never raise."""
    try:
        active_client = client or ollama.Client(host=OLLAMA_HOST)
        response = active_client.embed(model=FAQ_EMBED_MODEL, input=texts)
        vectors = response.embeddings
        if len(vectors) != len(texts):
            return None
        return [list(v) for v in vectors]
    except Exception as exc:
        logger.warning("faq_retrieval: embedding failed: %s", type(exc).__name__)
        return None


def embed_text(text: str, client: ollama.Client | None = None) -> list[float] | None:
    vectors = _embed_batch([text], client=client)
    if not vectors:
        return None
    return vectors[0]


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    if len(a) != len(b) or not a:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def _load_faq_vectors(client: ollama.Client | None = None) -> list[tuple[dict, list[float]]]:
    global _faq_vectors
    if _faq_vectors is not None:
        return _faq_vectors

    current_hash = _content_hash()
    cached = _read_cache()
    if (
        cached
        and cached.get("hash") == current_hash
        and len(cached.get("vectors") or []) == len(FAQ_ENTRIES)
    ):
        _faq_vectors = list(zip(FAQ_ENTRIES, cached["vectors"]))
        return _faq_vectors

    vectors = _embed_batch([entry["question"] for entry in FAQ_ENTRIES], client=client)
    if vectors is None:
        # Embedding the FAQ set failed entirely (Ollama down, model missing).
        # Degrade to "no FAQ has a vector" rather than crashing — find_relevant
        # will then just never match anything until the next successful load.
        vectors = [[] for _ in FAQ_ENTRIES]
    else:
        _write_cache(current_hash, vectors)

    _faq_vectors = list(zip(FAQ_ENTRIES, vectors))
    return _faq_vectors


def find_relevant(
    query: str,
    top_k: int = FAQ_TOP_K,
    threshold: float = FAQ_MATCH_THRESHOLD,
    client: ollama.Client | None = None,
) -> list[FAQMatch]:
    """Semantic search over the static FAQ set. Never raises: returns []
    if Ollama is unreachable or nothing clears the similarity threshold —
    callers fall back to the existing GENERAL_QUERY behavior in that case.
    """
    query_vector = embed_text(query, client=client)
    if not query_vector:
        return []

    faq_vectors = _load_faq_vectors(client=client)
    matches = [
        FAQMatch(entry=entry, score=_cosine_similarity(query_vector, vector))
        for entry, vector in faq_vectors
        if vector
    ]
    matches = [m for m in matches if m.score >= threshold]
    matches.sort(key=lambda m: m.score, reverse=True)
    return matches[:top_k]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest test_faq_retrieval.py -v`
Expected: PASS (7 tests total: 3 from `FAQDataTests`, 4 from `FindRelevantTests`)

- [ ] **Step 5: Commit**

```bash
git add services/ai-service/faq_retrieval.py services/ai-service/test_faq_retrieval.py
git commit -m "feat(ai-service): add semantic FAQ search over Ollama embeddings"
```

---

### Task 3: Hook FAQ retrieval into the `GENERAL_QUERY` branch

**Files:**
- Modify: `services/ai-service/retrieval.py:1-9` (imports), `retrieval.py:236-243` (the `GENERAL_QUERY` branch)
- Test: `services/ai-service/test_retrieval.py` (new file)

**Interfaces:**
- Consumes: `faq_retrieval.find_relevant(query: str, client=None) -> list[FAQMatch]` (Task 2), `FAQMatch.entry` (dict with `id`, `question`, `answer`), `FAQMatch.score`.
- Produces: `retrieve_context(intent_info, auth_header)` now returns a populated `{summary, raw, sources, warnings, retrieved_at}` envelope for `GENERAL_QUERY` when FAQ matches are found — same shape every other intent already returns, consumed unchanged by `rag.build_rag_context`, `rag.verify_numeric_grounding`, `rag.ensure_source_line` in `main.py`.

- [ ] **Step 1: Write the failing test**

Create `services/ai-service/test_retrieval.py`:

```python
from __future__ import annotations

import asyncio
import unittest
from unittest import mock

import faq_retrieval
import retrieval
from faq_retrieval import FAQMatch
from intent import GENERAL_QUERY


class GeneralQueryRetrievalTests(unittest.TestCase):
    def test_general_query_with_faq_match_returns_summary_and_sources(self):
        fake_entry = {
            "id": "test-faq",
            "category": "general",
            "question": "Cau hoi mau?",
            "answer": "Tra loi mau.",
        }
        with mock.patch.object(
            faq_retrieval, "find_relevant", return_value=[FAQMatch(entry=fake_entry, score=0.9)]
        ):
            result = asyncio.run(
                retrieval.retrieve_context({"intent": GENERAL_QUERY, "query": "cau hoi mau"}, auth_header=None)
            )

        self.assertIn("Tra loi mau.", result["summary"])
        self.assertTrue(result["sources"])
        self.assertEqual(result["sources"][0]["status"], "ok")
        self.assertEqual(result["raw"]["faq_matches"][0]["id"], "test-faq")

    def test_general_query_without_faq_match_returns_empty_envelope(self):
        with mock.patch.object(faq_retrieval, "find_relevant", return_value=[]):
            result = asyncio.run(
                retrieval.retrieve_context({"intent": GENERAL_QUERY, "query": "cau hoi la"}, auth_header=None)
            )

        self.assertEqual(result["summary"], "")
        self.assertEqual(result["sources"], [])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest test_retrieval.py -v`
Expected: FAIL — `AssertionError` (current `GENERAL_QUERY` branch always returns an empty envelope; `mock.patch.object(faq_retrieval, "find_relevant", ...)` has nothing to hook into yet since `retrieval.py` doesn't import `faq_retrieval`)

- [ ] **Step 3: Wire in the FAQ lookup**

In `services/ai-service/retrieval.py`, add the import after the existing `import httpx` (line 9):

```python
import httpx

import faq_retrieval
```

Replace the `GENERAL_QUERY` branch (current lines 236-243):

```python
    if intent == GENERAL_QUERY:
        return {
            "summary": "",
            "raw": raw,
            "sources": sources,
            "warnings": warnings,
            "retrieved_at": datetime.now(timezone.utc).isoformat(),
        }
```

with:

```python
    if intent == GENERAL_QUERY:
        # Ollama's embed() is a blocking network call — must run off the event
        # loop the same way main.py's _chat_with_ollama wraps ollama.Client
        # calls (main.py:3291-3309), since retrieve_context is async.
        faq_matches = await asyncio.to_thread(faq_retrieval.find_relevant, intent_info.get("query") or "")
        if not faq_matches:
            return {
                "summary": "",
                "raw": raw,
                "sources": sources,
                "warnings": warnings,
                "retrieved_at": datetime.now(timezone.utc).isoformat(),
            }

        for match in faq_matches:
            sources.append({
                "name": f"FAQ: {match.entry['question']}",
                "endpoint": f"faq://{match.entry['id']}",
                "status": "ok",
            })
        raw["faq_matches"] = [
            {
                "id": match.entry["id"],
                "question": match.entry["question"],
                "answer": match.entry["answer"],
                "score": round(match.score, 3),
            }
            for match in faq_matches
        ]
        summary = "Câu hỏi thường gặp liên quan:\n" + "\n".join(
            f"- {match.entry['question']}: {match.entry['answer']}" for match in faq_matches
        )

        return {
            "summary": summary,
            "raw": raw,
            "sources": sources,
            "warnings": warnings,
            "retrieved_at": datetime.now(timezone.utc).isoformat(),
        }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest test_retrieval.py -v`
Expected: PASS (2 tests)

Also re-run the full suite to confirm nothing else broke: `python -m pytest -v` (from `services/ai-service/`)

- [ ] **Step 5: Commit**

```bash
git add services/ai-service/retrieval.py services/ai-service/test_retrieval.py
git commit -m "feat(ai-service): answer GENERAL_QUERY chat messages from FAQ semantic search"
```

---

### Task 4: Let CUSTOMER/SUPPLIER reach the new FAQ answers too

**Why this task exists (not in the original spec):** while reading `main.py` to plan Task 3's integration point, found that `/chat` (`main.py:3416-3424`) and `/chat/stream` (`main.py:4211-4217`) short-circuit `retrieve_context()` entirely for CUSTOMER/SUPPLIER roles unless the intent is exactly `BOOK_SEARCH_QUERY` — replacing it with a hardcoded empty envelope *before* `retrieve_context` (and therefore Task 3's new FAQ branch) ever runs. CUSTOMER is the role most likely to ask the borrow/fine/reservation policy questions the new FAQ set covers, so without this fix Task 3's work would be unreachable for exactly the audience it matters most for.

**Files:**
- Modify: `services/ai-service/intent.py` (add exemption set near the intent constants, after line 18)
- Modify: `services/ai-service/main.py:45` (import), `main.py:3419-3421` (`/chat`), `main.py:4211-4213` (`/chat/stream`)
- Test: `services/ai-service/test_rag.py` (append a small test class)

**Interfaces:**
- Consumes: `intent.BOOK_SEARCH_QUERY`, `intent.GENERAL_QUERY` (already defined).
- Produces: `intent.ANALYTICS_BLOCK_EXEMPT_INTENTS: frozenset[str]` containing `{BOOK_SEARCH_QUERY, GENERAL_QUERY}`.

- [ ] **Step 1: Write the failing test**

Append to `services/ai-service/test_rag.py`, before `if __name__ == "__main__":`:

```python
class AnalyticsBlockExemptionTests(unittest.TestCase):
    def test_general_query_and_book_search_are_exempt(self):
        from intent import ANALYTICS_BLOCK_EXEMPT_INTENTS, BOOK_SEARCH_QUERY, GENERAL_QUERY

        self.assertIn(GENERAL_QUERY, ANALYTICS_BLOCK_EXEMPT_INTENTS)
        self.assertIn(BOOK_SEARCH_QUERY, ANALYTICS_BLOCK_EXEMPT_INTENTS)

    def test_low_stock_query_is_not_exempt(self):
        from intent import ANALYTICS_BLOCK_EXEMPT_INTENTS, LOW_STOCK_QUERY

        self.assertNotIn(LOW_STOCK_QUERY, ANALYTICS_BLOCK_EXEMPT_INTENTS)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest test_rag.py -v -k AnalyticsBlockExemptionTests`
Expected: FAIL — `ImportError: cannot import name 'ANALYTICS_BLOCK_EXEMPT_INTENTS' from 'intent'`

- [ ] **Step 3: Add the exemption set to `intent.py`**

In `services/ai-service/intent.py`, after line 18 (`GENERAL_QUERY = "GENERAL_QUERY"`), add:

```python
GENERAL_QUERY = "GENERAL_QUERY"

# Intents that should still reach retrieve_context() even for roles blocked
# from system-wide analytics (CUSTOMER, SUPPLIER — see
# user_personal_context.ANALYTICS_BLOCKED_ROLES): book search was always
# exempt so customers can look up the catalog; GENERAL_QUERY is exempt too
# so FAQ semantic search (faq_retrieval.find_relevant) answers policy
# questions for every role, not just staff.
ANALYTICS_BLOCK_EXEMPT_INTENTS: frozenset[str] = frozenset({BOOK_SEARCH_QUERY, GENERAL_QUERY})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest test_rag.py -v -k AnalyticsBlockExemptionTests`
Expected: PASS (2 tests)

- [ ] **Step 5: Wire the exemption set into `main.py`**

In `services/ai-service/main.py:45`, replace:

```python
from intent import BOOK_SEARCH_QUERY as _BOOK_SEARCH_INTENT
```

with:

```python
from intent import ANALYTICS_BLOCK_EXEMPT_INTENTS
```

In `main.py:3419-3421` (inside `async def chat`), replace:

```python
    _blocked = personal.get("role") in ANALYTICS_BLOCKED_ROLES
    _is_book_search = intent_info.get("intent") == _BOOK_SEARCH_INTENT
    if _blocked and not _is_book_search:
```

with:

```python
    _blocked = personal.get("role") in ANALYTICS_BLOCKED_ROLES
    _is_exempt_intent = intent_info.get("intent") in ANALYTICS_BLOCK_EXEMPT_INTENTS
    if _blocked and not _is_exempt_intent:
```

In `main.py:4211-4213` (inside `async def chat_stream`), apply the identical replacement:

```python
    _blocked = personal.get("role") in ANALYTICS_BLOCKED_ROLES
    _is_exempt_intent = intent_info.get("intent") in ANALYTICS_BLOCK_EXEMPT_INTENTS
    if _blocked and not _is_exempt_intent:
```

- [ ] **Step 6: Verify `main.py` still parses correctly**

`main.py` isn't imported directly by the test suite (it has module-level DB/service setup), so the existing convention is to sanity-check syntax with the compiler rather than importing it. Run (from `services/ai-service/`):

`python -m py_compile main.py`

Expected: no output, exit code 0. Also grep to confirm no leftover references to the removed name:

`grep -n "_BOOK_SEARCH_INTENT\|_is_book_search" main.py`

Expected: no matches.

- [ ] **Step 7: Commit**

```bash
git add services/ai-service/intent.py services/ai-service/main.py services/ai-service/test_rag.py
git commit -m "fix(ai-service): let CUSTOMER/SUPPLIER reach GENERAL_QUERY retrieval (FAQ search)"
```

---

### Task 5: Configuration and docs for the new embedding model

**Files:**
- Modify: `docker-compose.yml:216-219` (ai-service environment block)
- Modify: `.env.example:51-57`
- Modify: `README.md` (both `ollama pull` locations: around line 544 and line 739)
- Modify: `.gitignore`

**Interfaces:**
- Consumes: the `FAQ_EMBED_MODEL` env var name defined in `faq_retrieval.py` (Task 2, default `"nomic-embed-text"`).

- [ ] **Step 1: Add the env var to `docker-compose.yml`**

In `docker-compose.yml`, inside the `ai-service` `environment:` block, right after the `ASSISTANT_MODEL` line (`docker-compose.yml:219`), add:

```yaml
      - ASSISTANT_MODEL=${ASSISTANT_MODEL:-llama3.1:8b-instruct-q4_0}
      # Embedding model for chatbot FAQ semantic search (GENERAL_QUERY fallback) — separate
      # from ASSISTANT_MODEL/SUMMARY_MODEL since it's a dedicated embedding model, not a chat model.
      - FAQ_EMBED_MODEL=${FAQ_EMBED_MODEL:-nomic-embed-text}
```

- [ ] **Step 2: Add the env var to `.env.example`**

In `.env.example`, right after line 57 (`ASSISTANT_MODEL=llama3.1:8b-instruct-q4_0`), add:

```
ASSISTANT_MODEL=llama3.1:8b-instruct-q4_0
# Embedding model for chatbot FAQ semantic search (separate from the chat models above)
FAQ_EMBED_MODEL=nomic-embed-text
```

- [ ] **Step 3: Add the model pull command to `README.md`**

At `README.md:543-545` (the AI profile bring-up block), change:

```powershell
docker compose --profile ai up -d --build ai-service ollama
docker compose exec ollama ollama pull llama3.1:8b-instruct-q4_0
```

to:

```powershell
docker compose --profile ai up -d --build ai-service ollama
docker compose exec ollama ollama pull llama3.1:8b-instruct-q4_0
docker compose exec ollama ollama pull nomic-embed-text
```

At `README.md:738-740` (the AI Assistant integration test block), apply the same addition:

```powershell
docker compose exec ollama ollama pull llama3.1:8b-instruct-q4_0
docker compose exec ollama ollama pull nomic-embed-text
node scripts\ai-assistant-integration.mjs
```

- [ ] **Step 4: Ignore the runtime embedding cache file**

In `.gitignore`, add a line for the cache file `faq_retrieval.py` writes at runtime (`services/ai-service/.faq_embeddings_cache.json` — see `_CACHE_PATH` in Task 2):

```
services/ai-service/.faq_embeddings_cache.json
```

- [ ] **Step 5: Verify the compose file is still valid**

Run (from the repo root, `smartbook-system/`): `docker compose config --quiet`
Expected: no output, exit code 0 (validates YAML syntax and `${VAR:-default}` interpolation without needing containers running)

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml .env.example README.md .gitignore
git commit -m "docs(ai-service): document FAQ_EMBED_MODEL and nomic-embed-text pull step"
```

---

## After This Plan

Not covered here, left for the user (per the spec's "ngoài phạm vi" note):
- Expanding `FAQ_ENTRIES` beyond the 10 starter entries.
- Running `docker compose exec ollama ollama pull nomic-embed-text` on any environment that doesn't already have it (dev, demo, etc.) — the README steps in Task 5 only document the command, they don't run it.
