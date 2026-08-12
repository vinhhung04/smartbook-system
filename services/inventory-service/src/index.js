require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const {
  authenticateToken,
  authorizeAnyPermission,
  authorizeManagerDecision,
  authorizeManagerRead,
  authorizeTaskRead,
} = require('./middlewares/auth.middleware');

const prisma = new PrismaClient();
const bookRoutes = require('./routes/book.routes');
const warehouseRoutes = require('./routes/warehouse.routes');
const locationRoutes = require('./routes/location.routes');
const goodsReceiptRoutes = require('./routes/goods-receipt.routes');
const stockMovementRoutes = require('./routes/stock-movement.routes');
const borrowIntegrationRoutes = require('./routes/borrow-integration.routes');
const putawayRoutes = require('./routes/putaway.routes');
const shelfRoutes = require('./routes/shelf.routes');
const receivingPutawayRoutes = require('./routes/receiving-putaway.routes');
const pickingRoutes = require('./routes/picking.routes');
const packingRoutes = require('./routes/packing.routes');
const orderRequestRoutes = require('./routes/order-request.routes');
const outboundRoutes = require('./routes/outbound.routes');
const supplierRoutes = require('./routes/supplier.routes');
const receivingSmartRoutes = require('./routes/receiving-smart.routes');
const storageSuggestionRoutes = require('./routes/storage-suggestion.routes');
const reslottingSuggestionRoutes = require('./routes/reslotting-suggestion.routes');
const purchaseOrderRoutes = require('./routes/purchase-order.routes');
const supplierDeliveryRoutes = require('./routes/supplier-delivery.routes');
const supplierPortalRoutes = require('./routes/supplier-portal.routes');
const supplierAccountRoutes = require('./routes/supplier-account.routes');
const purchaseRequestRoutes = require('./routes/purchase-request.routes');
const exceptionReportRoutes = require('./routes/exception-report.routes');
const staffTaskRoutes = require('./routes/staff-task.routes');
const transferReceivingRoutes = require('./routes/transfer-receiving.routes');
const myWarehouseTasksRoutes = require('./routes/my-warehouse-tasks.routes');
const stockAlertRoutes = require('./routes/stock-alert.routes');
const stockBalanceRoutes = require('./routes/stock-balance.routes');
const stockAuditRoutes = require('./routes/stock-audit.routes');
const metadataReconciliationRoutes = require('./routes/metadata-reconciliation.routes');
const duplicateIntelligenceRoutes = require('./routes/duplicate-intelligence.routes');
const { startAgingInventoryJob } = require('./jobs/aging-inventory.job');

const app = express();
const PORT = process.env.PORT || 3001;
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || '8mb';

app.use(cors());
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));

app.get('/health', (_req, res) => {
  res.json({ service: 'inventory-service', status: 'ok' });
});

// Demo supplier portal is token-scoped and intentionally does not use internal RBAC.
app.use('/api/supplier-portal', supplierPortalRoutes);

// Only API routes require JWT.
app.use('/api', authenticateToken);

