const express = require('express');

const {
  getReadyReceipts,
  getReadyReceiptDetail,
  getPutawayLocations,
  confirmPutaway,
} = require('../controllers/putaway.controller');
const { authorizeAnyPermission } = require('../middlewares/auth.middleware');

const router = express.Router();

router.get('/receipts', authorizeAnyPermission(['inventory.stock.read', 'inventory.stock.write']), getReadyReceipts);
router.get('/receipts/:id', authorizeAnyPermission(['inventory.stock.read', 'inventory.stock.write']), getReadyReceiptDetail);
router.get('/receipts/:id/locations', authorizeAnyPermission(['inventory.stock.read', 'inventory.stock.write']), getPutawayLocations);
router.post('/receipts/:id/confirm', authorizeAnyPermission(['inventory.stock.write']), confirmPutaway);

module.exports = router;
