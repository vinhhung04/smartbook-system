const express = require('express');

const {
  listOutboundQueue,
  getOutboundOrderDetail,
  confirmOutbound,
} = require('../controllers/outbound.controller');
const { authorizeAnyPermission, authorizeManagerDecision } = require('../middlewares/auth.middleware');

const router = express.Router();
const canDecideOperation = authorizeManagerDecision(['inventory.operation.decide']);
const canReadTask = authorizeAnyPermission(['inventory.stock.read', 'inventory.task.read', 'inventory.outbound.read']);

router.get('/orders', canReadTask, listOutboundQueue);
router.get('/orders/:taskType/:taskId', canReadTask, getOutboundOrderDetail);
router.post('/orders/:taskType/:taskId/confirm', canDecideOperation, confirmOutbound);

module.exports = router;
