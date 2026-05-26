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
  authorizeManagerDecision,
  authorizeTaskRead,
  authorizeTaskProgress,
} = require("../middlewares/auth.middleware");

const router = express.Router();
const canReadTask = authorizeTaskRead(["inventory.task.read"]);
const canUpdateTaskProgress = authorizeTaskProgress(["inventory.task.progress"]);
const canDecideOperation = authorizeManagerDecision(["inventory.operation.decide"]);

router.get("/tasks", canReadTask, listPickingTasks);
router.post(
  "/tasks/:taskType/:taskId/claim",
  canDecideOperation,
  claimPickingTask,
);
router.get("/tasks/:taskType/:taskId", canReadTask, getPickingTaskDetail);
router.post(
  "/tasks/:taskType/:taskId/presence",
  canUpdateTaskProgress,
  confirmPickerPresence,
);
router.get(
  "/lookup/variant-by-barcode",
  canUpdateTaskProgress,
  lookupVariantByBarcode,
);
router.post(
  "/tasks/:taskType/:taskId/lines/:lineId/confirm",
  canUpdateTaskProgress,
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
