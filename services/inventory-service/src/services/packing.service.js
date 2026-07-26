const crypto = require("crypto");

function generateTaskNumber() {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const randomPart = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  return `PACK-${datePart}-${randomPart}`;
}

/**
 * Snapshot the order's picked line items into a new packing_tasks/packing_task_items pair.
 * expected_qty is taken from outbound_order_items.processed_qty — i.e. what Picking actually
 * moved to the shipping location, not the originally requested quantity.
 */
async function createPackingTask(tx, { outboundOrder, warehouseId, orderItems }) {
  const task = await tx.packing_tasks.create({
    data: {
      task_number: generateTaskNumber(),
      root_order_id: outboundOrder.id,
      warehouse_id: warehouseId,
      status: "PENDING",
    },
  });

  const items = (orderItems || []).filter((item) => Number(item.processed_qty || 0) > 0);
  if (items.length > 0) {
    await tx.packing_task_items.createMany({
      data: items.map((item) => ({
        packing_task_id: task.id,
        outbound_order_item_id: item.id,
        variant_id: item.variant_id,
        expected_qty: item.processed_qty,
        scanned_qty: 0,
        status: "PENDING",
      })),
    });
  }

  return task;
}

/**
 * Resolve a scanned code to one of the packing task's expected items.
 * Priority: individually tracked copy (inventory_units.unit_barcode) → variant identifier
 * (sku / isbn13 / isbn10 / internal_barcode), restricted to variants expected on this task.
 */
async function resolveScanCode(tx, packingTaskId, rawCode) {
  const code = String(rawCode || "").trim();
  if (!code) {
    return { result: "UNKNOWN", item: null, reason: "Empty scan code" };
  }

  const items = await tx.packing_task_items.findMany({
    where: { packing_task_id: packingTaskId },
  });
  if (items.length === 0) {
    return { result: "UNKNOWN", item: null, reason: "Packing task has no expected items" };
  }

  const variantIds = items.map((item) => item.variant_id);

  let variantId = null;

  const unit = await tx.inventory_units.findFirst({
    where: { unit_barcode: code, variant_id: { in: variantIds } },
    select: { variant_id: true },
  });
  if (unit) {
    variantId = unit.variant_id;
  } else {
    const variant = await tx.book_variants.findFirst({
      where: {
        id: { in: variantIds },
        OR: [
          { sku: code },
          { isbn13: code },
          { isbn10: code },
          { internal_barcode: code },
        ],
      },
      select: { id: true },
    });
    if (variant) variantId = variant.id;
  }

  if (!variantId) {
    return { result: "UNKNOWN", item: null, reason: "Book not found in this packing order" };
  }

  const item = items.find((it) => it.variant_id === variantId);
  if (!item || item.scanned_qty >= item.expected_qty) {
    return { result: "MISMATCH", item: item || null, reason: "Item already fully scanned or not expected" };
  }

  return { result: "MATCH", item, reason: null };
}

function isTaskFullyVerified(items) {
  return items.length > 0 && items.every((item) => item.status === "VERIFIED");
}

/**
 * Single source of truth for "mark a packing task as completed" — used by both the manual
 * Complete Packing action and the auto-complete trigger fired right after the last scan.
 * Caller is responsible for having already verified isTaskFullyVerified(items).
 */
async function markPackingTaskCompleted(tx, { taskId, actorUserId, rootOrderId }) {
  const updated = await tx.packing_tasks.update({
    where: { id: taskId },
    data: { status: "COMPLETED", completed_at: new Date() },
  });

  await tx.inventory_audit_logs.create({
    data: {
      actor_user_id: actorUserId,
      action_name: "PACKING_TASK_COMPLETED",
      entity_type: "PACKING_TASK",
      entity_id: taskId,
      after_data: { root_order_id: rootOrderId },
    },
  });

  return updated;
}

module.exports = {
  generateTaskNumber,
  createPackingTask,
  resolveScanCode,
  isTaskFullyVerified,
  markPackingTaskCompleted,
};
