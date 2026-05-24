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
const { authorizeAnyPermission } = require("../middlewares/auth.middleware");

const router = express.Router();

const canReadSupplierPortal = authorizeAnyPermission(["supplier.portal.read", "supplier.portal.write"]);
const canWriteSupplierPortal = authorizeAnyPermission(["supplier.portal.write"]);

router.get("/orders", canReadSupplierPortal, getSupplierAccountOrders);
router.post("/orders/:poId/confirm", canWriteSupplierPortal, confirmSupplierAccountOrder);
router.post("/orders/:poId/invoices", canWriteSupplierPortal, createSupplierAccountInvoice);
router.post("/orders/:poId/shortage-reports/:reportId/acknowledge", canWriteSupplierPortal, acknowledgeSupplierAccountShortage);
router.post("/orders/:poId/shortage-reports/:reportId/cannot-fulfill", canWriteSupplierPortal, cannotFulfillSupplierAccountShortage);
router.post("/orders/:poId/shortage-reports/:reportId/redelivery-invoice", canWriteSupplierPortal, createSupplierAccountRedeliveryInvoice);
router.post("/orders/:poId/create-goods-receipt", canWriteSupplierPortal, supplierCannotPostStock);
router.post("/orders/:poId/post-goods-receipt", canWriteSupplierPortal, supplierCannotPostStock);

module.exports = router;
