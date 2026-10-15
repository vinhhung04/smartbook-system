const { canReadWarehouse, canWriteWarehouse, WarehouseScopeUnavailableError } = require('../utils/warehouse-scope.utils');

// A warehouse id the client names is a claim to check, never a grant: every
// /api request that names one (path, query or body) must be inside the
// caller's scope - read scope for GET, write scope for anything that changes
// data (a transfer's destination only needs read: the source warehouse acts).
// Controllers that list without a warehouse filter still scope their own
// results (warehouse list, low stock, goods receipts, POs...).
//
// Not applied to library circulation (/api/borrow-integration: reservations,
// pickup, return - borrow-service calls it for readers at any branch, gated by
// borrow.* permissions) or to the book catalog.
const EXEMPT_PREFIXES = ['/api/borrow-integration', '/api/books', '/api/supplier-account'];
const READ_KEYS = ['warehouse_id', 'warehouseId', 'from_warehouse_id', 'to_warehouse_id'];
const WRITE_KEYS = ['warehouse_id', 'warehouseId', 'from_warehouse_id', 'source_warehouse_id'];
const WRITE_READ_KEYS = ['to_warehouse_id', 'destination_warehouse_id'];

function collect(source, keys) {
  const out = [];
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === 'string' && value.trim()) out.push(value.trim());
  }
  return out;
}

function pathWarehouseId(originalUrl) {
  const match = /^\/api\/warehouses\/([0-9a-f-]{36})(?:\/|$|\?)/i.exec(originalUrl || '');
  return match ? match[1] : null;
}

function enforceRequestedWarehouseScope() {
  return async (req, res, next) => {
    const url = req.originalUrl || '';
    if (!req.user || EXEMPT_PREFIXES.some((prefix) => url.startsWith(prefix))) return next();
    const isRead = req.method === 'GET' || req.method === 'HEAD';
    const pathId = pathWarehouseId(url);
    const readIds = collect(req.query, READ_KEYS);
    const writeIds = [];
    if (isRead) {
      if (pathId) readIds.push(pathId);
    } else {
      writeIds.push(...collect(req.body, WRITE_KEYS));
      readIds.push(...collect(req.body, WRITE_READ_KEYS));
      // /api/warehouses/:id writes are warehouse administration (superuser /
      // warehouse.write permission), checked by their own route guard.
    }
    try {
      for (const id of writeIds) {
        if (!(await canWriteWarehouse(req.user, id))) {
          return res.status(403).json({ message: 'You do not have write access to this warehouse', code: 'WAREHOUSE_ACCESS_DENIED' });
        }
      }
      for (const id of readIds) {
        if (!(await canReadWarehouse(req.user, id))) {
          return res.status(403).json({ message: 'You do not have read access to this warehouse', code: 'WAREHOUSE_ACCESS_DENIED' });
        }
      }
    } catch (error) {
      if (error instanceof WarehouseScopeUnavailableError) {
        return res.status(503).json({ message: error.message, code: error.code });
      }
      return next(error);
    }
    return next();
  };
}

module.exports = { enforceRequestedWarehouseScope, EXEMPT_PREFIXES };
