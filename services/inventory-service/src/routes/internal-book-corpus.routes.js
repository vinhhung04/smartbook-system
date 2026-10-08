const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { isValidInternalKey, mapCorpusBook, parseCorpusPageParams } = require('../services/internal-catalog.service');

const prisma = new PrismaClient();

// Feed for ai-service's catalog_sync.py, which keeps the BOOK_METADATA vector
// corpus in step with the catalog. That background job has no user session, so
// it authenticates with the shared service key (same pattern as
// /internal/covers) instead of /api's JWT. Only active books are returned: a
// book that disappears from the full scan is removed from the corpus.
function listCorpusBooks(db) {
  return async (req, res) => {
    if (!isValidInternalKey(req.headers['x-internal-service-key'], process.env.INTERNAL_SERVICE_KEY)) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const page = parseCorpusPageParams(req.query);
    if (page.error) return res.status(400).json({ message: page.error });

    try {
      const books = await db.books.findMany({
        // `id > after`, not Prisma's `cursor`: a cursor row deleted between two
        // page requests makes `cursor` return an empty page, which would end the
        // scan early and make ai-service drop every book after it from the corpus.
        where: { is_active: true, ...(page.after ? { id: { gt: page.after } } : {}) },
        orderBy: { id: 'asc' },
        take: page.limit + 1,
        select: {
          id: true,
          title: true,
          subtitle: true,
          description: true,
          metadata: true,
          updated_at: true,
          publishers: { select: { name: true } },
          book_authors: {
            orderBy: { author_order: 'asc' },
            take: 1,
            select: { authors: { select: { full_name: true } } },
          },
          book_categories: { take: 1, select: { categories: { select: { name: true } } } },
          book_variants: {
            orderBy: { created_at: 'asc' },
            take: 1,
            select: { isbn13: true, isbn10: true },
          },
        },
      });

      const hasMore = books.length > page.limit;
      const items = books.slice(0, page.limit).map(mapCorpusBook);
      return res.json({
        items,
        next_cursor: hasMore ? items[items.length - 1].id : null,
      });
    } catch (error) {
      console.error('Unable to list internal book corpus', error);
      return res.status(500).json({ message: 'Unable to list book corpus' });
    }
  };
}

router.get('/', listCorpusBooks(prisma));

module.exports = router;
module.exports.listCorpusBooks = listCorpusBooks;
