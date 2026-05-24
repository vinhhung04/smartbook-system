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
const { authorizeAnyPermission } = require('../middlewares/auth.middleware');

const router = express.Router();

const canOperateStock = authorizeAnyPermission(['inventory.transfer.write', 'inventory.stock.write']);
const canReadRequests = authorizeAnyPermission(['inventory.transfer.read', 'inventory.transfer.write', 'inventory.stock.read', 'inventory.stock.write', 'inventory.purchase.approve']);
const canApprove = authorizeAnyPermission(['inventory.purchase.approve']);

router.get('/variants/search', canOperateStock, searchVariants);
router.get('/outbound/reference-code/preview', canOperateStock, previewOutboundReferenceCode);
router.get('/', canReadRequests, listOrderRequests);
router.post('/outbound', canOperateStock, createOutboundRequest);
router.post('/transfer', canOperateStock, createTransferRequest);
router.post('/:taskType/:taskId/approve', canApprove, approveRequest);
router.post('/:taskType/:taskId/reject', canApprove, rejectRequest);

module.exports = router;
