const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function nextTaskNumber(tx, type) {
  const client = tx || prisma;
  const rows = await client.$queryRawUnsafe(
    `UPDATE picking_task_sequences
     SET last_number = last_number + 1, updated_at = now()
     WHERE sequence_type = $1
     RETURNING last_number`,
    type,
  );
  const num = Number(rows[0].last_number);
  const padded = String(num).padStart(4, "0");
  return type === "PICK" ? `PK-${padded}` : `RPK-${padded}`;
}

async function createPickingTask(tx, { outboundOrder, actorUserId }) {
  const taskNumber = await nextTaskNumber(tx, "PICK");

  const task = await tx.picking_tasks.create({
    data: {
      task_number: taskNumber,
      root_order_id: outboundOrder.id,
      parent_id: null,
      picking_type: "PICK",
      warehouse_id: outboundOrder.warehouse_id,
      status: "PENDING",
      created_at: new Date(),
      updated_at: new Date(),
    },
  });

  const items = outboundOrder.outbound_order_items || [];
  if (items.length > 0) {
    await tx.picking_task_items.createMany({
      data: items.map((item) => ({
        picking_task_id: task.id,
        outbound_order_item_id: item.id,
        variant_id: item.variant_id,
        source_location_id: item.source_location_id || null,
        requested_qty: item.quantity,
        picked_qty: item.processed_qty || 0,
        short_qty: Math.max(0, item.quantity - (item.processed_qty || 0)),
        status: "PENDING",
        created_at: new Date(),
        updated_at: new Date(),
      })),
    });
  }

  return task;
}

async function createRepickTask(tx, { parentPickingTask, shortages, actorUserId }) {
  const taskNumber = await nextTaskNumber(tx, "REPICK");

  const task = await tx.picking_tasks.create({
    data: {
      task_number: taskNumber,
      root_order_id: parentPickingTask.root_order_id,
      parent_id: parentPickingTask.id,
      picking_type: "REPICK",
      warehouse_id: parentPickingTask.warehouse_id,
      status: "PENDING",
      created_at: new Date(),
      updated_at: new Date(),
    },
  });

  if (shortages.length > 0) {
    await tx.picking_task_items.createMany({
      data: shortages.map((s) => ({
        picking_task_id: task.id,
        outbound_order_item_id: s.outbound_order_item_id || null,
        variant_id: s.variant_id,
        source_location_id: s.source_location_id || null,
        requested_qty: s.qty,
        picked_qty: 0,
        short_qty: s.qty,
        status: "PENDING",
        created_at: new Date(),
        updated_at: new Date(),
      })),
    });
  }

  return task;
}

module.exports = { nextTaskNumber, createPickingTask, createRepickTask };
