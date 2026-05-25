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
const {
  authorizeAnyPermission,
  authorizeManagerDecision,
  authorizeStaffTaskUpdate,
} = require("../middlewares/auth.middleware");

const router = express.Router();
const canReadTask = authorizeAnyPermission(["inventory.task.read", "inventory.picking.read", "inventory.stock.read"]);
const canUpdateAssignedTask = authorizeStaffTaskUpdate(["inventory.task.update"]);
const canDecideOperation = authorizeManagerDecision(["inventory.operation.decide"]);

router.get("/tasks", canReadTask, listPickingTasks);
router.post(
  "/tasks/:taskType/:taskId/claim",
  canUpdateAssignedTask,
  claimPickingTask,
);
router.get("/tasks/:taskType/:taskId", canReadTask, getPickingTaskDetail);
router.post(
  "/tasks/:taskType/:taskId/presence",
  canUpdateAssignedTask,
  confirmPickerPresence,
);
router.get(
  "/lookup/variant-by-barcode",
  canUpdateAssignedTask,
  lookupVariantByBarcode,
);
router.post(
  "/tasks/:taskType/:taskId/lines/:lineId/confirm",
  canUpdateAssignedTask,
  confirmPickingLine,
);
router.post(
  "/tasks/transfer/:taskId/cancel-return",
  canDecideOperation,
  cancelTransferReturn,
);
router.post(
  "/tasks/outbound/:taskId/cancel-return",
  canDecideOperation,
  cancelOutboundReturn,
);
router.post("/repicks/ensure", canDecideOperation, ensureRepicksEndpoint);

module.exports = router;
