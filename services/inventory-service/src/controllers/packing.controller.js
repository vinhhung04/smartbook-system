const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const { parseId, normalizeText } = require("../utils/validation");
const {
  createPackingTask,
  resolveScanCode,
  isTaskFullyVerified,
  markPackingTaskCompleted,
} = require("../services/packing.service");
const { toStorageRef } = require("../services/packing-video-storage.service");

const ORDER_READY_FOR_PACKING_STATUS = ["READY_FOR_OUTBOUND", "READY_TO_SHIP"];

function normalizeInvoiceCode(rawCode) {
  const code = normalizeText(rawCode);
  if (!code) return null;
  const match = code.match(/^SMARTBOOK:OUTBOUND:(.+)$/i);
  return match ? match[1].trim() : code;
}

async function scanInvoice(req, res) {
  const code = normalizeInvoiceCode(req.body?.code);
  const actorUserId = parseId(req.user?.id);

  if (!code) {
    return res.status(400).json({ message: "code is required" });
  }
  if (!actorUserId) {
    return res.status(401).json({ message: "Invalid current user context" });
  }

  try {
    const order = await prisma.outbound_orders.findFirst({
      where: { outbound_number: code },
      include: {
        warehouses: { select: { id: true, code: true, name: true } },
        outbound_order_items: {
          include: { book_variants: { select: { id: true, sku: true, books: { select: { title: true } } } } },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Outbound order not found for this code" });
    }
    if (!ORDER_READY_FOR_PACKING_STATUS.includes(order.status)) {
      return res.status(400).json({
        message: `Order chưa sẵn sàng đóng gói (status hiện tại: ${order.status}). Picking phải hoàn tất trước.`,
      });
    }

    let task = await prisma.packing_tasks.findFirst({
      where: { root_order_id: order.id, status: { in: ["PENDING", "IN_PROGRESS"] } },
      include: { packing_task_items: { include: { book_variants: { select: { id: true, sku: true, books: { select: { title: true } } } } } } },
    });

    if (!task) {
      task = await prisma.$transaction(async (tx) => {
        const created = await createPackingTask(tx, {
          outboundOrder: order,
          warehouseId: order.warehouse_id,
          orderItems: order.outbound_order_items,
        });
        await tx.packing_tasks.update({
          where: { id: created.id },
          data: { scan_invoice_code: code },
        });
        await tx.inventory_audit_logs.create({
          data: {
            actor_user_id: actorUserId,
            action_name: "PACKING_TASK_CREATED",
            entity_type: "PACKING_TASK",
            entity_id: created.id,
            after_data: { root_order_id: order.id, scan_invoice_code: code },
          },
        });
        return tx.packing_tasks.findUnique({
          where: { id: created.id },
          include: {
            packing_task_items: {
              include: { book_variants: { select: { id: true, sku: true, books: { select: { title: true } } } } },
            },
          },
        });
      });
    }

    return res.json({
      task,
      outbound_order: {
        id: order.id,
        outbound_number: order.outbound_number,
        status: order.status,
        warehouse: order.warehouses,
      },
    });
  } catch (error) {
    console.error("Error while scanning packing invoice:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function listPackingTasks(req, res) {
  const warehouseId = parseId(req.query.warehouse_id);
  const status = normalizeText(req.query.status);

  try {
    // Orders that finished Picking but have no active/completed packing task yet —
    // they must still show up as "waiting for packing" even before anyone scans them.
    const includeNotStarted = !status || status === "NOT_STARTED";

    const [tasks, pendingOrders] = await Promise.all([
      prisma.packing_tasks.findMany({
        where: {
          ...(warehouseId ? { warehouse_id: warehouseId } : {}),
          ...(status && status !== "NOT_STARTED" ? { status } : {}),
        },
        include: {
          outbound_orders: { select: { id: true, outbound_number: true, status: true } },
          warehouses: { select: { id: true, code: true, name: true } },
          packing_task_items: { select: { id: true, expected_qty: true, scanned_qty: true, status: true } },
        },
        orderBy: { created_at: "desc" },
      }),
      includeNotStarted
        ? prisma.outbound_orders.findMany({
            where: {
              status: { in: ORDER_READY_FOR_PACKING_STATUS },
              ...(warehouseId ? { warehouse_id: warehouseId } : {}),
              packing_tasks: { none: { status: { in: ["PENDING", "IN_PROGRESS", "COMPLETED"] } } },
            },
            select: {
              id: true,
              outbound_number: true,
              status: true,
              warehouse_id: true,
              warehouses: { select: { id: true, code: true, name: true } },
            },
          })
        : Promise.resolve([]),
    ]);

    const notStartedTasks = pendingOrders.map((order) => ({
      id: null,
      task_number: null,
      status: "NOT_STARTED",
      root_order_id: order.id,
      warehouse_id: order.warehouse_id,
      outbound_orders: { id: order.id, outbound_number: order.outbound_number, status: order.status },
      warehouses: order.warehouses,
      packing_task_items: [],
    }));

    return res.json({ tasks: [...notStartedTasks, ...tasks] });
  } catch (error) {
    console.error("Error while listing packing tasks:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function getPackingTaskDetail(req, res) {
  const taskId = parseId(req.params.taskId);
  if (!taskId) {
    return res.status(400).json({ message: "Invalid taskId" });
  }

  try {
    const task = await prisma.packing_tasks.findUnique({
      where: { id: taskId },
      include: {
        outbound_orders: { select: { id: true, outbound_number: true, status: true } },
        warehouses: { select: { id: true, code: true, name: true } },
        packing_task_items: {
          include: { book_variants: { select: { id: true, sku: true, isbn13: true, books: { select: { title: true } } } } },
        },
        packing_camera_evidence: {
          select: { id: true, evidence_type: true, captured_at: true, captured_by_user_id: true },
        },
      },
    });

    if (!task) {
      return res.status(404).json({ message: "Packing task not found" });
    }

    return res.json({ task });
  } catch (error) {
    console.error("Error while fetching packing task detail:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function claimPackingTask(req, res) {
  const taskId = parseId(req.params.taskId);
  const actorUserId = parseId(req.user?.id);
  const assignToSelf = req.path.endsWith("/claim-self");

  if (!taskId || !actorUserId) {
    return res.status(400).json({ message: "Invalid request" });
  }

  try {
    const task = await prisma.packing_tasks.findUnique({ where: { id: taskId } });
    if (!task) {
      return res.status(404).json({ message: "Packing task not found" });
    }
    if (task.assigned_packer_id && task.assigned_packer_id !== actorUserId) {
      return res.status(409).json({ message: "Task đã được nhân viên khác nhận" });
    }

    const updated = await prisma.packing_tasks.update({
      where: { id: taskId },
      data: {
        assigned_packer_id: assignToSelf ? actorUserId : req.body?.packer_id || actorUserId,
        assigned_at: new Date(),
        assigned_by_user_id: actorUserId,
        status: task.status === "PENDING" ? "IN_PROGRESS" : task.status,
        started_at: task.started_at || new Date(),
      },
    });

    return res.json({ task: updated });
  } catch (error) {
    console.error("Error while claiming packing task:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function scanPackingItem(req, res) {
  const taskId = parseId(req.params.taskId);
  const code = normalizeText(req.body?.code);
  const actorUserId = parseId(req.user?.id);

  if (!taskId || !code) {
    return res.status(400).json({ message: "taskId and code are required" });
  }
  if (!actorUserId) {
    return res.status(401).json({ message: "Invalid current user context" });
  }

  try {
    const task = await prisma.packing_tasks.findUnique({ where: { id: taskId } });
    if (!task) {
      return res.status(404).json({ message: "Packing task not found" });
    }
    if (task.status === "COMPLETED" || task.status === "CANCELLED") {
      return res.status(400).json({ message: `Task đã ${task.status}, không thể scan thêm` });
    }

    const result = await prisma.$transaction(async (tx) => {
      const resolution = await resolveScanCode(tx, taskId, code);

      await tx.packing_scan_events.create({
        data: {
          packing_task_id: taskId,
          packing_task_item_id: resolution.item?.id || null,
          scanned_code: code,
          scan_result: resolution.result,
          scanned_by_user_id: actorUserId,
        },
      });

      if (resolution.result !== "MATCH") {
        return { ok: false, resolution };
      }

      const nextScannedQty = resolution.item.scanned_qty + 1;
      const nextStatus = nextScannedQty >= resolution.item.expected_qty ? "VERIFIED" : "PENDING";
      const updatedItem = await tx.packing_task_items.update({
        where: { id: resolution.item.id },
        data: { scanned_qty: nextScannedQty, status: nextStatus },
      });

      // Signal completeness only — do NOT auto-complete the task here anymore. The client
      // keeps recording for a configurable grace period after the last scan (staff still
      // needs to physically finish boxing/taping) and calls the existing complete endpoint
      // itself once the recording is stopped and saved. Same markPackingTaskCompleted /
      // completePackingTask logic is reused there, unchanged.
      const allItems = await tx.packing_task_items.findMany({ where: { packing_task_id: taskId } });
      const allItemsVerified = isTaskFullyVerified(allItems);

      return { ok: true, item: updatedItem, allItemsVerified };
    });

    if (!result.ok) {
      return res.status(400).json({
        message: result.resolution.reason || "Scan không khớp với đơn đóng gói",
        scan_result: result.resolution.result,
      });
    }

    return res.json({
      item: result.item,
      scan_result: "MATCH",
      all_items_verified: result.allItemsVerified,
    });
  } catch (error) {
    console.error("Error while scanning packing item:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function uploadPackingEvidence(req, res) {
  const taskId = parseId(req.params.taskId);
  const evidenceType = normalizeText(req.body?.evidence_type);
  const storageRef = req.body?.storage_ref;
  const actorUserId = parseId(req.user?.id);

  if (!taskId || !evidenceType || !storageRef) {
    return res.status(400).json({ message: "taskId, evidence_type and storage_ref are required" });
  }
  if (!["PHOTO", "VIDEO", "LIVE_SNAPSHOT"].includes(evidenceType)) {
    return res.status(400).json({ message: "evidence_type must be PHOTO, VIDEO or LIVE_SNAPSHOT" });
  }
  if (!actorUserId) {
    return res.status(401).json({ message: "Invalid current user context" });
  }

  const ref = String(storageRef).trim();
  const isValidRef =
    ref.startsWith("data:image/") || ref.startsWith("data:video/") || ref.startsWith("http://") || ref.startsWith("https://");
  if (!isValidRef) {
    return res.status(400).json({ message: "storage_ref must be a data: URL or http(s) URL" });
  }

  try {
    const task = await prisma.packing_tasks.findUnique({ where: { id: taskId } });
    if (!task) {
      return res.status(404).json({ message: "Packing task not found" });
    }

    const evidence = await prisma.packing_camera_evidence.create({
      data: {
        packing_task_id: taskId,
        evidence_type: evidenceType,
        storage_ref: ref,
        captured_by_user_id: actorUserId,
        metadata: req.body?.metadata || undefined,
      },
    });

    return res.status(201).json({ evidence });
  } catch (error) {
    console.error("Error while uploading packing evidence:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

/** Runs before the video multer middleware so it can name the file using the real
 *  task_number / outbound_number instead of a random name. */
async function attachTaskNumberForUpload(req, res, next) {
  const taskId = parseId(req.params.taskId);
  if (!taskId) {
    return res.status(400).json({ message: "Invalid taskId" });
  }

  try {
    const task = await prisma.packing_tasks.findUnique({
      where: { id: taskId },
      include: { outbound_orders: { select: { outbound_number: true } } },
    });
    if (!task) {
      return res.status(404).json({ message: "Packing task not found" });
    }

    req.packingTaskNumber = task.task_number;
    req.packingOutboundNumber = task.outbound_orders?.outbound_number || taskId;
    return next();
  } catch (error) {
    console.error("Error while resolving packing task for video upload:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function uploadPackingVideoEvidence(req, res) {
  const taskId = parseId(req.params.taskId);
  const actorUserId = parseId(req.user?.id);

  if (!taskId) {
    return res.status(400).json({ message: "Invalid taskId" });
  }
  if (!actorUserId) {
    return res.status(401).json({ message: "Invalid current user context" });
  }
  if (!req.file) {
    return res.status(400).json({ message: "video file is required" });
  }

  try {
    const evidence = await prisma.packing_camera_evidence.create({
      data: {
        packing_task_id: taskId,
        evidence_type: "VIDEO",
        storage_ref: toStorageRef(req.file.filename),
        captured_by_user_id: actorUserId,
        metadata: {
          original_name: req.file.originalname,
          size: req.file.size,
          mimetype: req.file.mimetype,
        },
      },
    });

    return res.status(201).json({ evidence });
  } catch (error) {
    console.error("Error while uploading packing video evidence:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function completePackingTask(req, res) {
  const taskId = parseId(req.params.taskId);
  const actorUserId = parseId(req.user?.id);

  if (!taskId) {
    return res.status(400).json({ message: "Invalid taskId" });
  }
  if (!actorUserId) {
    return res.status(401).json({ message: "Invalid current user context" });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const task = await tx.packing_tasks.findUnique({
        where: { id: taskId },
        include: { packing_task_items: true },
      });
      if (!task) {
        return { invalid: true, statusCode: 404, message: "Packing task not found" };
      }
      if (task.status === "COMPLETED") {
        return { invalid: true, statusCode: 400, message: "Task already completed" };
      }
      if (!isTaskFullyVerified(task.packing_task_items)) {
        return {
          invalid: true,
          statusCode: 400,
          message: "Còn sách chưa scan đủ số lượng. Vui lòng scan đủ trước khi hoàn tất đóng gói.",
        };
      }

      const updated = await markPackingTaskCompleted(tx, {
        taskId,
        actorUserId,
        rootOrderId: task.root_order_id,
      });

      return { invalid: false, task: updated };
    });

    if (result.invalid) {
      return res.status(result.statusCode || 400).json({ message: result.message });
    }

    return res.json({ task: result.task });
  } catch (error) {
    console.error("Error while completing packing task:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function cancelPackingTask(req, res) {
  const taskId = parseId(req.params.taskId);
  const actorUserId = parseId(req.user?.id);

  if (!taskId) {
    return res.status(400).json({ message: "Invalid taskId" });
  }

  try {
    const task = await prisma.packing_tasks.findUnique({ where: { id: taskId } });
    if (!task) {
      return res.status(404).json({ message: "Packing task not found" });
    }
    if (task.status === "COMPLETED") {
      return res.status(400).json({ message: "Cannot cancel a completed task" });
    }

    const updated = await prisma.packing_tasks.update({
      where: { id: taskId },
      data: { status: "CANCELLED" },
    });

    await prisma.inventory_audit_logs.create({
      data: {
        actor_user_id: actorUserId,
        action_name: "PACKING_TASK_CANCELLED",
        entity_type: "PACKING_TASK",
        entity_id: taskId,
      },
    });

    return res.json({ task: updated });
  } catch (error) {
    console.error("Error while cancelling packing task:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function getPackingTaskHistory(req, res) {
  const taskId = parseId(req.params.taskId);
  if (!taskId) {
    return res.status(400).json({ message: "Invalid taskId" });
  }

  try {
    const [auditLogs, scanEvents] = await Promise.all([
      prisma.inventory_audit_logs.findMany({
        where: { entity_type: "PACKING_TASK", entity_id: taskId },
        orderBy: { created_at: "asc" },
      }),
      prisma.packing_scan_events.findMany({
        where: { packing_task_id: taskId },
        orderBy: { scanned_at: "asc" },
      }),
    ]);

    return res.json({ audit_logs: auditLogs, scan_events: scanEvents });
  } catch (error) {
    console.error("Error while fetching packing task history:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

module.exports = {
  scanInvoice,
  listPackingTasks,
  getPackingTaskDetail,
  claimPackingTask,
  scanPackingItem,
  uploadPackingEvidence,
  attachTaskNumberForUpload,
  uploadPackingVideoEvidence,
  completePackingTask,
  cancelPackingTask,
  getPackingTaskHistory,
};
