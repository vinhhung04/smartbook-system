
const { prisma } = require("../lib/prisma");
const { getTransferShippedLines } = require('../services/repick-quantities.service');
const { receiveTransfer, computeTransferLineOutcome } = require('../services/transfer-receiving.service');

const { parseId, normalizeRequiredUserId, normalizeOptionalUserId } = require("../utils/validation");
const { toSerializableError } = require("../utils/inventory");
const { requireAssignableUser, scopedWarehouseWhere, scopeErrorStatus } = require("../utils/warehouse-scope.utils");

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
    // Receiving happens at the destination: only transfers into the caller's warehouses.
    const destination = await scopedWarehouseWhere(req.user, "to_warehouse_id", warehouseId);
    const orders = await prisma.transfer_orders.findMany({
      where: {
        status: "IN_TRANSIT",
        ...destination,
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
          select: { id: true, variant_id: true, quantity: true, shipped_qty: true },
        },
      },
      orderBy: { shipped_at: "asc" },
    });

    const shippedOrders = await Promise.all(orders.map(async (order) => ({
      ...order, transfer_order_items: await getTransferShippedLines(prisma, order),
    })));
    const data = shippedOrders.map((order) => ({
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
    if (scopeErrorStatus(error) === 503) return res.status(503).json({ message: error.message, code: error.code });
    console.error("Error while listing transfer receiving queue:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

// Per-book lines for the counting step before confirm: id here is always the
// transfer_order_item id (stable from creation, unlike the GRN item id which may
// not exist yet), so the client can send counts back by the same id.
async function getTransferReceivingLines(req, res) {
  const transferId = parseId(req.params.id);
  if (!transferId) {
    return res.status(400).json({ message: "Mã phiếu chuyển kho không hợp lệ" });
  }

  try {
    const order = await prisma.transfer_orders.findUnique({
      where: { id: transferId },
      select: {
        id: true,
        transfer_number: true,
        status: true,
        transfer_order_items: {
          select: {
            id: true,
            variant_id: true,
            shipped_qty: true,
            quantity: true,
            book_variants: { select: { sku: true, isbn13: true, books: { select: { title: true } } } },
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Không tìm thấy phiếu chuyển kho" });
    }

    const shippedLines = await getTransferShippedLines(prisma, order);
    return res.json({
      data: {
        transfer_id: order.id,
        transfer_number: order.transfer_number,
        status: order.status,
        items: shippedLines
          .filter((line) => Number(line.shipped_qty || 0) > 0)
          .map((line) => ({
            transfer_order_item_id: line.id,
            variant_id: line.variant_id,
            title: line.book_variants?.books?.title || null,
            sku: line.book_variants?.sku || null,
            isbn13: line.book_variants?.isbn13 || null,
            shipped_qty: Number(line.shipped_qty || 0),
          })),
      },
    });
  } catch (error) {
    console.error("Error while loading transfer receiving lines:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function assignTransferReceiving(req, res) {
  const transferId = parseId(req.params.id);
  const assignedUserId = parseId(req.body?.received_by_user_id);
  const actorUserId = parseId(req.user?.id || req.user?.sub);

  if (!transferId) {
    return res.status(400).json({ message: "Mã phiếu chuyển kho không hợp lệ" });
  }
  if (!assignedUserId) {
    return res.status(400).json({ message: "Thiếu received_by_user_id" });
  }

  const scope = getTaskPermissionScope(req.user || {});
  if (!scope.canManageAssignment) {
    return res.status(403).json({ message: "Chỉ quản lý hoặc quản trị viên được giao công việc nhận hàng chuyển kho" });
  }

  try {
    const order = await prisma.transfer_orders.findUnique({
      where: { id: transferId },
      select: { id: true, transfer_number: true, status: true, to_warehouse_id: true },
    });
    if (!order) return res.status(404).json({ message: "Không tìm thấy phiếu chuyển kho" });
    if (!(await requireAssignableUser(res, assignedUserId, order.to_warehouse_id))) return undefined;
    if (order.status !== "IN_TRANSIT") {
      return res.status(400).json({ message: "Phiếu chuyển kho phải ở trạng thái IN_TRANSIT mới giao người nhận được" });
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
    return res.status(400).json({ message: "Mã phiếu chuyển kho không hợp lệ" });
  }
  if (!rawActor) {
    return res.status(401).json({ message: "Invalid current user context" });
  }

  const actorUserIdRequired = normalizeRequiredUserId(rawActor);
  const actorUserIdOptional = normalizeOptionalUserId(rawActor);

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        return receiveTransfer(tx, {
          transferId, actorUserIdRequired, actorUserIdOptional, user: req.user,
          items: req.body?.items,
        });
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
        message: "Dữ liệu đã thay đổi trong lúc xác nhận nhận hàng. Vui lòng tải lại và thử lại.",
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
    return res.status(400).json({ message: "Mã phiếu chuyển kho không hợp lệ" });
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
        return { invalid: true, statusCode: 404, message: "Không tìm thấy phiếu chuyển kho" };
      }
      if (order.received_by_user_id && order.received_by_user_id !== currentUserId) {
        return { invalid: true, statusCode: 409, message: "Task đã được nhân viên khác nhận" };
      }
      if (order.received_by_user_id === currentUserId) {
        return { data: { transfer_id: transferId, status: order.status } };
      }
      if (order.status !== "IN_TRANSIT") {
        return { invalid: true, statusCode: 400, message: "Chỉ phiếu ở trạng thái IN_TRANSIT mới tự nhận được" };
      }

      await tx.transfer_orders.update({
        where: { id: transferId },
        data: { received_by_user_id: currentUserId, updated_at: new Date() },
      });

      // Assign the DRAFT goods_receipt so it appears in staff's pending-verification queue.
      await tx.goods_receipts.updateMany({
        where: {
          source_type: "TRANSFER",
          source_reference_id: transferId,
          status: "DRAFT",
          received_by_user_id: null,
        },
        data: {
          received_by_user_id: currentUserId,
          updated_at: new Date(),
        },
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
  getTransferReceivingLines,
  assignTransferReceiving,
  claimSelfTransferReceiving,
  confirmTransferReceiving,
  computeTransferLineOutcome,
};
