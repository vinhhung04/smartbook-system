# Phase A — Vector Store & Hybrid Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay hai cache vector bằng file JSON (`.book_index_cache.json`, `.faq_embeddings_cache.json`) bằng pgvector trong `ai_db`, thêm hybrid search (semantic + full-text hợp nhất bằng RRF), và đo được cải thiện so với baseline.

**Architecture:** Vector lưu trong `ai_document_chunks` (pgvector, HNSW cosine). Một module `vector_store.py` theo `Protocol` với hai implementation — `PgVectorStore` cho production, `InMemoryVectorStore` cho test (test hiện chạy SQLite in-memory, không có pgvector). `ingestion.py` đồng bộ hai corpus (`BOOK_METADATA` từ `/api/books` qua gateway, `INTERNAL_DOC` từ file Markdown) theo kiểu incremental dựa trên content-hash từng chunk. Chữ ký public của `search_books()` và `find_relevant()` giữ nguyên nên 11 tool và `retrieval.py` không phải sửa.

**Tech Stack:** Python 3.14, FastAPI, SQLAlchemy async + asyncpg, pgvector 0.7+, Postgres 15, Ollama (`nomic-embed-text`, 768 chiều), `unittest`.

**Spec:** `docs/superpowers/specs/2026-09-16-ai-decision-support-platform-design.md`

## Global Constraints

