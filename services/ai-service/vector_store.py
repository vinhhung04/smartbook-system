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
