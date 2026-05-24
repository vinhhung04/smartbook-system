const express = require("express");

const {
  getPortalOrder,
  confirmPortalOrder,
  createPortalInvoice,
  supplierCannotPostStock,
} = require("../controllers/supplier-portal.controller");

const router = express.Router();

router.get("/orders/:token", getPortalOrder);
router.post("/orders/:token/confirm", confirmPortalOrder);
router.post("/orders/:token/invoices", createPortalInvoice);
router.post("/orders/:token/create-goods-receipt", supplierCannotPostStock);
router.post("/orders/:token/post-goods-receipt", supplierCannotPostStock);

module.exports = router;
