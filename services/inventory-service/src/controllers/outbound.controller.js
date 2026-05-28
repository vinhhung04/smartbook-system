const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const { SHIPPING_LOCATION_TYPE } = require("../utils/constants");
const {
  parseId,
  normalizeText,
  normalizeRequiredUserId,
  normalizeOptionalUserId,
} = require("../utils/validation");
const { createMovementNumber } = require("../utils/inventory");
const { toSerializableError } = require("../utils/inventory");
const {
  resolveOrCreateShippingLocation,
  resolveOrCreateReceivingLocation,
} = require("../utils/locations");

function normalizeTaskType(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "outbound" || normalized === "transfer") return normalized;
  return null;
}

function getTaskPermissionScope(user = {}) {
  const roles = Array.isArray(user.roles)
    ? user.roles.map((role) => String(role).toUpperCase())
    : [];

  return {
    currentUserId: parseId(user.id || user.sub),
    canManageAssignment:
      Boolean(user.is_superuser) ||
      roles.includes("ADMIN") ||
      roles.includes("MANAGER"),
  };
}

function canAccessAssignedTask(user, assignedUserId) {
  const scope = getTaskPermissionScope(user);
  if (scope.canManageAssignment) return true;
  const assigned = parseId(assignedUserId);
  return Boolean(scope.currentUserId && assigned && assigned === scope.currentUserId);
}

function createReceiptNumber(baseTimestamp) {
  const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `GR-TR-${baseTimestamp}-${suffix}`;
}

function createTransferMovementNumber(baseTimestamp, index) {
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `MV-TR-${baseTimestamp}-${index + 1}-${suffix}`;
}

async function postTransferReceiptToReceiving(tx, goodsReceipt, userId) {
  const existingMovementCount = await tx.stock_movements.count({
    where: {
      reference_type: "GOODS_RECEIPT",
      reference_id: goodsReceipt.id,
    },
  });

  if (existingMovementCount > 0) {
    return;
  }

  const receivingLocation = await resolveOrCreateReceivingLocation(
    tx,
    goodsReceipt.warehouse_id,
  );

  const items = await tx.goods_receipt_items.findMany({
    where: { goods_receipt_id: goodsReceipt.id },
    select: {
      variant_id: true,
      quantity: true,
      unit_cost: true,
    },
  });

  if (items.length === 0) {
    return;
  }

  const aggregateMap = new Map();
  items.forEach((item) => {
    const key = String(item.variant_id);
    const current = aggregateMap.get(key);
    if (!current) {
      aggregateMap.set(key, {
        variant_id: item.variant_id,
        quantity: Number(item.quantity || 0),
      });
      return;
    }
    current.quantity += Number(item.quantity || 0);
  });

  const aggregatedItems = Array.from(aggregateMap.values());

  for (const item of aggregatedItems) {
    const existingRows = await tx.$queryRawUnsafe(
      `SELECT id, on_hand_qty FROM stock_balances
       WHERE variant_id::text = $1 AND location_id::text = $2
       FOR UPDATE`,
      item.variant_id,
      receivingLocation.id,
    );
    const existingList = Array.isArray(existingRows) ? existingRows : [];

    if (existingList.length > 0) {
      await tx.$queryRawUnsafe(
        `UPDATE stock_balances
         SET on_hand_qty = on_hand_qty + $1,
             available_qty = 0,
             version = version + 1,
             last_movement_at = NOW()
         WHERE variant_id::text = $2 AND location_id::text = $3`,
        item.quantity,
        item.variant_id,
        receivingLocation.id,
      );
    } else {
      await tx.$queryRawUnsafe(
        `INSERT INTO stock_balances
           (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, version, last_movement_at)
         VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4, 0, 1, NOW())`,
        goodsReceipt.warehouse_id,
        item.variant_id,
        receivingLocation.id,
        item.quantity,
      );
    }
  }

  const baseTimestamp = Date.now();
  await tx.stock_movements.createMany({
    data: items.map((item, index) => ({
      movement_number: createTransferMovementNumber(baseTimestamp, index),
      movement_type: "INBOUND",
      movement_status: "POSTED",
      warehouse_id: goodsReceipt.warehouse_id,
      variant_id: item.variant_id,
      to_location_id: receivingLocation.id,
      quantity: item.quantity,
      unit_cost: Number(item.unit_cost || 0),
      source_service: "INVENTORY_SERVICE",
      reference_type: "GOODS_RECEIPT",
      reference_id: goodsReceipt.id,
      created_by_user_id: userId,
      metadata: {
        source_type: "TRANSFER",
        bucket: "RECEIVING_HOLD",
      },
    })),
  });
}

