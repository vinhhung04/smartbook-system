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
const { requireRecordWarehouse } = require('../middlewares/warehouse-scope.middleware');
const { taskOrderWarehouse } = require('../utils/record-warehouse');

const router = express.Router();
const canUpdateAssignedTask = authorizeTaskProgress(['inventory.task.progress']);
const canManage = authorizeManagerDecision(['inventory.operation.decide']);
// assign / claim / confirm act on the order's stored (source) warehouse
const writesOrder = requireRecordWarehouse(taskOrderWarehouse(), { fresh: true });

router.get('/orders', canUpdateAssignedTask, listOutboundQueue);
router.get('/orders/:taskType/:taskId', canUpdateAssignedTask, getOutboundOrderDetail);
router.patch('/orders/:taskType/:taskId/assign', canManage, writesOrder, assignOutboundTask);
router.patch('/orders/:taskType/:taskId/claim-self', canUpdateAssignedTask, writesOrder, claimSelfOutboundTask);
router.post('/orders/:taskType/:taskId/confirm', canUpdateAssignedTask, writesOrder, confirmOutbound);

module.exports = router;
