const express = require('express');

const {
  getReadyReceipts,
  getReadyReceiptDetail,
  getPutawayLocations,
  confirmPutaway,
} = require('../controllers/putaway.controller');
const { authorizeAnyPermission } = require('../middlewares/auth.middleware');

const router = express.Router();

router.get('/receipts', authorizeAnyPermission(['inventory.receiving.read', 'inventory.receiving.write', 'inventory.putaway.execute']), getReadyReceipts);
router.get('/receipts/:id', authorizeAnyPermission(['inventory.receiving.read', 'inventory.receiving.write', 'inventory.putaway.execute']), getReadyReceiptDetail);
router.get('/receipts/:id/locations', authorizeAnyPermission(['inventory.warehouse.read', 'inventory.warehouse.write', 'inventory.putaway.execute']), getPutawayLocations);
router.post('/receipts/:id/confirm', authorizeAnyPermission(['inventory.putaway.execute']), confirmPutaway);

module.exports = router;
