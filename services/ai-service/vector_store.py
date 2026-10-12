"""Vector store cho hai corpus cua ai-service.

Hai implementation:
- PgVectorStore (Task 4): production, pgvector trong ai_db.
- InMemoryVectorStore: test. Test cua service nay chay tren SQLite in-memory
  (db.py:18) noi khong co pgvector; neu retrieval goi thang SQL pgvector thi
  moi test deu can mot Postgres that.

Giong embeddings.py / book_index.py: khong bao gio raise, loi thi degrade.
"""
from __future__ import annotations

import os
import re
import uuid
from dataclasses import dataclass, field
from typing import Protocol

import embeddings
from intent import normalize_text

EMBEDDING_DIM = 768
CORPUS_BOOK = "BOOK_METADATA"
CORPUS_DOC = "INTERNAL_DOC"

# Nhanh keyword (full-text) cua hybrid retrieval.
#
# "all" (mac dinh, hanh vi production): plainto_tsquery - MOI tu cua cau hoi
# phai co trong tai lieu. Cau hoi tu nhien ("Sach nao cua nha van To Hoai?")
# gan nhu khong bao gio khop vi "sach", "nao", "cua"... khong nam trong noi
# dung; tren tap validation cua eval/rag_dataset.json nhanh nay chi ho tro
# top-1 o 4/36 cau co dap an, tuc "hybrid" thuc chat chi con semantic.
# "terms" (thu nghiem, opt-in): bo hu tu / tu hoi tieng Viet (danh sach co dinh
# ben duoi, lap theo ngu phap, KHONG hoc tu dataset), tim OR tren cac tu noi
# dung con lai roi xep hang theo ty le tu khop (coverage >= KEYWORD_MIN_COVERAGE).
# Ket qua 2026-10-08 (eval/reports/rag_*_C-terms067_test.md vs *_B-legacy_test.md):
# tot hon tren validation (cov 0.67 chon tren val) nhung KHONG tot hon tren test
# (them 1 false positive sach, Recall@1 giam 1 case) nen KHONG bat mac dinh -
# nguong retrieval_confidence duoc hieu chinh cho phan bo tin hieu keyword cu.
KEYWORD_MODE = os.getenv("RAG_KEYWORD_MODE", "all").strip().lower()
KEYWORD_MIN_COVERAGE = float(os.getenv("RAG_KEYWORD_MIN_COVERAGE", "0.67"))

# Hu tu, dai tu, tu hoi, tro tu va danh tu chung chi "sach" - da bo dau (sau
# intent.normalize_text). Chon theo ngu phap tieng Viet, khong theo cau hoi eval.
_KEYWORD_STOPWORDS = frozenset(
    "a ai anh ban bao bi biet cac can chi cho chua co con cua cuon da dang dau "
    "de den di do duoc gi giup ha hay hoac hoi khi khong la lam len ma minh mot muon "
    "nao nay ne nhe nhieu nhu nhung o oi quyen ra roi sach sao se ta tai the thi "
    "tim toi trong tu va vao ve vay voi xin".split()
)
_TERM_RE = re.compile(r"[a-z0-9]+")


def keyword_terms(query: str) -> list[str]:
    """Tu noi dung cua cau hoi, da bo dau, giu thu tu, khong trung lap."""
    terms: list[str] = []
    for token in _TERM_RE.findall(normalize_text(query or "")):
        if len(token) >= 2 and token not in _KEYWORD_STOPWORDS and token not in terms:
            terms.append(token)
    return terms


