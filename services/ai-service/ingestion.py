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
from typing import NamedTuple

import book_index
import embeddings
import vector_store
from vector_store import Chunk

logger = logging.getLogger("uvicorn.error")

MAX_CHUNK_CHARS = int(os.getenv("INGEST_MAX_CHUNK_CHARS", "1200"))
CORPUS_DIR = os.path.join(os.path.dirname(__file__), "corpus")

_HEADING_RE = re.compile(r"^#{1,6} ", re.MULTILINE)


def chunk_hash(text: str) -> str:
    # Identity = content + embedding model + dimensions (embeddings.EMBED_IDENTITY):
    # a chunk embedded by a different model, or the same model at a different
    # dimension count, lives in a different vector space and must never be
    # treated as "unchanged" just because its text didn't change.
    return embeddings.content_hash({"model": embeddings.EMBED_IDENTITY, "text": text})


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


class IngestOutcome(NamedTuple):
    embedded: int
    skipped: int
    # True khi embedding provider tra ve None: tai lieu da duoc upsert nhung
    # chunk can embed chua co vector moi. Lan dong bo sau se thu lai (hash chunk
    # van lech), nen caller can dem rieng truong hop nay thay vi coi la "bo qua".
    embed_failed: bool = False


async def _ingest_one(
    store, corpus: str, source_id: str, title: str | None,
    content: str, texts: list[str], metadata: dict,
) -> IngestOutcome:
    document_id = await store.upsert_document(
        corpus=corpus, source_id=source_id, title=title,
        content=content, content_hash=chunk_hash(content), metadata=metadata)

    existing = await store.existing_chunk_hashes(document_id)
    if any(index >= len(texts) for index in existing):
        # Tai lieu ngan lai: chunk duoi cung la noi dung da bi xoa, khong duoc
        # tiep tuc khop tim kiem.
        await store.delete_chunks_from(document_id, len(texts))
    todo = plan_chunks(existing, texts)
    if not todo:
        return IngestOutcome(0, len(texts))

    embed_result = await asyncio.to_thread(embeddings.embed_batch, [texts[i] for i in todo])
    if embed_result is None:
        logger.warning("ingestion: embed that bai cho %s/%s, bo qua", corpus, source_id)
        return IngestOutcome(0, len(texts), embed_failed=True)

    await store.upsert_chunks([
        Chunk(
            document_id=document_id, corpus=corpus, chunk_index=index,
            content=texts[index], content_hash=chunk_hash(texts[index]),
            embedding=vector, embedding_model=embed_result.model,
        )
        for index, vector in zip(todo, embed_result.vectors)
    ])
    return IngestOutcome(len(todo), len(texts) - len(todo))


def book_metadata(book: dict) -> dict:
    """Metadata luu kem document sach. Khong gom so luong ton kho: ton kho doi
    lien tuc theo nghiep vu kho, dua vao day chi lam moi lan dong bo deu phai
    ghi lai document ma noi dung tim kiem khong he doi."""
    return {"author": book.get("author"), "category": book.get("category"), "isbn": book.get("isbn")}


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
        try:
            done, skip, _ = await _ingest_one(
                store, vector_store.CORPUS_BOOK, str(book["id"]),
                str(book.get("title") or ""), text, [text],
                book_metadata(book),
            )
        except Exception as exc:
            logger.warning(
                "ingestion: loi khi ingest book %s, bo qua: %s", book.get("id"), type(exc).__name__)
            continue
        documents += 1
        embedded += done
        skipped += skip
    logger.info("ingestion: books %d doc, %d chunk embed, %d bo qua", documents, embedded, skipped)
    return {"documents": documents, "chunks_embedded": embedded, "chunks_skipped": skipped}


async def ingest_internal_docs(directory: str = CORPUS_DIR) -> dict:
    """Moi file .md trong corpus/ la mot document; source_id la ten file khong
    duoi. Noi dung review qua git nhu code — cung triet ly module FAQ tinh cu,
    nhung khong hardcode trong .py."""
    store = vector_store.get_store()
    documents = embedded = skipped = 0
    if not os.path.isdir(directory):
        logger.warning("ingestion: khong tim thay thu muc corpus %s", directory)
        return {"documents": 0, "chunks_embedded": 0, "chunks_skipped": 0}

    present: set[str] = set()
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
        # Danh dau "con ton tai" TRUOC khi ingest: mot file loi tam thoi (DB/embed)
        # van la tai lieu hop le, khong duoc bi coi la da xoa va bi go khoi corpus.
        present.add(source_id)
        title = texts[0].splitlines()[0].lstrip("# ").strip()
        try:
            done, skip, _ = await _ingest_one(
                store, vector_store.CORPUS_DOC, source_id, title, content, texts,
                {"filename": filename},
            )
        except Exception as exc:
            logger.warning(
                "ingestion: loi khi ingest file %s, bo qua: %s", filename, type(exc).__name__)
            continue
        documents += 1
        embedded += done
        skipped += skip

    removed = 0
    if present:
        # File .md da bi xoa khoi corpus/ thi document cua no cung phai roi khoi
        # vector store, neu khong RAG van trich dan mot chinh sach khong con hieu luc.
        # Chi xoa khi lan quet nay ingest duoc it nhat mot file, de mot thu muc
        # corpus rong/hong khong xoa sach corpus.
        try:
            stale = [sid for sid in await store.list_documents(vector_store.CORPUS_DOC) if sid not in present]
            removed = await store.delete_documents(vector_store.CORPUS_DOC, stale) if stale else 0
        except Exception as exc:
            logger.warning("ingestion: khong go duoc tai lieu da xoa: %s", type(exc).__name__)
    logger.info(
        "ingestion: docs %d doc, %d chunk embed, %d bo qua, %d go bo", documents, embedded, skipped, removed)
    return {"documents": documents, "chunks_embedded": embedded, "chunks_skipped": skipped, "removed": removed}
