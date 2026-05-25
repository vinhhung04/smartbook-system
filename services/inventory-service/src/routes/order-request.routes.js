const express = require('express');

const {
  searchVariants,
  listOrderRequests,
  createOutboundRequest,
  createTransferRequest,
  previewOutboundReferenceCode,
  approveRequest,
  rejectRequest,
} = require('../controllers/order-request.controller');
const { authorizeAnyPermission, authorizeManagerDecision } = require('../middlewares/auth.middleware');

const router = express.Router();

const canDecideOperation = authorizeManagerDecision(['inventory.operation.decide']);
const canReadRequests = authorizeAnyPermission(['inventory.task.read', 'inventory.stock.read', 'inventory.operation.decide', 'inventory.purchase.approve']);
const canApprove = authorizeManagerDecision(['inventory.operation.decide', 'inventory.purchase.approve']);

router.get('/variants/search', canDecideOperation, searchVariants);
router.get('/outbound/reference-code/preview', canDecideOperation, previewOutboundReferenceCode);
router.get('/', canReadRequests, listOrderRequests);
router.post('/outbound', canDecideOperation, createOutboundRequest);
router.post('/transfer', canDecideOperation, createTransferRequest);
router.post('/:taskType/:taskId/approve', canApprove, approveRequest);
router.post('/:taskType/:taskId/reject', canApprove, rejectRequest);

module.exports = router;
