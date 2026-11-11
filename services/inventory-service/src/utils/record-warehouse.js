/**
 * Loaders for requireRecordWarehouse (middlewares/warehouse-scope.middleware.js):
 * each returns the STORED warehouse of the record a route acts on - the
 * warehouse that does the work - or undefined when the record does not exist.
 *
 * - outbound order          -> outbound_orders.warehouse_id
 * - transfer, pick / ship   -> transfer_orders.from_warehouse_id (source acts)
 * - transfer, receive       -> transfer_orders.to_warehouse_id (destination acts)
 * - packing task            -> packing_tasks.warehouse_id
 * - location (compartment)  -> locations.warehouse_id
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idOf(value) {
  const id = String(value || '').trim();
  return UUID_RE.test(id) ? id : null;
}

async function outboundWarehouse(id) {
  const row = await prisma.outbound_orders.findUnique({ where: { id }, select: { warehouse_id: true } });
  return row ? row.warehouse_id : undefined;
}

async function transferWarehouse(id, side) {
  const row = await prisma.transfer_orders.findUnique({
    where: { id },
    select: { from_warehouse_id: true, to_warehouse_id: true },
  });
  if (!row) return undefined;
  return side === 'to' ? row.to_warehouse_id : row.from_warehouse_id;
}

/** /:taskType/:taskId routes (picking, outbound) - `fixedType` for paths that name it. */
function taskOrderWarehouse(fixedType = null) {
  return async (req) => {
    const taskType = String(fixedType || req.params.taskType || '').toLowerCase();
    const taskId = idOf(req.params.taskId);
    if (!taskId) return undefined;
    if (taskType === 'outbound') return outboundWarehouse(taskId);
    if (taskType === 'transfer') return transferWarehouse(taskId, 'from');
    return undefined;
  };
}

/** /transfer-receiving/:id - the destination warehouse receives. */
async function transferDestinationWarehouse(req) {
  const id = idOf(req.params.id);
  return id ? transferWarehouse(id, 'to') : undefined;
}

async function packingTaskWarehouse(req) {
  const id = idOf(req.params.taskId);
  if (!id) return undefined;
  const row = await prisma.packing_tasks.findUnique({ where: { id }, select: { warehouse_id: true } });
  return row ? row.warehouse_id : undefined;
}

/** A path-param location id (receiving location or compartment). */
function locationWarehouse(param) {
  return async (req) => {
    const id = idOf(req.params[param]);
    if (!id) return undefined;
    const row = await prisma.locations.findUnique({ where: { id }, select: { warehouse_id: true } });
    return row ? row.warehouse_id : undefined;
  };
}

/** A path-param warehouse id outside /api/warehouses/:id (not caught by enforceRequestedWarehouseScope). */
function pathWarehouse(param) {
  return async (req) => idOf(req.params[param]) || undefined;
}

module.exports = {
  taskOrderWarehouse,
  transferDestinationWarehouse,
  packingTaskWarehouse,
  locationWarehouse,
  pathWarehouse,
};
