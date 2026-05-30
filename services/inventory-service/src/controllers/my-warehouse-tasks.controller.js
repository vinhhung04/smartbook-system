const { PrismaClient } = require('@prisma/client');
const { parseId } = require('../utils/validation');

const prisma = new PrismaClient();

async function getAvailableTasks(req, res) {
  // Build permission scope inline (mirrors pattern used in other controllers)
  const roles = Array.isArray(req.user?.roles)
    ? req.user.roles.map((r) => String(r).toUpperCase())
    : [];
  const canManageAssignment =
    Boolean(req.user?.is_superuser) ||
    roles.includes('ADMIN') ||
    roles.includes('WAREHOUSE_MANAGER');

  // Warehouse scope: use warehouse_id from JWT if available, else from query param.
  // NOTE: Current JWT payload does not include warehouse_id. Until auth-service adds
  // primary_warehouse_id to the token, filtering relies on ?warehouse_id= query param.
  // Without a warehouse filter, all available tasks are returned (backward-compatible).
  const userWarehouseId = parseId(req.user?.warehouse_id);
  const queryWarehouseId = parseId(req.query.warehouse_id);
  const warehouseId = userWarehouseId || queryWarehouseId || null;

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
          ...(warehouseId ? { warehouse_id: warehouseId } : {}),
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
          ...(warehouseId ? { from_warehouse_id: warehouseId } : {}),
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
      prisma.outbound_orders.findMany({
        where: {
          status: { in: ['READY_FOR_OUTBOUND', 'READY_TO_SHIP'] },
          outbound_assigned_user_id: null,
          ...(warehouseId ? { warehouse_id: warehouseId } : {}),
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
          ...(warehouseId ? { from_warehouse_id: warehouseId } : {}),
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
          ...(warehouseId ? { to_warehouse_id: warehouseId } : {}),
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
          claimable: true,
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
        claimable: true,
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
        claimable: true,
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
        claimable: true,
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
        claimable: true,
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
