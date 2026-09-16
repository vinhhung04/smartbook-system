const express = require("express");
const { createRateLimiter } = require("@smartbook/shared/runtime");

const {
  getPortalOrder,
  confirmPortalOrder,
  createPortalInvoice,
  acknowledgeShortageReport,
  cannotFulfillShortageReport,
  createRedeliveryInvoice,
  supplierCannotPostStock,
} = require("../controllers/supplier-portal.controller");

const router = express.Router();
// trustedProxyHops: 2 — this public route is reached through nginx then api-gateway, both of
// which append to X-Forwarded-For; trusting exactly those 2 hops recovers the real client IP
// instead of the client-spoofable leftmost entry (see packages/shared/runtime/index.cjs).
router.use(createRateLimiter({ max: 60, windowMs: 15 * 60 * 1000, trustedProxyHops: 2 }));

router.get("/orders/:token", getPortalOrder);
router.post("/orders/:token/confirm", confirmPortalOrder);
router.post("/orders/:token/invoices", createPortalInvoice);
router.post("/orders/:token/shortage-reports/:reportId/acknowledge", acknowledgeShortageReport);
router.post("/orders/:token/shortage-reports/:reportId/cannot-fulfill", cannotFulfillShortageReport);
router.post("/orders/:token/shortage-reports/:reportId/redelivery-invoice", createRedeliveryInvoice);
router.post("/orders/:token/create-goods-receipt", supplierCannotPostStock);
router.post("/orders/:token/post-goods-receipt", supplierCannotPostStock);

module.exports = router;
