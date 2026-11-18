const { getTransferShippedLines } = require('./repick-quantities.service');
const { recordTransferDiscrepancy, caseDetail } = require('./transfer-discrepancy.service');
const { parseId } = require('../utils/validation');
const { postTransferReceiptToReceiving, createReceiptNumber } = require('./transfer-receipt-stock.service');

function receiptCountsToTransferLines(lines, receiptItems) {
  const byVariant = new Map();
  for (const item of receiptItems) {
    const delivered = item.actual_quantity ?? item.delivered_qty ?? item.quantity;
    const values = [delivered, item.damaged_qty ?? 0, item.rejected_qty ?? 0];
    if (values.some(value => !Number.isInteger(value) || value < 0)) return { error: 'Số lượng kiểm đếm phải là số nguyên không âm' };
    const key = String(item.variant_id);
    if (!lines.some(line => String(line.variant_id) === key)) return { error: 'Ấn bản không thuộc chuyến chuyển kho' };
    const sum = byVariant.get(key) || { delivered: 0, damaged: 0, rejected: 0 };
    sum.delivered += delivered;
    sum.damaged += values[1];
    sum.rejected += values[2];
    byVariant.set(key, sum);
  }
  const result = [];
  for (const key of new Set(lines.map(line => String(line.variant_id)))) {
    const group = lines.filter(line => String(line.variant_id) === key);
    const count = byVariant.get(key);
    if (!count) return { error: 'Thiếu dòng kiểm đếm cho chuyến chuyển kho' };
    const outcome = computeTransferLineOutcome({ shippedQty: group.reduce((sum, line) => sum + Number(line.shipped_qty || 0), 0), ...count });
    if (outcome.error) return outcome;
    let accepted = outcome.accepted, damaged = outcome.damaged, rejected = outcome.rejected;
    for (let index = 0; index < group.length; index++) {
      const line = group[index];
      const shipped = Number(line.shipped_qty || 0);
      const a = Math.min(accepted, shipped);
      const d = Math.min(damaged, shipped - a);
      const r = index === group.length - 1 ? rejected : Math.min(rejected, shipped - a - d);
      result.push({ transfer_order_item_id: line.id, delivered_qty: a + d + r, damaged_qty: d, rejected_qty: r });
      accepted -= a; damaged -= d; rejected -= r;
    }
  }
  return result;
}

async function reconcilePostedTransfer(tx, order, receipt, lines, actorId) {
  // Old generic posting could leave IN_TRANSIT after stock was posted. Reconcile
  // only an unambiguous full receipt; discrepancies need an explicit stock review.
  const items = await tx.goods_receipt_items.findMany({ where: { goods_receipt_id: receipt.id } });
  const shipped = new Map();
  const accepted = new Map();
  for (const line of lines) shipped.set(String(line.variant_id), (shipped.get(String(line.variant_id)) || 0) + Number(line.shipped_qty || 0));
  for (const item of items) accepted.set(String(item.variant_id), (accepted.get(String(item.variant_id)) || 0) + Number(item.quantity || 0));
  const discrepancy = await caseDetail(tx, order.id);
  const movements = await tx.stock_movements.findMany({ where: { reference_type: 'GOODS_RECEIPT', reference_id: receipt.id, reverted: false } });
  const posted = new Map();
  for (const move of movements) posted.set(String(move.variant_id), (posted.get(String(move.variant_id)) || 0) + Number(move.quantity || 0));
  if (discrepancy || [...accepted].some(([id, qty]) => posted.get(id) !== qty) || posted.size !== accepted.size || items.some(item => Number(item.damaged_qty || 0) || Number(item.rejected_qty || 0) || (item.actual_quantity != null && item.actual_quantity !== item.quantity)) ||
      shipped.size !== accepted.size || [...shipped].some(([id, qty]) => accepted.get(id) !== qty)) {
    return { invalid: true, statusCode: 409, message: 'Phiếu chuyển đã ghi sổ nhưng chưa hoàn tất; cần đối soát số lượng đã ghi trước khi nhận lại' };
  }
  for (const line of lines) await tx.transfer_order_items.update({ where: { id: line.id }, data: { received_qty: Number(line.shipped_qty || 0) } });
  await tx.transfer_orders.update({ where: { id: order.id }, data: { status: 'RECEIVED', received_at: receipt.received_at || new Date(), received_by_user_id: actorId } });
  await tx.inventory_audit_logs.create({ data: { actor_user_id: actorId, action_name: 'TRANSFER_RECEIVING_RECONCILED', entity_type: 'TRANSFER_ORDER', entity_id: order.id,
    after_data: { goods_receipt_id: receipt.id, status: 'RECEIVED' } } });
  return { data: { transfer_id: order.id, status: 'RECEIVED', goods_receipt_id: receipt.id, goods_receipt_number: receipt.receipt_number, discrepancy_id: null, discrepancy_status: 'NONE' } };
}

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

