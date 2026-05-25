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
const { authorizeAnyPermission, authorizePurchaseManager } = require("../middlewares/auth.middleware");

const router = express.Router();

const canRead = authorizeAnyPermission([
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
