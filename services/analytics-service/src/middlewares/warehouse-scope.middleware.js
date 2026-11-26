const { createWarehouseScopeResolver, WarehouseScopeUnavailableError } = require('@smartbook/shared/warehouse-scope');

let resolver = createWarehouseScopeResolver();

/** Tests swap the resolver (no auth-service there). */
function setWarehouseScopeResolver(next) {
  resolver = next;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * req.warehouseScope for endpoints with per-warehouse rows:
 * null = no filter (internal service call with the service key, or superuser),
 * otherwise the Set of warehouse IDs the user may read - possibly empty.
 * `?warehouseId=` narrows a user's scope to that one warehouse (403 when it is not theirs).
 * Fail-closed: scope unreadable -> 503, never "all warehouses".
 */
function attachWarehouseScope() {
  return async (req, res, next) => {
    if (!req.user) {
      req.warehouseScope = null; // authenticateInternalOrUser let a service-key call through
      return next();
    }
    try {
      const scope = await resolver.resolve(req.user);
      req.warehouseScope = scope.all ? null : scope.read;
      const picked = String(req.query?.warehouseId || '').trim();
      if (picked) {
        if (!UUID_RE.test(picked)) return res.status(400).json({ message: 'Mã kho không hợp lệ', code: 'INVALID_WAREHOUSE_ID' });
        if (!inScope(req.warehouseScope, picked)) {
          return res.status(403).json({ message: 'Bạn không có quyền xem kho này', code: 'WAREHOUSE_OUT_OF_SCOPE' });
        }
        req.warehouseScope = new Set([picked]);
      }
      return next();
    } catch (error) {
      if (error instanceof WarehouseScopeUnavailableError) {
        return res.status(503).json({ message: error.message, code: error.code });
      }
      return next(error);
    }
  };
}

function inScope(scope, warehouseId) {
  return scope === null || scope === undefined || scope.has(String(warehouseId || ''));
}

/** For a warehouse a request names (e.g. ?priorityWarehouseId=): read scope or not.
 * Scope unreadable -> WarehouseScopeUnavailableError (503 via the error handler). */
async function canReadWarehouseScope(user, warehouseId) {
  return resolver.canRead(user, warehouseId);
}

/** {all, read, write} for a user - read AND write sets, for endpoints that say
 * which actions are executable. `fresh` skips the 30 s cache.
 * Scope unreadable -> WarehouseScopeUnavailableError (503 via the error handler). */
async function resolveWarehouseScope(user, options) {
  return resolver.resolve(user, options);
}

module.exports = { attachWarehouseScope, inScope, canReadWarehouseScope, resolveWarehouseScope, setWarehouseScopeResolver };
