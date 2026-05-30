const express = require('express');

const {
  createPurchaseRequest,
  getMyPurchaseRequests,
  getAllPurchaseRequests,
  getPurchaseRequestById,
  approvePurchaseRequest,
  rejectPurchaseRequest,
  convertPurchaseRequestToPO,
} = require('../controllers/purchase-request.controller');
const {
  authorizeAnyPermission,
  authorizeManagerDecision,
} = require('../middlewares/auth.middleware');

const router = express.Router();

// WAREHOUSE_STAFF can create and view their own requests
const canStaffRequest = authorizeAnyPermission(['inventory.purchase.request']);
// Only WAREHOUSE_MANAGER/ADMIN can see all requests or make decisions
const canManagerDecide = authorizeManagerDecision(['inventory.purchase.request']);
// Convert to PO requires purchase.write permission (creating a PO)
const canManagerConvert = authorizeManagerDecision(['inventory.purchase.write']);

router.post('/', canStaffRequest, createPurchaseRequest);
router.get('/my', canStaffRequest, getMyPurchaseRequests);
router.get('/', canManagerDecide, getAllPurchaseRequests);
router.get('/:id', canStaffRequest, getPurchaseRequestById);
router.post('/:id/approve', canManagerDecide, approvePurchaseRequest);
router.post('/:id/reject', canManagerDecide, rejectPurchaseRequest);
router.post('/:id/convert-to-po', canManagerConvert, convertPurchaseRequestToPO);

module.exports = router;
