"""Diem semantic cho catalog sach, doc tu vector store.

Truoc day module nay tu dung index rieng trong mot file cache JSON tren dia
va rebuild toan bo khi content hash cua CA catalog doi.
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
