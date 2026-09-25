"""Re-index every corpus (INTERNAL_DOC + BOOK_METADATA) with the currently
configured embedding model (embeddings.EMBED_IDENTITY).

Why this exists: switching embedding providers/models (e.g. nomic-embed-text
-> qwen/qwen3-embedding-8b) makes every previously-embedded vector unusable -
it lives in a different vector space, and cosine similarity against it is
meaningless. ingestion.py's incremental content-hash check already causes
every chunk to be re-embedded once EMBED_IDENTITY changes (see
ingestion.chunk_hash), but a document that is no longer in corpus/ or in
/api/books never gets re-ingested at all, so its stale vector would sit in
the table forever, still matchable by embedding_model if that filter were
ever relaxed. This script purges every chunk NOT tagged with the current
EMBED_IDENTITY before re-ingesting, so no stale vector survives either way.

Usage (from services/ai-service/, with a running Postgres + gateway):
    REINDEX_AUTH_TOKEN=<a valid staff/admin JWT> python reindex_embeddings.py

The book corpus requires a real bearer token: /api/books is authenticated,
and this script (like main.py's own startup ingest — see task_5448fb5f) has
no user session to draw one from. Without REINDEX_AUTH_TOKEN set, only the
internal-docs corpus (corpus/*.md) is re-indexed and a warning is printed.
"""
from __future__ import annotations

import asyncio
import logging
import os
import sys

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("reindex_embeddings")


async def main() -> int:
    import assistant_tools
    import embeddings
    import ingestion
    import vector_store

    store = vector_store.get_store()
    purged = await store.delete_chunks_except_model(embeddings.EMBED_IDENTITY)
    logger.info("Purged %d chunk(s) not tagged %s", purged, embeddings.EMBED_IDENTITY)

    doc_stats = await ingestion.ingest_internal_docs()
    logger.info("Internal docs: %s", doc_stats)

    token = os.getenv("REINDEX_AUTH_TOKEN", "").strip()
    if not token:
        logger.warning(
            "REINDEX_AUTH_TOKEN not set - skipping the BOOK_METADATA corpus. "
            "search_books will keyword-only fallback until this is run with a token."
        )
        return 0

    books = await assistant_tools._get("/api/books", f"Bearer {token}", truncate=False)
    if not isinstance(books, list):
        logger.error("GET /api/books did not return a list (got %s) - aborting book re-index.", type(books).__name__)
        return 1

    book_stats = await ingestion.ingest_books(books)
    logger.info("Books: %s", book_stats)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
