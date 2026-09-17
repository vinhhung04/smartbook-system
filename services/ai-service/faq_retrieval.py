"""Hybrid search tren corpus tai lieu noi bo (INTERNAL_DOC).

Backs the /chat GENERAL_QUERY branch: khi mot cau hoi khong khop intent nao
trong 11 intent co dinh, retrieval.py hoi module nay thay vi tra context rong.

Truoc day noi dung nam hardcode trong mot module Python rieng va vector nam
trong mot file JSON tren dia. Gio noi dung la file Markdown trong corpus/ (van
review qua git nhu code) va vector nam trong ai_document_chunks.

Hai nhanh nhu ben tim sach: semantic (cosine tren pgvector) VA keyword
(full-text bo dau), hop nhat bang RRF. Nhanh keyword bat duoc nhung cau hoi
gan trung tung chu voi heading cua FAQ ma vector mot minh bo lo.

Chu ky find_relevant KHONG doi: retrieval.py va test_retrieval.py phu thuoc vao
no (AD-5). Never raises — khong co ket qua thi caller giu hanh vi fallback cu.
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import NamedTuple

import ollama
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

import db
import embeddings
import fusion
import vector_store
from pg_vector_store import PgVectorStore

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


def _per_call_store():
    """(store, engine) cho DUY NHAT lan goi nay. engine is not None => caller
    phai dispose() no truoc khi vong lap cua asyncio.run() dong lai.

    find_relevant() mo mot event loop moi moi lan goi. db.engine la pool dung
    chung toan process, cung duoc conversation_store/agent_store/cover_gallery
    dung tren vong lap CHINH cua uvicorn — ket noi asyncpg bi rang buoc voi
    vong lap da mo no, nen khong the dung chung pool do o day, va cang khong the
    dispose() no tu vong lap phu (dispose keo sap ca ket noi cua vong lap chinh,
    crash trong asyncpg roi bi try/except nuot thanh [] im lang).

    Nen: engine RIENG, NullPool (khong tai su dung ket noi), tao va dispose gon
    trong mot lan goi — khong con gi sot lai cho lan goi sau ke thua.
    Test tiem InMemoryVectorStore qua set_store() thi dung thang, khong co engine.
    """
    store = vector_store.get_store()
    if not isinstance(store, PgVectorStore):
        return store, None
    engine = create_async_engine(db.DATABASE_URL, poolclass=NullPool)
    return PgVectorStore(engine=engine), engine


async def _find_relevant_async(query: str, top_k: int, threshold: float, client) -> list[FAQMatch]:
    query_vector = await asyncio.to_thread(embed_text, query, client)
    if not query_vector:
        return []
    store, engine = _per_call_store()
    try:
        # threshold la nguong COSINE (mac dinh 0.75), ap len nhanh semantic
        # TRUOC khi fuse — diem RRF sau fusion la thang do khac han, nguong
        # cosine khong chuyen sang do duoc. Nhanh keyword khong co nguong:
        # mot cu khop full-text da tu no la tin hieu co nghia (cung quy uoc voi
        # _score_and_rank_books ben phia sach).
        semantic = [
            hit for hit in await store.search_semantic(
                vector_store.CORPUS_DOC, query_vector, k=top_k)
            if hit.score >= threshold
        ]
        keyword = await store.search_keyword(vector_store.CORPUS_DOC, query, k=top_k)
        fused = fusion.reciprocal_rank_fusion([semantic, keyword], limit=top_k)
        return [FAQMatch(entry=_entry_from_hit(hit), score=hit.score) for hit in fused]
    finally:
        if engine is not None:
            await engine.dispose()


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
