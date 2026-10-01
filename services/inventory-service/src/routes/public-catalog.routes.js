const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { createPublicCatalog } = require('../services/public-catalog.service');

const prisma = new PrismaClient();
const catalog = createPublicCatalog(prisma);

// Anonymous, read-only catalog for the public website. Mounted before the /api
// JWT guard on purpose; only GET handlers exist here, and the gateway also
// rejects any other method on /public. Mutations (reserve, wishlist, review)
// stay behind /my/* and /api/*.
function cacheFor(seconds) {
  return (_req, res, next) => {
    res.set('Cache-Control', `public, max-age=${seconds}`);
    next();
  };
}

function handle(work) {
  return async (req, res) => {
    try {
      return await work(req, res);
    } catch (error) {
      console.error('[public-catalog] request failed:', error);
      return res.status(500).json({ message: 'Không tải được danh mục sách' });
    }
  };
}

router.get('/home', cacheFor(60), handle(async (_req, res) => res.json(await catalog.home())));

router.get('/categories', cacheFor(300), handle(async (_req, res) => res.json({ data: await catalog.categories() })));

router.get('/books', cacheFor(30), handle(async (req, res) => res.json(await catalog.list(req.query))));

router.get('/books/:id', cacheFor(30), handle(async (req, res) => {
  const book = await catalog.detail(req.params.id);
  if (!book) return res.status(404).json({ message: 'Không tìm thấy sách' });
  return res.json(book);
}));

module.exports = router;
