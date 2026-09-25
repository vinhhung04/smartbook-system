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

from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

import db
import embeddings
import fusion
import retrieval_confidence as confidence
import vector_store
from pg_vector_store import PgVectorStore

logger = logging.getLogger("uvicorn.error")

# When on (default), find_relevant() withholds matches for a NO_EVIDENCE decision
# instead of handing retrieval.py "the nearest thing we have" for a question the
# corpus has no real answer to (see retrieval_confidence.py). Kept switchable so
# eval/eval_rag.py can reproduce the pre-abstention baseline for comparison.
RAG_ABSTENTION_ENABLED = os.getenv("RAG_ABSTENTION_ENABLED", "true").lower() != "false"

# 0.75 was tuned for nomic-embed-text's cosine distribution. Verified live against
# qwen/qwen3-embedding-8b (post-Ollama-removal migration): the correct document for a
# real query scored ~0.39 cosine, with the best distractor at ~0.32 - Qwen3's short-text
# similarity scores sit in a much lower/flatter range than nomic's. Re-ran
# eval/eval_rag.py's INTERNAL_DOC cases live at both values: 0.75 gave R@5 0.45 (most
# correct matches filtered out by the gate before RRF ever saw them); 0.3 gave R@5 0.85 -
# above the pre-migration nomic baseline (0.775, eval/reports/rag_final_fixes_20260917_061603.md).
FAQ_MATCH_THRESHOLD = float(os.getenv("FAQ_MATCH_THRESHOLD", "0.3"))
FAQ_TOP_K = int(os.getenv("FAQ_TOP_K", "3"))


class FAQMatch(NamedTuple):
    entry: dict
    score: float


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


async def _find_relevant_async(
    query: str, top_k: int, threshold: float,
) -> tuple[list[FAQMatch], confidence.RetrievalConfidence]:
    # embeddings.embed_batch()/embed_text() are documented to never raise and to
    # let the caller "drop the semantic signal, keyword search only" on failure
    # (embeddings.py's module docstring) - this used to return [] immediately
    # instead, which contradicted that contract and meant an OpenRouter outage
    # made GENERAL_QUERY answer with zero FAQ context even for questions the
    # keyword arm alone could have answered (book search already fell back to
    # keyword-only; this brings the FAQ corpus in line with it).
    embed_result = await asyncio.to_thread(embeddings.embed_text, query)
    store, engine = _per_call_store()
    try:
        # threshold la nguong COSINE (mac dinh 0.75), ap len nhanh semantic
        # TRUOC khi fuse — diem RRF sau fusion la thang do khac han, nguong
        # cosine khong chuyen sang do duoc. Nhanh keyword khong co nguong:
        # mot cu khop full-text da tu no la tin hieu co nghia (cung quy uoc voi
        # _score_and_rank_books ben phia sach).
        semantic = (
            [
                hit for hit in await store.search_semantic(
                    vector_store.CORPUS_DOC, embed_result.vector, k=top_k,
                    embedding_model=embed_result.model)
                if hit.score >= threshold
            ]
            if embed_result is not None else []
        )
        keyword = await store.search_keyword(vector_store.CORPUS_DOC, query, k=top_k)
        fused = fusion.reciprocal_rank_fusion([semantic, keyword], limit=top_k)
        signals = confidence.extract_signals(
            vector_store.CORPUS_DOC, semantic, keyword, fused, semantic_available=embed_result is not None,
        )
        result = confidence.evaluate(signals, confidence.DOC_CONFIDENCE)
        confidence.log_decision(result)
        matches = [FAQMatch(entry=_entry_from_hit(hit), score=hit.score) for hit in fused]
        return matches, result
    finally:
        if engine is not None:
            await engine.dispose()


def find_relevant_with_confidence(
    query: str,
    top_k: int = FAQ_TOP_K,
    threshold: float = FAQ_MATCH_THRESHOLD,
) -> tuple[list[FAQMatch], confidence.RetrievalConfidence]:
    """Same sync/never-raises contract as find_relevant(), but also returns the
    RetrievalConfidence decision so retrieval.py can abstain instead of
    presenting a weak match as a settled answer (see retrieval_confidence.py)."""
    query = (query or "").strip()
    empty_confidence = confidence.RetrievalConfidence(
        confidence.NO_EVIDENCE, 0.0, ["EMPTY_QUERY"],
        confidence.RetrievalSignals(vector_store.CORPUS_DOC, 0, False, 0.0, None, None, False),
    )
    if not query:
        return [], empty_confidence
    try:
        return asyncio.run(_find_relevant_async(query, top_k, threshold))
    except Exception as exc:
        logger.warning("faq_retrieval: tim kiem that bai: %s", type(exc).__name__)
        return [], empty_confidence


def find_relevant(
    query: str,
    top_k: int = FAQ_TOP_K,
    threshold: float = FAQ_MATCH_THRESHOLD,
) -> list[FAQMatch]:
    """Chu ky sync giu nguyen (AD-5): retrieval.py:254 goi ham nay qua
    asyncio.to_thread, nen no chay trong mot thread KHONG co event loop —
    asyncio.run() o day la hop le, khong phai nested loop.

    Withholds matches on a NO_EVIDENCE decision when RAG_ABSTENTION_ENABLED
    (default on) - callers that need the confidence/reason codes too (to show
    an UNCERTAIN caveat, or to log the decision) should call
    find_relevant_with_confidence() instead."""
    matches, result = find_relevant_with_confidence(query, top_k, threshold)
    if RAG_ABSTENTION_ENABLED and result.decision == confidence.NO_EVIDENCE:
        return []
    return matches
