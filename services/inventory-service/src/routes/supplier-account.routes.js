const express = require("express");

const {
  getSupplierAccountOrders,
  confirmSupplierAccountOrder,
  createSupplierAccountInvoice,
  acknowledgeSupplierAccountShortage,
  cannotFulfillSupplierAccountShortage,
  createSupplierAccountRedeliveryInvoice,
  supplierCannotPostStock,
  respondSupplierAccountOrder,
  proposeSupplierAccountShortageAction,
} = require("../controllers/supplier-portal.controller");
const { supplier: supplierDocuments } = require("../controllers/procurement-document.controller");
const { handleDocumentUpload } = require("../services/procurement-document-storage.service");
const { authorizeAnyPermission } = require("../middlewares/auth.middleware");

const router = express.Router();
const canUseSupplierPortal = authorizeAnyPermission(["supplier.portal.read", "supplier.portal.write"]);
const canWriteSupplierPortal = authorizeAnyPermission(["supplier.portal.write"]);

router.get("/orders", canUseSupplierPortal, getSupplierAccountOrders);
router.post("/orders/:poId/confirm", canWriteSupplierPortal, confirmSupplierAccountOrder);
router.post("/orders/:poId/invoices", canWriteSupplierPortal, createSupplierAccountInvoice);
router.post("/orders/:poId/shortage-reports/:reportId/acknowledge", canWriteSupplierPortal, acknowledgeSupplierAccountShortage);
router.post("/orders/:poId/shortage-reports/:reportId/cannot-fulfill", canWriteSupplierPortal, cannotFulfillSupplierAccountShortage);
router.post("/orders/:poId/shortage-reports/:reportId/redelivery-invoice", canWriteSupplierPortal, createSupplierAccountRedeliveryInvoice);
router.post("/orders/:poId/respond", canWriteSupplierPortal, respondSupplierAccountOrder);
router.post("/orders/:poId/shortage-reports/:reportId/propose", canWriteSupplierPortal, proposeSupplierAccountShortageAction);

// Shared procurement documents (same records SmartBook sees; supplier only sees its own POs).
router.get("/orders/:poId/documents", canUseSupplierPortal, supplierDocuments.list);
router.post("/orders/:poId/documents", canWriteSupplierPortal, handleDocumentUpload, supplierDocuments.create);
router.get("/documents/:docId", canUseSupplierPortal, supplierDocuments.get);
router.get("/documents/:docId/files/:fileId/download", canUseSupplierPortal, supplierDocuments.download);
router.post("/documents/:docId/files", canWriteSupplierPortal, handleDocumentUpload, supplierDocuments.uploadVersion);
router.post("/documents/:docId/issue", canWriteSupplierPortal, supplierDocuments.issue);
router.post("/documents/:docId/cancel", canWriteSupplierPortal, supplierDocuments.cancel);
router.post("/documents/:docId/acknowledge", canWriteSupplierPortal, supplierDocuments.acknowledge);

router.post("/orders/:poId/create-goods-receipt", canWriteSupplierPortal, supplierCannotPostStock);
router.post("/orders/:poId/post-goods-receipt", canWriteSupplierPortal, supplierCannotPostStock);

module.exports = router;
