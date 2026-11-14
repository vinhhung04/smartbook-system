const express = require("express");

const {
  getPurchaseOrders,
  getPurchaseOrderById,
  createPurchaseOrder,
  updatePurchaseOrder,
  submitPurchaseOrder,
  approvePurchaseOrder,
  rejectPurchaseOrder,
  cancelPurchaseOrder,
  sendToSupplier,
  supplierConfirm,
  getSupplierDocuments,
  getShortageReports,
  sendShortageReport,
  resolveShortageReport,
  getPurchaseOrderReconciliation,
  createGoodsReceiptFromPurchaseOrder,
} = require("../controllers/purchase-order.controller");
const {
  reviewSupplierResponse,
  getDocumentReconciliation,
  completeDocumentReconciliation,
} = require("../controllers/procurement-workflow.controller");
const {
  requestPurchaseOrderRevision,
  approveRevision,
  rejectRevision,
  cancelRevision,
  supplierConfirmRevision,
  supplierRejectRevision,
  getPurchaseOrderRevisions,
} = require("../controllers/purchase-order-revision.controller");
const { closeRemainingLine, reopenLine } = require("../controllers/purchase-order-line-closure.controller");
const {
  requestSupplierReturn,
  approveSupplierReturn,
  rejectSupplierReturn,
  cancelSupplierReturn,
  supplierConfirmReturn,
  supplierRejectReturn,
  executeSupplierReturn,
  completeSupplierReturn,
  getSupplierReturns,
} = require("../controllers/supplier-return.controller");
const { authorizeManagerRead, authorizePurchaseManager } = require("../middlewares/auth.middleware");

const router = express.Router();

const canRead = authorizeManagerRead([
  "inventory.purchase.read",
  "inventory.purchase.write",
  "inventory.purchase.approve",
]);
const canWrite = authorizePurchaseManager(["inventory.purchase.write"]);
const canApprove = authorizePurchaseManager(["inventory.purchase.approve"]);
const canReceiveFromPurchase = authorizePurchaseManager(["inventory.purchase.write"]);

router.get("/", canRead, getPurchaseOrders);
router.post("/", canWrite, createPurchaseOrder);
router.get("/:id/reconciliation", canRead, getPurchaseOrderReconciliation);
router.get("/:id/supplier-documents", canRead, getSupplierDocuments);
router.get("/:id/shortage-reports", canRead, getShortageReports);
router.get("/:id/document-reconciliation", canRead, getDocumentReconciliation);
router.post("/:id/document-reconciliation/complete", canWrite, completeDocumentReconciliation);
router.post("/:id/supplier-responses/:responseId/review", canApprove, reviewSupplierResponse);
router.get("/:id/revisions", canRead, getPurchaseOrderRevisions);
router.post("/:id/revisions", canWrite, requestPurchaseOrderRevision);
router.post("/:id/revisions/:revisionId/approve", canApprove, approveRevision);
router.post("/:id/revisions/:revisionId/reject", canApprove, rejectRevision);
router.post("/:id/revisions/:revisionId/cancel", canWrite, cancelRevision);
router.post("/:id/revisions/:revisionId/supplier-confirm", canWrite, supplierConfirmRevision);
router.post("/:id/revisions/:revisionId/supplier-reject", canWrite, supplierRejectRevision);
router.post("/:id/items/:itemId/close-remaining", canWrite, closeRemainingLine);
router.post("/:id/items/:itemId/reopen-remaining", canApprove, reopenLine);
router.get("/:id/returns", canRead, getSupplierReturns);
router.post("/:id/returns", canWrite, requestSupplierReturn);
router.post("/:id/returns/:returnId/approve", canApprove, approveSupplierReturn);
router.post("/:id/returns/:returnId/reject", canApprove, rejectSupplierReturn);
router.post("/:id/returns/:returnId/cancel", canWrite, cancelSupplierReturn);
router.post("/:id/returns/:returnId/supplier-confirm", canWrite, supplierConfirmReturn);
router.post("/:id/returns/:returnId/supplier-reject", canWrite, supplierRejectReturn);
router.post("/:id/returns/:returnId/execute", canWrite, executeSupplierReturn);
router.post("/:id/returns/:returnId/complete", canWrite, completeSupplierReturn);
router.post("/:id/submit", canWrite, submitPurchaseOrder);
router.post("/:id/approve", canApprove, approvePurchaseOrder);
router.post("/:id/reject", canApprove, rejectPurchaseOrder);
router.post("/:id/cancel", canWrite, cancelPurchaseOrder);
router.post("/:id/send-to-supplier", canWrite, sendToSupplier);
router.post("/:id/supplier-confirm", canWrite, supplierConfirm);
router.post("/:id/shortage-reports/:reportId/send", canWrite, sendShortageReport);
router.post("/:id/shortage-reports/:reportId/resolve", canWrite, resolveShortageReport);
router.post("/:id/goods-receipts", canReceiveFromPurchase, createGoodsReceiptFromPurchaseOrder);
router.get("/:id", canRead, getPurchaseOrderById);
router.patch("/:id", canWrite, updatePurchaseOrder);

module.exports = router;
