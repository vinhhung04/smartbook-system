/**
 * Warehouse scope for the borrow domain (loans, reservations): which branches
 * (warehouse_id) a LIBRARIAN/ADMIN caller may read or write. Same source of
 * truth and resolver as inventory-service's warehouse-scope.utils.js
 * (auth_db.user_warehouse_scopes, read through auth-service's internal
 * endpoint) - borrow-service never had its own copy of this check before.
 *
 * Fail-closed: no scope rows -> no warehouse; auth-service unreachable ->
 * 503, never "every warehouse". Only a superuser (verified JWT claim) sees
 * every warehouse.
 */

const { createWarehouseScopeResolver, WarehouseScopeUnavailableError } = require('@smartbook/shared/warehouse-scope');

let resolver = createWarehouseScopeResolver();

/** Tests swap the resolver (no auth-service there). */
function setWarehouseScopeResolver(next) {
  resolver = next;
}

function isAdminUser(user) {
  return user?.is_superuser === true;
}

async function canReadWarehouse(user, warehouseId) {
  if (!warehouseId) return isAdminUser(user);
  return resolver.canRead(user, warehouseId);
}

async function canWriteWarehouse(user, warehouseId) {
  if (!warehouseId) return isAdminUser(user);
  return resolver.canWrite(user, warehouseId);
}

/** null = no filter needed (superuser); otherwise the readable warehouse IDs. */
async function readableWarehouseFilter(user) {
  const scope = await resolver.resolve(user);
  return scope.all ? null : [...scope.read];
}

/** Prisma `where` fragment limiting a list to the caller's readable branches. */
async function scopedWarehouseWhere(user) {
  const readable = await readableWarehouseFilter(user);
  return readable === null ? {} : { warehouse_id: { in: readable } };
}

function respondUnavailable(res, error) {
  res.status(503).json({ message: error.message, code: error.code });
  return false;
}

async function requireAccess(req, res, warehouseId, check, verb) {
  const user = req.user;
  if (!user) {
    res.status(401).json({ message: 'Authentication required' });
    return false;
  }
  try {
    if (await check(user, warehouseId)) return true;
  } catch (error) {
    if (error instanceof WarehouseScopeUnavailableError) return respondUnavailable(res, error);
    throw error;
  }
  res.status(403).json({
    message: `Bạn không có quyền ${verb === 'read' ? 'xem' : 'thao tác trên'} phiếu của kho/chi nhánh này`,
    code: 'WAREHOUSE_ACCESS_DENIED',
  });
  return false;
}

/** Usage: if (!(await requireWarehouseReadAccess(req, res, warehouseId))) return; */
async function requireWarehouseReadAccess(req, res, warehouseId) {
  return requireAccess(req, res, warehouseId, canReadWarehouse, 'read');
}

async function requireWarehouseWriteAccess(req, res, warehouseId) {
  return requireAccess(req, res, warehouseId, canWriteWarehouse, 'write');
}

function scopeErrorStatus(error) {
  return error instanceof WarehouseScopeUnavailableError ? 503 : 500;
}

module.exports = {
  WarehouseScopeUnavailableError,
  isAdminUser,
  canReadWarehouse,
  canWriteWarehouse,
  readableWarehouseFilter,
  scopedWarehouseWhere,
  requireWarehouseReadAccess,
  requireWarehouseWriteAccess,
  scopeErrorStatus,
  setWarehouseScopeResolver,
};
