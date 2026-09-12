const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { isValidInternalKey, mapCoverGalleryItem } = require('../services/internal-catalog.service');

const prisma = new PrismaClient();

// Used by ai-service to build/refresh its cover-image embedding gallery. No
// live user JWT exists for that background job, so this follows the same
// shared-secret pattern as /internal/authority instead of /api's JWT auth.
router.get('/', async (_req, res) => {
  const expectedKey = process.env.INTERNAL_SERVICE_KEY || 'smartbook_internal_key';
  const providedKey = _req.headers['x-internal-service-key'];
  if (!isValidInternalKey(providedKey, expectedKey)) return res.status(403).json({ message: 'Forbidden' });

  try {
    const variants = await prisma.book_variants.findMany({
      where: { cover_image_url: { not: null }, is_active: true },
      select: {
        id: true,
        book_id: true,
        isbn13: true,
        cover_image_url: true,
        books: {
          select: {
            title: true,
            book_authors: {
              orderBy: { author_order: 'asc' },
              take: 1,
              select: { authors: { select: { full_name: true } } },
            },
          },
        },
      },
    });

    return res.json({ items: variants.map(mapCoverGalleryItem) });
  } catch (error) {
    console.error('Unable to list internal cover gallery', error);
    return res.status(500).json({ message: 'Unable to list cover gallery' });
  }
});

module.exports = router;
