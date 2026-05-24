const express = require("express");

const {
  getSupplierAccountOrders,
  confirmSupplierAccountOrder,
  createSupplierAccountInvoice,
  acknowledgeSupplierAccountShortage,
  cannotFulfillSupplierAccountShortage,
  createSupplierAccountRedeliveryInvoice,
  supplierCannotPostStock,
} = require("../controllers/supplier-portal.controller");

const router = express.Router();

router.get("/orders", getSupplierAccountOrders);
router.post("/orders/:poId/confirm", confirmSupplierAccountOrder);
router.post("/orders/:poId/invoices", createSupplierAccountInvoice);
router.post("/orders/:poId/shortage-reports/:reportId/acknowledge", acknowledgeSupplierAccountShortage);
router.post("/orders/:poId/shortage-reports/:reportId/cannot-fulfill", cannotFulfillSupplierAccountShortage);
router.post("/orders/:poId/shortage-reports/:reportId/redelivery-invoice", createSupplierAccountRedeliveryInvoice);
router.post("/orders/:poId/create-goods-receipt", supplierCannotPostStock);
router.post("/orders/:poId/post-goods-receipt", supplierCannotPostStock);

module.exports = router;
