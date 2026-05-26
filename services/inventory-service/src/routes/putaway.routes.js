const express = require('express');

const {
  getReadyReceipts,
  getReadyReceiptDetail,
  getPutawayLocations,
  confirmPutaway,
} = require('../controllers/putaway.controller');
const { authorizeTaskProgress } = require('../middlewares/auth.middleware');

const router = express.Router();
const canUpdateAssignedTask = authorizeTaskProgress(['inventory.task.progress']);

router.get('/receipts', canUpdateAssignedTask, getReadyReceipts);
router.get('/receipts/:id', canUpdateAssignedTask, getReadyReceiptDetail);
router.get('/receipts/:id/locations', canUpdateAssignedTask, getPutawayLocations);
router.post('/receipts/:id/confirm', canUpdateAssignedTask, confirmPutaway);

module.exports = router;
