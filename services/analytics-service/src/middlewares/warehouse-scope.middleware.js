const { createWarehouseScopeResolver, WarehouseScopeUnavailableError } = require('@smartbook/shared/warehouse-scope');

let resolver = createWarehouseScopeResolver();

/** Tests swap the resolver (no auth-service there). */
function setWarehouseScopeResolver(next) {
  resolver = next;
}

/**
 * req.warehouseScope for endpoints with per-warehouse rows:
 * null = no filter (internal service call with the service key, or superuser),
 * otherwise the Set of warehouse IDs the user may read - possibly empty.
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

module.exports = { attachWarehouseScope, inScope, canReadWarehouseScope, setWarehouseScopeResolver };
