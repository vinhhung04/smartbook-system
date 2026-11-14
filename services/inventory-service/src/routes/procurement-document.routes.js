const express = require("express");

const {
  internal,
  shareInternalDocument,
  issueGoodsReceiptConfirmation,
  getGoodsReceiptDocuments,
  getPurchaseOrderActivity,
} = require("../controllers/procurement-document.controller");
const { handleDocumentUpload } = require("../services/procurement-document-storage.service");
const {
  authorizeManagerDecision,
  authorizeTaskRead,
  authorizeTaskProgress,
} = require("../middlewares/auth.middleware");

// SmartBook side of the shared procurement document registry.
// Managers: POs in their warehouse scope. Warehouse staff: only POs with a goods receipt assigned
// to them (checked in the controller), and only receiving minutes / discrepancy scans.
// Supplier-side routes live in supplier-account.routes.js.
const router = express.Router();

const canRead = authorizeTaskRead(["inventory.task.read", "inventory.purchase.read"]);
const canWrite = authorizeTaskProgress(["inventory.task.progress", "inventory.purchase.write"]);
const canManage = authorizeManagerDecision(["inventory.purchase.write"]);

router.get("/purchase-orders/:poId", canRead, internal.list);
router.get("/purchase-orders/:poId/activity", canRead, getPurchaseOrderActivity);
router.post("/purchase-orders/:poId", canWrite, handleDocumentUpload, internal.create);
router.get("/goods-receipts/:grId", canRead, getGoodsReceiptDocuments);
router.post("/goods-receipts/:grId/confirmation", canManage, issueGoodsReceiptConfirmation);
router.get("/:docId", canRead, internal.get);
router.get("/:docId/files/:fileId/download", canRead, internal.download);
router.post("/:docId/files", canWrite, handleDocumentUpload, internal.uploadVersion);
router.post("/:docId/issue", canWrite, internal.issue);
router.post("/:docId/cancel", canWrite, internal.cancel);
router.post("/:docId/acknowledge", canWrite, internal.acknowledge);
router.post("/:docId/share", canManage, shareInternalDocument);

module.exports = router;
