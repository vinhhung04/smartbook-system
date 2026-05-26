const express = require('express');

const {
  listOutboundQueue,
  getOutboundOrderDetail,
  confirmOutbound,
} = require('../controllers/outbound.controller');
const { authorizeTaskProgress } = require('../middlewares/auth.middleware');

const router = express.Router();
const canUpdateAssignedTask = authorizeTaskProgress(['inventory.task.progress']);

router.get('/orders', canUpdateAssignedTask, listOutboundQueue);
router.get('/orders/:taskType/:taskId', canUpdateAssignedTask, getOutboundOrderDetail);
router.post('/orders/:taskType/:taskId/confirm', canUpdateAssignedTask, confirmOutbound);

module.exports = router;
