const crypto = require('crypto');
const express = require('express');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function digest(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest();
}

// Constant-time comparison; an empty expected key rejects every caller.
function isValidInternalKey(provided, expected) {
  if (!expected) return false;
  return crypto.timingSafeEqual(digest(provided), digest(expected));
}

/**
 * Service-to-service routes (x-internal-service-key), never exposed through
 * the gateway. GET /internal/users/:id/warehouse-scopes is the one source the
 * other services read a user's warehouse scope from
 * (@smartbook/shared/warehouse-scope), so no service queries auth_db itself.
 */
function createInternalRouter({ prisma, internalKey = process.env.INTERNAL_SERVICE_KEY } = {}) {
  const router = express.Router();

  router.use((req, res, next) => {
    if (!isValidInternalKey(req.headers['x-internal-service-key'], String(internalKey || '').trim())) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    return next();
  });

  router.get('/users/:id/warehouse-scopes', async (req, res) => {
    const userId = String(req.params.id || '');
    if (!UUID_RE.test(userId)) {
      return res.status(400).json({ message: 'user id must be a UUID' });
    }
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          status: true,
          is_superuser: true,
          deleted_at: true,
          user_warehouse_scopes: { select: { warehouse_id: true, access_level: true } },
          user_roles: {
            where: { OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }] },
            select: { role: { select: { code: true } } },
          },
        },
      });
      if (!user) return res.status(404).json({ message: 'User not found' });
      return res.json({
        data: {
          user_id: user.id,
          status: user.status,
          deleted: Boolean(user.deleted_at),
          is_superuser: user.is_superuser === true,
          scopes: user.user_warehouse_scopes.map((s) => ({ warehouse_id: s.warehouse_id, access_level: s.access_level })),
          // role codes let other services check that an assignee is warehouse staff
          roles: (user.user_roles || []).map((ur) => ur.role?.code).filter(Boolean),
        },
      });
    } catch (_error) {
      return res.status(500).json({ message: 'Could not read warehouse scopes' });
    }
  });

  return router;
}

module.exports = { createInternalRouter, isValidInternalKey };
