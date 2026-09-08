const express = require('express');

const {
  getReadyReceipts,
  getReadyReceiptDetail,
  getPutawayLocations,
  confirmPutaway,
  claimPutawayTask,
  assignPutawayTask,
} = require('../controllers/putaway.controller');
const { authorizeTaskProgress, authorizeManagerDecision } = require('../middlewares/auth.middleware');

const router = express.Router();
const canUpdateAssignedTask = authorizeTaskProgress(['inventory.task.progress']);
const canManagerDecide = authorizeManagerDecision(['inventory.operation.decide']);

router.get('/receipts', canUpdateAssignedTask, getReadyReceipts);
router.get('/receipts/:id', canUpdateAssignedTask, getReadyReceiptDetail);
router.get('/receipts/:id/locations', canUpdateAssignedTask, getPutawayLocations);
router.post('/receipts/:id/confirm', canUpdateAssignedTask, confirmPutaway);
router.patch('/receipts/:id/assign', canManagerDecide, assignPutawayTask);
router.patch('/receipts/:id/claim-self', canUpdateAssignedTask, claimPutawayTask);

module.exports = router;