def keyword_coverage(terms: list[str], content: str) -> float:
    """Ty le tu noi dung xuat hien NGUYEN TU trong content (khong phai substring:
    "an" khong duoc khop vao "toan")."""
    if not terms:
        return 0.0
    words = set(_TERM_RE.findall(normalize_text(content or "")))
    return sum(1 for term in terms if term in words) / len(terms)


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
class DocumentState:
    """Mot document da luu cung hash cua tung chunk — du de catalog_sync.py
    quyet dinh "khong doi, bo qua" ma khong can mot query rieng cho moi quyen."""
    document_id: str
    source_id: str
    title: str | None
    content_hash: str
    metadata: dict
    chunk_hashes: dict[int, str]


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
        self, corpus: str, query_vec: list[float], k: int, embedding_model: str,
        source_ids: list[str] | None = None,
    ) -> list[Hit]: ...

    async def search_keyword(
        self, corpus: str, query: str, k: int,
        source_ids: list[str] | None = None,
    ) -> list[Hit]: ...

    async def delete_chunks_except_model(self, embedding_model: str) -> int:
        """Xoa moi chunk KHONG thuoc `embedding_model` (vd cac vector nomic cu
        con sot lai sau khi doi embedding provider). Tra ve so chunk da xoa.
        Dung khi khoi dong (truoc ingest) va boi reindex_embeddings.py, de
        khong vector nao cua model cu song sot ke ca voi tai lieu khong duoc
        ingest lai."""
        ...

    async def list_documents(self, corpus: str) -> dict[str, DocumentState]:
        """source_id -> DocumentState cho moi document cua corpus."""
        ...

    async def delete_documents(self, corpus: str, source_ids: list[str]) -> int:
        """Xoa document (va chunk cua no). Tra ve so document da xoa."""
        ...

    async def delete_chunks_from(self, document_id: str, start_index: int) -> int:
        """Xoa chunk co chunk_index >= start_index: tai lieu ngan lai thi chunk
        duoi cung khong duoc de lai lam ket qua tim kiem ma."""
        ...


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

    async def search_keyword(
        self, corpus: str, query: str, k: int,
        source_ids: list[str] | None = None,
    ) -> list[Hit]:
        if KEYWORD_MODE == "terms":
            terms = keyword_terms(query)
            scored = []
            for doc, row in self._candidates(corpus, source_ids):
                coverage = keyword_coverage(terms, row["content"])
                if coverage > 0 and coverage >= KEYWORD_MIN_COVERAGE:
                    scored.append(self._hit(doc, row, coverage))
            scored.sort(key=lambda hit: (-hit.score, hit.source_id))
            return scored[:k]
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

    async def delete_chunks_except_model(self, embedding_model: str) -> int:
        deleted = 0
        for document_id, rows in self._chunks.items():
            stale = [index for index, row in rows.items() if row["embedding_model"] != embedding_model]
            for index in stale:
                del rows[index]
            deleted += len(stale)
        return deleted

    async def list_documents(self, corpus: str) -> dict[str, DocumentState]:
        return {
            doc["source_id"]: DocumentState(
                document_id=doc["id"], source_id=doc["source_id"], title=doc["title"],
                content_hash=doc["content_hash"], metadata=dict(doc["metadata"]),
                chunk_hashes={
                    index: row["content_hash"] for index, row in self._chunks.get(doc["id"], {}).items()
                },
            )
            for (doc_corpus, _), doc in self._docs.items()
            if doc_corpus == corpus
        }

    async def delete_documents(self, corpus: str, source_ids: list[str]) -> int:
        deleted = 0
        for source_id in source_ids:
            doc = self._docs.pop((corpus, source_id), None)
            if doc is not None:
                self._chunks.pop(doc["id"], None)
                deleted += 1
        return deleted

    async def delete_chunks_from(self, document_id: str, start_index: int) -> int:
        rows = self._chunks.get(document_id, {})
        stale = [index for index in rows if index >= start_index]
        for index in stale:
            del rows[index]
        return len(stale)


_store: VectorStore | None = None


def get_store() -> VectorStore:
    """PgVectorStore khi DATABASE_URL tro toi Postgres that, InMemoryVectorStore
    mac dinh khi chua cau hinh gi. Luu y: test trong repo nay KHONG dua vao viec
    tu dong chon theo DATABASE_URL — moi test can InMemoryVectorStore phai tu goi
    set_store() trong setUp(), vi DATABASE_URL khong bao gio thuc su duoc set
    thanh sqlite trong moi truong test cua repo nay (khac voi cach db.py tu chon
    engine cho chinh no)."""
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
