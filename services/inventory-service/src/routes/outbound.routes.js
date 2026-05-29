const express = require('express');

const {
  listOutboundQueue,
  getOutboundOrderDetail,
  assignOutboundTask,
  claimSelfOutboundTask,
  confirmOutbound,
} = require('../controllers/outbound.controller');
const {
  authorizeTaskProgress,
  authorizeManagerDecision,
} = require('../middlewares/auth.middleware');

const router = express.Router();
const canUpdateAssignedTask = authorizeTaskProgress(['inventory.task.progress']);
const canManage = authorizeManagerDecision(['inventory.operation.decide']);

router.get('/orders', canUpdateAssignedTask, listOutboundQueue);
router.get('/orders/:taskType/:taskId', canUpdateAssignedTask, getOutboundOrderDetail);
router.patch('/orders/:taskType/:taskId/assign', canManage, assignOutboundTask);
router.patch('/orders/:taskType/:taskId/claim-self', canUpdateAssignedTask, claimSelfOutboundTask);
router.post('/orders/:taskType/:taskId/confirm', canUpdateAssignedTask, confirmOutbound);

module.exports = router;
