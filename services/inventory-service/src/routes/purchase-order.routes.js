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
  getPurchaseOrderReconciliation,
  createGoodsReceiptFromPurchaseOrder,
} = require("../controllers/purchase-order.controller");
const { authorizeAnyPermission } = require("../middlewares/auth.middleware");

const router = express.Router();

const canRead = authorizeAnyPermission([
  "inventory.purchase.read",
  "inventory.purchase.write",
  "inventory.purchase.approve",
]);
const canWrite = authorizeAnyPermission(["inventory.purchase.write"]);
const canApprove = authorizeAnyPermission(["inventory.purchase.approve"]);

router.get("/", canRead, getPurchaseOrders);
router.post("/", canWrite, createPurchaseOrder);
router.get("/:id/reconciliation", canRead, getPurchaseOrderReconciliation);
router.post("/:id/submit", canWrite, submitPurchaseOrder);
router.post("/:id/approve", canApprove, approvePurchaseOrder);
router.post("/:id/reject", canApprove, rejectPurchaseOrder);
router.post("/:id/cancel", canWrite, cancelPurchaseOrder);
router.post("/:id/goods-receipts", canWrite, createGoodsReceiptFromPurchaseOrder);
router.get("/:id", canRead, getPurchaseOrderById);
router.patch("/:id", canWrite, updatePurchaseOrder);

module.exports = router;
