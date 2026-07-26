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
  completePackingTask,
  cancelPackingTask,
  getPackingTaskHistory,
} = require("../controllers/packing.controller");
const { videoUploadMiddleware } = require("../services/packing-video-storage.service");
const {
  authorizeManagerDecision,
  authorizeTaskRead,
  authorizeTaskProgress,
} = require("../middlewares/auth.middleware");

const router = express.Router();
const canReadTask = authorizeTaskRead(["inventory.task.read"]);
const canUpdateTaskProgress = authorizeTaskProgress(["inventory.task.progress"]);
const canDecideOperation = authorizeManagerDecision(["inventory.operation.decide"]);

router.post("/scan-invoice", canUpdateTaskProgress, scanInvoice);
router.get("/tasks", canReadTask, listPackingTasks);
router.get("/tasks/:taskId", canReadTask, getPackingTaskDetail);
router.post("/tasks/:taskId/claim", canDecideOperation, claimPackingTask);
router.post("/tasks/:taskId/claim-self", canUpdateTaskProgress, claimPackingTask);
router.post("/tasks/:taskId/items/scan", canUpdateTaskProgress, scanPackingItem);
router.post("/tasks/:taskId/evidence", canUpdateTaskProgress, uploadPackingEvidence);
router.post(
  "/tasks/:taskId/evidence/video",
  canUpdateTaskProgress,
  attachTaskNumberForUpload,
  videoUploadMiddleware.single("video"),
  uploadPackingVideoEvidence,
);
router.post("/tasks/:taskId/complete", canUpdateTaskProgress, completePackingTask);
router.post("/tasks/:taskId/cancel", canDecideOperation, cancelPackingTask);
router.get("/tasks/:taskId/history", canReadTask, getPackingTaskHistory);

module.exports = router;