// Both public entrypoints execute this workflow in their own transaction.
// Always lock the transfer before its receipt, including generic PATCH.
async function receiveTransfer(tx, { transferId, actorUserIdRequired, actorUserIdOptional, user, items, genericReceiptId }) {
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
      from_warehouse_id: true,
      to_warehouse_id: true,
      received_by_user_id: true,
      transfer_order_items: {
        select: {
          id: true,
          variant_id: true,
          shipped_qty: true,
          quantity: true,
          unit_cost: true,
        },
      },
    },
  });

  if (!order)
    return { invalid: true, statusCode: 404, message: "Không tìm thấy phiếu chuyển kho" };

  // Idempotent re-confirm: already received
  if (order.status === "RECEIVED") {
    const discrepancy = await caseDetail(tx, order.id);
    const postedReceipt = await tx.goods_receipts.findFirst({
      where: { source_type: "TRANSFER", source_reference_id: order.id, warehouse_id: order.to_warehouse_id, status: "POSTED" },
      select: { id: true, receipt_number: true },
    });
    if (genericReceiptId && postedReceipt?.id !== genericReceiptId) return { invalid: true, statusCode: 409, message: 'Chuyến chuyển đã được nhận qua phiếu khác' };
    return {
      data: {
        transfer_id: order.id,
        status: "RECEIVED",
        goods_receipt_id: postedReceipt?.id ?? null,
        goods_receipt_number: postedReceipt?.receipt_number ?? null,
        discrepancy_id: discrepancy?.id || null,
        discrepancy_status: discrepancy?.status || 'NONE',
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

  const scope = getTaskPermissionScope(user || {});
  if (!scope.canManageAssignment) {
    if (!order.received_by_user_id || order.received_by_user_id !== scope.currentUserId) {
      return {
        invalid: true,
        statusCode: 403,
        message: "Công việc nhận hàng chuyển kho phải được giao cho nhân viên kho hiện tại",
      };
    }
  }

  const shippedLines = await getTransferShippedLines(tx, order);
  const committedReceipt = await tx.goods_receipts.findFirst({
    where: { source_type: 'TRANSFER', source_reference_id: order.id, warehouse_id: order.to_warehouse_id, status: 'POSTED' },
  });
  if (committedReceipt) {
    if (genericReceiptId && committedReceipt.id !== genericReceiptId) return { invalid: true, statusCode: 409, message: 'Chuyến chuyển đã được nhận qua phiếu khác' };
    return reconcilePostedTransfer(tx, order, committedReceipt, shippedLines, actorUserIdOptional);
  }

  // Optional per-line count of what actually arrived. Without it (older
  // clients, or the explicit "received in full" quick action), every shipped
  // line is still accepted in full - unchanged, backward-compatible default.
  // items: [] is NOT the same as omitting items entirely: an explicit but empty
  // counting payload is rejected rather than silently treated as "received in full".
  let rawItems = items;
  if (genericReceiptId) {
    const receiptItems = await tx.goods_receipt_items.findMany({ where: { goods_receipt_id: genericReceiptId } });
    rawItems = receiptCountsToTransferLines(shippedLines, receiptItems);
    if (rawItems.error) return { invalid: true, statusCode: 400, message: rawItems.error };
  }
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
  const outcomeByLineId = new Map();
  if (Array.isArray(rawItems) && rawItems.length > 0) {
    const lineById = new Map(shippedLines.map((l) => [String(l.id), l]));
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
      outcomeByLineId.set(lineId, outcome);
    }
    const missingLine = shippedLines.find(
      (l) => Number(l.shipped_qty || 0) > 0 && !seenLineIds.has(String(l.id)),
    );
    if (missingLine) {
      return { invalid: true, statusCode: 400, message: "Thiếu số lượng kiểm đếm cho một hoặc nhiều dòng đã xuất" };
    }
  } else {
    // Omitting items is the existing receive-in-full action. Normalize the
    // receipt to that decision too, rather than posting stale saved draft counts.
    outcomeByVariant = new Map();
    for (const line of shippedLines) {
      if (Number(line.shipped_qty || 0) > 0) {
        const quantity = Number(line.shipped_qty);
        const key = String(line.variant_id);
        const previous = outcomeByVariant.get(key);
        outcomeByVariant.set(key, { accepted: (previous?.accepted || 0) + quantity,
          delivered: (previous?.delivered || 0) + quantity, damaged: 0, rejected: 0 });
        receivedQtyByLineId.set(String(line.id), quantity);
      }
    }
  }

  // The order lock serializes receipt promotion across both public routes.
  const existingReceipt = await tx.goods_receipts.findFirst({
    where: {
      source_type: "TRANSFER",
      source_reference_id: order.id,
      warehouse_id: order.to_warehouse_id,
      status: { not: "CANCELLED" },
    },
    select: { id: true, receipt_number: true, status: true, warehouse_id: true },
  });

  if (genericReceiptId && existingReceipt?.id !== genericReceiptId) {
    return { invalid: true, statusCode: 409, message: 'Phiếu nhập không khớp với phiếu nhận của chuyến chuyển kho' };
  }
  if (existingReceipt) await tx.$queryRawUnsafe('SELECT id FROM goods_receipts WHERE id = $1::uuid FOR UPDATE', existingReceipt.id);
  let destinationReceipt;

  if (existingReceipt?.status === "DRAFT") {
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
      const linesToReceive = shippedLines.filter(
        (l) => Number(l.shipped_qty || 0) > 0,
      );
      if (linesToReceive.length > 0) {
        await tx.goods_receipt_items.createMany({
          data: buildGoodsReceiptItemRows(linesToReceive, outcomeByVariant, destinationReceipt.id),
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
        // line, all sharing this variant_id - keep the total in one row and zero the others so postTransferReceiptToReceiving's own
        // per-variant aggregation over goods_receipt_items doesn't double-count it.
        if (duplicates.length > 0) {
          await tx.goods_receipt_items.updateMany({
            where: { id: { in: duplicates.map((d) => d.id) } },
            data: { quantity: 0, delivered_qty: 0, damaged_qty: 0, rejected_qty: 0 },
          });
        }
      }
    }

    // postTransferReceiptToReceiving has its own idempotency guard (stock_movements count check)
    await postTransferReceiptToReceiving(tx, destinationReceipt, actorUserIdOptional);

  } else {
    // No receipt: migration period — order went IN_TRANSIT before this fix was deployed
    const linesToReceive = shippedLines.filter(
      (line) => Number(line.shipped_qty || 0) > 0,
    );
    if (linesToReceive.length === 0) {
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
      data: buildGoodsReceiptItemRows(linesToReceive, outcomeByVariant, destinationReceipt.id),
    });
    await postTransferReceiptToReceiving(tx, destinationReceipt, actorUserIdOptional);
  }

  const discrepancy = await recordTransferDiscrepancy(tx, {
    order, receiptId: destinationReceipt.id, lines: shippedLines,
    outcomes: outcomeByLineId, actorId: actorUserIdOptional,
  });

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
      discrepancy_id: discrepancy?.id || null,
      discrepancy_status: discrepancy?.status || 'NONE',
    },
  };
}

module.exports = { receiveTransfer, computeTransferLineOutcome };
