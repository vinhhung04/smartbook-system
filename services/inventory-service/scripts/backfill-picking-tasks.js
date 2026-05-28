/**
 * Backfill script: populate picking_tasks + picking_task_items from existing outbound_orders.
 *
 * Run once after deploying migration 20260529000600_add_picking_tasks.
 * Idempotent: skips orders that already have a picking_tasks row.
 *
 * Usage:
 *   node scripts/backfill-picking-tasks.js
 */

"use strict";

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const REPICK_META_MARKER = "REPICK_META";

function parseMarkerPayload(note, marker) {
  if (!note) return null;
  const tag = `[${marker}]`;
  const idx = note.indexOf(tag);
  if (idx === -1) return null;
  const rest = note.slice(idx + tag.length).trim();
  const line = rest.split("\n")[0].trim();
  const payload = {};
  for (const pair of line.split(";")) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx === -1) continue;
    const k = decodeURIComponent(pair.slice(0, eqIdx).trim());
    const v = decodeURIComponent(pair.slice(eqIdx + 1).trim());
    payload[k] = v;
  }
  return payload;
}

function parseRepickMeta(note) {
  const payload = parseMarkerPayload(note, REPICK_META_MARKER);
  if (!payload) return null;
  const rootTaskId = String(payload.root_task_id || "").trim();
  const parentTaskId = String(payload.parent_task_id || "").trim();
  if (!rootTaskId || !parentTaskId) return null;
  return {
    root_task_id: rootTaskId,
    parent_task_id: parentTaskId,
    repick_sequence: parseInt(payload.repick_sequence || "0", 10) || 0,
  };
}

async function nextTaskNumber(tx, type) {
  const rows = await tx.$queryRawUnsafe(
    `UPDATE picking_task_sequences SET last_number = last_number + 1, updated_at = now() WHERE sequence_type = $1 RETURNING last_number`,
    type,
  );
  const num = Number(rows[0].last_number);
  return type === "PICK"
    ? `PK-${String(num).padStart(4, "0")}`
    : `RPK-${String(num).padStart(4, "0")}`;
}

function statusMap(outboundStatus) {
  if (outboundStatus === "APPROVED") return "PENDING";
  if (outboundStatus === "PICKING") return "PICKING";
  if (outboundStatus === "READY_FOR_OUTBOUND") return "COMPLETED";
  if (outboundStatus === "COMPLETED") return "COMPLETED";
  if (outboundStatus === "CANCELLED") return "CANCELLED";
  return "PENDING";
}

