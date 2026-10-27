const express = require("express");

const {
  listPickingTasks,
  claimPickingTask,
  claimSelfPickingTask,
  getPickingTaskDetail,
  confirmPickerPresence,
  lookupVariantByBarcode,
  confirmPickingLine,
  cancelTransferReturn,
  cancelOutboundReturn,
  ensureRepicksEndpoint,
  declareOutboundShortage,
  declareTransferShortage,
  listPickingTasksHierarchy,
  getPickingTaskChildren,
} = require("../controllers/picking.controller");
const {
  authorizeManagerDecision,
  authorizeTaskRead,
  authorizeTaskProgress,
} = require("../middlewares/auth.middleware");
const { requireRecordWarehouse } = require("../middlewares/warehouse-scope.middleware");
const { taskOrderWarehouse } = require("../utils/record-warehouse");

const router = express.Router();
const canReadTask = authorizeTaskRead(["inventory.task.read"]);
const canUpdateTaskProgress = authorizeTaskProgress(["inventory.task.progress"]);
// Claims and every picking step act on the order's stored warehouse: READ
// scope sees a task, only WRITE scope may claim or work it.
const writesOrder = requireRecordWarehouse(taskOrderWarehouse());
const claimsOrder = requireRecordWarehouse(taskOrderWarehouse(), { fresh: true });
const writesOutbound = requireRecordWarehouse(taskOrderWarehouse("outbound"));
const writesTransfer = requireRecordWarehouse(taskOrderWarehouse("transfer"));
const canDecideOperation = authorizeManagerDecision(["inventory.operation.decide"]);

router.get("/tasks", canReadTask, listPickingTasks);
router.post(
  "/tasks/:taskType/:taskId/claim",
  canDecideOperation,
  claimsOrder,
  claimPickingTask,
);
router.post(
  "/tasks/:taskType/:taskId/claim-self",
  canUpdateTaskProgress,
  claimsOrder,
  claimSelfPickingTask,
);
router.get("/tasks/:taskType/:taskId", canReadTask, getPickingTaskDetail);
router.post(
  "/tasks/:taskType/:taskId/presence",
  canUpdateTaskProgress,
  writesOrder,
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
  writesOrder,
  confirmPickingLine,
);
router.post(
  "/tasks/transfer/:taskId/cancel-return",
  canDecideOperation,
  writesTransfer,
  cancelTransferReturn,
);
router.post(
  "/tasks/outbound/:taskId/cancel-return",
  canDecideOperation,
  writesOutbound,
  cancelOutboundReturn,
);
router.post("/repicks/ensure", canDecideOperation, ensureRepicksEndpoint);
router.post(
  "/tasks/outbound/:taskId/declare-shortage",
  canUpdateTaskProgress,
  writesOutbound,
  declareOutboundShortage,
);
router.post(
  "/tasks/transfer/:taskId/declare-shortage",
  canUpdateTaskProgress,
  writesTransfer,
  declareTransferShortage,
);

// New relational hierarchy endpoints for picking_tasks
router.get("/picking-tasks", canReadTask, listPickingTasksHierarchy);
router.get("/picking-tasks/:pickingTaskId/children", canReadTask, getPickingTaskChildren);

module.exports = router;
