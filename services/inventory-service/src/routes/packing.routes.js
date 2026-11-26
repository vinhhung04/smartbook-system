const express = require("express");

const {
  scanInvoice,
  listPackingTasks,
  getPackingTaskDetail,
  claimPackingTask,
  scanPackingItem,
  uploadPackingEvidence,
  attachTaskNumberForUpload,
  uploadPackingVideoEvidence,
  listPackingEvidence,
  streamPackingEvidenceVideo,
  completePackingTask,
  cancelPackingTask,
  getPackingTaskHistory,
} = require("../controllers/packing.controller");
const { handleVideoUpload } = require("../services/packing-video-storage.service");
const {
  authorizeManagerDecision,
  authorizeTaskRead,
  authorizeTaskProgress,
} = require("../middlewares/auth.middleware");
const { requireRecordWarehouse } = require("../middlewares/warehouse-scope.middleware");
const { packingTaskWarehouse } = require("../utils/record-warehouse");

const router = express.Router();
const canReadTask = authorizeTaskRead(["inventory.task.read"]);
const canUpdateTaskProgress = authorizeTaskProgress(["inventory.task.progress"]);
const canDecideOperation = authorizeManagerDecision(["inventory.operation.decide"]);
// every packing step acts on the task's stored warehouse (WRITE scope)
const writesTask = requireRecordWarehouse(packingTaskWarehouse);
const claimsTask = requireRecordWarehouse(packingTaskWarehouse, { fresh: true });
const readsTask = requireRecordWarehouse(packingTaskWarehouse, { access: "read" });

router.post("/scan-invoice", canUpdateTaskProgress, scanInvoice);
router.get("/tasks", canReadTask, listPackingTasks);
router.get("/tasks/:taskId", canReadTask, getPackingTaskDetail);
router.post("/tasks/:taskId/claim", canDecideOperation, claimsTask, claimPackingTask);
router.post("/tasks/:taskId/claim-self", canUpdateTaskProgress, claimsTask, claimPackingTask);
router.post("/tasks/:taskId/items/scan", canUpdateTaskProgress, writesTask, scanPackingItem);
router.post("/tasks/:taskId/evidence", canUpdateTaskProgress, writesTask, uploadPackingEvidence);
router.post(
  "/tasks/:taskId/evidence/video",
  canUpdateTaskProgress,
  writesTask,
  attachTaskNumberForUpload,
  handleVideoUpload,
  uploadPackingVideoEvidence,
);
router.get("/tasks/:taskId/evidence/videos", canReadTask, readsTask, listPackingEvidence);
router.get("/tasks/:taskId/evidence/:evidenceId/video", canReadTask, readsTask, streamPackingEvidenceVideo);
router.post("/tasks/:taskId/complete", canUpdateTaskProgress, claimsTask, completePackingTask);
router.post("/tasks/:taskId/cancel", canDecideOperation, claimsTask, cancelPackingTask);
router.get("/tasks/:taskId/history", canReadTask, getPackingTaskHistory);

module.exports = router;
