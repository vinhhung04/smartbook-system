const express = require('express');

const {
  getReadyReceipts,
  getReadyReceiptDetail,
  getPutawayLocations,
  confirmPutaway,
} = require('../controllers/putaway.controller');

const router = express.Router();

router.get('/receipts', getReadyReceipts);
router.get('/receipts/:id', getReadyReceiptDetail);
router.get('/receipts/:id/locations', getPutawayLocations);
router.post('/receipts/:id/confirm', confirmPutaway);

module.exports = router;
