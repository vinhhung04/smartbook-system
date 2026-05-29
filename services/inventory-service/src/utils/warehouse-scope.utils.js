/**
 * Warehouse Scope Utilities
 *
 * Helper functions for checking user warehouse access.
 * Users can only access warehouses they have scope to, unless they are superusers.
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/**
 * Check if user is admin/superuser
 */
function isAdminUser(user) {
  return user?.is_superuser === true;
}

/**
 * Get list of warehouse IDs that user can read
 */
async function getAllActiveWarehouseIds() {
  const all = await prisma.warehouses.findMany({ select: { id: true }, where: { is_active: true } });
  return all.map((w) => w.id);
}

async function getReadableWarehouseIds(user) {
  if (isAdminUser(user)) return getAllActiveWarehouseIds();

  // user_warehouse_scopes table may not exist yet — grant full access as fallback
  if (!prisma.user_warehouse_scopes) return getAllActiveWarehouseIds();

  const scopes = await prisma.user_warehouse_scopes.findMany({
    where: { user_id: user?.id },
    select: { warehouse_id: true, access_level: true },
  });

  // If user has no scope entries, grant access to all warehouses
  if (!scopes.length) return getAllActiveWarehouseIds();

  return scopes
    .filter((s) => ['FULL', 'READ_ONLY', 'READ'].includes(s.access_level))
    .map((s) => s.warehouse_id);
}

/**
 * Get list of warehouse IDs that user can write
 */
async function getWritableWarehouseIds(user) {
  if (isAdminUser(user)) return getAllActiveWarehouseIds();

  // user_warehouse_scopes table may not exist yet — grant full access as fallback
  if (!prisma.user_warehouse_scopes) return getAllActiveWarehouseIds();

  const scopes = await prisma.user_warehouse_scopes.findMany({
    where: {
      user_id: user?.id,
      access_level: { in: ['FULL', 'WRITE'] },
    },
    select: { warehouse_id: true },
  });

  // If user has no scope entries, grant access to all warehouses
  if (!scopes.length) return getAllActiveWarehouseIds();

  return scopes.map((s) => s.warehouse_id);
}

/**
 * Check if user can read a specific warehouse
 */
async function canReadWarehouse(user, warehouseId) {
  if (isAdminUser(user)) return true;

  const readable = await getReadableWarehouseIds(user);
  return readable.includes(warehouseId);
}

/**
 * Check if user can write to a specific warehouse
 */
async function canWriteWarehouse(user, warehouseId) {
  if (isAdminUser(user)) return true;

  const writable = await getWritableWarehouseIds(user);
  return writable.includes(warehouseId);
}

/**
 * Middleware helper: Require read access to a warehouse
 * Usage: await requireWarehouseReadAccess(req, res, warehouseId)
 */
async function requireWarehouseReadAccess(req, res, warehouseId) {
  const user = req.user;

  if (!user) {
    res.status(401).json({ message: 'Authentication required' });
    return false;
  }

  if (isAdminUser(user)) {
    return true;
  }

  const canRead = await canReadWarehouse(user, warehouseId);
  if (!canRead) {
    res.status(403).json({
      message: 'You do not have read access to this warehouse',
      code: 'WAREHOUSE_ACCESS_DENIED',
    });
    return false;
  }

  return true;
}

/**
 * Middleware helper: Require write access to a warehouse
 * Usage: await requireWarehouseWriteAccess(req, res, warehouseId)
 */
async function requireWarehouseWriteAccess(req, res, warehouseId) {
  const user = req.user;

  if (!user) {
    res.status(401).json({ message: 'Authentication required' });
    return false;
  }

  if (isAdminUser(user)) {
    return true;
  }

  const canWrite = await canWriteWarehouse(user, warehouseId);
  if (!canWrite) {
    res.status(403).json({
      message: 'You do not have write access to this warehouse',
      code: 'WAREHOUSE_ACCESS_DENIED',
    });
    return false;
  }

  return true;
}

/**
 * Filter warehouse IDs based on user's readable warehouses
 */
async function filterReadableWarehouses(user, warehouseIds) {
  if (isAdminUser(user)) return warehouseIds;

  const readable = await getReadableWarehouseIds(user);
  return warehouseIds.filter((id) => readable.includes(id));
}

module.exports = {
  isAdminUser,
  getReadableWarehouseIds,
  getWritableWarehouseIds,
  canReadWarehouse,
  canWriteWarehouse,
  requireWarehouseReadAccess,
  requireWarehouseWriteAccess,
  filterReadableWarehouses,
};