async function listOutboundQueue(req, res) {
  const warehouseId = parseId(req.query.warehouse_id);
  const scope = getTaskPermissionScope(req.user || {});

  // Staff sees tasks where they are the outbound assignee.
  // Backward compat: if outbound_assigned_user_id is null, fall back to processed_by_user_id / shipped_by_user_id.
  const outboundAssignment = scope.canManageAssignment
    ? {}
    : {
        OR: [
          { outbound_assigned_user_id: scope.currentUserId },
          {
            AND: [
              { outbound_assigned_user_id: null },
              { processed_by_user_id: scope.currentUserId },
            ],
          },
        ],
      };

  const transferAssignment = scope.canManageAssignment
    ? {}
    : {
        OR: [
          { outbound_assigned_user_id: scope.currentUserId },
          {
            AND: [
              { outbound_assigned_user_id: null },
              { shipped_by_user_id: scope.currentUserId },
            ],
          },
        ],
      };

  // Statuses visible in the outbound queue — includes orders still being picked/repicked
  const OUTBOUND_VISIBLE_STATUSES = [
    "APPROVED",
    "PICKING",
    "PARTIAL_PICKED",
    "REPICKING",
    "READY_FOR_OUTBOUND",
    "READY_TO_SHIP",
  ];

  try {
    const [outboundOrders, transferOrders, pickingTasksMeta] = await Promise.all([
      prisma.outbound_orders.findMany({
        where: {
          status: { in: OUTBOUND_VISIBLE_STATUSES },
          ...(warehouseId ? { warehouse_id: warehouseId } : {}),
          ...outboundAssignment,
        },
        include: {
          warehouses: { select: { id: true, code: true, name: true } },
          outbound_order_items: {
            select: { quantity: true, processed_qty: true },
          },
        },
        orderBy: { updated_at: "asc" },
      }),
      prisma.transfer_orders.findMany({
        where: {
          status: "READY_FOR_OUTBOUND",
          ...(warehouseId ? { from_warehouse_id: warehouseId } : {}),
          ...transferAssignment,
        },
        include: {
          warehouses_transfer_orders_from_warehouse_idTowarehouses: {
            select: { id: true, code: true, name: true },
          },
          warehouses_transfer_orders_to_warehouse_idTowarehouses: {
            select: { id: true, code: true, name: true },
          },
          transfer_order_items: {
            select: { quantity: true, shipped_qty: true },
          },
        },
        orderBy: { updated_at: "asc" },
      }),
      // Aggregate picking_tasks (PICK + REPICK) per root outbound order
      // Only query PICK tasks as root; REPICK tasks are loaded via child_tasks.
      prisma.picking_tasks.findMany({
        where: {
          picking_type: "PICK",
          ...(warehouseId ? { warehouse_id: warehouseId } : {}),
        },
        select: {
          id: true,
          root_order_id: true,
          status: true,
          _count: { select: { child_tasks: true } },
          // PICK task's own items
          picking_task_items: {
            select: { requested_qty: true, picked_qty: true, short_qty: true },
          },
          // REPICK child tasks + their items for aggregate
          child_tasks: {
            select: {
              id: true,
              status: true,
              picking_type: true,
              picking_task_items: {
                select: { requested_qty: true, picked_qty: true, short_qty: true },
              },
            },
          },
        },
      }),
    ]);

    // Build lookup: outbound_order_id → picking meta
    // Aggregate picked_qty across PICK task + ALL REPICK child tasks.
    const pickingMetaByOrder = new Map();
    for (const pt of pickingTasksMeta) {
      const repickCount = pt._count.child_tasks;
      const activeRepicks = (pt.child_tasks || []).filter(
        (c) => !["COMPLETED", "CANCELLED"].includes(c.status),
      ).length;

      // Sum across PICK items
      const pickRequested = pt.picking_task_items.reduce((s, i) => s + i.requested_qty, 0);
      const pickPicked = pt.picking_task_items.reduce((s, i) => s + i.picked_qty, 0);

      // Sum across all REPICK child items
      const repickPicked = (pt.child_tasks || []).flatMap((c) => c.picking_task_items || [])
        .reduce((s, i) => s + i.picked_qty, 0);

      pickingMetaByOrder.set(pt.root_order_id, {
        picking_task_id: pt.id,
        pick_status: pt.status,
        repick_count: repickCount,
        active_repick_count: activeRepicks,
        aggregate_requested_qty: pickRequested,
        // Total fulfilled = PICK picked + REPICK picked (additive, not double-counted)
        aggregate_picked_qty: pickPicked + repickPicked,
      });
    }

    const data = [
      ...outboundOrders.map((order) => {
        const ptMeta = pickingMetaByOrder.get(order.id);
        return {
          task_type: "outbound",
          task_id: order.id,
          order_number: order.outbound_number,
          status: order.status,
          source_warehouse_id: order.warehouse_id,
          source_warehouse_code: order.warehouses?.code || null,
          source_warehouse_name: order.warehouses?.name || null,
          target_warehouse_id: null,
          target_warehouse_code: null,
          target_warehouse_name: null,
          outbound_assigned_user_id: order.outbound_assigned_user_id || null,
          total_quantity: (order.outbound_order_items || []).reduce(
            (sum, line) => sum + Number(line.quantity || 0),
            0,
          ),
          ready_quantity: ptMeta?.aggregate_picked_qty
            ?? (order.outbound_order_items || []).reduce(
              (sum, line) => sum + Number(line.processed_qty || 0),
              0,
            ),
          picking_task_id: ptMeta?.picking_task_id || null,
          repick_count: ptMeta?.repick_count || 0,
          active_repick_count: ptMeta?.active_repick_count || 0,
        };
      }),
      ...transferOrders.map((order) => ({
        task_type: "transfer",
        task_id: order.id,
        order_number: order.transfer_number,
        status: order.status,
        source_warehouse_id: order.from_warehouse_id,
        source_warehouse_code:
          order.warehouses_transfer_orders_from_warehouse_idTowarehouses
            ?.code || null,
        source_warehouse_name:
          order.warehouses_transfer_orders_from_warehouse_idTowarehouses
            ?.name || null,
        target_warehouse_id: order.to_warehouse_id,
        target_warehouse_code:
          order.warehouses_transfer_orders_to_warehouse_idTowarehouses?.code ||
          null,
        target_warehouse_name:
          order.warehouses_transfer_orders_to_warehouse_idTowarehouses?.name ||
          null,
        outbound_assigned_user_id: order.outbound_assigned_user_id || null,
        total_quantity: (order.transfer_order_items || []).reduce(
          (sum, line) => sum + Number(line.quantity || 0),
          0,
        ),
        ready_quantity: (order.transfer_order_items || []).reduce(
          (sum, line) => sum + Number(line.shipped_qty || 0),
          0,
        ),
      })),
    ];

    return res.json({ data });
  } catch (error) {
    console.error("Error while listing outbound queue:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function getOutboundOrderDetail(req, res) {
  const taskType = normalizeTaskType(req.params.taskType);
  const taskId = parseId(req.params.taskId);

  if (!taskType || !taskId) {
    return res.status(400).json({ message: "Invalid taskType or taskId" });
  }

  try {
    if (taskType === "outbound") {
      const order = await prisma.outbound_orders.findUnique({
        where: { id: taskId },
        include: {
          warehouses: { select: { id: true, code: true, name: true } },
          outbound_order_items: {
            include: {
              book_variants: {
                select: {
                  sku: true,
                  isbn13: true,
                  isbn10: true,
                  internal_barcode: true,
                  books: { select: { title: true } },
                },
              },
            },
            orderBy: { id: "asc" },
          },
        },
      });

      if (!order)
        return res.status(404).json({ message: "Outbound order not found" });

      // Prefer outbound_assigned_user_id; fall back to processed_by_user_id for old data
      const effectiveAssignee =
        order.outbound_assigned_user_id || order.processed_by_user_id;
      if (!canAccessAssignedTask(req.user || {}, effectiveAssignee)) {
        return res.status(403).json({ message: "Forbidden" });
      }

      // Fetch full execution chain: PICK task + all REPICK tasks
      const allPickingTasks = await prisma.picking_tasks.findMany({
        where: { root_order_id: taskId },
        orderBy: { created_at: "asc" },
        select: {
          id: true,
          task_number: true,
          picking_type: true,
          status: true,
          parent_id: true,
          assigned_picker_id: true,
          started_at: true,
          completed_at: true,
          created_at: true,
          picking_task_items: {
            select: {
              id: true,
              variant_id: true,
              requested_qty: true,
              picked_qty: true,
              short_qty: true,
              status: true,
              outbound_order_item_id: true,
            },
          },
        },
      });

      const pickTask = allPickingTasks.find((t) => t.picking_type === "PICK") || null;
      const repickTasks = allPickingTasks.filter((t) => t.picking_type === "REPICK");

      // Aggregate quantities across ALL picking_task_items (PICK + all REPICKs)
      let aggregateTotalRequested = 0;
      let aggregateTotalPicked = 0;
      for (const task of allPickingTasks) {
        for (const item of task.picking_task_items) {
          aggregateTotalRequested += item.requested_qty;
          aggregateTotalPicked += item.picked_qty;
        }
      }
      // Fallback to outbound_order_items if no picking_tasks exist yet
      if (allPickingTasks.length === 0) {
        aggregateTotalRequested = (order.outbound_order_items || []).reduce(
          (s, l) => s + Number(l.quantity || 0), 0,
        );
        aggregateTotalPicked = (order.outbound_order_items || []).reduce(
          (s, l) => s + Number(l.processed_qty || 0), 0,
        );
      }

      return res.json({
        task_type: "outbound",
        task_id: order.id,
        order_number: order.outbound_number,
        status: order.status,
        source_warehouse_id: order.warehouse_id,
        source_warehouse_code: order.warehouses?.code || null,
        source_warehouse_name: order.warehouses?.name || null,
        outbound_assigned_user_id: order.outbound_assigned_user_id || null,
        // Aggregate across PICK + all REPICKs
        aggregate_requested_qty: aggregateTotalRequested,
        aggregate_picked_qty: aggregateTotalPicked,
        aggregate_remaining_qty: Math.max(0, aggregateTotalRequested - aggregateTotalPicked),
        // Execution chain
        pick_task: pickTask ? {
          picking_task_id: pickTask.id,
          task_number: pickTask.task_number,
          status: pickTask.status,
          assigned_picker_id: pickTask.assigned_picker_id,
          started_at: pickTask.started_at,
          completed_at: pickTask.completed_at,
          items: pickTask.picking_task_items,
        } : null,
        repick_tasks: repickTasks.map((rt) => ({
          picking_task_id: rt.id,
          task_number: rt.task_number,
          status: rt.status,
          parent_id: rt.parent_id,
          created_at: rt.created_at,
          items: rt.picking_task_items,
        })),
        lines: (order.outbound_order_items || []).map((line) => ({
          line_id: line.id,
          variant_id: line.variant_id,
          quantity: Number(line.quantity || 0),
          ready_qty: Number(line.processed_qty || 0),
          sku: line.book_variants?.sku || null,
          isbn13: line.book_variants?.isbn13 || null,
          isbn10: line.book_variants?.isbn10 || null,
          barcode:
            line.book_variants?.internal_barcode ||
            line.book_variants?.isbn13 ||
            line.book_variants?.isbn10 ||
            line.book_variants?.sku ||
            null,
          book_title: line.book_variants?.books?.title || "Chua co ten sach",
        })),
      });
    }

    const order = await prisma.transfer_orders.findUnique({
      where: { id: taskId },
      include: {
        warehouses_transfer_orders_from_warehouse_idTowarehouses: {
          select: { id: true, code: true, name: true },
        },
        warehouses_transfer_orders_to_warehouse_idTowarehouses: {
          select: { id: true, code: true, name: true },
        },
        transfer_order_items: {
          include: {
            book_variants: {
              select: {
                sku: true,
                isbn13: true,
                isbn10: true,
                internal_barcode: true,
                books: { select: { title: true } },
              },
            },
          },
          orderBy: { id: "asc" },
        },
      },
    });

    if (!order)
      return res.status(404).json({ message: "Transfer order not found" });

    // Prefer outbound_assigned_user_id; fall back to shipped_by_user_id for old data
    const effectiveAssignee =
      order.outbound_assigned_user_id || order.shipped_by_user_id;
    if (!canAccessAssignedTask(req.user || {}, effectiveAssignee)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    return res.json({
      task_type: "transfer",
      task_id: order.id,
      order_number: order.transfer_number,
      status: order.status,
      source_warehouse_id: order.from_warehouse_id,
      source_warehouse_code:
        order.warehouses_transfer_orders_from_warehouse_idTowarehouses?.code ||
        null,
      source_warehouse_name:
        order.warehouses_transfer_orders_from_warehouse_idTowarehouses?.name ||
        null,
      target_warehouse_id: order.to_warehouse_id,
      target_warehouse_code:
        order.warehouses_transfer_orders_to_warehouse_idTowarehouses?.code ||
        null,
      target_warehouse_name:
        order.warehouses_transfer_orders_to_warehouse_idTowarehouses?.name ||
        null,
      outbound_assigned_user_id: order.outbound_assigned_user_id || null,
      lines: (order.transfer_order_items || []).map((line) => ({
        line_id: line.id,
        variant_id: line.variant_id,
        quantity: Number(line.quantity || 0),
        ready_qty: Number(line.shipped_qty || 0),
        sku: line.book_variants?.sku || null,
        isbn13: line.book_variants?.isbn13 || null,
        isbn10: line.book_variants?.isbn10 || null,
        barcode:
          line.book_variants?.internal_barcode ||
          line.book_variants?.isbn13 ||
          line.book_variants?.isbn10 ||
          line.book_variants?.sku ||
          null,
        book_title: line.book_variants?.books?.title || "Chua co ten sach",
      })),
    });
  } catch (error) {
    console.error("Error while loading outbound detail:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function assignOutboundTask(req, res) {
  const taskType = normalizeTaskType(req.params.taskType);
  const taskId = parseId(req.params.taskId);
  const assignedUserId = parseId(req.body?.outbound_assigned_user_id);
  const actorUserId = parseId(req.user?.id || req.user?.sub);

  if (!taskType || !taskId) {
    return res.status(400).json({ message: "Invalid taskType or taskId" });
  }
  if (!assignedUserId) {
    return res.status(400).json({ message: "outbound_assigned_user_id is required" });
  }

  const scope = getTaskPermissionScope(req.user || {});
  if (!scope.canManageAssignment) {
    return res.status(403).json({ message: "Only manager or admin can assign outbound tasks" });
  }

  try {
    if (taskType === "outbound") {
      const order = await prisma.outbound_orders.findUnique({
        where: { id: taskId },
        select: { id: true, outbound_number: true, status: true },
      });
      if (!order) return res.status(404).json({ message: "Outbound order not found" });
      const ASSIGNABLE_STATUSES = ["APPROVED", "PICKING", "PARTIAL_PICKED", "REPICKING", "READY_FOR_OUTBOUND", "READY_TO_SHIP"];
      if (!ASSIGNABLE_STATUSES.includes(order.status)) {
        return res.status(400).json({ message: "Order must be in an active picking status to assign" });
      }

      await prisma.outbound_orders.update({
        where: { id: taskId },
        data: {
          outbound_assigned_user_id: assignedUserId,
          outbound_assigned_at: new Date(),
          outbound_assigned_by_user_id: actorUserId,
          updated_at: new Date(),
        },
      });

      await prisma.inventory_audit_logs.create({
        data: {
          actor_user_id: actorUserId,
          action_name: "OUTBOUND_TASK_ASSIGNED",
          entity_type: "OUTBOUND_ORDER",
          entity_id: taskId,
          after_data: { outbound_assigned_user_id: assignedUserId },
        },
      });

      return res.json({ message: "Outbound task assigned successfully" });
    }

    const order = await prisma.transfer_orders.findUnique({
      where: { id: taskId },
      select: { id: true, transfer_number: true, status: true },
    });
    if (!order) return res.status(404).json({ message: "Transfer order not found" });
    if (order.status !== "READY_FOR_OUTBOUND") {
      return res.status(400).json({ message: "Transfer order must be READY_FOR_OUTBOUND to assign" });
    }

    await prisma.transfer_orders.update({
      where: { id: taskId },
      data: {
        outbound_assigned_user_id: assignedUserId,
        outbound_assigned_at: new Date(),
        outbound_assigned_by_user_id: actorUserId,
        updated_at: new Date(),
      },
    });

    await prisma.inventory_audit_logs.create({
      data: {
        actor_user_id: actorUserId,
        action_name: "TRANSFER_OUTBOUND_TASK_ASSIGNED",
        entity_type: "TRANSFER_ORDER",
        entity_id: taskId,
        after_data: { outbound_assigned_user_id: assignedUserId },
      },
    });

    return res.json({ message: "Transfer outbound task assigned successfully" });
  } catch (error) {
    console.error("Error while assigning outbound task:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function confirmOutbound(req, res) {
  const taskType = normalizeTaskType(req.params.taskType);
  const taskId = parseId(req.params.taskId);
  const rawActor = parseId(req.user?.id);
  const scanCode = normalizeText(req.body?.scan_code);

  if (!taskType || !taskId) {
    return res.status(400).json({ message: "Invalid taskType or taskId" });
  }

  if (!rawActor) {
    return res.status(401).json({ message: "Invalid current user context" });
  }

  /** NOT NULL UUID columns (e.g. goods_receipts.received_by_user_id). */
  const actorUserIdRequired = normalizeRequiredUserId(rawActor);
  /** Nullable UUID columns (movements, audit). */
  const actorUserIdOptional = normalizeOptionalUserId(rawActor);

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        if (taskType === "outbound") {
          await tx.$queryRawUnsafe(
            "SELECT id FROM outbound_orders WHERE id::text = $1 FOR UPDATE",
            taskId,
          );

          const order = await tx.outbound_orders.findUnique({
            where: { id: taskId },
            select: {
              id: true,
              outbound_number: true,
              status: true,
              warehouse_id: true,
              processed_by_user_id: true,
              outbound_assigned_user_id: true,
            },
          });

          if (!order)
            return {
              invalid: true,
              statusCode: 404,
              message: "Outbound order not found",
            };
          if (!["READY_FOR_OUTBOUND", "READY_TO_SHIP"].includes(order.status)) {
            return {
              invalid: true,
              statusCode: 400,
              message: "Outbound order must be READY_TO_SHIP (or READY_FOR_OUTBOUND) to confirm",
            };
          }

          // Block completion if any picking_tasks for this order are not yet done
          const pendingPickingTasks = await tx.picking_tasks.count({
            where: {
              root_order_id: taskId,
              status: { notIn: ["COMPLETED", "CANCELLED"] },
            },
          });
          if (pendingPickingTasks > 0) {
            return {
              invalid: true,
              statusCode: 400,
              message: `Còn ${pendingPickingTasks} picking task chưa hoàn tất. Vui lòng hoàn thành tất cả PICK/REPICK trước khi xuất kho.`,
            };
          }

          const scope = getTaskPermissionScope(req.user || {});
          if (!scope.canManageAssignment) {
            // New flow: check outbound_assigned_user_id first
            if (order.outbound_assigned_user_id) {
              if (order.outbound_assigned_user_id !== scope.currentUserId) {
                return {
                  invalid: true,
                  statusCode: 403,
                  message: "Task must be assigned to current warehouse staff",
                };
              }
            } else {
              // Backward compat: fall back to processed_by_user_id
              if (order.processed_by_user_id !== scope.currentUserId) {
                return {
                  invalid: true,
                  statusCode: 403,
                  message: "Task must be assigned to current warehouse staff",
                };
              }
            }
          }

          if (
            scanCode &&
            scanCode.toUpperCase() !==
              String(order.outbound_number || "").toUpperCase()
          ) {
            return {
              invalid: true,
              statusCode: 400,
              message: "scan_code does not match outbound order number",
            };
          }

          const lines = await tx.outbound_order_items.findMany({
            where: { outbound_order_id: order.id },
            select: { variant_id: true, processed_qty: true, quantity: true },
          });

          const shippingLocation = await resolveOrCreateShippingLocation(
            tx,
            order.warehouse_id,
          );

          const movementRows = [];

          for (const line of lines) {
            const qty = Number(line.processed_qty || 0);
            if (qty <= 0) continue;

            await tx.$queryRawUnsafe(
              "SELECT id FROM stock_balances WHERE variant_id::text = $1 AND location_id::text = $2 FOR UPDATE",
              line.variant_id,
              shippingLocation.id,
            );

            const shippingBalance = await tx.stock_balances.findUnique({
              where: {
                variant_id_location_id: {
                  variant_id: line.variant_id,
                  location_id: shippingLocation.id,
                },
              },
              select: { on_hand_qty: true },
            });

            if (
              !shippingBalance ||
              Number(shippingBalance.on_hand_qty || 0) < qty
            ) {
              return {
                invalid: true,
                statusCode: 409,
                code: "CONCURRENCY_CONFLICT",
                message:
                  "Shipping stock changed. Please reload before outbound.",
              };
            }

            // Pick-to-SHIPPING only increments on_hand_qty there (available_qty stays 0).
            // Decrementing available_qty here would violate CHECK (available_qty >= 0).
            await tx.stock_balances.update({
              where: {
                variant_id_location_id: {
                  variant_id: line.variant_id,
                  location_id: shippingLocation.id,
                },
              },
              data: {
                on_hand_qty: { decrement: qty },
                version: { increment: 1 },
                last_movement_at: new Date(),
              },
            });

            movementRows.push({
              variant_id: line.variant_id,
              quantity: qty,
            });
          }

          if (movementRows.length === 0) {
            return {
              invalid: true,
              statusCode: 400,
              message: "No picked quantity to outbound",
            };
          }

          const baseTimestamp = Date.now();
          await tx.stock_movements.createMany({
            data: movementRows.map((row, index) => ({
              movement_number: createMovementNumber(baseTimestamp, index),
              movement_type: "OUTBOUND",
              movement_status: "POSTED",
              warehouse_id: order.warehouse_id,
              variant_id: row.variant_id,
              from_location_id: shippingLocation.id,
              to_location_id: null,
              quantity: row.quantity,
              unit_cost: 0,
              source_service: "INVENTORY_SERVICE",
              reference_type: "OUTBOUND_ORDER",
              reference_id: order.id,
              created_by_user_id: actorUserIdOptional,
              metadata: {
                stage: "OUTBOUND_CONFIRMED",
              },
            })),
          });

          await tx.outbound_orders.update({
            where: { id: order.id },
            data: {
              status: "COMPLETED",
              completed_at: new Date(),
              processed_by_user_id: actorUserIdOptional,
            },
          });

          await tx.inventory_audit_logs.create({
            data: {
              actor_user_id: actorUserIdOptional,
              action_name: "OUTBOUND_CONFIRMED",
              entity_type: "OUTBOUND_ORDER",
              entity_id: order.id,
              after_data: {
                status: "COMPLETED",
                scan_code: scanCode,
              },
            },
          });

          return {
            data: {
              task_type: "outbound",
              task_id: order.id,
              status: "COMPLETED",
            },
          };
        }

        await tx.$queryRawUnsafe(
          "SELECT id FROM transfer_orders WHERE id::text = $1 FOR UPDATE",
          taskId,
        );

        const order = await tx.transfer_orders.findUnique({
          where: { id: taskId },
          select: {
            id: true,
            transfer_number: true,
            status: true,
            from_warehouse_id: true,
            to_warehouse_id: true,
            shipped_by_user_id: true,
            outbound_assigned_user_id: true,
          },
        });

        if (!order)
          return {
            invalid: true,
            statusCode: 404,
            message: "Transfer order not found",
          };
        if (order.status !== "READY_FOR_OUTBOUND") {
          return {
            invalid: true,
            statusCode: 400,
            message: "Transfer order must be READY_FOR_OUTBOUND",
          };
        }

        const scope = getTaskPermissionScope(req.user || {});
        if (!scope.canManageAssignment) {
          // New flow: check outbound_assigned_user_id first
          if (order.outbound_assigned_user_id) {
            if (order.outbound_assigned_user_id !== scope.currentUserId) {
              return {
                invalid: true,
                statusCode: 403,
                message: "Task must be assigned to current warehouse staff",
              };
            }
          } else {
            // Backward compat: fall back to shipped_by_user_id
            if (order.shipped_by_user_id !== scope.currentUserId) {
              return {
                invalid: true,
                statusCode: 403,
                message: "Task must be assigned to current warehouse staff",
              };
            }
          }
        }

        if (
          scanCode &&
          scanCode.toUpperCase() !==
            String(order.transfer_number || "").toUpperCase()
        ) {
          return {
            invalid: true,
            statusCode: 400,
            message: "scan_code does not match transfer order number",
          };
        }

        const lines = await tx.transfer_order_items.findMany({
          where: { transfer_order_id: order.id },
          select: {
            id: true,
            variant_id: true,
            quantity: true,
            shipped_qty: true,
            unit_cost: true,
          },
        });

        const shippingLocation = await resolveOrCreateShippingLocation(
          tx,
          order.from_warehouse_id,
        );

        const movementRows = [];
        for (const line of lines) {
          const qty = Number(line.shipped_qty || 0);
          if (qty <= 0) continue;

          await tx.$queryRawUnsafe(
            "SELECT id FROM stock_balances WHERE variant_id::text = $1 AND location_id::text = $2 FOR UPDATE",
            line.variant_id,
            shippingLocation.id,
          );

          const shippingBalance = await tx.stock_balances.findUnique({
            where: {
              variant_id_location_id: {
                variant_id: line.variant_id,
                location_id: shippingLocation.id,
              },
            },
            select: { on_hand_qty: true },
          });

          if (
            !shippingBalance ||
            Number(shippingBalance.on_hand_qty || 0) < qty
          ) {
            return {
              invalid: true,
              statusCode: 409,
              code: "CONCURRENCY_CONFLICT",
              message: "Shipping stock changed. Please reload before outbound.",
            };
          }

          await tx.stock_balances.update({
            where: {
              variant_id_location_id: {
                variant_id: line.variant_id,
                location_id: shippingLocation.id,
              },
            },
            data: {
              on_hand_qty: { decrement: qty },
              version: { increment: 1 },
              last_movement_at: new Date(),
            },
          });

          movementRows.push({
            variant_id: line.variant_id,
            quantity: qty,
          });
        }

        if (movementRows.length === 0) {
          return {
            invalid: true,
            statusCode: 400,
            message: "No picked quantity to outbound",
          };
        }

        const baseTimestamp = Date.now();
        await tx.stock_movements.createMany({
          data: movementRows.map((row, index) => ({
            movement_number: createMovementNumber(baseTimestamp, index),
            movement_type: "OUTBOUND",
            movement_status: "POSTED",
            warehouse_id: order.from_warehouse_id,
            variant_id: row.variant_id,
            from_location_id: shippingLocation.id,
            to_location_id: null,
            quantity: row.quantity,
            unit_cost: 0,
            source_service: "INVENTORY_SERVICE",
            reference_type: "TRANSFER_OUTBOUND",
            reference_id: order.id,
            created_by_user_id: actorUserIdOptional,
            metadata: {
              stage: "OUTBOUND_CONFIRMED",
            },
          })),
        });

        // Transfer moves to IN_TRANSIT — goods receipt is created later by the destination warehouse staff.
        await tx.transfer_orders.update({
          where: { id: order.id },
          data: {
            status: "IN_TRANSIT",
            shipped_at: new Date(),
            shipped_by_user_id: actorUserIdOptional,
          },
        });

        await tx.inventory_audit_logs.create({
          data: {
            actor_user_id: actorUserIdOptional,
            action_name: "TRANSFER_SHIPPED_WAITING_RECEIVE",
            entity_type: "TRANSFER_ORDER",
            entity_id: order.id,
            after_data: {
              status: "IN_TRANSIT",
              scan_code: scanCode,
            },
          },
        });

        return {
          data: {
            task_type: "transfer",
            task_id: order.id,
            status: "IN_TRANSIT",
          },
        };
      },
      { isolationLevel: "Serializable" },
    );

    if (result.invalid) {
      return res.status(result.statusCode || 400).json({
        message: result.message,
        ...(result.code ? { code: result.code } : {}),
      });
    }

    return res.json({
      message: "Outbound confirmed successfully",
      data: result.data,
    });
  } catch (error) {
    if (toSerializableError(error)) {
      return res.status(409).json({
        message:
          "Data changed during outbound confirmation. Please reload and try again.",
        code: "CONCURRENCY_CONFLICT",
      });
    }

    console.error("Error while confirming outbound:", error);
    const devHint =
      process.env.NODE_ENV !== "production" && error?.message
        ? ` — ${error.message}`
        : "";
    return res.status(500).json({
      message: `Internal server error${devHint}`,
      ...(error?.code ? { code: String(error.code) } : {}),
    });
  }
}

module.exports = {
  listOutboundQueue,
  getOutboundOrderDetail,
  assignOutboundTask,
  confirmOutbound,
  postTransferReceiptToReceiving,
  createReceiptNumber,
};
