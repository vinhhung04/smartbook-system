const express = require('express');

const {
  getReadyReceipts,
  getReadyReceiptDetail,
  getPutawayLocations,
  confirmPutaway,
} = require('../controllers/putaway.controller');
const { authorizeAnyPermission, authorizeManagerDecision } = require('../middlewares/auth.middleware');

const router = express.Router();
const canReadTask = authorizeAnyPermission(['inventory.stock.read', 'inventory.task.read', 'inventory.putaway.read']);
const canDecideOperation = authorizeManagerDecision(['inventory.operation.decide']);

router.get('/receipts', canReadTask, getReadyReceipts);
router.get('/receipts/:id', canReadTask, getReadyReceiptDetail);
router.get('/receipts/:id/locations', canReadTask, getPutawayLocations);
router.post('/receipts/:id/confirm', canDecideOperation, confirmPutaway);

module.exports = router;
