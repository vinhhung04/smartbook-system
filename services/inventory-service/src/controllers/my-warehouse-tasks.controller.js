const { PrismaClient } = require('@prisma/client');
const { parseId } = require('../utils/validation');
const { readableWarehouseFilter, writableWarehouseFilter, scopeErrorStatus } = require('../utils/warehouse-scope.utils');

const prisma = new PrismaClient();

async function getAvailableTasks(req, res) {
  // Warehouse scope comes from auth-service (resolver), never from the token
  // or the query alone: no warehouse_id means "my readable warehouses", not
  // "every warehouse". A warehouse_id the client names was already checked
  // against the read scope by enforceRequestedWarehouseScope; it only narrows.
  // `claimable` is true only where the caller has WRITE scope - the claim
  // endpoints refuse everything else.
  const requestedWarehouseId = parseId(req.query.warehouse_id);
  let readable;
  let writable;
  try {
    [readable, writable] = await Promise.all([readableWarehouseFilter(req.user), writableWarehouseFilter(req.user)]);
  } catch (error) {
    return res.status(scopeErrorStatus(error)).json({ message: error.message, code: error.code });
  }
  const writableSet = writable === null ? null : new Set(writable);
  const canClaim = (warehouseId) => writableSet === null || writableSet.has(warehouseId);
  const inScope = (field) => {
    if (requestedWarehouseId) return { [field]: requestedWarehouseId };
    return readable === null ? {} : { [field]: { in: readable } };
  };

  try {
    const [
      pickingOutbound,
      pickingTransfer,
      outboundConfirmOutbound,
      outboundConfirmTransfer,
      transferReceiving,
    ] = await Promise.all([
      // 1. Outbound picking: APPROVED, chưa có picker
      prisma.outbound_orders.findMany({
        where: {
          status: 'APPROVED',
          processed_by_user_id: null,
          ...inScope('warehouse_id'),
        },
        select: {
          id: true,
          outbound_number: true,
          status: true,
          warehouse_id: true,
          external_reference: true,
          requested_at: true,
          created_at: true,
          warehouses: { select: { code: true, name: true } },
        },
        orderBy: { requested_at: 'asc' },
        take: 50,
      }),
      // 2. Transfer picking: APPROVED, chưa có picker
      prisma.transfer_orders.findMany({
        where: {
          status: 'APPROVED',
          shipped_by_user_id: null,
          ...inScope('from_warehouse_id'),
        },
        select: {
          id: true,
          transfer_number: true,
          status: true,
          from_warehouse_id: true,
          to_warehouse_id: true,
          requested_at: true,
          created_at: true,
          warehouses_transfer_orders_from_warehouse_idTowarehouses: { select: { code: true, name: true } },
          warehouses_transfer_orders_to_warehouse_idTowarehouses: { select: { code: true, name: true } },
        },
        orderBy: { requested_at: 'asc' },
        take: 50,
      }),
      // 3. Outbound confirmation (outbound_orders READY_FOR_OUTBOUND/READY_TO_SHIP, chưa có outbound assignee)
      // Excludes orders whose Packing task isn't COMPLETED yet — /confirm rejects those
      // with a 409 regardless, so surfacing them here as "claimable" just lets someone
      // claim a task they can't finish, mirroring the same guard listOutboundQueue uses.
      prisma.outbound_orders.findMany({
        where: {
          status: { in: ['READY_FOR_OUTBOUND', 'READY_TO_SHIP'] },
          outbound_assigned_user_id: null,
          packing_tasks: { some: { status: 'COMPLETED' } },
          ...inScope('warehouse_id'),
        },
        select: {
          id: true,
          outbound_number: true,
          status: true,
          warehouse_id: true,
          requested_at: true,
          created_at: true,
          warehouses: { select: { code: true, name: true } },
        },
        orderBy: { requested_at: 'asc' },
        take: 50,
      }),
      // 4. Outbound confirmation (transfer_orders READY_FOR_OUTBOUND, chưa có outbound assignee)
      prisma.transfer_orders.findMany({
        where: {
          status: 'READY_FOR_OUTBOUND',
          outbound_assigned_user_id: null,
          ...inScope('from_warehouse_id'),
        },
        select: {
          id: true,
          transfer_number: true,
          status: true,
          from_warehouse_id: true,
          to_warehouse_id: true,
          requested_at: true,
          created_at: true,
          warehouses_transfer_orders_from_warehouse_idTowarehouses: { select: { code: true, name: true } },
          warehouses_transfer_orders_to_warehouse_idTowarehouses: { select: { code: true, name: true } },
        },
        orderBy: { requested_at: 'asc' },
        take: 50,
      }),
      // 5. Transfer receiving: IN_TRANSIT, chưa có người nhận — filter by DESTINATION warehouse
      prisma.transfer_orders.findMany({
        where: {
          status: 'IN_TRANSIT',
          received_by_user_id: null,
          ...inScope('to_warehouse_id'),
        },
        select: {
          id: true,
          transfer_number: true,
          status: true,
          from_warehouse_id: true,
          to_warehouse_id: true,
          requested_at: true,
          created_at: true,
          warehouses_transfer_orders_from_warehouse_idTowarehouses: { select: { code: true, name: true } },
          warehouses_transfer_orders_to_warehouse_idTowarehouses: { select: { code: true, name: true } },
        },
        orderBy: { requested_at: 'asc' },
        take: 50,
      }),
    ]);

    function transferWarehouseLabel(order) {
      return [
        order.warehouses_transfer_orders_from_warehouse_idTowarehouses?.code,
        order.warehouses_transfer_orders_to_warehouse_idTowarehouses?.code,
      ]
        .filter(Boolean)
        .join(' -> ') || null;
    }

    function transferDirectionFields(order) {
      return {
        from_warehouse_name:
          order.warehouses_transfer_orders_from_warehouse_idTowarehouses?.name ?? null,
        to_warehouse_name:
          order.warehouses_transfer_orders_to_warehouse_idTowarehouses?.name ?? null,
      };
    }

    const tasks = [
      ...pickingOutbound.map((o) => {
        const isRepick = typeof o.external_reference === 'string' &&
          o.external_reference.startsWith('REPICK:');
        const parentOrderNumber = isRepick
          ? o.external_reference.replace('REPICK:', '')
          : null;
        return {
          id: o.id,
          type: 'PICKING',
          task_type: 'outbound',
          title: o.outbound_number,
          status: o.status,
          warehouse: o.warehouses?.code || o.warehouses?.name || null,
          warehouse_id: o.warehouse_id,
          is_repick: isRepick,
          parent_order_number: parentOrderNumber,
          created_at: o.created_at,
          completed_at: null,
          action_path: '/picking',
          claimable: canClaim(o.warehouse_id),
          claim_endpoint: `/api/picking/tasks/outbound/${o.id}/claim-self`,
        };
      }),
      ...pickingTransfer.map((o) => ({
        id: o.id,
        type: 'PICKING',
        task_type: 'transfer',
        title: o.transfer_number,
        status: o.status,
        warehouse: transferWarehouseLabel(o),
        warehouse_id: o.from_warehouse_id,
        created_at: o.created_at,
        completed_at: null,
        action_path: '/picking',
        claimable: canClaim(o.from_warehouse_id),
        claim_endpoint: `/api/picking/tasks/transfer/${o.id}/claim-self`,
        ...transferDirectionFields(o),
      })),
      ...outboundConfirmOutbound.map((o) => ({
        id: o.id,
        type: 'OUTBOUND',
        task_type: 'outbound',
        title: o.outbound_number,
        status: o.status,
        warehouse: o.warehouses?.code || o.warehouses?.name || null,
        warehouse_id: o.warehouse_id,
        created_at: o.created_at,
        completed_at: null,
        action_path: '/outbound',
        claimable: canClaim(o.warehouse_id),
        claim_endpoint: `/api/outbound/orders/outbound/${o.id}/claim-self`,
      })),
      ...outboundConfirmTransfer.map((o) => ({
        id: o.id,
        type: 'OUTBOUND',
        task_type: 'transfer',
        title: o.transfer_number,
        status: o.status,
        warehouse: transferWarehouseLabel(o),
        warehouse_id: o.from_warehouse_id,
        created_at: o.created_at,
        completed_at: null,
        action_path: '/outbound',
        claimable: canClaim(o.from_warehouse_id),
        claim_endpoint: `/api/outbound/orders/transfer/${o.id}/claim-self`,
        ...transferDirectionFields(o),
      })),
      ...transferReceiving.map((o) => ({
        id: o.id,
        type: 'TRANSFER_RECEIVING',
        task_type: 'transfer',
        title: o.transfer_number,
        status: o.status,
        warehouse: transferWarehouseLabel(o),
        warehouse_id: o.to_warehouse_id,
        created_at: o.created_at,
        completed_at: null,
        action_path: '/transfer-receiving',
        claimable: canClaim(o.to_warehouse_id),
        claim_endpoint: `/api/transfer-receiving/${o.id}/claim-self`,
        ...transferDirectionFields(o),
      })),
    ];

    return res.json({ data: tasks });
  } catch (error) {
    console.error('getAvailableTasks error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

module.exports = { getAvailableTasks };
