const express = require("express");

const {
  getSupplierDeliveries,
  getSupplierDeliveryById,
  createSupplierDelivery,
  createGoodsReceiptFromInvoice,
} = require("../controllers/supplier-delivery.controller");
const { authorizeAnyPermission, authorizeManagerDecision } = require("../middlewares/auth.middleware");

const router = express.Router();

const canRead = authorizeAnyPermission([
  "inventory.purchase.read",
  "inventory.purchase.write",
  "inventory.stock.read",
  "inventory.supplier.read",
]);
const canWrite = authorizeManagerDecision(["inventory.operation.decide"]);

router.get("/", canRead, getSupplierDeliveries);
router.post("/", canWrite, createSupplierDelivery);
router.get("/:id", canRead, getSupplierDeliveryById);
router.post("/:id/create-goods-receipt", canWrite, createGoodsReceiptFromInvoice);

module.exports = router;