app.get('/api/my-warehouse-tasks', authorizeTaskRead(['inventory.task.read']), async (req, res) => {
  const userId = req.user?.id || req.user?.sub;

  if (!userId) {
    return res.status(401).json({ message: 'Invalid current user context' });
  }

  try {
    const [goodsReceipts, outboundOrders, transferOrders, transferReceivingOrders, purchaseRequests, exceptionReports, staffTasks] = await Promise.all([
      prisma.goods_receipts.findMany({
        where: { received_by_user_id: userId },
        select: {
          id: true,
          receipt_number: true,
          status: true,
          warehouse_id: true,
          received_at: true,
          created_at: true,
          warehouses: { select: { code: true, name: true } },
        },
        orderBy: { created_at: 'desc' },
        take: 20,
      }),
      prisma.outbound_orders.findMany({
        where: {
          OR: [
            { outbound_assigned_user_id: userId },
            { AND: [{ outbound_assigned_user_id: null }, { processed_by_user_id: userId }] },
          ],
          // Exclude terminal statuses — completed/cancelled orders are history, not active tasks.
          // Picking page only shows APPROVED/PICKING; outbound page shows up to READY_TO_SHIP.
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
        },
        select: {
          id: true,
          outbound_number: true,
          status: true,
          warehouse_id: true,
          external_reference: true,
          requested_at: true,
          completed_at: true,
          warehouses: { select: { code: true, name: true } },
        },
        orderBy: { requested_at: 'desc' },
        take: 20,
      }),
      prisma.transfer_orders.findMany({
        where: {
          OR: [
            { outbound_assigned_user_id: userId },
            { AND: [{ outbound_assigned_user_id: null }, { shipped_by_user_id: userId }] },
          ],
          // Exclude terminal statuses — IN_TRANSIT/RECEIVED/CANCELLED are past the active phase.
          // Picking page: APPROVED/PICKING. Outbound page: READY_FOR_OUTBOUND/REPICKING.
          status: { notIn: ['IN_TRANSIT', 'RECEIVED', 'CANCELLED'] },
        },
        select: {
          id: true,
          transfer_number: true,
          status: true,
          from_warehouse_id: true,
          to_warehouse_id: true,
          requested_at: true,
          shipped_at: true,
          received_at: true,
          warehouses_transfer_orders_from_warehouse_idTowarehouses: { select: { code: true, name: true } },
          warehouses_transfer_orders_to_warehouse_idTowarehouses: { select: { code: true, name: true } },
        },
        orderBy: { requested_at: 'desc' },
        take: 20,
      }),
      prisma.transfer_orders.findMany({
        where: {
          status: 'IN_TRANSIT',
          received_by_user_id: userId,
        },
        select: {
          id: true,
          transfer_number: true,
          status: true,
          from_warehouse_id: true,
          to_warehouse_id: true,
          requested_at: true,
          shipped_at: true,
          received_at: true,
          warehouses_transfer_orders_from_warehouse_idTowarehouses: { select: { code: true, name: true } },
          warehouses_transfer_orders_to_warehouse_idTowarehouses: { select: { code: true, name: true } },
        },
        orderBy: { shipped_at: 'desc' },
        take: 20,
      }),
      prisma.purchase_requests.findMany({
        where: { created_by_user_id: userId },
        select: {
          id: true,
          request_number: true,
          status: true,
          reason: true,
          quantity_requested: true,
          warehouse_id: true,
          created_at: true,
          approved_at: true,
          rejected_at: true,
          warehouses: { select: { code: true, name: true } },
        },
        orderBy: { created_at: 'desc' },
        take: 20,
      }),
      prisma.warehouse_exception_reports.findMany({
        where: {
          OR: [
            { assigned_to_user_id: userId },
            { created_by_user_id: userId },
          ],
        },
        select: {
          id: true,
          report_number: true,
          status: true,
          exception_type: true,
          task_type: true,
          warehouse_id: true,
          created_at: true,
          resolved_at: true,
          assigned_to_user_id: true,
          warehouses: { select: { code: true, name: true } },
        },
        orderBy: { created_at: 'desc' },
        take: 20,
      }),
      prisma.staff_tasks.findMany({
        where: { assignee_user_id: userId },
        select: {
          id: true,
          title: true,
          status: true,
          task_type: true,
          priority: true,
          warehouse_id: true,
          due_date: true,
          completed_at: true,
          created_at: true,
          warehouses: { select: { code: true, name: true } },
        },
        orderBy: { created_at: 'desc' },
        take: 20,
      }),
    ]);

    // Deduplicate exception reports (a user might be both creator and assignee)
    const seenExceptionIds = new Set();
    const dedupedExceptionReports = exceptionReports.filter((r) => {
      if (seenExceptionIds.has(r.id)) return false;
      seenExceptionIds.add(r.id);
      return true;
    });

    const tasks = [
      ...goodsReceipts.map((task) => ({
        id: task.id,
        type: task.status === 'POSTED' ? 'PUTAWAY' : 'RECEIVING',
        title: task.receipt_number,
        status: task.status,
        warehouse: task.warehouses?.code || task.warehouses?.name || null,
        created_at: task.created_at,
        completed_at: task.received_at,
        action_path: task.status === 'POSTED' ? `/putaway` : `/orders/${task.id}`,
      })),
      ...outboundOrders.map((task) => {
        const isOutboundPhase = ['READY_FOR_OUTBOUND', 'READY_TO_SHIP'].includes(task.status);
        const isRepick = typeof task.external_reference === 'string' &&
          task.external_reference.startsWith('REPICK:');
        return {
          id: task.id,
          type: isOutboundPhase ? 'OUTBOUND' : 'PICKING',
          title: task.outbound_number,
          status: task.status,
          warehouse: task.warehouses?.code || task.warehouses?.name || null,
          is_repick: isRepick,
          parent_order_number: isRepick
            ? task.external_reference.replace('REPICK:', '')
            : null,
          created_at: task.requested_at,
          completed_at: task.completed_at,
          action_path: isOutboundPhase ? '/outbound' : '/picking',
        };
      }),
      ...transferOrders.map((task) => ({
        id: task.id,
        type: ['READY_FOR_OUTBOUND', 'IN_TRANSIT'].includes(task.status) ? 'OUTBOUND' : 'PICKING',
        title: task.transfer_number,
        status: task.status,
        warehouse: [
          task.warehouses_transfer_orders_from_warehouse_idTowarehouses?.code,
          task.warehouses_transfer_orders_to_warehouse_idTowarehouses?.code,
        ].filter(Boolean).join(' -> ') || null,
        created_at: task.requested_at,
        completed_at: task.received_at || task.shipped_at,
        action_path: task.status === 'READY_FOR_OUTBOUND' ? '/outbound' : '/picking',
      })),
      ...transferReceivingOrders.map((task) => ({
        id: task.id,
        type: 'TRANSFER_RECEIVING',
        title: task.transfer_number,
        status: task.status,
        warehouse: [
          task.warehouses_transfer_orders_from_warehouse_idTowarehouses?.code,
          task.warehouses_transfer_orders_to_warehouse_idTowarehouses?.code,
        ].filter(Boolean).join(' -> ') || null,
        created_at: task.requested_at,
        completed_at: task.received_at,
        action_path: '/transfer-receiving',
      })),
      ...purchaseRequests.map((task) => ({
        id: task.id,
        type: 'PURCHASE_REQUEST',
        title: task.request_number,
        status: task.status,
        warehouse: task.warehouses?.code || task.warehouses?.name || null,
        created_at: task.created_at,
        completed_at: task.approved_at || task.rejected_at,
        action_path: `/my-purchase-requests`,
      })),
      ...dedupedExceptionReports.map((task) => ({
        id: task.id,
        type: 'EXCEPTION_REPORT',
        title: task.report_number,
        status: task.status,
        warehouse: task.warehouses?.code || task.warehouses?.name || null,
        created_at: task.created_at,
        completed_at: task.resolved_at,
        action_path: `/my-exception-reports`,
      })),
      ...staffTasks.map((task) => ({
        id: task.id,
        type: 'STAFF_TASK',
        title: task.title,
        status: task.status,
        warehouse: task.warehouses?.code || task.warehouses?.name || null,
        created_at: task.created_at,
        completed_at: task.completed_at,
        action_path: `/staff-tasks`,
      })),
    ].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());

    const summary = tasks.reduce((acc, task) => {
      const type = String(task.type || 'OTHER').toLowerCase();
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});

    return res.json({ data: tasks, summary });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/receiving-context/warehouses', authorizeTaskRead(['inventory.task.read']), async (_req, res) => {
  try {
    const warehouses = await prisma.warehouses.findMany({
      where: { is_active: true },
      select: {
        id: true,
        code: true,
        name: true,
      },
      orderBy: { code: 'asc' },
    });

    return res.json({ data: warehouses });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

app.use('/api/my-warehouse-tasks', myWarehouseTasksRoutes);

app.use('/api/books', bookRoutes);
app.use('/api/warehouses', warehouseRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/goods-receipts', goodsReceiptRoutes);
app.use('/api/stock-movements', stockMovementRoutes);
app.use('/api/borrow-integration', borrowIntegrationRoutes);
app.use('/api/putaway', putawayRoutes);
app.use('/api/shelves', shelfRoutes);
app.use('/api/receiving-putaway', receivingPutawayRoutes);
app.use('/api/picking', pickingRoutes);
app.use('/api/packing', packingRoutes);
app.use('/api/order-requests', orderRequestRoutes);
app.use('/api/outbound', outboundRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/receiving-smart', receivingSmartRoutes);
app.use('/api/storage-suggestions', storageSuggestionRoutes);
app.use('/api/reslotting-suggestions', reslottingSuggestionRoutes);
app.use('/api/purchase-orders', purchaseOrderRoutes);
app.use('/api/supplier-deliveries', supplierDeliveryRoutes);
app.use('/api/supplier-account', supplierAccountRoutes);
app.use('/api/purchase-requests', purchaseRequestRoutes);
app.use('/api/stock-alerts', stockAlertRoutes);
app.use('/api/stock-balances', stockBalanceRoutes);
app.use('/api/stock-audits', stockAuditRoutes);
app.use('/api/metadata-reconciliations', metadataReconciliationRoutes);
app.use('/api/duplicate-intelligence', duplicateIntelligenceRoutes);
app.use('/api/exception-reports', exceptionReportRoutes);
app.use('/api/staff-tasks', staffTaskRoutes);
app.use('/api/transfer-receiving', transferReceivingRoutes);

// ─── GET /api/inventory ──────────────────────────────────────────────────────
// Lấy danh sách toàn bộ sách kèm variants, số lượng tồn kho và vị trí kệ
app.get('/api/inventory', authorizeManagerRead(['inventory.stock.read']), async (req, res) => {
  try {
    const books = await prisma.books.findMany({
      include: {
        book_variants: {
          include: {
            stock_balances: {
              include: {
                locations: {
                  select: {
                    id: true,
                    location_code: true,
                    location_type: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    res.json(books);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/inventory/inbound ─────────────────────────────────────────────
// Nhập kho: cộng số lượng vào Inventory và ghi log StockMovement (type: IN)
app.post('/api/inventory/inbound', authorizeManagerDecision(['inventory.stock.adjust']), async (req, res) => {
  const { variantId, locationId, warehouseId, quantity, unitCost } = req.body;

  if (!variantId || !locationId || !warehouseId || !quantity || quantity <= 0) {
    return res.status(400).json({ error: 'variantId, locationId, warehouseId và quantity (> 0) là bắt buộc' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Upsert: nếu đã có bản ghi với cùng variant_id + location_id thì cộng thêm; nếu chưa thì tạo mới
      const inventory = await tx.stock_balances.upsert({
        where: {
          variant_id_location_id: { variant_id: variantId, location_id: locationId },
        },
        update: {
          on_hand_qty: { increment: quantity },
          available_qty: { increment: quantity },
        },
        create: {
          variant_id: variantId,
          location_id: locationId,
          warehouse_id: warehouseId,
          on_hand_qty: quantity,
          available_qty: quantity,
        },
      });

      const movement = await tx.stock_movements.create({
        data: {
          movement_number: `IN-${Date.now()}`,
          movement_type: 'IN',
          warehouse_id: warehouseId,
          variant_id: variantId,
          to_location_id: locationId,
          quantity,
          unit_cost: unitCost || 0,
          source_service: 'inventory-service',
        },
      });

      return { inventory, movement };
    });

    res.status(201).json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/inventory/outbound ────────────────────────────────────────────
// Xuất kho: trừ số lượng tồn và ghi log StockMovement (type: OUT)
app.post('/api/inventory/outbound', authorizeManagerDecision(['inventory.stock.adjust']), async (req, res) => {
  const { variantId, locationId, warehouseId, quantity } = req.body;

  if (!variantId || !locationId || !warehouseId || !quantity || quantity <= 0) {
    return res.status(400).json({ error: 'variantId, locationId, warehouseId và quantity (> 0) là bắt buộc' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const inventory = await tx.stock_balances.findUnique({
        where: {
          variant_id_location_id: { variant_id: variantId, location_id: locationId },
        },
      });

      if (!inventory) {
        const err = new Error('Không tìm thấy bản ghi tồn kho cho variant và vị trí này');
        err.statusCode = 400;
        throw err;
      }

      if (inventory.on_hand_qty < quantity) {
        const err = new Error(
          `Số lượng tồn kho không đủ. Hiện có: ${inventory.on_hand_qty}, yêu cầu xuất: ${quantity}`
        );
        err.statusCode = 400;
        throw err;
      }

      const updated = await tx.stock_balances.update({
        where: { id: inventory.id },
        data: {
          on_hand_qty: { decrement: quantity },
          available_qty: { decrement: quantity },
        },
      });

      const movement = await tx.stock_movements.create({
        data: {
          movement_number: `OUT-${Date.now()}`,
          movement_type: 'OUT',
          warehouse_id: warehouseId,
          variant_id: variantId,
          from_location_id: locationId,
          quantity,
          source_service: 'inventory-service',
        },
      });

      return { inventory: updated, movement };
    });

    res.json(result);
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({ error: error.message });
    }
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Return JSON for oversized request payloads (e.g. base64 cover image uploads).
app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({
      message: `Payload quá lớn. Vui lòng dùng ảnh nhỏ hơn hoặc nén ảnh trước khi upload (giới hạn hiện tại: ${JSON_BODY_LIMIT}).`,
    });
  }

  return next(err);
});

// ─── Start server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Inventory Service running on http://localhost:${PORT}`);
  startAgingInventoryJob();
});
