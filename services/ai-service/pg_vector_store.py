"""pgvector-backed VectorStore. Chi duoc dung khi DATABASE_URL la Postgres —
vector_store.get_store() lo viec chon.

Moi query loc theo embedding_model dang hoat dong: chunk embed bang model cu
nam trong khong gian vector khac, dung lan se cho ket qua sai im lang (AD-3).
"""
from __future__ import annotations

import json
import logging

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

import db
import embeddings
from vector_store import Chunk, Hit

logger = logging.getLogger("uvicorn.error")


def _to_vector_literal(values: list[float]) -> str:
    """pgvector nhan dang text '[1,2,3]'. Dung literal thay vi register type
    de khong phai gan pgvector vao engine dung chung voi phan con lai cua service."""
    return "[" + ",".join(repr(float(value)) for value in values) + "]"


class PgVectorStore:
    def __init__(self, engine: AsyncEngine | None = None) -> None:
        """engine=None (mac dinh) -> dung db.engine dung chung, y het truoc day.

        Truyen engine RIENG khi caller chay tren mot event loop khac voi loop
        cua service (vd faq_retrieval.find_relevant chay trong worker thread va
        tu mo loop moi moi lan goi): ket noi asyncpg bi rang buoc voi loop da
        tao ra no, nen dung chung mot pool giua hai loop se hong — va dispose()
        pool dung chung tu loop phu con keo sap ca ket noi cua loop chinh.
        """
        self._session_factory = (
            async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
            if engine is not None else None
        )

    def _session(self) -> AsyncSession:
        return self._session_factory() if self._session_factory is not None else db.get_session()

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
        async with self._session() as session:
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
        async with self._session() as session:
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
        async with self._session() as session:
            rows = (await session.execute(sql, {"document_id": document_id})).all()
        return {int(row[0]): str(row[1]) for row in rows}

    async def _search(self, sql: text, params: dict) -> list[Hit]:
        try:
            async with self._session() as session:
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
