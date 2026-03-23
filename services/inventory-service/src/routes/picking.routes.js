const express = require("express");

const {
  listPickingTasks,
  claimPickingTask,
  getPickingTaskDetail,
  confirmPickerPresence,
  lookupVariantByBarcode,
  confirmPickingLine,
  cancelTransferReturn,
  cancelOutboundReturn,
  ensureRepicksEndpoint,
} = require("../controllers/picking.controller");
const { authorizeAnyPermission } = require("../middlewares/auth.middleware");

const router = express.Router();
const canOperateStock = authorizeAnyPermission(["inventory.stock.write"]);

router.get("/tasks", canOperateStock, listPickingTasks);
router.post(
  "/tasks/:taskType/:taskId/claim",
  canOperateStock,
  claimPickingTask,
);
router.get("/tasks/:taskType/:taskId", canOperateStock, getPickingTaskDetail);
router.post(
  "/tasks/:taskType/:taskId/presence",
  canOperateStock,
  confirmPickerPresence,
);
router.get(
  "/lookup/variant-by-barcode",
  canOperateStock,
  lookupVariantByBarcode,
);
router.post(
  "/tasks/:taskType/:taskId/lines/:lineId/confirm",
  canOperateStock,
  confirmPickingLine,
);
router.post(
  "/tasks/transfer/:taskId/cancel-return",
  canOperateStock,
  cancelTransferReturn,
);
router.post(
  "/tasks/outbound/:taskId/cancel-return",
  canOperateStock,
  cancelOutboundReturn,
);
router.post("/repicks/ensure", canOperateStock, ensureRepicksEndpoint);

module.exports = router;
