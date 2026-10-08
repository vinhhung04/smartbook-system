"""Re-index every corpus (INTERNAL_DOC + BOOK_METADATA) with the currently
configured embedding model (embeddings.EMBED_IDENTITY).

Why this exists: switching embedding providers/models (e.g. nomic-embed-text
-> qwen/qwen3-embedding-8b) makes every previously-embedded vector unusable -
it lives in a different vector space, and cosine similarity against it is
meaningless. ingestion.py's incremental content-hash check already causes
every chunk to be re-embedded once EMBED_IDENTITY changes (see
ingestion.chunk_hash), and catalog_sync.py removes books that left the
catalog, but this script also purges every chunk NOT tagged with the current
EMBED_IDENTITY first, so no stale vector survives either way.

Normal operation does NOT need this script: main.py's startup hook ingests
corpus/*.md and catalog_sync.sync_loop() keeps BOOK_METADATA in step with
inventory-service on a schedule. Use it after changing the embedding model,
or to force a full pass from a shell.

Usage (from services/ai-service/, with Postgres + inventory-service reachable):
    INTERNAL_SERVICE_KEY=<same key as inventory-service> python reindex_embeddings.py

The book corpus is read from inventory-service's internal feed
(GET /internal/catalog/books) with the service key - no user JWT is needed.
"""
from __future__ import annotations

import asyncio
import logging
import sys

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("reindex_embeddings")


async def main() -> int:
    import catalog_sync
    import embeddings
    import ingestion
    import vector_store

    store = vector_store.get_store()
    purged = await store.delete_chunks_except_model(embeddings.EMBED_IDENTITY)
    logger.info("Purged %d chunk(s) not tagged %s", purged, embeddings.EMBED_IDENTITY)

    doc_stats = await ingestion.ingest_internal_docs()
    logger.info("Internal docs: %s", doc_stats)

    status = await catalog_sync.sync_book_corpus()
    logger.info("Books: outcome=%s stats=%s error=%s",
                status.get("last_outcome"), status.get("last_stats"), status.get("last_error"))
    return 0 if status.get("last_outcome") == "ok" else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
