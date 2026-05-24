const express = require('express');

const {
  listOutboundQueue,
  getOutboundOrderDetail,
  confirmOutbound,
} = require('../controllers/outbound.controller');
const { authorizeAnyPermission } = require('../middlewares/auth.middleware');

const router = express.Router();
const canOperateStock = authorizeAnyPermission(['inventory.transfer.write', 'inventory.stock.write']);
const canReadStock = authorizeAnyPermission(['inventory.transfer.read', 'inventory.transfer.write', 'inventory.stock.read', 'inventory.stock.write']);

router.get('/orders', canReadStock, listOutboundQueue);
router.get('/orders/:taskType/:taskId', canReadStock, getOutboundOrderDetail);
router.post('/orders/:taskType/:taskId/confirm', canOperateStock, confirmOutbound);

module.exports = router;
