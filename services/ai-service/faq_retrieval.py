"""Semantic search tren corpus tai lieu noi bo (INTERNAL_DOC).

Backs the /chat GENERAL_QUERY branch: khi mot cau hoi khong khop intent nao
trong 11 intent co dinh, retrieval.py hoi module nay thay vi tra context rong.

Truoc day noi dung nam hardcode trong mot module Python rieng va vector nam
trong mot file JSON tren dia. Gio noi dung la file Markdown trong corpus/ (van
review qua git nhu code) va vector nam trong ai_document_chunks.

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
    result = [
        FAQMatch(entry=_entry_from_hit(hit), score=hit.score)
        for hit in hits if hit.score >= threshold
    ]
    # find_relevant() goi asyncio.run() moi lan — khi store la PgVectorStore,
    # ket noi asyncpg lay tu db.engine (pool dung chung, song suot process) bi
    # rang buoc voi vong lap tao ra no. Dispose o CUOI coroutine nay, truoc khi
    # asyncio.run() dong vong lap, de lan goi ke tiep khong nhan lai ket noi
    # rang buoc voi mot vong lap da chet (giong fix cua Task 4 trong
    # test_pgvector_store.py).
    import db
    await db.engine.dispose()
    return result


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
