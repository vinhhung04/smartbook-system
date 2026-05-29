const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const { parseId, normalizeRequiredUserId, normalizeOptionalUserId } = require("../utils/validation");
const { toSerializableError } = require("../utils/inventory");
const {
  postTransferReceiptToReceiving,
  createReceiptNumber,
} = require("./outbound.controller");

function getTaskPermissionScope(user = {}) {
  const roles = Array.isArray(user.roles)
    ? user.roles.map((r) => String(r).toUpperCase())
    : [];
  return {
    currentUserId: parseId(user.id || user.sub),
    canManageAssignment:
      Boolean(user.is_superuser) ||
      roles.includes("ADMIN") ||
      roles.includes("MANAGER"),
  };
}

async function listTransferReceivingQueue(req, res) {
  const warehouseId = parseId(req.query.warehouse_id);
  const scope = getTaskPermissionScope(req.user || {});

  const assignmentFilter = scope.canManageAssignment
    ? {}
    : { received_by_user_id: scope.currentUserId };

  try {
    const orders = await prisma.transfer_orders.findMany({
      where: {
        status: "IN_TRANSIT",
        ...(warehouseId ? { to_warehouse_id: warehouseId } : {}),
        ...assignmentFilter,
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
      orderBy: { shipped_at: "asc" },
    });

    const data = orders.map((order) => ({
      id: order.id,
      transfer_number: order.transfer_number,
      status: order.status,
      from_warehouse_id: order.from_warehouse_id,
      from_warehouse_code:
        order.warehouses_transfer_orders_from_warehouse_idTowarehouses?.code || null,
      from_warehouse_name:
        order.warehouses_transfer_orders_from_warehouse_idTowarehouses?.name || null,
      to_warehouse_id: order.to_warehouse_id,
      to_warehouse_code:
        order.warehouses_transfer_orders_to_warehouse_idTowarehouses?.code || null,
      to_warehouse_name:
        order.warehouses_transfer_orders_to_warehouse_idTowarehouses?.name || null,
      received_by_user_id: order.received_by_user_id || null,
      shipped_at: order.shipped_at,
      total_quantity: (order.transfer_order_items || []).reduce(
        (sum, line) => sum + Number(line.shipped_qty || 0),
        0,
      ),
    }));

    return res.json({ data });
  } catch (error) {
    console.error("Error while listing transfer receiving queue:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function assignTransferReceiving(req, res) {
  const transferId = parseId(req.params.id);
  const assignedUserId = parseId(req.body?.received_by_user_id);
  const actorUserId = parseId(req.user?.id || req.user?.sub);

  if (!transferId) {
    return res.status(400).json({ message: "Invalid transfer id" });
  }
  if (!assignedUserId) {
    return res.status(400).json({ message: "received_by_user_id is required" });
  }

  const scope = getTaskPermissionScope(req.user || {});
  if (!scope.canManageAssignment) {
    return res.status(403).json({ message: "Only manager or admin can assign transfer receiving tasks" });
  }

  try {
    const order = await prisma.transfer_orders.findUnique({
      where: { id: transferId },
      select: { id: true, transfer_number: true, status: true },
    });
    if (!order) return res.status(404).json({ message: "Transfer order not found" });
    if (order.status !== "IN_TRANSIT") {
      return res.status(400).json({ message: "Transfer order must be IN_TRANSIT to assign receiver" });
    }

    await prisma.transfer_orders.update({
      where: { id: transferId },
      data: {
        received_by_user_id: assignedUserId,
        updated_at: new Date(),
      },
    });

    await prisma.inventory_audit_logs.create({
      data: {
        actor_user_id: actorUserId,
        action_name: "TRANSFER_RECEIVING_ASSIGNED",
        entity_type: "TRANSFER_ORDER",
        entity_id: transferId,
        after_data: { received_by_user_id: assignedUserId },
      },
    });

    return res.json({ message: "Transfer receiving task assigned successfully" });
  } catch (error) {
    console.error("Error while assigning transfer receiving:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function confirmTransferReceiving(req, res) {
  const transferId = parseId(req.params.id);
  const rawActor = parseId(req.user?.id);

  if (!transferId) {
    return res.status(400).json({ message: "Invalid transfer id" });
  }
  if (!rawActor) {
    return res.status(401).json({ message: "Invalid current user context" });
  }

  const actorUserIdRequired = normalizeRequiredUserId(rawActor);
  const actorUserIdOptional = normalizeOptionalUserId(rawActor);

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        await tx.$queryRawUnsafe(
          "SELECT id FROM transfer_orders WHERE id::text = $1 FOR UPDATE",
          transferId,
        );

        const order = await tx.transfer_orders.findUnique({
          where: { id: transferId },
          select: {
            id: true,
            transfer_number: true,
            status: true,
            to_warehouse_id: true,
            received_by_user_id: true,
            transfer_order_items: {
              select: {
                id: true,
                variant_id: true,
                shipped_qty: true,
                unit_cost: true,
              },
            },
          },
        });

        if (!order)
          return { invalid: true, statusCode: 404, message: "Transfer order not found" };
        if (order.status !== "IN_TRANSIT") {
          return {
            invalid: true,
            statusCode: 400,
            message: "Transfer order must be IN_TRANSIT to confirm receiving",
          };
        }

        const scope = getTaskPermissionScope(req.user || {});
        if (!scope.canManageAssignment) {
          if (!order.received_by_user_id || order.received_by_user_id !== scope.currentUserId) {
            return {
              invalid: true,
              statusCode: 403,
              message: "Transfer receiving task must be assigned to current warehouse staff",
            };
          }
        }

        // Idempotency: check if goods_receipt already exists for this transfer
        const existingReceipt = await tx.goods_receipts.findFirst({
          where: {
            warehouse_id: order.to_warehouse_id,
            source_type: "TRANSFER",
            source_reference_id: order.id,
          },
          select: { id: true, receipt_number: true },
        });

        let destinationReceipt = existingReceipt;
        if (!destinationReceipt) {
          const baseTimestamp = Date.now();
          const shippedLines = order.transfer_order_items.filter(
            (line) => Number(line.shipped_qty || 0) > 0,
          );

          if (shippedLines.length === 0) {
            return {
              invalid: true,
              statusCode: 400,
              message: "No shipped items to receive",
            };
          }

          destinationReceipt = await tx.goods_receipts.create({
            data: {
              receipt_number: createReceiptNumber(baseTimestamp),
              warehouse_id: order.to_warehouse_id,
              source_type: "TRANSFER",
              source_reference_id: order.id,
              status: "POSTED",
              received_by_user_id: actorUserIdRequired,
              note: `Nhan hang tu chuyen kho ${order.transfer_number}`,
            },
            select: { id: true, warehouse_id: true, receipt_number: true, status: true },
          });

          await tx.goods_receipt_items.createMany({
            data: shippedLines.map((line) => ({
              goods_receipt_id: destinationReceipt.id,
              variant_id: line.variant_id,
              location_id: null,
              quantity: Number(line.shipped_qty || 0),
              unit_cost: Number(line.unit_cost || 0),
              note: `Tu chuyen kho line ${line.id}`,
            })),
          });

          await postTransferReceiptToReceiving(tx, destinationReceipt, actorUserIdOptional);
        }

        await tx.transfer_orders.update({
          where: { id: order.id },
          data: {
            status: "RECEIVED",
            received_at: new Date(),
            received_by_user_id: actorUserIdOptional,
          },
        });

        await tx.inventory_audit_logs.create({
          data: {
            actor_user_id: actorUserIdOptional,
            action_name: "TRANSFER_RECEIVING_CONFIRMED",
            entity_type: "TRANSFER_ORDER",
            entity_id: order.id,
            after_data: {
              status: "RECEIVED",
              goods_receipt_id: destinationReceipt.id,
              goods_receipt_number: destinationReceipt.receipt_number,
            },
          },
        });

        return {
          data: {
            transfer_id: order.id,
            status: "RECEIVED",
            goods_receipt_id: destinationReceipt.id,
            goods_receipt_number: destinationReceipt.receipt_number,
          },
        };
      },
      { isolationLevel: "Serializable" },
    );

    if (result.invalid) {
      return res.status(result.statusCode || 400).json({ message: result.message });
    }

    return res.json({
      message: "Transfer receiving confirmed successfully",
      data: result.data,
    });
  } catch (error) {
    if (toSerializableError(error)) {
      return res.status(409).json({
        message: "Data changed during receiving confirmation. Please reload and try again.",
        code: "CONCURRENCY_CONFLICT",
      });
    }
    console.error("Error while confirming transfer receiving:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function claimSelfTransferReceiving(req, res) {
  const transferId = parseId(req.params.id);

  if (!transferId) {
    return res.status(400).json({ message: "Invalid transfer id" });
  }

  const scope = getTaskPermissionScope(req.user || {});
  const currentUserId = scope.currentUserId;

  if (!currentUserId) {
    return res.status(401).json({ message: "Invalid current user context" });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        "SELECT id FROM transfer_orders WHERE id = $1::uuid FOR UPDATE",
        transferId,
      );

      const order = await tx.transfer_orders.findUnique({
        where: { id: transferId },
        select: { id: true, status: true, received_by_user_id: true },
      });

      if (!order) {
        return { invalid: true, statusCode: 404, message: "Transfer order not found" };
      }
      if (order.received_by_user_id && order.received_by_user_id !== currentUserId) {
        return { invalid: true, statusCode: 409, message: "Task đã được nhân viên khác nhận" };
      }
      if (order.received_by_user_id === currentUserId) {
        return { data: { transfer_id: transferId, status: order.status } };
      }
      if (order.status !== "IN_TRANSIT") {
        return { invalid: true, statusCode: 400, message: "Only IN_TRANSIT orders are available for self-claim" };
      }

      await tx.transfer_orders.update({
        where: { id: transferId },
        data: { received_by_user_id: currentUserId, updated_at: new Date() },
      });

      await tx.inventory_audit_logs.create({
        data: {
          actor_user_id: currentUserId,
          action_name: "TRANSFER_RECEIVING_SELF_CLAIMED",
          entity_type: "TRANSFER_ORDER",
          entity_id: transferId,
          after_data: { received_by_user_id: currentUserId },
        },
      });

      return { data: { transfer_id: transferId, status: order.status } };
    });

    if (result.invalid) {
      return res.status(result.statusCode || 400).json({ message: result.message });
    }

    return res.json(result.data);
  } catch (error) {
    console.error("claimSelfTransferReceiving error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

module.exports = {
  listTransferReceivingQueue,
  assignTransferReceiving,
  claimSelfTransferReceiving,
  confirmTransferReceiving,
};
