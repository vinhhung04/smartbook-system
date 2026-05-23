const express = require('express');

const {
  searchVariants,
  listOrderRequests,
  createOutboundRequest,
  createTransferRequest,
  approveRequest,
  rejectRequest,
} = require('../controllers/order-request.controller');
const { authorizeAnyPermission } = require('../middlewares/auth.middleware');

const router = express.Router();

const canOperateStock = authorizeAnyPermission(['inventory.stock.write']);
const canReadRequests = authorizeAnyPermission(['inventory.stock.read', 'inventory.stock.write', 'inventory.purchase.approve']);
const canApprove = authorizeAnyPermission(['inventory.purchase.approve']);

router.get('/variants/search', canOperateStock, searchVariants);
router.get('/', canReadRequests, listOrderRequests);
router.post('/outbound', canOperateStock, createOutboundRequest);
router.post('/transfer', canOperateStock, createTransferRequest);
router.post('/:taskType/:taskId/approve', canApprove, approveRequest);
router.post('/:taskType/:taskId/reject', canApprove, rejectRequest);

module.exports = router;
