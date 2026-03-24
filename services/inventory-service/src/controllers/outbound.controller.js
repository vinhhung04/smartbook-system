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

  try {
    const [outboundOrders, transferOrders] = await Promise.all([
      prisma.outbound_orders.findMany({
        where: {
          status: "READY_FOR_OUTBOUND",
          ...(warehouseId ? { warehouse_id: warehouseId } : {}),
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
    ]);

    const data = [
      ...outboundOrders.map((order) => ({
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
        total_quantity: (order.outbound_order_items || []).reduce(
          (sum, line) => sum + Number(line.quantity || 0),
          0,
        ),
        ready_quantity: (order.outbound_order_items || []).reduce(
          (sum, line) => sum + Number(line.processed_qty || 0),
          0,
        ),
      })),
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

      return res.json({
        task_type: "outbound",
        task_id: order.id,
        order_number: order.outbound_number,
        status: order.status,
        source_warehouse_id: order.warehouse_id,
        source_warehouse_code: order.warehouses?.code || null,
        source_warehouse_name: order.warehouses?.name || null,
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
            },
          });

          if (!order)
            return {
              invalid: true,
              statusCode: 404,
              message: "Outbound order not found",
            };
          if (order.status !== "READY_FOR_OUTBOUND") {
            return {
              invalid: true,
              statusCode: 400,
              message: "Outbound order must be READY_FOR_OUTBOUND",
            };
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

        const existingReceipt = await tx.goods_receipts.findFirst({
          where: {
            warehouse_id: order.to_warehouse_id,
            source_type: "TRANSFER",
            source_reference_id: order.id,
          },
          select: {
            id: true,
            warehouse_id: true,
            receipt_number: true,
            status: true,
          },
        });

        let destinationReceipt = existingReceipt;
        if (!destinationReceipt) {
          destinationReceipt = await tx.goods_receipts.create({
            data: {
              receipt_number: createReceiptNumber(baseTimestamp),
              warehouse_id: order.to_warehouse_id,
              source_type: "TRANSFER",
              source_reference_id: order.id,
              status: "POSTED",
              received_by_user_id: actorUserIdRequired,
              note: `Auto-created from transfer ${order.transfer_number}`,
            },
            select: {
              id: true,
              warehouse_id: true,
              receipt_number: true,
              status: true,
            },
          });

          await tx.goods_receipt_items.createMany({
            data: lines
              .filter((line) => Number(line.shipped_qty || 0) > 0)
              .map((line) => ({
                goods_receipt_id: destinationReceipt.id,
                variant_id: line.variant_id,
                location_id: null,
                quantity: Number(line.shipped_qty || 0),
                unit_cost: Number(line.unit_cost || 0),
                note: `Auto-created from transfer line ${line.id}`,
              })),
          });

          await postTransferReceiptToReceiving(
            tx,
            destinationReceipt,
            actorUserIdOptional,
          );
        }

        await tx.transfer_orders.update({
          where: { id: order.id },
          data: {
            status: "OUTBOUND_COMPLETED",
            shipped_at: new Date(),
            shipped_by_user_id: actorUserIdOptional,
          },
        });

        await tx.inventory_audit_logs.create({
          data: {
            actor_user_id: actorUserIdOptional,
            action_name: "TRANSFER_OUTBOUND_CONFIRMED",
            entity_type: "TRANSFER_ORDER",
            entity_id: order.id,
            after_data: {
              status: "OUTBOUND_COMPLETED",
              destination_receipt_id: destinationReceipt.id,
              destination_receipt_number: destinationReceipt.receipt_number,
              scan_code: scanCode,
            },
          },
        });

        return {
          data: {
            task_type: "transfer",
            task_id: order.id,
            status: "OUTBOUND_COMPLETED",
            destination_receipt_id: destinationReceipt.id,
            destination_receipt_number: destinationReceipt.receipt_number,
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
  confirmOutbound,
};