async function main() {
  console.log("Starting backfill of picking_tasks...");

  // Fetch all outbound orders that don't yet have a picking_tasks row
  const ordersWithoutTasks = await prisma.$queryRawUnsafe(`
    SELECT o.id, o.status, o.warehouse_id, o.note
    FROM outbound_orders o
    WHERE o.status IN ('APPROVED','PICKING','READY_FOR_OUTBOUND','COMPLETED','CANCELLED')
      AND NOT EXISTS (
        SELECT 1 FROM picking_tasks pt WHERE pt.root_order_id = o.id
      )
    ORDER BY o.created_at ASC
  `);

  console.log(`Found ${ordersWithoutTasks.length} outbound orders to backfill`);

  // Separate PICK (no REPICK_META) from REPICK (has REPICK_META)
  const pickOrders = ordersWithoutTasks.filter((o) => !parseRepickMeta(o.note));
  const repickOrders = ordersWithoutTasks.filter((o) => parseRepickMeta(o.note));

  console.log(`  PICK orders: ${pickOrders.length}`);
  console.log(`  REPICK orders: ${repickOrders.length}`);

  // --- Pass 1: Insert PICK tasks ---
  let pickCreated = 0;
  for (const order of pickOrders) {
    try {
      await prisma.$transaction(async (tx) => {
        const taskNumber = await nextTaskNumber(tx, "PICK");
        const task = await tx.picking_tasks.create({
          data: {
            task_number: taskNumber,
            root_order_id: order.id,
            parent_id: null,
            picking_type: "PICK",
            warehouse_id: order.warehouse_id,
            status: statusMap(order.status),
            completed_at: ["READY_FOR_OUTBOUND", "COMPLETED"].includes(order.status) ? new Date() : null,
            created_at: new Date(),
            updated_at: new Date(),
          },
        });

        // Fetch items for this order
        const items = await tx.outbound_order_items.findMany({
          where: { outbound_order_id: order.id },
          select: { id: true, variant_id: true, source_location_id: true, quantity: true, processed_qty: true },
        });

        if (items.length > 0) {
          await tx.picking_task_items.createMany({
            data: items.map((item) => {
              const pickedQty = Number(item.processed_qty || 0);
              const requestedQty = Number(item.quantity || 0);
              return {
                picking_task_id: task.id,
                outbound_order_item_id: item.id,
                variant_id: item.variant_id,
                source_location_id: item.source_location_id || null,
                requested_qty: requestedQty,
                picked_qty: pickedQty,
                short_qty: Math.max(0, requestedQty - pickedQty),
                status: pickedQty >= requestedQty ? "PICKED" : pickedQty > 0 ? "PENDING" : "PENDING",
                created_at: new Date(),
                updated_at: new Date(),
              };
            }),
          });
        }
      });
      pickCreated++;
      if (pickCreated % 50 === 0) console.log(`  Created ${pickCreated}/${pickOrders.length} PICK tasks...`);
    } catch (err) {
      console.error(`  Failed to create PICK task for order ${order.id}:`, err.message);
    }
  }
  console.log(`Pass 1 complete: ${pickCreated} PICK tasks created`);

  // --- Pass 2: Insert REPICK tasks ---
  // Build a lookup: outbound_order_id → picking_task_id for PICK tasks
  const allPickTasks = await prisma.picking_tasks.findMany({
    where: { picking_type: "PICK" },
    select: { id: true, root_order_id: true },
  });
  const pickTaskByOrderId = new Map(allPickTasks.map((pt) => [pt.root_order_id, pt.id]));

  let repickCreated = 0;
  for (const order of repickOrders) {
    const meta = parseRepickMeta(order.note);
    if (!meta) continue;

    // parent_id is the picking_task for the parent outbound order
    const parentPickingTaskId = pickTaskByOrderId.get(meta.parent_task_id) || null;
    const rootOrderId = meta.root_task_id;

    try {
      await prisma.$transaction(async (tx) => {
        const taskNumber = await nextTaskNumber(tx, "REPICK");
        const task = await tx.picking_tasks.create({
          data: {
            task_number: taskNumber,
            root_order_id: rootOrderId,
            parent_id: parentPickingTaskId,
            picking_type: "REPICK",
            warehouse_id: order.warehouse_id,
            status: statusMap(order.status),
            completed_at: ["READY_FOR_OUTBOUND", "COMPLETED"].includes(order.status) ? new Date() : null,
            created_at: new Date(),
            updated_at: new Date(),
          },
        });

        // Also register this REPICK's picking_task_id for later REPICK→REPICK chains
        pickTaskByOrderId.set(order.id, task.id);

        const items = await tx.outbound_order_items.findMany({
          where: { outbound_order_id: order.id },
          select: { id: true, variant_id: true, source_location_id: true, quantity: true, processed_qty: true },
        });

        if (items.length > 0) {
          await tx.picking_task_items.createMany({
            data: items.map((item) => {
              const pickedQty = Number(item.processed_qty || 0);
              const requestedQty = Number(item.quantity || 0);
              return {
                picking_task_id: task.id,
                outbound_order_item_id: item.id,
                variant_id: item.variant_id,
                source_location_id: item.source_location_id || null,
                requested_qty: requestedQty,
                picked_qty: pickedQty,
                short_qty: Math.max(0, requestedQty - pickedQty),
                status: pickedQty >= requestedQty ? "PICKED" : "PENDING",
                created_at: new Date(),
                updated_at: new Date(),
              };
            }),
          });
        }
      });
      repickCreated++;
    } catch (err) {
      console.error(`  Failed to create REPICK task for order ${order.id}:`, err.message);
    }
  }
  console.log(`Pass 2 complete: ${repickCreated} REPICK tasks created`);

  const totalPT = await prisma.picking_tasks.count();
  const totalPTI = await prisma.picking_task_items.count();
  console.log(`\nBackfill complete.`);
  console.log(`  Total picking_tasks: ${totalPT}`);
  console.log(`  Total picking_task_items: ${totalPTI}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
