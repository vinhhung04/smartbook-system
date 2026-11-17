
const { prisma } = require("../lib/prisma");

const { parseId, normalizeRequiredUserId, normalizeOptionalUserId } = require("../utils/validation");
const { toSerializableError } = require("../utils/inventory");
const { requireAssignableUser, scopedWarehouseWhere, scopeErrorStatus } = require("../utils/warehouse-scope.utils");
const {
  postTransferReceiptToReceiving,
  createReceiptNumber,
} = require("./outbound.controller");

function toNonNegativeInt(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const n = Number(value);
  return Number.isFinite(n) && Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * Per-line counting for a transfer receipt: shipped_qty is what the source
 * warehouse sent, never what the destination actually received. Same
 * accepted/damaged/rejected/missing/overage math as supplier receipts
 * (procurement-receipt.service.js: accepted = delivered - damaged - rejected is
 * the only quantity posted to stock), minus the PO cap - a transfer's only
 * ceiling is what was shipped.
 * @returns {{error:string}|{delivered:number,damaged:number,rejected:number,accepted:number,missing:number,overage:number}}
 */
function computeTransferLineOutcome({ shippedQty, delivered, damaged = 0, rejected = 0 }) {
  const d = toNonNegativeInt(delivered, null);
  const dmg = toNonNegativeInt(damaged, 0);
  const rej = toNonNegativeInt(rejected, 0);
  if (d === null || dmg === null || rej === null) {
    return { error: "Số lượng thực nhận, hỏng và từ chối phải là số nguyên không âm" };
  }
  if (dmg + rej > d) {
    return { error: "Số lượng hỏng + từ chối không được vượt số lượng thực nhận" };
  }
  const shipped = Number(shippedQty || 0);
  const overage = Math.max(0, d - shipped);
  if (rej < overage) {
    return { error: `Nhận thừa ${overage} so với số lượng đã xuất - ghi phần thừa vào số lượng từ chối` };
  }
  return { delivered: d, damaged: dmg, rejected: rej, accepted: d - dmg - rej, missing: Math.max(0, shipped - d), overage };
}

/**
 * Build goods_receipt_items rows for a transfer's shipped lines.
 * outcomeByVariant (when present) already holds the PER-VARIANT total across every line that
 * shares that variant - writing it into one row per line (instead of one row per variant)
 * would duplicate it when postTransferReceiptToReceiving aggregates by variant again, so this
 * collapses to one row per variant in that case. Without a counting payload each line already
 * carries its own shipped_qty (never aggregated), so there is no duplication risk there - keep
 * one row per line as before.
 */
function buildGoodsReceiptItemRows(shippedLines, outcomeByVariant, goodsReceiptId) {
  if (!outcomeByVariant) {
    return shippedLines.map((line) => ({
      goods_receipt_id: goodsReceiptId,
      variant_id: line.variant_id,
      location_id: null,
      quantity: Number(line.shipped_qty || 0),
      delivered_qty: Number(line.shipped_qty || 0),
      damaged_qty: 0,
      rejected_qty: 0,
      unit_cost: Number(line.unit_cost || 0),
      note: `Tu chuyen kho line ${line.id}`,
    }));
  }
  return Array.from(outcomeByVariant.entries()).map(([variantId, outcome]) => {
    const representativeLine =
      shippedLines.find((l) => String(l.variant_id) === variantId) || shippedLines[0];
    return {
      goods_receipt_id: goodsReceiptId,
      variant_id: variantId,
      location_id: null,
      quantity: outcome.accepted,
      delivered_qty: outcome.delivered,
      damaged_qty: outcome.damaged,
      rejected_qty: outcome.rejected,
      unit_cost: Number(representativeLine?.unit_cost || 0),
      note: `Tu chuyen kho line ${representativeLine?.id || ""}`.trim(),
    };
  });
}

function getTaskPermissionScope(user = {}) {
  const roles = Array.isArray(user.roles)
    ? user.roles.map((r) => String(r).toUpperCase())
    : [];
  return {
    currentUserId: parseId(user.id || user.sub),
    canManageAssignment:
      Boolean(user.is_superuser) ||
      roles.includes("ADMIN") ||
      roles.includes("WAREHOUSE_MANAGER"),
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
            book_variants: { select: { sku: true, isbn13: true, books: { select: { title: true } } } },
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Không tìm thấy phiếu chuyển kho" });
    }

    return res.json({
      data: {
        transfer_id: order.id,
        transfer_number: order.transfer_number,
        status: order.status,
        items: order.transfer_order_items
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
          return { invalid: true, statusCode: 404, message: "Không tìm thấy phiếu chuyển kho" };

        // Idempotent re-confirm: already received
        if (order.status === "RECEIVED") {
          const postedReceipt = await tx.goods_receipts.findFirst({
            where: { source_type: "TRANSFER", source_reference_id: order.id },
            select: { id: true, receipt_number: true },
          });
          return {
            data: {
              transfer_id: order.id,
              status: "RECEIVED",
              goods_receipt_id: postedReceipt?.id ?? null,
              goods_receipt_number: postedReceipt?.receipt_number ?? null,
            },
          };
        }

        if (order.status !== "IN_TRANSIT") {
          return {
            invalid: true,
            statusCode: 400,
            message: "Phiếu chuyển kho phải ở trạng thái IN_TRANSIT mới xác nhận nhận hàng được",
          };
        }

        const scope = getTaskPermissionScope(req.user || {});
        if (!scope.canManageAssignment) {
          if (!order.received_by_user_id || order.received_by_user_id !== scope.currentUserId) {
            return {
              invalid: true,
              statusCode: 403,
              message: "Công việc nhận hàng chuyển kho phải được giao cho nhân viên kho hiện tại",
            };
          }
        }

        // Optional per-line count of what actually arrived. Without it (older
        // clients, or the explicit "received in full" quick action), every shipped
        // line is still accepted in full - unchanged, backward-compatible default.
        // items: [] is NOT the same as omitting items entirely: an explicit but empty
        // counting payload is rejected rather than silently treated as "received in full".
        const rawItems = req.body?.items;
        if (rawItems !== undefined && !Array.isArray(rawItems)) {
          return { invalid: true, statusCode: 400, message: "items phải là một mảng" };
        }
        if (Array.isArray(rawItems) && rawItems.length === 0) {
          return {
            invalid: true,
            statusCode: 400,
            message: "items không được để trống - bỏ hẳn trường items nếu muốn nhận đủ theo số lượng đã xuất",
          };
        }

        let outcomeByVariant = null;
        // transfer_order_items.received_qty (one write per line, set exactly once when the
        // order moves out of IN_TRANSIT - unlike a PO, a transfer has a single receiving
        // confirmation, not multiple batches) - mirrors the accepted qty posted to stock,
        // same convention as purchase_order_items.received_qty.
        const receivedQtyByLineId = new Map();
        if (Array.isArray(rawItems) && rawItems.length > 0) {
          const lineById = new Map(order.transfer_order_items.map((l) => [String(l.id), l]));
          outcomeByVariant = new Map();
          const seenLineIds = new Set();
          for (const raw of rawItems) {
            const lineId = String(raw?.transfer_order_item_id || "");
            if (seenLineIds.has(lineId)) {
              return { invalid: true, statusCode: 400, message: `transfer_order_item_id bị lặp trong payload: ${lineId}` };
            }
            seenLineIds.add(lineId);
            const line = lineById.get(lineId);
            if (!line) {
              return { invalid: true, statusCode: 400, message: `transfer_order_item_id không hợp lệ: ${raw?.transfer_order_item_id}` };
            }
            const outcome = computeTransferLineOutcome({
              shippedQty: line.shipped_qty,
              delivered: raw?.delivered_qty,
              damaged: raw?.damaged_qty,
              rejected: raw?.rejected_qty,
            });
            if (outcome.error) {
              return { invalid: true, statusCode: 400, message: outcome.error };
            }
            const key = String(line.variant_id);
            const prev = outcomeByVariant.get(key) || { accepted: 0, delivered: 0, damaged: 0, rejected: 0 };
            outcomeByVariant.set(key, {
              accepted: prev.accepted + outcome.accepted,
              delivered: prev.delivered + outcome.delivered,
              damaged: prev.damaged + outcome.damaged,
              rejected: prev.rejected + outcome.rejected,
            });
            receivedQtyByLineId.set(lineId, outcome.accepted);
          }
          const missingLine = order.transfer_order_items.find(
            (l) => Number(l.shipped_qty || 0) > 0 && !seenLineIds.has(String(l.id)),
          );
          if (missingLine) {
            return { invalid: true, statusCode: 400, message: "Thiếu số lượng kiểm đếm cho một hoặc nhiều dòng đã xuất" };
          }
        } else {
          for (const line of order.transfer_order_items) {
            if (Number(line.shipped_qty || 0) > 0) {
              receivedQtyByLineId.set(String(line.id), Number(line.shipped_qty || 0));
            }
          }
        }

        // Three-branch receipt promotion: POSTED (idempotent) | DRAFT→POSTED | no receipt (fallback)
        const existingReceipt = await tx.goods_receipts.findFirst({
          where: {
            source_type: "TRANSFER",
            source_reference_id: order.id,
            warehouse_id: order.to_warehouse_id,
          },
          select: { id: true, receipt_number: true, status: true, warehouse_id: true },
        });

        let destinationReceipt;

        if (existingReceipt?.status === "POSTED") {
          // Already posted — idempotent, skip stock movement work
          destinationReceipt = existingReceipt;

        } else if (existingReceipt?.status === "DRAFT") {
          // Normal path: DRAFT was created by confirmOutbound; promote to POSTED
          destinationReceipt = await tx.goods_receipts.update({
            where: { id: existingReceipt.id },
            data: {
              status: "POSTED",
              received_by_user_id: actorUserIdRequired,
              received_at: new Date(),
              updated_at: new Date(),
            },
            select: { id: true, warehouse_id: true, receipt_number: true, status: true },
          });

          // Items created by confirmOutbound; add fallback in case DRAFT had no items
          const existingItemCount = await tx.goods_receipt_items.count({
            where: { goods_receipt_id: existingReceipt.id },
          });
          if (existingItemCount === 0) {
            const shippedLines = order.transfer_order_items.filter(
              (l) => Number(l.shipped_qty || 0) > 0,
            );
            if (shippedLines.length > 0) {
              await tx.goods_receipt_items.createMany({
                data: buildGoodsReceiptItemRows(shippedLines, outcomeByVariant, destinationReceipt.id),
              });
            }
          } else if (outcomeByVariant) {
            // Lines already exist at shipped_qty (created by confirmOutbound, one row per
            // transfer line) - apply the destination's actual count before posting to stock.
            const existingItems = await tx.goods_receipt_items.findMany({
              where: { goods_receipt_id: existingReceipt.id },
              select: { id: true, variant_id: true },
            });
            const existingItemsByVariant = new Map();
            for (const item of existingItems) {
              const key = String(item.variant_id);
              if (!existingItemsByVariant.has(key)) existingItemsByVariant.set(key, []);
              existingItemsByVariant.get(key).push(item);
            }
            for (const [variantId, outcome] of outcomeByVariant) {
              const rows = existingItemsByVariant.get(variantId);
              if (!rows || rows.length === 0) continue;
              const [primary, ...duplicates] = rows;
              await tx.goods_receipt_items.update({
                where: { id: primary.id },
                data: {
                  quantity: outcome.accepted,
                  delivered_qty: outcome.delivered,
                  damaged_qty: outcome.damaged,
                  rejected_qty: outcome.rejected,
                },
              });
              // A variant shipped across multiple transfer lines has one existing row per
              // line, all sharing this variant_id - keep exactly one (already updated to the
              // full per-variant total above) so postTransferReceiptToReceiving's own
              // per-variant aggregation over goods_receipt_items doesn't double-count it.
              if (duplicates.length > 0) {
                await tx.goods_receipt_items.deleteMany({
                  where: { id: { in: duplicates.map((d) => d.id) } },
                });
              }
            }
          }

          // postTransferReceiptToReceiving has its own idempotency guard (stock_movements count check)
          await postTransferReceiptToReceiving(tx, destinationReceipt, actorUserIdOptional);

        } else {
          // No receipt: migration period — order went IN_TRANSIT before this fix was deployed
          const shippedLines = order.transfer_order_items.filter(
            (line) => Number(line.shipped_qty || 0) > 0,
          );
          if (shippedLines.length === 0) {
            return { invalid: true, statusCode: 400, message: "Không có hàng đã gửi để nhận" };
          }
          destinationReceipt = await tx.goods_receipts.create({
            data: {
              receipt_number: createReceiptNumber(Date.now()),
              warehouse_id: order.to_warehouse_id,
              source_type: "TRANSFER",
              source_reference_id: order.id,
              status: "POSTED",
              received_by_user_id: actorUserIdRequired,
              received_at: new Date(),
              note: `Nhan hang tu chuyen kho ${order.transfer_number}`,
            },
            select: { id: true, warehouse_id: true, receipt_number: true, status: true },
          });
          await tx.goods_receipt_items.createMany({
            data: buildGoodsReceiptItemRows(shippedLines, outcomeByVariant, destinationReceipt.id),
          });
          await postTransferReceiptToReceiving(tx, destinationReceipt, actorUserIdOptional);
        }

        for (const [lineId, receivedQty] of receivedQtyByLineId) {
          await tx.transfer_order_items.update({
            where: { id: lineId },
            data: { received_qty: receivedQty },
          });
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