- **Working directory cho mọi lệnh Python:** `services/ai-service/`. Test import phẳng (`import book_index`), không phải package.
- **Test framework:** `unittest` (không phải pytest). Chạy: `python -m unittest discover` từ `services/ai-service/`.
- **Không được raise từ tầng retrieval.** Mọi lỗi degrade xuống mức thấp hơn và log warning. Đây là convention có sẵn của `embeddings.py`, `book_index.py`, `faq_retrieval.py` — giữ nguyên.
- **AD-5 (ràng buộc cứng):** `assistant_tools.search_books(auth_header, query) -> dict` và `faq_retrieval.find_relevant(query, top_k, threshold) -> list[FAQMatch]` **giữ nguyên chữ ký và shape trả về**. Nếu phải sửa test hiện có vì đổi interface của hai hàm này → đã làm sai, dừng lại.
- **AD-4:** LLM không sinh số. Không áp dụng trực tiếp trong Phase A nhưng eval ở Task 1 đo đúng việc này.
- **Chiều vector:** 768 (`nomic-embed-text`). Mọi chỗ hard-code 768 phải đọc từ một hằng số duy nhất `vector_store.EMBEDDING_DIM`.
- **Corpus name:** chỉ hai giá trị `"BOOK_METADATA"` và `"INTERNAL_DOC"`. Hằng số trong `vector_store.py`.
- **Commit message:** tiếng Việt không dấu (theo commit history có sẵn của repo), kết thúc bằng `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Branch:** `hungg`. Không push lên `main`.

---

## File Structure

| File | Trạng thái | Trách nhiệm |
|---|---|---|
| `eval/rag_dataset.json` | Tạo | 100 câu hỏi có ground truth cho retrieval eval |
| `eval/eval_rag.py` | Tạo | Chạy eval, in report, ghi `eval/reports/` |
| `eval/scoring.py` | Sửa | Thêm `recall_at_k`, `mean_reciprocal_rank`, `aggregate_retrieval_scores` |
| `services/ai-service/schema.sql` | Sửa | Thêm extension + 2 bảng + 3 index |
| `db-init/02-create-extensions.sql` | Sửa | Thêm `vector`, `unaccent` cho `ai_db` (chỉ chạy khi volume mới) |
| `docker-compose.yml` | Sửa | Image `db`: `postgres:15-alpine` → `pgvector/pgvector:pg15` |
| `services/ai-service/vector_store.py` | Tạo | Types, `VectorStore` protocol, `InMemoryVectorStore`, `PgVectorStore`, `get_store()` |
| `services/ai-service/fusion.py` | Tạo | RRF — hàm thuần, không I/O |
| `services/ai-service/ingestion.py` | Tạo | chunk → hash → embed (chỉ chunk đổi) → upsert |
| `services/ai-service/corpus/*.md` | Tạo | Tài liệu nội bộ, thay `faq_data.py` |
| `services/ai-service/book_index.py` | Sửa | Ruột đổi sang `vector_store`; bỏ cache JSON |
| `services/ai-service/assistant_tools.py` | Sửa | `_score_and_rank_books` thành async |
| `services/ai-service/routes_cover_search.py:251` | Sửa | Await thay vì `asyncio.to_thread` |
| `services/ai-service/main.py:4634` | Sửa | Await thay vì `asyncio.to_thread` |
| `services/ai-service/faq_retrieval.py` | Sửa | Đọc corpus `INTERNAL_DOC`; giữ chữ ký `find_relevant` |
| `services/ai-service/test_vector_store.py` | Tạo | Test `InMemoryVectorStore` + protocol |
| `services/ai-service/test_fusion.py` | Tạo | Test RRF |
| `services/ai-service/test_ingestion.py` | Tạo | Test chunking + incremental hashing |
| `services/ai-service/test_pgvector_store.py` | Tạo | Integration, skip khi không có Postgres |

---

## Cảnh báo trước khi bắt đầu

**`book_index.semantic_scores` có 3 caller, không phải 1.** Trước khi sửa nó, đọc cả ba:

```
assistant_tools.py:182    _score_and_rank_books  → search_books, routes_cover_search
main.py:4634              recommendations        → asyncio.to_thread(book_index.semantic_scores, candidates, profile_text)
recommendation.py:208     tiêu thụ điểm semantic đã tính sẵn (không tự gọi)
```

`semantic_scores(books, query)` là API **rerank một danh sách cho trước**, không phải API **tìm top-k trong toàn corpus**. pgvector làm được cả hai, nhưng cái thứ nhất cần lọc `source_id = ANY(...)`. Đó là lý do `VectorStore.search_semantic` có tham số `source_ids`.

`semantic_scores` là hàm nội bộ của module, **không** nằm trong AD-5 — được phép đổi thành async. `search_books` và `find_relevant` thì không.

---

### Task 1: RAG eval harness + baseline

Phải làm trước tiên. Baseline chỉ đo được trên code hiện tại; sửa retrieval trước rồi mới dựng eval là mất vĩnh viễn con số "trước/sau".

**Files:**
- Create: `services/ai-service/eval/rag_dataset.json`
- Create: `services/ai-service/eval/eval_rag.py`
- Modify: `services/ai-service/eval/scoring.py` (thêm vào cuối file)
- Test: `services/ai-service/test_eval_scoring.py` (thêm vào file đã có)

**Interfaces:**
- Consumes: `scoring.hallucinated_numbers`, `scoring.fact_recall` (đã có trong `eval/scoring.py`)
- Produces:
  - `scoring.recall_at_k(retrieved_ids: list[str], expected_ids: list[str], k: int) -> float`
  - `scoring.mean_reciprocal_rank(retrieved_ids: list[str], expected_ids: list[str]) -> float`
  - `scoring.aggregate_retrieval_scores(results: list[dict]) -> dict` với khoá `recall_at_1`, `recall_at_3`, `recall_at_5`, `mrr`, `count`

- [ ] **Step 1: Viết test thất bại cho retrieval metrics**

Thêm vào cuối `services/ai-service/test_eval_scoring.py`:

```python
class RetrievalMetricsTest(unittest.TestCase):
    def test_recall_at_k_counts_any_expected_in_top_k(self):
        self.assertEqual(scoring.recall_at_k(["a", "b", "c"], ["c"], 3), 1.0)
        self.assertEqual(scoring.recall_at_k(["a", "b", "c"], ["c"], 2), 0.0)

    def test_recall_at_k_is_fraction_of_expected_found(self):
        self.assertEqual(scoring.recall_at_k(["a", "b"], ["a", "z"], 2), 0.5)

    def test_recall_at_k_empty_expected_is_zero(self):
        self.assertEqual(scoring.recall_at_k(["a"], [], 3), 0.0)

    def test_mrr_uses_rank_of_first_expected_hit(self):
        self.assertAlmostEqual(scoring.mean_reciprocal_rank(["x", "a"], ["a"]), 0.5)
        self.assertAlmostEqual(scoring.mean_reciprocal_rank(["a", "x"], ["a"]), 1.0)

    def test_mrr_zero_when_no_hit(self):
        self.assertEqual(scoring.mean_reciprocal_rank(["x", "y"], ["a"]), 0.0)

    def test_aggregate_retrieval_scores(self):
        results = [
            {"retrieved_ids": ["a", "b", "c"], "expected_ids": ["a"]},
            {"retrieved_ids": ["x", "y", "b"], "expected_ids": ["b"]},
        ]
        agg = scoring.aggregate_retrieval_scores(results)
        self.assertEqual(agg["count"], 2)
        self.assertAlmostEqual(agg["recall_at_1"], 0.5)
        self.assertAlmostEqual(agg["recall_at_3"], 1.0)
        self.assertAlmostEqual(agg["mrr"], (1.0 + 1 / 3) / 2)
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `cd services/ai-service && python -m unittest test_eval_scoring -v`
Expected: FAIL — `AttributeError: module 'scoring' has no attribute 'recall_at_k'`

- [ ] **Step 3: Implement metrics**

Thêm vào cuối `services/ai-service/eval/scoring.py`:

```python
def recall_at_k(retrieved_ids: list[str], expected_ids: list[str], k: int) -> float:
    """Tỷ lệ tài liệu đúng nằm trong top-k. 0.0 khi không có expected nào —
    một case không có ground truth là lỗi dataset, không phải điểm tuyệt đối."""
    if not expected_ids:
        return 0.0
    top = set(retrieved_ids[:k])
    found = sum(1 for doc_id in set(expected_ids) if doc_id in top)
    return found / len(set(expected_ids))


def mean_reciprocal_rank(retrieved_ids: list[str], expected_ids: list[str]) -> float:
    """1/rank của tài liệu đúng ĐẦU TIÊN. Đo "người dùng phải đọc qua bao nhiêu
    kết quả sai", thứ recall@k không phân biệt được."""
    expected = set(expected_ids)
    for position, doc_id in enumerate(retrieved_ids, start=1):
        if doc_id in expected:
            return 1.0 / position
    return 0.0


def aggregate_retrieval_scores(results: list[dict]) -> dict:
    if not results:
        return {"count": 0, "recall_at_1": 0.0, "recall_at_3": 0.0, "recall_at_5": 0.0, "mrr": 0.0}
    total = len(results)
    def mean(values):
        return sum(values) / total
    return {
        "count": total,
        "recall_at_1": round(mean([recall_at_k(r["retrieved_ids"], r["expected_ids"], 1) for r in results]), 4),
        "recall_at_3": round(mean([recall_at_k(r["retrieved_ids"], r["expected_ids"], 3) for r in results]), 4),
        "recall_at_5": round(mean([recall_at_k(r["retrieved_ids"], r["expected_ids"], 5) for r in results]), 4),
        "mrr": round(mean([mean_reciprocal_rank(r["retrieved_ids"], r["expected_ids"]) for r in results]), 4),
    }
```

- [ ] **Step 4: Chạy test, xác nhận PASS**

Run: `cd services/ai-service && python -m unittest test_eval_scoring -v`
Expected: PASS, toàn bộ test cũ trong file vẫn pass.

- [ ] **Step 5: Tạo dataset**

Tạo `services/ai-service/eval/rag_dataset.json`. Schema mỗi entry:

```json
{
  "id": "bm-001",
  "corpus": "BOOK_METADATA",
  "question": "Có sách nào dạy trẻ kỹ năng sống tự lập không?",
  "expected_ids": ["b2"],
  "expected_facts": [["ky nang song", "tu phuc vu"]],
  "note": "Chi match duoc qua description/summary_vi, khong match duoc bang title"
}
```

- `expected_ids` — `source_id` của tài liệu đúng (book id, hoặc slug tài liệu nội bộ).
- `expected_facts` — list các nhóm OR; `scoring.fact_recall` đã có sẵn hiểu format này (một nhóm tính là đạt nếu **bất kỳ** chuỗi nào trong nhóm xuất hiện).
- `note` — vì sao case này khó. Bắt buộc, để người sau biết case nào đang đo cái gì.

**Cấu tạo 100 case:** 60 `BOOK_METADATA` + 40 `INTERNAL_DOC`.

60 case `BOOK_METADATA`, lấy id thật từ seed `data/smartbook_sample_seed.sql`, chia theo loại:
- 15 case tra cứu chính xác (tên sách đúng, ISBN) — keyword phải thắng
- 20 case hỏi theo chủ đề ("sách nào nói về...") — semantic phải thắng, keyword không match được
- 10 case hỏi theo tác giả/thể loại
- 10 case diễn đạt vòng vo, sai chính tả, không dấu — đúng cách người dùng thật gõ
- 5 case **không có đáp án** (`expected_ids: []`) — hệ thống phải trả rỗng, không bịa

40 case `INTERNAL_DOC`, dựa trên nội dung sẽ viết ở Task 9 (11 entry FAQ hiện có trong `faq_data.py` + quy định mượn trả, phí phạt, quy trình kho):
- 25 case hỏi chính sách trực tiếp
- 10 case hỏi vòng vo cùng một chính sách
- 5 case **không có đáp án**

8 case mẫu để bắt nhịp — viết đủ 100 theo đúng khuôn này:

```json
[
  {"id": "bm-001", "corpus": "BOOK_METADATA", "question": "Sach nao day tre ky nang song tu lap?",
   "expected_ids": ["b2"], "expected_facts": [["ky nang song", "tu phuc vu"]],
   "note": "Chi match qua description/summary_vi"},
  {"id": "bm-002", "corpus": "BOOK_METADATA", "question": "Tim sach ISBN 9786041234567",
   "expected_ids": ["b1"], "expected_facts": [["Python"]],
   "note": "Exact ISBN — embedding thuong fail, keyword phai thang"},
  {"id": "bm-003", "corpus": "BOOK_METADATA", "question": "lap trinh python co ban",
   "expected_ids": ["b1"], "expected_facts": [["Python"]],
   "note": "Khong dau, khong hoa — normalize_text phai xu ly"},
  {"id": "bm-004", "corpus": "BOOK_METADATA", "question": "Toi muon doc gi do ve qua khu nhan loai",
   "expected_ids": ["b3"], "expected_facts": [["lich su"]],
   "note": "Dien dat vong vo, khong tu nao trung title"},
  {"id": "bm-005", "corpus": "BOOK_METADATA", "question": "Co sach nao ve du hanh vu tru khong?",
   "expected_ids": [], "expected_facts": [],
   "note": "Khong co trong catalog — phai tra rong, khong duoc bia"},
  {"id": "doc-001", "corpus": "INTERNAL_DOC", "question": "Moi nguoi duoc muon toi da bao nhieu quyen?",
   "expected_ids": ["quy-dinh-muon-tra"], "expected_facts": [["muon toi da", "so luong toi da"]],
   "note": "Hoi chinh sach truc tiep"},
  {"id": "doc-002", "corpus": "INTERNAL_DOC", "question": "Tra sach tre thi bi sao?",
   "expected_ids": ["phi-phat"], "expected_facts": [["phi phat", "qua han"]],
   "note": "Dien dat dan da cua cung chinh sach phi phat"},
  {"id": "doc-003", "corpus": "INTERNAL_DOC", "question": "Thu vien co ban cafe khong?",
   "expected_ids": [], "expected_facts": [],
   "note": "Ngoai pham vi tai lieu noi bo — phai tra rong"}
]
```

- [ ] **Step 6: Viết `eval_rag.py`**

Tạo `services/ai-service/eval/rag_dataset.json` xong thì tạo `services/ai-service/eval/eval_rag.py`:

```python
"""Retrieval + answer-grounding eval cho RAG.

Chay truc tiep vao tang retrieval (assistant_tools.search_books /
faq_retrieval.find_relevant), khong qua HTTP — chi tang retrieval dang duoc do,
khong phai auth/conversation/cache. Cung quy uoc voi eval_assistant_tools.py.

Chay TRUOC khi doi retrieval sang pgvector de co baseline, roi chay lai SAU de
so sanh. Report ghi vao eval/reports/rag_<timestamp>.md.

Usage (tu services/ai-service/):
    python eval/eval_rag.py
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import scoring  # noqa: E402
import assistant_tools  # noqa: E402
import faq_retrieval  # noqa: E402

DATASET_PATH = os.path.join(os.path.dirname(__file__), "rag_dataset.json")
REPORTS_DIR = os.path.join(os.path.dirname(__file__), "reports")
AUTH_TOKEN = os.getenv("EVAL_AUTH_TOKEN", "")


async def retrieve(entry: dict) -> list[str]:
    """Tra ve source_id da xep hang. Shape khac nhau giua hai corpus nen
    chuan hoa o day, khong o trong scoring."""
    if entry["corpus"] == "BOOK_METADATA":
        auth = f"Bearer {AUTH_TOKEN}" if AUTH_TOKEN else None
        payload = await assistant_tools.search_books(auth_header=auth, query=entry["question"])
        if "error" in payload:
            return []
        return [str(item.get("id") or "") for item in payload.get("results", [])]
    matches = await asyncio.to_thread(faq_retrieval.find_relevant, entry["question"])
    return [str(match.entry.get("id") or "") for match in matches]


async def main() -> int:
    with open(DATASET_PATH, "r", encoding="utf-8") as handle:
        dataset = json.load(handle)

    results = []
    for entry in dataset:
        retrieved = await retrieve(entry)
        results.append({
            "id": entry["id"],
            "corpus": entry["corpus"],
            "question": entry["question"],
            "retrieved_ids": retrieved,
            "expected_ids": entry["expected_ids"],
        })

    overall = scoring.aggregate_retrieval_scores(results)
    by_corpus = {
        corpus: scoring.aggregate_retrieval_scores([r for r in results if r["corpus"] == corpus])
        for corpus in ("BOOK_METADATA", "INTERNAL_DOC")
    }
    # Case khong co dap an do rieng: chi dung khi tra ve rong.
    empty_cases = [r for r in results if not r["expected_ids"]]
    empty_correct = sum(1 for r in empty_cases if not r["retrieved_ids"])

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    os.makedirs(REPORTS_DIR, exist_ok=True)
    report_path = os.path.join(REPORTS_DIR, f"rag_{timestamp}.md")
    lines = [
        f"# RAG retrieval eval — {timestamp}",
        "",
        f"- Tong: {overall['count']} case",
        f"- Recall@1 {overall['recall_at_1']} / Recall@3 {overall['recall_at_3']} / Recall@5 {overall['recall_at_5']}",
        f"- MRR {overall['mrr']}",
        f"- Case khong dap an tra dung rong: {empty_correct}/{len(empty_cases)}",
        "",
        "## Theo corpus",
    ]
    for corpus, agg in by_corpus.items():
        lines.append(f"- **{corpus}** ({agg['count']}): R@1 {agg['recall_at_1']}, R@3 {agg['recall_at_3']}, R@5 {agg['recall_at_5']}, MRR {agg['mrr']}")
    lines += ["", "## Case truot (khong co expected nao trong top-5)", ""]
    for r in results:
        if r["expected_ids"] and scoring.recall_at_k(r["retrieved_ids"], r["expected_ids"], 5) == 0.0:
            lines.append(f"- `{r['id']}` {r['question']} — mong {r['expected_ids']}, nhan {r['retrieved_ids'][:5]}")

    with open(report_path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")
    print("\n".join(lines))
    print(f"\nReport: {report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
```

- [ ] **Step 7: Chạy baseline**

Yêu cầu: stack đang chạy (`make up`), Ollama đã `ollama pull nomic-embed-text`, và `EVAL_AUTH_TOKEN` là JWT hợp lệ của tài khoản có quyền đọc catalog.

Run: `cd services/ai-service && EVAL_AUTH_TOKEN=<jwt> python eval/eval_rag.py`
Expected: in ra bảng số liệu và ghi `eval/reports/rag_<timestamp>.md`.

**Đây là baseline. Đổi tên file thành `rag_baseline_<timestamp>.md` để nó không lẫn với report sau này.**

- [ ] **Step 8: Commit**

```bash
git add services/ai-service/eval/rag_dataset.json services/ai-service/eval/eval_rag.py services/ai-service/eval/scoring.py services/ai-service/test_eval_scoring.py services/ai-service/eval/reports/
git commit -m "test(eval): RAG retrieval eval 100 cau + baseline truoc khi doi sang pgvector

Recall@k, MRR va so case khong-dap-an tra dung rong. Chay trUoc moi thay doi
retrieval de co con so so sanh; sau Phase A chay lai cung dataset.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Hạ tầng pgvector

**Files:**
- Modify: `docker-compose.yml:3` (image của service `db`)
- Modify: `db-init/02-create-extensions.sql` (khối `ai_db`)
- Modify: `services/ai-service/schema.sql` (cuối file)

**Interfaces:**
- Consumes: không
- Produces: bảng `ai_documents`, `ai_document_chunks` trong `ai_db`; extension `vector`, `unaccent`

- [ ] **Step 1: Đổi image Postgres**

Trong `docker-compose.yml`, service `db`:

```yaml
  db:
    image: pgvector/pgvector:pg15
```

(thay `postgres:15-alpine`). Image này là Postgres 15 chính thức + extension `vector` dựng sẵn. Volume `postgres_data` giữ nguyên, dữ liệu không mất — chỉ đổi binary.

- [ ] **Step 2: Thêm extension cho `ai_db` trong db-init**

Trong `db-init/02-create-extensions.sql`, sửa khối `ai_db`:

```sql
-- For ai_db
\c ai_db
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS unaccent;
```

**Lưu ý:** `db-init/` chỉ chạy khi volume Postgres **trống** (`docker-entrypoint-initdb.d`). Volume hiện có sẽ không chạy lại file này. Vì vậy Step 3 cũng tạo extension — đó mới là đường có tác dụng với database đang chạy.

- [ ] **Step 3: Thêm schema**

Thêm vào cuối `services/ai-service/schema.sql`:

```sql
-- Vector store (Phase A). Extension tao o day chu khong chi trong db-init/ vi
-- db-init chi chay tren volume trong; schema.sql chay moi lan service khoi dong
-- nen day la duong duy nhat co tac dung voi database dang ton tai.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE TABLE IF NOT EXISTS ai_documents (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    corpus        VARCHAR(32)  NOT NULL,
    source_id     VARCHAR(128) NOT NULL,
    title         TEXT,
    content       TEXT         NOT NULL,
    content_hash  VARCHAR(64)  NOT NULL,
    metadata      JSONB        NOT NULL DEFAULT '{}',
    updated_at    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    UNIQUE (corpus, source_id)
);

CREATE TABLE IF NOT EXISTS ai_document_chunks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id     UUID NOT NULL REFERENCES ai_documents (id) ON DELETE CASCADE,
    corpus          VARCHAR(32)  NOT NULL,
    chunk_index     INT          NOT NULL,
    content         TEXT         NOT NULL,
    content_hash    VARCHAR(64)  NOT NULL,
    embedding       vector(768)  NOT NULL,
    embedding_model VARCHAR(64)  NOT NULL,
    tsv             tsvector,
    created_at      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    UNIQUE (document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS ix_ai_chunks_embedding
    ON ai_document_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS ix_ai_chunks_tsv
    ON ai_document_chunks USING gin (tsv);
CREATE INDEX IF NOT EXISTS ix_ai_chunks_corpus_model
    ON ai_document_chunks (corpus, embedding_model);
```

**Vì sao `tsv` không dùng `GENERATED ALWAYS AS`:** Postgres đòi generated column gọi hàm `IMMUTABLE`, mà `unaccent()` là `STABLE` (đọc dictionary config) → `CREATE TABLE` bị từ chối. `ingestion.py` ghi thẳng `tsv` trong câu INSERT (Task 6). Nó là nơi duy nhất ghi bảng này nên `tsv` không thể lệch khỏi `content`.

- [ ] **Step 4: Verify extension và bảng lên được**

```bash
docker compose down && docker compose up -d db
docker compose --profile ai up -d ai-service
docker compose logs ai-service | grep "DB schema ready"
```
Expected: dòng `ai-service: DB schema ready (N statements applied)` với N lớn hơn trước.

```bash
docker compose exec db psql -U "$POSTGRES_USER" -d ai_db -c "\dx vector" -c "\d ai_document_chunks"
```
Expected: extension `vector` có mặt; bảng có cột `embedding` kiểu `vector(768)` và hai index `hnsw` / `gin`.

Nếu `CREATE EXTENSION` báo permission denied → user trong `DATABASE_URL` không phải superuser. Chạy tay một lần bằng `POSTGRES_USER` rồi tiếp tục.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml db-init/02-create-extensions.sql services/ai-service/schema.sql
git commit -m "feat(ai-service): them pgvector, bang ai_documents va ai_document_chunks

Doi image db sang pgvector/pgvector:pg15 (van la Postgres 15, volume giu nguyen).
Extension tao ca trong schema.sql vi db-init/ chi chay tren volume trong.

tsv khong dung GENERATED ALWAYS AS vi unaccent() la STABLE chu khong IMMUTABLE;
ingestion.py ghi tsv truc tiep trong cau INSERT.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `vector_store.py` — types, protocol, InMemoryVectorStore

**Files:**
- Create: `services/ai-service/vector_store.py`
- Test: `services/ai-service/test_vector_store.py`

**Interfaces:**
- Consumes: không
- Produces:
  - `EMBEDDING_DIM = 768`, `CORPUS_BOOK = "BOOK_METADATA"`, `CORPUS_DOC = "INTERNAL_DOC"`
  - `@dataclass(frozen=True) Chunk(document_id: str, corpus: str, chunk_index: int, content: str, content_hash: str, embedding: list[float], embedding_model: str)`
  - `@dataclass(frozen=True) Hit(chunk_id: str, document_id: str, source_id: str, corpus: str, content: str, score: float, metadata: dict)`
  - `class VectorStore(Protocol)` với 5 method async (xem Step 3)
  - `class InMemoryVectorStore(VectorStore)`
  - `get_store() -> VectorStore`

- [ ] **Step 1: Viết test thất bại**

Tạo `services/ai-service/test_vector_store.py`:

```python
from __future__ import annotations

import asyncio
import unittest

import vector_store
from vector_store import Chunk


def run(coro):
    return asyncio.run(coro)


class InMemoryVectorStoreTest(unittest.TestCase):
    def setUp(self):
        self.store = vector_store.InMemoryVectorStore()

    def _seed(self):
        doc_a = run(self.store.upsert_document(
            corpus=vector_store.CORPUS_BOOK, source_id="b1", title="Python co ban",
            content="Huong dan lap trinh Python", content_hash="h1", metadata={"author": "A"}))
        doc_b = run(self.store.upsert_document(
            corpus=vector_store.CORPUS_BOOK, source_id="b2", title="Ky nang song",
            content="Day tre tu phuc vu", content_hash="h2", metadata={"author": "B"}))
        run(self.store.upsert_chunks([
            Chunk(doc_a, vector_store.CORPUS_BOOK, 0, "Huong dan lap trinh Python", "c1", [1.0, 0.0], "m"),
            Chunk(doc_b, vector_store.CORPUS_BOOK, 0, "Day tre tu phuc vu", "c2", [0.0, 1.0], "m"),
        ]))
        return doc_a, doc_b

    def test_upsert_document_is_idempotent_per_source_id(self):
        first = run(self.store.upsert_document(
            corpus=vector_store.CORPUS_BOOK, source_id="b1", title="T",
            content="C", content_hash="h1", metadata={}))
        second = run(self.store.upsert_document(
            corpus=vector_store.CORPUS_BOOK, source_id="b1", title="T2",
            content="C2", content_hash="h2", metadata={}))
        self.assertEqual(first, second)

    def test_search_semantic_ranks_by_cosine(self):
        self._seed()
        hits = run(self.store.search_semantic(vector_store.CORPUS_BOOK, [1.0, 0.0], k=2))
        self.assertEqual([hit.source_id for hit in hits], ["b1", "b2"])
        self.assertAlmostEqual(hits[0].score, 1.0)

    def test_search_semantic_restricted_to_source_ids(self):
        self._seed()
        hits = run(self.store.search_semantic(
            vector_store.CORPUS_BOOK, [1.0, 0.0], k=5, source_ids=["b2"]))
        self.assertEqual([hit.source_id for hit in hits], ["b2"])

    def test_search_semantic_isolates_corpus(self):
        self._seed()
        hits = run(self.store.search_semantic(vector_store.CORPUS_DOC, [1.0, 0.0], k=5))
        self.assertEqual(hits, [])

    def test_search_keyword_matches_tokens(self):
        self._seed()
        hits = run(self.store.search_keyword(vector_store.CORPUS_BOOK, "python", k=5))
        self.assertEqual([hit.source_id for hit in hits], ["b1"])

    def test_existing_chunk_hashes_maps_index_to_hash(self):
        doc_a, _ = self._seed()
        self.assertEqual(run(self.store.existing_chunk_hashes(doc_a)), {0: "c1"})

    def test_upsert_chunks_replaces_same_index(self):
        doc_a, _ = self._seed()
        run(self.store.upsert_chunks([
            Chunk(doc_a, vector_store.CORPUS_BOOK, 0, "Noi dung moi", "c1-new", [0.5, 0.5], "m"),
        ]))
        self.assertEqual(run(self.store.existing_chunk_hashes(doc_a)), {0: "c1-new"})


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `cd services/ai-service && python -m unittest test_vector_store -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'vector_store'`

- [ ] **Step 3: Implement**

Tạo `services/ai-service/vector_store.py`:

```python
"""Vector store cho hai corpus cua ai-service.

Hai implementation:
- PgVectorStore (Task 4): production, pgvector trong ai_db.
- InMemoryVectorStore: test. Test cua service nay chay tren SQLite in-memory
  (db.py:18) noi khong co pgvector; neu retrieval goi thang SQL pgvector thi
  moi test deu can mot Postgres that.

Giong embeddings.py / book_index.py: khong bao gio raise, loi thi degrade.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Protocol

import embeddings
from intent import normalize_text

EMBEDDING_DIM = 768
CORPUS_BOOK = "BOOK_METADATA"
CORPUS_DOC = "INTERNAL_DOC"


@dataclass(frozen=True)
class Chunk:
    document_id: str
    corpus: str
    chunk_index: int
    content: str
    content_hash: str
    embedding: list[float]
    embedding_model: str


@dataclass(frozen=True)
class Hit:
    chunk_id: str
    document_id: str
    source_id: str
    corpus: str
    content: str
    score: float
    metadata: dict = field(default_factory=dict)


class VectorStore(Protocol):
    async def upsert_document(
        self, corpus: str, source_id: str, title: str | None,
        content: str, content_hash: str, metadata: dict,
    ) -> str:
        """Tra ve document_id. Idempotent theo (corpus, source_id)."""
        ...

    async def upsert_chunks(self, chunks: list[Chunk]) -> None: ...

    async def existing_chunk_hashes(self, document_id: str) -> dict[int, str]:
        """chunk_index -> content_hash. Dung de bo qua chunk khong doi."""
        ...

    async def search_semantic(
        self, corpus: str, query_vec: list[float], k: int,
        source_ids: list[str] | None = None,
    ) -> list[Hit]: ...

    async def search_keyword(
        self, corpus: str, query: str, k: int,
        source_ids: list[str] | None = None,
    ) -> list[Hit]: ...


class InMemoryVectorStore:
    """Cosine tuyen tinh tren dict. Dung cho test, khong dung cho production."""

    def __init__(self) -> None:
        self._docs: dict[tuple[str, str], dict] = {}
        self._chunks: dict[str, dict[int, dict]] = {}

    async def upsert_document(
        self, corpus: str, source_id: str, title: str | None,
        content: str, content_hash: str, metadata: dict,
    ) -> str:
        key = (corpus, source_id)
        existing = self._docs.get(key)
        document_id = existing["id"] if existing else str(uuid.uuid4())
        self._docs[key] = {
            "id": document_id, "corpus": corpus, "source_id": source_id,
            "title": title, "content": content, "content_hash": content_hash,
            "metadata": metadata or {},
        }
        self._chunks.setdefault(document_id, {})
        return document_id

    async def upsert_chunks(self, chunks: list[Chunk]) -> None:
        for chunk in chunks:
            slot = self._chunks.setdefault(chunk.document_id, {})
            slot[chunk.chunk_index] = {
                "id": str(uuid.uuid4()), "content": chunk.content,
                "content_hash": chunk.content_hash, "embedding": chunk.embedding,
                "embedding_model": chunk.embedding_model, "corpus": chunk.corpus,
            }

    async def existing_chunk_hashes(self, document_id: str) -> dict[int, str]:
        return {index: row["content_hash"] for index, row in self._chunks.get(document_id, {}).items()}

    def _doc_by_id(self, document_id: str) -> dict | None:
        for doc in self._docs.values():
            if doc["id"] == document_id:
                return doc
        return None

    def _candidates(self, corpus: str, source_ids: list[str] | None):
        allowed = set(source_ids) if source_ids is not None else None
        for document_id, rows in self._chunks.items():
            doc = self._doc_by_id(document_id)
            if doc is None or doc["corpus"] != corpus:
                continue
            if allowed is not None and doc["source_id"] not in allowed:
                continue
            for row in rows.values():
                yield doc, row

    @staticmethod
    def _hit(doc: dict, row: dict, score: float) -> Hit:
        return Hit(
            chunk_id=row["id"], document_id=doc["id"], source_id=doc["source_id"],
            corpus=doc["corpus"], content=row["content"], score=score,
            metadata=doc["metadata"],
        )

    async def search_semantic(
        self, corpus: str, query_vec: list[float], k: int,
        source_ids: list[str] | None = None,
    ) -> list[Hit]:
        hits = [
            self._hit(doc, row, embeddings.cosine_similarity(query_vec, row["embedding"]))
            for doc, row in self._candidates(corpus, source_ids)
        ]
        hits.sort(key=lambda hit: (-hit.score, hit.source_id))
        return hits[:k]

    async def search_keyword(
        self, corpus: str, query: str, k: int,
        source_ids: list[str] | None = None,
    ) -> list[Hit]:
        tokens = [token for token in normalize_text(query).split() if len(token) >= 2]
        if not tokens:
            return []
        hits = []
        for doc, row in self._candidates(corpus, source_ids):
            text = normalize_text(row["content"])
            overlap = sum(1 for token in tokens if token in text)
            if overlap:
                hits.append(self._hit(doc, row, overlap / len(tokens)))
        hits.sort(key=lambda hit: (-hit.score, hit.source_id))
        return hits[:k]


_store: VectorStore | None = None


def get_store() -> VectorStore:
    """PgVectorStore tren Postgres, InMemoryVectorStore o noi khac (test chay
    SQLite). Cung cach db.py chon engine theo DATABASE_URL."""
    global _store
    if _store is None:
        import db
        if db.DATABASE_URL.startswith("postgresql"):
            from pg_vector_store import PgVectorStore
            _store = PgVectorStore()
        else:
            _store = InMemoryVectorStore()
    return _store


def set_store(store: VectorStore | None) -> None:
    """Chi dung trong test, de tiem store gia."""
    global _store
    _store = store
```

- [ ] **Step 4: Chạy test, xác nhận PASS**

Run: `cd services/ai-service && python -m unittest test_vector_store -v`
Expected: PASS, 7 test.

Chú ý: `get_store()` import `pg_vector_store` lazy, nên Task 3 chạy được khi file đó chưa tồn tại — miễn là `DATABASE_URL` là sqlite (đúng trong test).

- [ ] **Step 5: Commit**

```bash
git add services/ai-service/vector_store.py services/ai-service/test_vector_store.py
git commit -m "feat(ai-service): vector_store protocol + InMemoryVectorStore

Hai implementation vi test cua service chay tren SQLite in-memory, khong co
pgvector. search_semantic co tham so source_ids de phuc vu truong hop rerank
mot danh sach ung vien cho truoc (book_index.semantic_scores), khac voi tim
top-k trong toan corpus.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `PgVectorStore`

**Files:**
- Create: `services/ai-service/pg_vector_store.py`
- Test: `services/ai-service/test_pgvector_store.py`
- Modify: `services/ai-service/requirements.txt`

**Interfaces:**
- Consumes: `vector_store.Chunk`, `vector_store.Hit`, `vector_store.VectorStore`, `db.get_session`
- Produces: `class PgVectorStore` — thoả `VectorStore`, không thêm method public nào khác

- [ ] **Step 1: Thêm dependency**

Thêm vào `services/ai-service/requirements.txt`, sau dòng `asyncpg`:

```
pgvector
```

Cài: `cd services/ai-service && pip install pgvector`

- [ ] **Step 2: Viết integration test (skip khi không có Postgres)**

Tạo `services/ai-service/test_pgvector_store.py`:

```python
"""Integration test cham vao Postgres that. Skip khi khong co —
`python -m unittest discover` van chay duoc tren may khong dung Docker.

Chay co Postgres:
    TEST_PG_DSN=postgresql+asyncpg://user:pass@localhost:5432/ai_db \
        python -m unittest test_pgvector_store -v
"""
from __future__ import annotations

import asyncio
import os
import unittest

TEST_DSN = os.getenv("TEST_PG_DSN", "")


@unittest.skipUnless(TEST_DSN, "TEST_PG_DSN khong duoc set — bo qua integration test")
class PgVectorStoreTest(unittest.TestCase):
    def setUp(self):
        os.environ["DATABASE_URL"] = TEST_DSN
        import importlib
        import db, vector_store
        importlib.reload(db)
        importlib.reload(vector_store)
        from pg_vector_store import PgVectorStore
        self.vector_store = vector_store
        self.store = PgVectorStore()
        asyncio.run(db.init_db())
        asyncio.run(self._clean())

    async def _clean(self):
        from sqlalchemy import text
        import db
        async with db.engine.begin() as conn:
            await conn.execute(text("DELETE FROM ai_documents WHERE source_id LIKE 'test-%'"))

    def _vec(self, lead: float) -> list[float]:
        vec = [0.0] * self.vector_store.EMBEDDING_DIM
        vec[0] = lead
        vec[1] = 1.0 - lead
        return vec

    def test_roundtrip_semantic_and_keyword(self):
        async def scenario():
            doc = await self.store.upsert_document(
                corpus=self.vector_store.CORPUS_BOOK, source_id="test-b1",
                title="Python co ban", content="Huong dan lap trinh Python",
                content_hash="h1", metadata={"author": "A"})
            await self.store.upsert_chunks([self.vector_store.Chunk(
                doc, self.vector_store.CORPUS_BOOK, 0,
                "Huong dan lap trinh Python", "c1", self._vec(1.0), "test-model")])
            semantic = await self.store.search_semantic(
                self.vector_store.CORPUS_BOOK, self._vec(1.0), k=5)
            keyword = await self.store.search_keyword(
                self.vector_store.CORPUS_BOOK, "python", k=5)
            hashes = await self.store.existing_chunk_hashes(doc)
            return semantic, keyword, hashes

        semantic, keyword, hashes = asyncio.run(scenario())
        self.assertIn("test-b1", [hit.source_id for hit in semantic])
        self.assertAlmostEqual(semantic[0].score, 1.0, places=4)
        self.assertIn("test-b1", [hit.source_id for hit in keyword])
        self.assertEqual(hashes, {0: "c1"})

    def test_upsert_document_idempotent(self):
        async def scenario():
            first = await self.store.upsert_document(
                corpus=self.vector_store.CORPUS_BOOK, source_id="test-b2", title="T",
                content="C", content_hash="h1", metadata={})
            second = await self.store.upsert_document(
                corpus=self.vector_store.CORPUS_BOOK, source_id="test-b2", title="T2",
                content="C2", content_hash="h2", metadata={})
            return first, second
        first, second = asyncio.run(scenario())
        self.assertEqual(first, second)

    def test_keyword_ignores_dau(self):
        """unaccent: go khong dau van phai match noi dung co dau."""
        async def scenario():
            doc = await self.store.upsert_document(
                corpus=self.vector_store.CORPUS_DOC, source_id="test-d1", title="Quy dinh",
                content="Phi phạt trả sách quá hạn", content_hash="h1", metadata={})
            await self.store.upsert_chunks([self.vector_store.Chunk(
                doc, self.vector_store.CORPUS_DOC, 0,
                "Phi phạt trả sách quá hạn", "c1", self._vec(0.5), "test-model")])
            return await self.store.search_keyword(self.vector_store.CORPUS_DOC, "phi phat", k=5)
        hits = asyncio.run(scenario())
        self.assertIn("test-d1", [hit.source_id for hit in hits])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 3: Chạy test, xác nhận FAIL**

Run: `cd services/ai-service && TEST_PG_DSN="postgresql+asyncpg://$DB_USER:$DB_PASSWORD@localhost:5432/ai_db" python -m unittest test_pgvector_store -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'pg_vector_store'`

- [ ] **Step 4: Implement**

Tạo `services/ai-service/pg_vector_store.py`:

```python
"""pgvector-backed VectorStore. Chi duoc dung khi DATABASE_URL la Postgres —
vector_store.get_store() lo viec chon.

Moi query loc theo embedding_model dang hoat dong: chunk embed bang model cu
nam trong khong gian vector khac, dung lan se cho ket qua sai im lang (AD-3).
"""
from __future__ import annotations

import json
import logging

from sqlalchemy import text

import db
import embeddings
from vector_store import Chunk, Hit

logger = logging.getLogger("uvicorn.error")


def _to_vector_literal(values: list[float]) -> str:
    """pgvector nhan dang text '[1,2,3]'. Dung literal thay vi register type
    de khong phai gan pgvector vao engine dung chung voi phan con lai cua service."""
    return "[" + ",".join(repr(float(value)) for value in values) + "]"


class PgVectorStore:
    async def upsert_document(
        self, corpus: str, source_id: str, title: str | None,
        content: str, content_hash: str, metadata: dict,
    ) -> str:
        sql = text("""
            INSERT INTO ai_documents (corpus, source_id, title, content, content_hash, metadata, updated_at)
            VALUES (:corpus, :source_id, :title, :content, :content_hash, CAST(:metadata AS JSONB), now())
            ON CONFLICT (corpus, source_id) DO UPDATE
                SET title = EXCLUDED.title,
                    content = EXCLUDED.content,
                    content_hash = EXCLUDED.content_hash,
                    metadata = EXCLUDED.metadata,
                    updated_at = now()
            RETURNING id
        """)
        async with db.get_session() as session:
            result = await session.execute(sql, {
                "corpus": corpus, "source_id": source_id, "title": title,
                "content": content, "content_hash": content_hash,
                "metadata": json.dumps(metadata or {}, ensure_ascii=False),
            })
            document_id = result.scalar_one()
            await session.commit()
        return str(document_id)

    async def upsert_chunks(self, chunks: list[Chunk]) -> None:
        if not chunks:
            return
        # tsv ghi o day chu khong phai generated column: unaccent() la STABLE,
        # Postgres khong cho dung trong GENERATED ALWAYS AS.
        sql = text("""
            INSERT INTO ai_document_chunks
                (document_id, corpus, chunk_index, content, content_hash, embedding, embedding_model, tsv)
            VALUES
                (CAST(:document_id AS UUID), :corpus, :chunk_index, :content, :content_hash,
                 CAST(:embedding AS vector), :embedding_model,
                 to_tsvector('simple', unaccent(:content)))
            ON CONFLICT (document_id, chunk_index) DO UPDATE
                SET content = EXCLUDED.content,
                    content_hash = EXCLUDED.content_hash,
                    embedding = EXCLUDED.embedding,
                    embedding_model = EXCLUDED.embedding_model,
                    tsv = EXCLUDED.tsv
        """)
        async with db.get_session() as session:
            for chunk in chunks:
                await session.execute(sql, {
                    "document_id": chunk.document_id, "corpus": chunk.corpus,
                    "chunk_index": chunk.chunk_index, "content": chunk.content,
                    "content_hash": chunk.content_hash,
                    "embedding": _to_vector_literal(chunk.embedding),
                    "embedding_model": chunk.embedding_model,
                })
            await session.commit()

    async def existing_chunk_hashes(self, document_id: str) -> dict[int, str]:
        sql = text("""
            SELECT chunk_index, content_hash FROM ai_document_chunks
            WHERE document_id = CAST(:document_id AS UUID)
        """)
        async with db.get_session() as session:
            rows = (await session.execute(sql, {"document_id": document_id})).all()
        return {int(row[0]): str(row[1]) for row in rows}

    async def _search(self, sql: text, params: dict) -> list[Hit]:
        try:
            async with db.get_session() as session:
                rows = (await session.execute(sql, params)).mappings().all()
        except Exception as exc:
            # Khong raise: caller phai giu duoc hanh vi cu (keyword-only, hoac
            # khong co tin hieu semantic). Cung quy uoc voi embeddings.py.
            logger.warning("pg_vector_store: query that bai: %s", type(exc).__name__)
            return []
        return [
            Hit(
                chunk_id=str(row["chunk_id"]), document_id=str(row["document_id"]),
                source_id=str(row["source_id"]), corpus=str(row["corpus"]),
                content=str(row["content"]), score=float(row["score"]),
                metadata=row["metadata"] or {},
            )
            for row in rows
        ]

    async def search_semantic(
        self, corpus: str, query_vec: list[float], k: int,
        source_ids: list[str] | None = None,
    ) -> list[Hit]:
        if not query_vec:
            return []
        # 1 - cosine_distance = cosine_similarity, de score cung thang do voi
        # InMemoryVectorStore va voi book_index cu.
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
            "embedding_model": embeddings.EMBED_MODEL, "k": k,
            "filter_sources": source_ids is not None,
            "source_ids": list(source_ids or []),
        })

    async def search_keyword(
        self, corpus: str, query: str, k: int,
        source_ids: list[str] | None = None,
    ) -> list[Hit]:
        if not (query or "").strip():
            return []
        sql = text("""
            SELECT c.id AS chunk_id, c.document_id, d.source_id, c.corpus, c.content,
                   ts_rank(c.tsv, plainto_tsquery('simple', unaccent(:query))) AS score,
                   d.metadata
            FROM ai_document_chunks c
            JOIN ai_documents d ON d.id = c.document_id
            WHERE c.corpus = :corpus
              AND c.tsv @@ plainto_tsquery('simple', unaccent(:query))
              AND (:filter_sources = FALSE OR d.source_id = ANY(:source_ids))
            ORDER BY score DESC
            LIMIT :k
        """)
        return await self._search(sql, {
            "corpus": corpus, "query": query, "k": k,
            "filter_sources": source_ids is not None,
            "source_ids": list(source_ids or []),
        })
```

- [ ] **Step 5: Chạy test, xác nhận PASS**

Run: `cd services/ai-service && TEST_PG_DSN="postgresql+asyncpg://$DB_USER:$DB_PASSWORD@localhost:5432/ai_db" python -m unittest test_pgvector_store -v`
Expected: PASS, 3 test.

Rồi xác nhận test suite không cần Postgres vẫn chạy:
Run: `cd services/ai-service && python -m unittest discover 2>&1 | tail -5`
Expected: `OK (skipped=3)` hoặc tương đương — 3 test pgvector bị skip, không fail.

- [ ] **Step 6: Commit**

```bash
git add services/ai-service/pg_vector_store.py services/ai-service/test_pgvector_store.py services/ai-service/requirements.txt
git commit -m "feat(ai-service): PgVectorStore - semantic va keyword search tren pgvector

Loc theo embedding_model trong moi query: chunk embed bang model cu nam trong
khong gian vector khac, dung lan se sai im lang (AD-3).

Query loi tra ve [] thay vi raise, giu duoc hanh vi degrade cua caller.

Integration test skip khi khong co TEST_PG_DSN nen `unittest discover` van chay
duoc tren may khong dung Docker.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: RRF fusion

**Files:**
- Create: `services/ai-service/fusion.py`
- Test: `services/ai-service/test_fusion.py`

**Interfaces:**
- Consumes: `vector_store.Hit`
- Produces: `fusion.reciprocal_rank_fusion(rankings: list[list[Hit]], k: int = 60, limit: int | None = None) -> list[Hit]`

- [ ] **Step 1: Viết test thất bại**

Tạo `services/ai-service/test_fusion.py`:

```python
from __future__ import annotations

import unittest

import fusion
from vector_store import Hit


def hit(source_id: str, score: float = 0.0) -> Hit:
    return Hit(chunk_id=f"c-{source_id}", document_id=f"d-{source_id}",
               source_id=source_id, corpus="BOOK_METADATA",
               content=source_id, score=score, metadata={})


class ReciprocalRankFusionTest(unittest.TestCase):
    def test_document_in_both_rankings_beats_document_in_one(self):
        semantic = [hit("a"), hit("b")]
        keyword = [hit("c"), hit("a")]
        fused = fusion.reciprocal_rank_fusion([semantic, keyword])
        self.assertEqual(fused[0].source_id, "a")

    def test_higher_rank_wins_within_same_coverage(self):
        fused = fusion.reciprocal_rank_fusion([[hit("a"), hit("b")]])
        self.assertEqual([h.source_id for h in fused], ["a", "b"])
        self.assertGreater(fused[0].score, fused[1].score)

    def test_empty_rankings_return_empty(self):
        self.assertEqual(fusion.reciprocal_rank_fusion([]), [])
        self.assertEqual(fusion.reciprocal_rank_fusion([[], []]), [])

    def test_score_is_rrf_score_not_original(self):
        fused = fusion.reciprocal_rank_fusion([[hit("a", score=0.99)]], k=60)
        self.assertAlmostEqual(fused[0].score, 1 / 61)

    def test_limit_truncates(self):
        fused = fusion.reciprocal_rank_fusion([[hit("a"), hit("b"), hit("c")]], limit=2)
        self.assertEqual(len(fused), 2)

    def test_deduplicates_by_source_id(self):
        fused = fusion.reciprocal_rank_fusion([[hit("a"), hit("a")]])
        self.assertEqual(len(fused), 1)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `cd services/ai-service && python -m unittest test_fusion -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'fusion'`

- [ ] **Step 3: Implement**

Tạo `services/ai-service/fusion.py`:

```python
"""Reciprocal Rank Fusion — gop nhieu bang xep hang thanh mot.

Chon RRF thay vi cong diem co trong so vi cosine similarity (0..1) va ts_rank
(khong chan tren) la hai thang do khac ban chat; chuan hoa chung lai se dua vao
gia dinh ve phan phoi diem ma khong ai kiem chung. RRF chi dung THU HANG, nen
khong co tham so nao phai tune mu.

Ham thuan, khong I/O.
"""
from __future__ import annotations

from vector_store import Hit

RRF_K = 60  # hang so chuan trong bai goc (Cormack 2009); lam phang chenh lech o top


def reciprocal_rank_fusion(
    rankings: list[list[Hit]], k: int = RRF_K, limit: int | None = None,
) -> list[Hit]:
    """score(doc) = sum over rankings of 1/(k + rank), rank tinh tu 1.

    Gop theo source_id, khong phai chunk_id: hai chunk cua cung mot tai lieu
    la cung mot ket qua duoi goc nhin cua nguoi dung.
    """
    scores: dict[str, float] = {}
    best: dict[str, Hit] = {}
    for ranking in rankings:
        seen: set[str] = set()
        for rank, item in enumerate(ranking, start=1):
            if item.source_id in seen:
                continue  # mot bang xep hang chi duoc gop 1 lan cho moi tai lieu
            seen.add(item.source_id)
            scores[item.source_id] = scores.get(item.source_id, 0.0) + 1.0 / (k + rank)
            if item.source_id not in best:
                best[item.source_id] = item

    ordered = sorted(scores.items(), key=lambda pair: (-pair[1], pair[0]))
    fused = [
        Hit(
            chunk_id=best[source_id].chunk_id, document_id=best[source_id].document_id,
            source_id=source_id, corpus=best[source_id].corpus,
            content=best[source_id].content, score=score,
            metadata=best[source_id].metadata,
        )
        for source_id, score in ordered
    ]
    return fused[:limit] if limit is not None else fused
```

- [ ] **Step 4: Chạy test, xác nhận PASS**

Run: `cd services/ai-service && python -m unittest test_fusion -v`
Expected: PASS, 6 test.

- [ ] **Step 5: Commit**

```bash
git add services/ai-service/fusion.py services/ai-service/test_fusion.py
git commit -m "feat(ai-service): RRF de gop semantic va keyword ranking

Dung thu hang thay vi diem so vi cosine (0..1) va ts_rank (khong chan tren)
khong cung thang do. Gop theo source_id chu khong chunk_id.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: `ingestion.py`

**Files:**
- Create: `services/ai-service/ingestion.py`
- Test: `services/ai-service/test_ingestion.py`

**Interfaces:**
- Consumes: `vector_store.get_store`, `vector_store.Chunk`, `embeddings.embed_batch`, `embeddings.content_hash`, `book_index.book_text`
- Produces:
  - `ingestion.chunk_markdown(text: str, max_chars: int = 1200) -> list[str]`
  - `ingestion.chunk_hash(text: str) -> str`
  - `ingestion.plan_chunks(existing: dict[int, str], texts: list[str]) -> list[int]` — trả về index cần re-embed
  - `async ingestion.ingest_books(books: list[dict]) -> dict` — `{"documents": int, "chunks_embedded": int, "chunks_skipped": int}`
  - `async ingestion.ingest_internal_docs(directory: str) -> dict` — cùng shape

- [ ] **Step 1: Viết test thất bại**

Tạo `services/ai-service/test_ingestion.py`:

```python
from __future__ import annotations

import unittest

import ingestion


class ChunkMarkdownTest(unittest.TestCase):
    def test_splits_on_headings(self):
        text = "# A\nnoi dung a\n\n# B\nnoi dung b"
        chunks = ingestion.chunk_markdown(text)
        self.assertEqual(len(chunks), 2)
        self.assertIn("noi dung a", chunks[0])
        self.assertIn("noi dung b", chunks[1])

    def test_keeps_heading_with_its_body(self):
        chunks = ingestion.chunk_markdown("## Phi phat\nTra tre bi phat 5000d/ngay")
        self.assertIn("Phi phat", chunks[0])
        self.assertIn("5000d", chunks[0])

    def test_splits_long_section_on_paragraphs(self):
        body = "\n\n".join(["doan van " + str(i) + " " + "x" * 200 for i in range(10)])
        chunks = ingestion.chunk_markdown("# Dai\n" + body, max_chars=500)
        self.assertGreater(len(chunks), 1)
        self.assertTrue(all(len(chunk) <= 700 for chunk in chunks))

    def test_no_heading_still_returns_content(self):
        chunks = ingestion.chunk_markdown("chi la mot doan van thuong")
        self.assertEqual(len(chunks), 1)

    def test_empty_returns_empty(self):
        self.assertEqual(ingestion.chunk_markdown(""), [])
        self.assertEqual(ingestion.chunk_markdown("   \n  "), [])


class PlanChunksTest(unittest.TestCase):
    def test_all_new_when_nothing_exists(self):
        texts = ["a", "b"]
        self.assertEqual(ingestion.plan_chunks({}, texts), [0, 1])

    def test_skips_unchanged(self):
        texts = ["a", "b"]
        existing = {0: ingestion.chunk_hash("a"), 1: ingestion.chunk_hash("b")}
        self.assertEqual(ingestion.plan_chunks(existing, texts), [])

    def test_only_changed_index_is_replanned(self):
        texts = ["a", "b-moi"]
        existing = {0: ingestion.chunk_hash("a"), 1: ingestion.chunk_hash("b")}
        self.assertEqual(ingestion.plan_chunks(existing, texts), [1])

    def test_new_index_beyond_existing_is_planned(self):
        texts = ["a", "b"]
        existing = {0: ingestion.chunk_hash("a")}
        self.assertEqual(ingestion.plan_chunks(existing, texts), [1])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `cd services/ai-service && python -m unittest test_ingestion -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'ingestion'`

- [ ] **Step 3: Implement**

Tạo `services/ai-service/ingestion.py`:

```python
"""Dong bo hai corpus vao vector store.

Incremental theo content_hash TUNG CHUNK: doi mot quyen sach chi re-embed chunk
cua quyen do. Day la diem sua truc tiep cho han che cua book_index.py cu — o do
content hash phu toan bo catalog nen doi mot quyen la rebuild het.

Khong raise: loi embedding thi bo qua tai lieu do va ghi log, phan da ingest
truoc do van dung duoc.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re

import book_index
import embeddings
import vector_store
from vector_store import Chunk

logger = logging.getLogger("uvicorn.error")

MAX_CHUNK_CHARS = int(os.getenv("INGEST_MAX_CHUNK_CHARS", "1200"))
CORPUS_DIR = os.path.join(os.path.dirname(__file__), "corpus")

_HEADING_RE = re.compile(r"^#{1,6} ", re.MULTILINE)


def chunk_hash(text: str) -> str:
    return embeddings.content_hash({"model": embeddings.EMBED_MODEL, "text": text})


def chunk_markdown(text: str, max_chars: int = MAX_CHUNK_CHARS) -> list[str]:
    """Cat theo heading Markdown; section qua dai thi cat tiep theo doan.

    Cat theo heading chu khong theo so ky tu co dinh vi mot muc chinh sach
    (vd "Phi phat") la mot don vi y nghia — cat giua no thi ca hai nua deu
    tra loi sai cau hoi ve chinh sach do.
    """
    text = (text or "").strip()
    if not text:
        return []

    positions = [match.start() for match in _HEADING_RE.finditer(text)]
    if not positions or positions[0] != 0:
        positions = [0] + positions
    sections = [
        text[start:end].strip()
        for start, end in zip(positions, positions[1:] + [len(text)])
    ]

    chunks: list[str] = []
    for section in sections:
        if not section:
            continue
        if len(section) <= max_chars:
            chunks.append(section)
            continue
        heading = section.splitlines()[0] if section.startswith("#") else ""
        current = heading
        for paragraph in section.split("\n\n"):
            paragraph = paragraph.strip()
            if not paragraph or paragraph == heading:
                continue
            if current and len(current) + len(paragraph) + 2 > max_chars:
                chunks.append(current.strip())
                current = f"{heading}\n{paragraph}" if heading else paragraph
            else:
                current = f"{current}\n\n{paragraph}" if current else paragraph
        if current.strip():
            chunks.append(current.strip())
    return [chunk for chunk in chunks if chunk]


def plan_chunks(existing: dict[int, str], texts: list[str]) -> list[int]:
    """Index nao can embed lai. Chunk co hash trung voi ban da luu thi bo qua."""
    return [
        index for index, content in enumerate(texts)
        if existing.get(index) != chunk_hash(content)
    ]


async def _ingest_one(
    store, corpus: str, source_id: str, title: str | None,
    content: str, texts: list[str], metadata: dict,
) -> tuple[int, int]:
    """Tra ve (so chunk da embed, so chunk bo qua)."""
    document_id = await store.upsert_document(
        corpus=corpus, source_id=source_id, title=title,
        content=content, content_hash=chunk_hash(content), metadata=metadata)

    existing = await store.existing_chunk_hashes(document_id)
    todo = plan_chunks(existing, texts)
    if not todo:
        return 0, len(texts)

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
    return len(todo), len(texts) - len(todo)


async def ingest_books(books: list[dict]) -> dict:
    """Mot quyen sach = mot document = mot chunk. Text da ngan (title + author +
    category + description + summary_vi), cat nho ra chi lam loang tin hieu."""
    store = vector_store.get_store()
    documents = embedded = skipped = 0
    for book in books:
        if not isinstance(book, dict) or not book.get("id"):
            continue
        text = book_index.book_text(book)
        if not text.strip():
            continue
        done, skip = await _ingest_one(
            store, vector_store.CORPUS_BOOK, str(book["id"]),
            str(book.get("title") or ""), text, [text],
            {"author": book.get("author"), "category": book.get("category"),
             "isbn": book.get("isbn"), "quantity": book.get("quantity")},
        )
        documents += 1
        embedded += done
        skipped += skip
    logger.info("ingestion: books %d doc, %d chunk embed, %d bo qua", documents, embedded, skipped)
    return {"documents": documents, "chunks_embedded": embedded, "chunks_skipped": skipped}


async def ingest_internal_docs(directory: str = CORPUS_DIR) -> dict:
    """Moi file .md trong corpus/ la mot document; source_id la ten file khong
    duoi. Noi dung review qua git nhu code — cung triet ly faq_data.py cu,
    nhung khong hardcode trong .py."""
    store = vector_store.get_store()
    documents = embedded = skipped = 0
    if not os.path.isdir(directory):
        logger.warning("ingestion: khong tim thay thu muc corpus %s", directory)
        return {"documents": 0, "chunks_embedded": 0, "chunks_skipped": 0}

    for filename in sorted(os.listdir(directory)):
        if not filename.endswith(".md"):
            continue
        path = os.path.join(directory, filename)
        with open(path, "r", encoding="utf-8") as handle:
            content = handle.read()
        texts = chunk_markdown(content)
        if not texts:
            continue
        source_id = filename[:-3]
        title = texts[0].splitlines()[0].lstrip("# ").strip()
        done, skip = await _ingest_one(
            store, vector_store.CORPUS_DOC, source_id, title, content, texts,
            {"filename": filename},
        )
        documents += 1
        embedded += done
        skipped += skip
    logger.info("ingestion: docs %d doc, %d chunk embed, %d bo qua", documents, embedded, skipped)
    return {"documents": documents, "chunks_embedded": embedded, "chunks_skipped": skipped}
```

- [ ] **Step 4: Chạy test, xác nhận PASS**

Run: `cd services/ai-service && python -m unittest test_ingestion -v`
Expected: PASS, 9 test.

- [ ] **Step 5: Commit**

```bash
git add services/ai-service/ingestion.py services/ai-service/test_ingestion.py
git commit -m "feat(ai-service): ingestion pipeline incremental theo content-hash tung chunk

Doi mot quyen sach chi re-embed chunk cua quyen do. book_index.py cu hash toan
bo catalog nen doi mot quyen la rebuild het.

chunk_markdown cat theo heading chu khong theo so ky tu: mot muc chinh sach la
mot don vi y nghia, cat giua no thi ca hai nua deu tra loi sai.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Đổi `semantic_scores` sang async — hành vi giữ nguyên

Refactor thuần, **chưa đổi backend**. Tách riêng để nếu có gì hỏng thì biết ngay là do đổi shape async hay do đổi sang pgvector.

**Files:**
- Modify: `services/ai-service/book_index.py` (`semantic_scores`)
- Modify: `services/ai-service/assistant_tools.py:159` (`_score_and_rank_books`), `:224-227` (`search_books`)
- Modify: `services/ai-service/routes_cover_search.py:251`
- Modify: `services/ai-service/main.py:4634`
- Test: `services/ai-service/test_book_index.py` (sửa 6 call site trong test)

**Interfaces:**
- Consumes: không có gì mới
- Produces:
  - `async book_index.semantic_scores(books: list[dict], query: str, client=None) -> list[float]` (cũ: sync)
  - `async assistant_tools._score_and_rank_books(books: list, query: str, limit: int, client=None) -> list[dict]` (cũ: sync)
  - `search_books` và shape trả về **không đổi** (AD-5)

- [ ] **Step 1: Đổi `semantic_scores` sang async**

Trong `services/ai-service/book_index.py`, đổi:

```python
async def semantic_scores(
    books: list[dict],
    query: str,
    client: ollama.Client | None = None,
) -> list[float]:
    """Cosine similarity of `query` against each book, aligned with `books`.
    Returns [] (not zeros) when embeddings are unavailable, so callers can tell
    "no semantic signal" apart from "semantically unrelated".

    Async vi Task 8 doi ruot sang vector_store (query DB). Phan than ham o buoc
    nay van la code cu chay trong thread — doi shape truoc, doi backend sau.
    """
    query = (query or "").strip()
    if not query or not books:
        return []

    query_vector = await asyncio.to_thread(embeddings.embed_text, query, client)
    if not query_vector:
        return []

    vectors = await asyncio.to_thread(build_index, books, client)
    if not vectors or len(vectors) != len(books):
        return []

    return [embeddings.cosine_similarity(query_vector, vector) for vector in vectors]
```

Thêm `import asyncio` lên đầu file.

- [ ] **Step 2: Đổi `_score_and_rank_books` sang async**

Trong `services/ai-service/assistant_tools.py`, đổi dòng 159 `def _score_and_rank_books(...)` thành `async def`, và dòng 182 thành:

```python
    semantic = await book_index.semantic_scores(valid_books, query, client=client)
```

Sửa docstring: bỏ dòng `Blocking: calls Ollama. Callers on the event loop must use asyncio.to_thread.`, thay bằng:

```
    Async: book_index.semantic_scores cham DB/Ollama va tu lo viec khong chan
    event loop. Caller await truc tiep, khong boc asyncio.to_thread nua.
```

- [ ] **Step 3: Sửa 3 call site**

`services/ai-service/assistant_tools.py:224-227` — bỏ `asyncio.to_thread`:

```python
    results = await _score_and_rank_books(books, query, SEARCH_BOOKS_RESULT_LIMIT)
    return {"query": query, "results": results}
```

`services/ai-service/routes_cover_search.py:251`:

```python
        scored = await assistant_tools._score_and_rank_books(
            books, ocr_query, COVER_SEARCH_RESULT_LIMIT
        )
```

(thay `await asyncio.to_thread(assistant_tools._score_and_rank_books, books, ocr_query, COVER_SEARCH_RESULT_LIMIT)` — giữ nguyên tên biến nhận kết quả như code hiện tại.)

`services/ai-service/main.py:4634`:

```python
            semantic = await book_index.semantic_scores(candidates, profile_text)
```

(thay `await asyncio.to_thread(book_index.semantic_scores, candidates, profile_text)` — giữ nguyên tên biến nhận kết quả như code hiện tại.)

- [ ] **Step 4: Sửa test hiện có**

`test_book_index.py` gọi hai hàm giờ là async ở 6 chỗ (dòng 92, 117, 136, 145, 150, 163). Bọc bằng `asyncio.run`. Thêm lên đầu file:

```python
import asyncio


def run(coro):
    return asyncio.run(coro)
```

Rồi mỗi call site, ví dụ dòng 92:

```python
        scores = run(book_index.semantic_scores(BOOKS, self.query, client=client))
```

và dòng 136:

```python
        results = run(assistant_tools._score_and_rank_books(BOOKS, query, 5, client=client))
```

**Đây là ngoại lệ được phép với AD-5:** `semantic_scores` và `_score_and_rank_books` là hàm nội bộ (tiền tố `_`, hoặc không nằm trong `TOOL_FUNCTIONS`). `search_books` và `find_relevant` vẫn không đổi. Nếu bạn thấy mình phải sửa test của `search_books` hay `find_relevant` → dừng lại, đã làm sai.

- [ ] **Step 5: Chạy toàn bộ test**

Run: `cd services/ai-service && python -m unittest discover -v 2>&1 | tail -20`
Expected: PASS toàn bộ. Không có `RuntimeWarning: coroutine ... was never awaited` — nếu thấy warning đó là còn sót một call site chưa await.

Kiểm tra lại không còn chỗ nào gọi hai hàm này kiểu cũ:

Run: `cd services/ai-service && grep -rn "to_thread(.*semantic_scores\|to_thread(.*_score_and_rank_books" --include="*.py" . | grep -v ".venv"`
Expected: không có dòng nào.

- [ ] **Step 6: Commit**

```bash
git add services/ai-service/book_index.py services/ai-service/assistant_tools.py services/ai-service/routes_cover_search.py services/ai-service/main.py services/ai-service/test_book_index.py
git commit -m "refactor(ai-service): semantic_scores va _score_and_rank_books thanh async

Hanh vi khong doi — chi doi shape, chuan bi cho Task 8 doi ruot sang vector_store
(query DB, khong con la blocking Ollama call chay trong thread).

Tach rieng khoi viec doi backend de neu co gi hong thi biet ngay la do doi shape
hay do doi sang pgvector.

search_books va find_relevant giu nguyen chu ky (AD-5).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Đổi ruột book search sang vector store

**Files:**
- Modify: `services/ai-service/book_index.py` (bỏ cache JSON, dùng `vector_store`)
- Modify: `services/ai-service/assistant_tools.py` (`search_books` dùng hybrid + RRF)
- Modify: `services/ai-service/main.py` (gọi ingest lúc startup)
- Test: `services/ai-service/test_book_index.py` (thêm test hybrid)

**Interfaces:**
- Consumes: `vector_store.get_store`, `fusion.reciprocal_rank_fusion`, `ingestion.ingest_books`
- Produces:
  - `async book_index.semantic_scores(books, query, client=None) -> list[float]` — chữ ký không đổi so với Task 7, ruột đổi
  - `book_index.build_index` bị **xoá** (không còn caller)

- [ ] **Step 1: Viết test cho hybrid search**

Thêm vào `services/ai-service/test_book_index.py`:

```python
class HybridSearchTest(unittest.TestCase):
    """search_books gio hop nhat semantic va keyword qua vector_store + RRF."""

    def setUp(self):
        import vector_store
        from vector_store import Chunk
        self.vector_store = vector_store
        self.store = vector_store.InMemoryVectorStore()
        vector_store.set_store(self.store)
        for book, vec in zip(BOOKS, ([1.0, 0.0], [0.0, 1.0], [0.7, 0.7])):
            doc = run(self.store.upsert_document(
                corpus=vector_store.CORPUS_BOOK, source_id=book["id"],
                title=book["title"], content=book_index.book_text(book),
                content_hash="h-" + book["id"], metadata={}))
            run(self.store.upsert_chunks([Chunk(
                doc, vector_store.CORPUS_BOOK, 0, book_index.book_text(book),
                "c-" + book["id"], vec, "test-model")]))

    def tearDown(self):
        self.vector_store.set_store(None)

    def test_semantic_scores_aligned_with_input_order(self):
        with mock.patch.object(embeddings, "embed_text", return_value=[1.0, 0.0]):
            scores = run(book_index.semantic_scores(BOOKS, "lap trinh"))
        self.assertEqual(len(scores), len(BOOKS))
        self.assertAlmostEqual(scores[0], 1.0)
        self.assertAlmostEqual(scores[1], 0.0)

    def test_semantic_scores_empty_when_embedding_unavailable(self):
        with mock.patch.object(embeddings, "embed_text", return_value=None):
            self.assertEqual(run(book_index.semantic_scores(BOOKS, "bat ky")), [])

    def test_book_not_in_index_scores_zero_not_crash(self):
        extra = BOOKS + [{"id": "b-unknown", "title": "Chua ingest", "author": "",
                          "category": "", "isbn": "", "quantity": 0,
                          "description": "", "summary_vi": ""}]
        with mock.patch.object(embeddings, "embed_text", return_value=[1.0, 0.0]):
            scores = run(book_index.semantic_scores(extra, "lap trinh"))
        self.assertEqual(len(scores), len(extra))
        self.assertEqual(scores[-1], 0.0)
```

Thêm `from unittest import mock` và `import embeddings` lên đầu file nếu chưa có.

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `cd services/ai-service && python -m unittest test_book_index.HybridSearchTest -v`
Expected: FAIL — `semantic_scores` còn đang đọc cache JSON, chưa biết `vector_store`; `test_book_not_in_index_scores_zero_not_crash` fail vì `build_index` embed cả quyển chưa ingest.

- [ ] **Step 3: Viết lại `book_index.py`**

Thay toàn bộ nội dung `services/ai-service/book_index.py`:

```python
"""Diem semantic cho catalog sach, doc tu vector store.

Truoc day module nay tu dung index rieng trong mot file JSON tren dia
(.book_index_cache.json) va rebuild toan bo khi content hash cua CA catalog doi.
Gio vector nam trong ai_document_chunks; ingestion.py lo viec dong bo incremental.

Giu nguyen hop dong cu: semantic_scores tra ve list cung do dai voi `books`, va
[] (khong phai list toan 0) khi khong co tin hieu semantic — caller phan biet
duoc "khong co embedding" voi "khong lien quan".
"""
from __future__ import annotations

import asyncio
import logging
import os

import ollama

import embeddings
import vector_store

logger = logging.getLogger("uvicorn.error")

# Nguong cosine toi thieu de mot quyen duoc tinh la trung ve ngu nghia.
BOOK_SEMANTIC_THRESHOLD = float(os.getenv("BOOK_SEMANTIC_THRESHOLD", "0.6"))


def book_text(book: dict) -> str:
    """Text duoc embed cho mot quyen. Co description va summary_vi de cau hoi
    ve NOI DUNG sach match duoc — dieu keyword tren title/author khong lam duoc."""
    parts = [
        str(book.get("title") or ""),
        str(book.get("author") or ""),
        str(book.get("category") or ""),
        str(book.get("description") or ""),
        str(book.get("summary_vi") or ""),
    ]
    return " ".join(part.strip() for part in parts if part and part.strip())


async def semantic_scores(
    books: list[dict],
    query: str,
    client: ollama.Client | None = None,
) -> list[float]:
    """Cosine similarity cua `query` voi tung quyen, xep thang hang voi `books`.

    Loc theo source_ids thay vi tim top-k toan corpus: caller da co san danh sach
    ung vien (vd recommendation.py da loc theo lich su muon) va can diem cho DUNG
    nhung quyen do, dung thu tu do.

    Quyen chua duoc ingest vao vector store nhan diem 0.0 — khong phai loi, chi
    la chua co tin hieu semantic cho no.
    """
    query = (query or "").strip()
    if not query or not books:
        return []

    query_vector = await asyncio.to_thread(embeddings.embed_text, query, client)
    if not query_vector:
        return []

    source_ids = [str(book.get("id") or "") for book in books]
    hits = await vector_store.get_store().search_semantic(
        vector_store.CORPUS_BOOK, query_vector,
        k=len(source_ids), source_ids=[sid for sid in source_ids if sid],
    )
    if not hits:
        return []

    by_source = {hit.source_id: hit.score for hit in hits}
    return [by_source.get(source_id, 0.0) for source_id in source_ids]
```

`build_index`, `_content_hash`, `_CACHE_PATH`, `_index` bị xoá — không còn caller nào sau Task 7.

- [ ] **Step 4: Đổi `search_books` sang hybrid qua vector store**

Trong `services/ai-service/assistant_tools.py`, thay thân `search_books` (giữ nguyên chữ ký và shape trả về):

```python
async def search_books(auth_header: str | None = None, query: str = "") -> dict:
    """Tìm sách theo từ khóa tự do, kể cả nội dung mô tả — không dùng
    /api/books?search= vì backend chỉ lọc title/author/category/publisher/isbn.

    Hybrid qua vector store: semantic (pgvector cosine) và keyword (Postgres
    full-text, bỏ dấu bằng unaccent) chạy song song rồi hợp nhất bằng RRF.
    Catalog vẫn lấy từ /api/books để có dữ liệu hiển thị (tồn kho, ISBN) và để
    giữ đúng ràng buộc AI không truy cập DB nghiệp vụ trực tiếp.
    """
    query = (query or "").strip()
    if not query:
        return {"error": "query khong duoc de trong"}
    headers = {"Authorization": auth_header} if auth_header else {}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(ASSISTANT_TOOL_TIMEOUT_SECONDS)) as client:
            response = await client.get(f"{GATEWAY_URL}/api/books", headers=headers)
        if response.status_code >= 400:
            return {"error": f"/api/books tra ve HTTP {response.status_code}"}
        books = _data(response.json())
        books = books if isinstance(books, list) else []
    except httpx.TimeoutException:
        return {"error": "/api/books het thoi gian cho phan hoi"}
    except Exception as exc:
        return {"error": f"/api/books that bai: {type(exc).__name__}"}

    results = await _score_and_rank_books(books, query, SEARCH_BOOKS_RESULT_LIMIT)
    return {"query": query, "results": results}
```

Và thay thân `_score_and_rank_books`:

```python
async def _score_and_rank_books(books: list, query: str, limit: int, client=None) -> list[dict]:
    """Hybrid ranking qua vector store, hop nhat bang RRF.

    Truoc day ham nay tu cham diem keyword trong Python roi trung binh cong voi
    cosine. Gio ca hai tin hieu deu do Postgres tra ve da xep hang, va RRF gop
    theo THU HANG — khong con phai chuan hoa hai thang diem khac ban chat.

    Van degrade dung nhu cu: vector store hong thi search_semantic/search_keyword
    tra ve [], RRF cua hai list rong la list rong, ham tra ve [].
    """
    query = (query or "").strip()
    if not query:
        return []
    valid_books = [book for book in books if isinstance(book, dict) and book.get("id")]
    if not valid_books:
        return []

    by_id = {str(book["id"]): book for book in valid_books}
    source_ids = list(by_id.keys())
    store = vector_store.get_store()

    query_vector = await asyncio.to_thread(embeddings.embed_text, query, client)
    semantic = (
        await store.search_semantic(
            vector_store.CORPUS_BOOK, query_vector, k=limit * 3, source_ids=source_ids)
        if query_vector else []
    )
    keyword = await store.search_keyword(
        vector_store.CORPUS_BOOK, query, k=limit * 3, source_ids=source_ids)

    fused = fusion.reciprocal_rank_fusion([semantic, keyword], limit=limit)
    return [
        {**_compact_book_with_content(by_id[hit.source_id]), "score": round(hit.score, 3)}
        for hit in fused
        if hit.source_id in by_id
    ]
```

Thêm lên đầu `assistant_tools.py`:

```python
import embeddings
import fusion
import vector_store
```

`re` và `normalize_text` có thể thành orphan import nếu không còn chỗ dùng — kiểm tra bằng `grep -n "re\.\|normalize_text" services/ai-service/assistant_tools.py` và chỉ xoá nếu thật sự không còn dùng. `_keyword_score` nếu không còn caller thì xoá (orphan do thay đổi này tạo ra).

- [ ] **Step 5: Gọi ingest lúc startup**

Trong `services/ai-service/main.py`, cạnh `_startup_nightly_briefing` (dòng ~259), thêm:

```python
@app.on_event("startup")
async def _startup_ingest_corpus() -> None:
    """Dong bo vector store nen o background. Khong chan startup: service phai
    len duoc ngay ca khi Ollama chua san sang — retrieval se degrade xuong
    keyword-only cho den khi ingest xong.

    Tat bang ENABLE_CORPUS_INGEST=false (vd trong test e2e khong can semantic).
    """
    if os.getenv("ENABLE_CORPUS_INGEST", "true").strip().lower() in ("false", "0", "no"):
        return

    async def _run() -> None:
        import ingestion
        try:
            await ingestion.ingest_internal_docs()
            books = await assistant_tools._get("/api/books", None)
            if isinstance(books, list):
                await ingestion.ingest_books(books)
        except Exception as exc:
            logger.warning("startup ingest that bai: %s", type(exc).__name__)

    asyncio.create_task(_run())
```

- [ ] **Step 6: Chạy toàn bộ test**

Run: `cd services/ai-service && python -m unittest discover -v 2>&1 | tail -20`
Expected: PASS toàn bộ.

**Nếu phải sửa test của `search_books` hoặc `find_relevant` để pass → dừng lại, đã vi phạm AD-5.** Test của `_score_and_rank_books` trong `test_book_index.py` (dòng 136-163 cũ) thì được sửa — đó là hàm nội bộ, và ruột nó vừa đổi từ "tự chấm điểm trong Python" sang "đọc từ store", nên test cũ phải seed store (như `HybridSearchTest.setUp` đã làm).

- [ ] **Step 7: Verify end-to-end**

```bash
docker compose --profile ai up -d --build ai-service
docker compose logs -f ai-service | grep -E "ingestion:|DB schema ready"
```
Expected: `ingestion: docs N doc, M chunk embed`, rồi `ingestion: books N doc, M chunk embed`.

```bash
docker compose exec db psql -U "$POSTGRES_USER" -d ai_db \
  -c "SELECT corpus, count(*) FROM ai_document_chunks GROUP BY corpus;"
```
Expected: hai dòng, `BOOK_METADATA` và `INTERNAL_DOC`, số chunk > 0.

Restart lần hai để chứng minh incremental có tác dụng:
```bash
docker compose restart ai-service && docker compose logs ai-service | grep "ingestion: books"
```
Expected: `chunks_embedded` gần 0, `chunks_skipped` bằng tổng số sách — không re-embed gì.

- [ ] **Step 8: Commit**

```bash
git add services/ai-service/book_index.py services/ai-service/assistant_tools.py services/ai-service/main.py services/ai-service/test_book_index.py
git commit -m "feat(ai-service): book search doc tu pgvector, hybrid hop nhat bang RRF

book_index bo index JSON rieng (.book_index_cache.json); vector nam trong
ai_document_chunks, ingestion.py dong bo incremental.

_score_and_rank_books khong con tu cham diem keyword trong Python roi trung binh
cong voi cosine — ca hai tin hieu do Postgres tra ve da xep hang va RRF gop theo
thu hang, khong phai chuan hoa hai thang diem khac ban chat.

search_books giu nguyen chu ky va shape tra ve (AD-5).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Chuyển FAQ sang corpus `INTERNAL_DOC`

**Files:**
- Create: `services/ai-service/corpus/quy-dinh-muon-tra.md`, `phi-phat.md`, `quy-trinh-kho.md`, `chinh-sach-chung.md`
- Modify: `services/ai-service/faq_retrieval.py`
- Delete: `services/ai-service/faq_data.py`
- Test: `services/ai-service/test_faq_retrieval.py`

**Interfaces:**
- Consumes: `vector_store.get_store`, `fusion.reciprocal_rank_fusion`
- Produces: `faq_retrieval.find_relevant(query, top_k=3, threshold=0.75, client=None) -> list[FAQMatch]` — **chữ ký và shape không đổi** (AD-5). `FAQMatch.entry` vẫn là dict có khoá `id`, `question`, `answer`.

- [ ] **Step 1: Chuyển nội dung FAQ sang Markdown**

Đọc `services/ai-service/faq_data.py` — 11 entry, mỗi entry có `id`, `category`, `question`, `answer`. Nhóm theo `category` thành 4 file trong `services/ai-service/corpus/`. Mỗi entry thành một section `##`:

```markdown
# Quy định mượn trả

## Mỗi người được mượn tối đa bao nhiêu sách?

<nguyên văn answer của entry tương ứng trong faq_data.py>

## Thời hạn mượn là bao lâu?

<nguyên văn answer>
```

Tên file = `source_id` (Task 6 cắt đuôi `.md`), phải khớp `expected_ids` đã viết trong `rag_dataset.json` ở Task 1. Nếu lệch, sửa dataset cho khớp file — **trước khi** chạy eval so sánh, không phải sau.

Giữ nguyên văn `answer`, không viết lại. Đây là chuyển nơi lưu, không phải viết lại nội dung — viết lại đồng thời làm baseline ở Task 1 mất ý nghĩa so sánh.

- [ ] **Step 2: Sửa test hiện có**

`test_faq_retrieval.py` đang import `FAQ_ENTRIES` từ `faq_data`. Thay bằng seed vào `InMemoryVectorStore`:

```python
from __future__ import annotations

import asyncio
import unittest
from unittest import mock

import embeddings
import faq_retrieval
import vector_store
from vector_store import Chunk


def run(coro):
    return asyncio.run(coro)


ENTRIES = [
    ("quy-dinh-muon-tra", "## Muon toi da bao nhieu quyen?\nMoi the muon toi da 5 quyen.", [1.0, 0.0]),
    ("phi-phat", "## Tra tre bi phat bao nhieu?\nPhi phat 5000d moi ngay qua han.", [0.0, 1.0]),
]


class FindRelevantTest(unittest.TestCase):
    def setUp(self):
        self.store = vector_store.InMemoryVectorStore()
        vector_store.set_store(self.store)
        for source_id, content, vec in ENTRIES:
            doc = run(self.store.upsert_document(
                corpus=vector_store.CORPUS_DOC, source_id=source_id,
                title=source_id, content=content, content_hash="h-" + source_id, metadata={}))
            run(self.store.upsert_chunks([Chunk(
                doc, vector_store.CORPUS_DOC, 0, content, "c-" + source_id, vec, "test-model")]))

    def tearDown(self):
        vector_store.set_store(None)

    def test_returns_match_above_threshold(self):
        with mock.patch.object(embeddings, "embed_text", return_value=[1.0, 0.0]):
            matches = faq_retrieval.find_relevant("muon toi da bao nhieu", threshold=0.5)
        self.assertTrue(matches)
        self.assertEqual(matches[0].entry["id"], "quy-dinh-muon-tra")

    def test_entry_shape_unchanged(self):
        """AD-5: retrieval.py doc entry['question'] va entry['answer']."""
        with mock.patch.object(embeddings, "embed_text", return_value=[1.0, 0.0]):
            matches = faq_retrieval.find_relevant("muon toi da bao nhieu", threshold=0.5)
        self.assertIn("id", matches[0].entry)
        self.assertIn("question", matches[0].entry)
        self.assertIn("answer", matches[0].entry)

    def test_below_threshold_returns_empty(self):
        with mock.patch.object(embeddings, "embed_text", return_value=[1.0, 0.0]):
            self.assertEqual(faq_retrieval.find_relevant("bat ky", threshold=0.99), [])

    def test_embedding_unavailable_returns_empty(self):
        with mock.patch.object(embeddings, "embed_text", return_value=None):
            self.assertEqual(faq_retrieval.find_relevant("bat ky"), [])

    def test_empty_query_returns_empty(self):
        self.assertEqual(faq_retrieval.find_relevant("   "), [])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 3: Chạy test, xác nhận FAIL**

Run: `cd services/ai-service && python -m unittest test_faq_retrieval -v`
Expected: FAIL — `faq_retrieval` còn import `faq_data` và đọc cache JSON.

- [ ] **Step 4: Viết lại `faq_retrieval.py`**

```python
"""Semantic search tren corpus tai lieu noi bo (INTERNAL_DOC).

Backs the /chat GENERAL_QUERY branch: khi mot cau hoi khong khop intent nao
trong 11 intent co dinh, retrieval.py hoi module nay thay vi tra context rong.

Truoc day noi dung nam hardcode trong faq_data.FAQ_ENTRIES va vector nam trong
mot file JSON tren dia. Gio noi dung la file Markdown trong corpus/ (van review
qua git nhu code) va vector nam trong ai_document_chunks.

Chu ky find_relevant KHONG doi: retrieval.py va test_retrieval.py phu thuoc vao
no (AD-5). Never raises — khong co ket qua thi caller giu hanh vi fallback cu.
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import NamedTuple

import ollama

import embeddings
import vector_store

logger = logging.getLogger("uvicorn.error")

FAQ_EMBED_MODEL = embeddings.EMBED_MODEL
FAQ_MATCH_THRESHOLD = float(os.getenv("FAQ_MATCH_THRESHOLD", "0.75"))
FAQ_TOP_K = int(os.getenv("FAQ_TOP_K", "3"))


class FAQMatch(NamedTuple):
    entry: dict
    score: float


def embed_text(text: str, client: ollama.Client | None = None) -> list[float] | None:
    return embeddings.embed_text(text, client=client)


def _entry_from_hit(hit) -> dict:
    """Shape cu: {id, question, answer}. Chunk Markdown co dang
    "## <heading>\n<body>" — heading la question, phan con lai la answer."""
    lines = hit.content.splitlines()
    if lines and lines[0].lstrip().startswith("#"):
        question = lines[0].lstrip("# ").strip()
        answer = "\n".join(lines[1:]).strip()
    else:
        question = ""
        answer = hit.content.strip()
    return {"id": hit.source_id, "question": question, "answer": answer}


async def _find_relevant_async(query: str, top_k: int, threshold: float, client) -> list[FAQMatch]:
    query_vector = await asyncio.to_thread(embed_text, query, client)
    if not query_vector:
        return []
    hits = await vector_store.get_store().search_semantic(
        vector_store.CORPUS_DOC, query_vector, k=top_k)
    return [
        FAQMatch(entry=_entry_from_hit(hit), score=hit.score)
        for hit in hits if hit.score >= threshold
    ]


def find_relevant(
    query: str,
    top_k: int = FAQ_TOP_K,
    threshold: float = FAQ_MATCH_THRESHOLD,
    client: ollama.Client | None = None,
) -> list[FAQMatch]:
    """Chu ky sync giu nguyen (AD-5): retrieval.py:254 goi ham nay qua
    asyncio.to_thread, nen no chay trong mot thread KHONG co event loop —
    asyncio.run() o day la hop le, khong phai nested loop."""
    query = (query or "").strip()
    if not query:
        return []
    try:
        return asyncio.run(_find_relevant_async(query, top_k, threshold, client))
    except Exception as exc:
        logger.warning("faq_retrieval: tim kiem that bai: %s", type(exc).__name__)
        return []
```

Xoá `services/ai-service/faq_data.py`.

- [ ] **Step 5: Kiểm tra không còn ai import `faq_data`**

Run: `cd services/ai-service && grep -rn "faq_data" --include="*.py" . | grep -v ".venv"`
Expected: không có dòng nào. Nếu còn, sửa chỗ đó trước khi đi tiếp.

- [ ] **Step 6: Chạy toàn bộ test**

Run: `cd services/ai-service && python -m unittest discover -v 2>&1 | tail -20`
Expected: PASS toàn bộ, kể cả `test_retrieval.py` (nó mock `find_relevant` nên không được ảnh hưởng — nếu nó fail thì shape trả về đã đổi, vi phạm AD-5).

- [ ] **Step 7: Commit**

```bash
git add services/ai-service/corpus/ services/ai-service/faq_retrieval.py services/ai-service/test_faq_retrieval.py
git rm services/ai-service/faq_data.py
git commit -m "feat(ai-service): tai lieu noi bo thanh corpus INTERNAL_DOC trong vector store

11 entry hardcode trong faq_data.py thanh 4 file Markdown trong corpus/ — van
review qua git nhu code, nhung khong con nam trong .py va vector khong con trong
file JSON tren dia.

Noi dung answer giu nguyen van, khong viet lai: viet lai se lam baseline o Task 1
mat y nghia so sanh.

find_relevant giu nguyen chu ky sync va shape FAQMatch (AD-5) — retrieval.py goi
no qua asyncio.to_thread nen asyncio.run ben trong la hop le.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Dọn dẹp và so sánh với baseline

**Files:**
- Modify: `services/ai-service/embeddings.py` (xoá `read_cache` / `write_cache` nếu hết caller)
- Modify: `services/ai-service/.gitignore` hoặc `.gitignore` gốc
- Modify: `docs/SERVICES/AI_SERVICE.md`
- Create: `eval/reports/rag_after_<timestamp>.md` (sinh ra khi chạy)

**Interfaces:**
- Consumes: `eval/eval_rag.py` (Task 1)
- Produces: không có API mới

- [ ] **Step 1: Xoá orphan do thay đổi này tạo ra**

Run: `cd services/ai-service && grep -rn "read_cache\|write_cache\|_CACHE_PATH" --include="*.py" . | grep -v ".venv"`

Nếu không còn caller nào ngoài chính `embeddings.py`, xoá `read_cache`, `write_cache` khỏi `embeddings.py`. Nếu `cover_embeddings.py` còn dùng thì **giữ lại** — đó là dead code có sẵn từ trước, không phải orphan do thay đổi này tạo ra, và CLAUDE.md của repo nói rõ không xoá dead code có sẵn khi chưa được yêu cầu.

Xoá hai file cache còn sót trên đĩa:
```bash
rm -f services/ai-service/.book_index_cache.json services/ai-service/.faq_embeddings_cache.json
```

Kiểm tra `.gitignore` đã bỏ qua hai file này chưa; nếu có dòng nào chỉ đích danh chúng thì xoá dòng đó.

- [ ] **Step 2: Chạy toàn bộ test lần cuối**

Run: `cd services/ai-service && python -m unittest discover 2>&1 | tail -5`
Expected: `OK` (có thể kèm `skipped=3` khi không set `TEST_PG_DSN`).

Run với Postgres:
`cd services/ai-service && TEST_PG_DSN="postgresql+asyncpg://$DB_USER:$DB_PASSWORD@localhost:5432/ai_db" python -m unittest discover 2>&1 | tail -5`
Expected: `OK`, không skip.

- [ ] **Step 3: Chạy eval, so với baseline**

```bash
docker compose --profile ai up -d --build ai-service
# doi ingest xong
docker compose logs ai-service | grep "ingestion: books"
cd services/ai-service && EVAL_AUTH_TOKEN=<jwt> python eval/eval_rag.py
```

So report mới với `eval/reports/rag_baseline_<timestamp>.md` từ Task 1.

**Tiêu chí chấp nhận (từ spec mục A5):** Recall@5 **không thấp hơn** baseline.

- Nếu cao hơn → ghi cả hai số vào bảng so sánh ở Step 4.
- Nếu **thấp hơn** → dừng, không đi tiếp Phase B. Đọc mục "Case truot" trong report mới, đối chiếu với report baseline xem case nào mới truợt. Hai nguyên nhân hay gặp: (a) `source_id` trong `rag_dataset.json` không khớp id thật sau khi ingest — kiểm tra bằng `SELECT source_id FROM ai_documents LIMIT 20;`; (b) sách chưa ingest xong lúc chạy eval — kiểm tra `SELECT count(*) FROM ai_document_chunks WHERE corpus='BOOK_METADATA';` so với số sách trong catalog.

- [ ] **Step 4: Cập nhật tài liệu**

Trong `docs/SERVICES/AI_SERVICE.md`, thêm mục mô tả: hai corpus, bảng `ai_documents` / `ai_document_chunks`, cách chạy lại ingest, biến môi trường mới (`INGEST_MAX_CHUNK_CHARS`, `ENABLE_CORPUS_INGEST`), và bảng so sánh baseline ↔ sau Phase A với số thật từ Step 3.

- [ ] **Step 5: Commit**

```bash
git add services/ai-service/embeddings.py docs/SERVICES/AI_SERVICE.md services/ai-service/eval/reports/ .gitignore
git commit -m "chore(ai-service): don cache JSON cu, cap nhat tai lieu, do lai eval

Recall@5 sau Phase A so voi baseline: <dien so that tu Step 3>.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Tiêu chí hoàn thành Phase A

- [ ] `python -m unittest discover` PASS, cả có và không có `TEST_PG_DSN`
- [ ] Không có test nào của `search_books` hoặc `find_relevant` phải sửa (AD-5)
- [ ] `SELECT corpus, count(*) FROM ai_document_chunks GROUP BY corpus` trả về cả hai corpus với số chunk > 0
- [ ] Restart ai-service lần hai: `chunks_embedded` gần 0 (incremental có tác dụng)
- [ ] `grep -rn "faq_data\|book_index_cache" services/ai-service --include="*.py" | grep -v .venv` không ra dòng nào
- [ ] Recall@5 không thấp hơn baseline, số thật ghi trong `docs/SERVICES/AI_SERVICE.md`

---

## Self-review

**Spec coverage:**

| Mục spec | Task |
|---|---|
| A0 đo baseline | Task 1 |
| A1 Schema | Task 2 |
| A2 Ingestion pipeline | Task 6 |
| A3 Hybrid search (semantic + keyword + RRF) | Task 3, 4, 5 |
| A3 Rerank sau feature flag, mặc định tắt | **Không có task** — đúng chủ ý: spec nói chỉ bật nếu eval chứng minh có lợi. Quyết định đó thuộc Phase D, sau khi có số. Không viết code cho một giả định chưa được đo. |
| A4 Chuyển `book_index` | Task 7, 8 |
| A4 Chuyển `faq_retrieval` | Task 9 |
| A4 Xoá cache JSON orphan | Task 10 |
| A5 Tiêu chí hoàn thành | Task 10 Step 3 + mục trên |
| AD-1 pgvector | Task 2 |
| AD-2 protocol + InMemory | Task 3 |
| AD-3 `embedding_model` là cột | Task 2 (schema), Task 4 (lọc trong mọi query) |
| AD-5 giữ chữ ký | Task 7 Step 4, Task 8 Step 6, Task 9 Step 6 — kiểm ở cả ba chỗ |

**Type consistency:** `Chunk` và `Hit` định nghĩa ở Task 3, dùng nguyên vẹn ở Task 4, 5, 6, 8, 9. `VectorStore` 5 method — `upsert_document`, `upsert_chunks`, `existing_chunk_hashes`, `search_semantic`, `search_keyword` — tên và tham số giống nhau ở protocol (Task 3), `InMemoryVectorStore` (Task 3), `PgVectorStore` (Task 4) và mọi call site. `reciprocal_rank_fusion(rankings, k, limit)` khai ở Task 5, gọi ở Task 8 với `limit=` keyword.

**Rủi ro đã biết, không phải placeholder:**
- `Task 1 Step 5` yêu cầu viết đủ 100 case; plan cho schema, phân bổ theo loại và 8 case mẫu, còn lại phải lấy id thật từ seed. Không tự sinh được vì id phụ thuộc dữ liệu thật của từng máy.
- `Task 9 Step 1` yêu cầu đọc `faq_data.py` rồi chuyển nguyên văn; nội dung 11 entry không chép vào plan này vì phải giữ nguyên văn từ nguồn, chép lại là tạo cơ hội sai khác.
- `Task 10 Step 5` có `<dien so that tu Step 3>` — đây là số đo được lúc chạy, không phải thứ plan biết trước.
