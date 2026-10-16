/**
 * Warehouse Scope Utilities
 *
 * Which warehouses the calling user may read / write. The scope itself lives
 * in auth_db (user_warehouse_scopes) and is read through auth-service's
 * internal endpoint by @smartbook/shared/warehouse-scope - never through this
 * service's Prisma client, which has no such table.
 *
 * Fail-closed: a user without scope rows gets no warehouse, and when the scope
 * cannot be read (auth-service down, key missing) the request is refused
 * (503) instead of falling back to "every warehouse". Only a superuser (a
 * verified JWT claim) sees every active warehouse.
 */

const { PrismaClient } = require('@prisma/client');
const { createWarehouseScopeResolver, WarehouseScopeUnavailableError } = require('@smartbook/shared/warehouse-scope');

const prisma = new PrismaClient();

let resolver = createWarehouseScopeResolver();

/** Tests swap the resolver (no auth-service there). */
function setWarehouseScopeResolver(next) {
  resolver = next;
}

function isAdminUser(user) {
  return user?.is_superuser === true;
}

async function getAllActiveWarehouseIds() {
  const all = await prisma.warehouses.findMany({ select: { id: true }, where: { is_active: true } });
  return all.map((w) => w.id);
}

/** Warehouse IDs the user can read. Throws WarehouseScopeUnavailableError. */
async function getReadableWarehouseIds(user) {
  const scope = await resolver.resolve(user);
  if (scope.all) return getAllActiveWarehouseIds();
  return [...scope.read];
}

/** Warehouse IDs the user can write. Throws WarehouseScopeUnavailableError. */
async function getWritableWarehouseIds(user) {
  const scope = await resolver.resolve(user);
  if (scope.all) return getAllActiveWarehouseIds();
  return [...scope.write];
}

async function canReadWarehouse(user, warehouseId) {
  if (!warehouseId) return isAdminUser(user);
  return resolver.canRead(user, warehouseId);
}

async function canWriteWarehouse(user, warehouseId) {
  if (!warehouseId) return isAdminUser(user);
  return resolver.canWrite(user, warehouseId);
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
    message: `You do not have ${verb} access to this warehouse`,
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

/** null = no filter needed (superuser); otherwise the readable warehouse IDs. */
async function readableWarehouseFilter(user) {
  const scope = await resolver.resolve(user);
  return scope.all ? null : [...scope.read];
}

/**
 * Prisma `where` fragment that limits a list to the caller's readable
 * warehouses (Copilot 3.2): {} for a superuser, otherwise
 * { [field]: { in: ids } } - an empty scope lists nothing, never "all".
 * With several fields a row is kept when ANY of them is readable (a transfer
 * is visible to its source and its destination). `requested` is a
 * warehouse_id the client named; enforceRequestedWarehouseScope has already
 * checked it, so it only narrows. Throws WarehouseScopeUnavailableError.
 */
async function scopedWarehouseWhere(user, fields = 'warehouse_id', requested = null) {
  const list = Array.isArray(fields) ? fields : [fields];
  if (requested) {
    if (!(await canReadWarehouse(user, requested))) return { [list[0]]: { in: [] } };
    return list.length === 1 ? { [list[0]]: requested } : { OR: list.map((f) => ({ [f]: requested })) };
  }
  const readable = await readableWarehouseFilter(user);
  if (readable === null) return {};
  return list.length === 1 ? { [list[0]]: { in: readable } } : { OR: list.map((f) => ({ [f]: { in: readable } })) };
}

/** Express error tail for list endpoints: scope unavailable -> 503. */
function scopeErrorStatus(error) {
  return error instanceof WarehouseScopeUnavailableError ? 503 : 500;
}

async function filterReadableWarehouses(user, warehouseIds) {
  const scope = await resolver.resolve(user);
  if (scope.all) return warehouseIds;
  return warehouseIds.filter((id) => scope.read.has(id));
}

module.exports = {
  WarehouseScopeUnavailableError,
  isAdminUser,
  getReadableWarehouseIds,
  getWritableWarehouseIds,
  canReadWarehouse,
  canWriteWarehouse,
  requireWarehouseReadAccess,
  requireWarehouseWriteAccess,
  filterReadableWarehouses,
  readableWarehouseFilter,
  scopedWarehouseWhere,
  scopeErrorStatus,
  setWarehouseScopeResolver,
};
