const express = require('express');
const { isValidInternalKey } = require('../services/internal-catalog.service');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IDS = 200;

/**
 * Service-to-service warehouse contract (x-internal-service-key), never
 * exposed through the gateway. auth-service validates warehouse ids it is
 * asked to put into user_warehouse_scopes here instead of reading
 * inventory_db, and tells this service to drop a user's cached scope after
 * it changed (the shared resolver otherwise keeps it for up to 30 s).
 */
function createInternalWarehousesRouter({ prisma, onScopeChanged = () => {}, internalKey = () => process.env.INTERNAL_SERVICE_KEY } = {}) {
  const router = express.Router();

  router.use((req, res, next) => {
    if (!isValidInternalKey(req.headers['x-internal-service-key'], internalKey())) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    return next();
  });

  // GET /internal/warehouses?ids=a,b  -> the warehouses that exist (active or not)
  router.get('/warehouses', async (req, res) => {
    const ids = [...new Set(String(req.query.ids || '').split(',').map((v) => v.trim()).filter(Boolean))];
    if (!ids.length) return res.json({ data: [] });
    if (ids.length > MAX_IDS || ids.some((id) => !UUID_RE.test(id))) {
      return res.status(400).json({ message: 'ids must be up to 200 UUIDs' });
    }
    try {
      const rows = await prisma.warehouses.findMany({
        where: { id: { in: ids } },
        select: { id: true, code: true, name: true, is_active: true },
      });
      return res.json({ data: rows });
    } catch (_error) {
      return res.status(500).json({ message: 'Could not read warehouses' });
    }
  });

  router.post('/warehouse-scopes/invalidate', express.json(), (req, res) => {
    const userId = String(req.body?.user_id || '');
    if (!UUID_RE.test(userId)) return res.status(400).json({ message: 'user_id must be a UUID' });
    onScopeChanged(userId);
    return res.status(204).end();
  });

  return router;
}

module.exports = { createInternalWarehousesRouter };
