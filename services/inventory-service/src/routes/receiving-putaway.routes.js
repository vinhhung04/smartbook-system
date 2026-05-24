const express = require('express');

const {
  getWarehouseReceivings,
  getReceivingItems,
  getCompartmentCandidates,
  lookupCompartmentByBarcode,
  lookupVariantByBarcode,
  getOccupiedCompartments,
  getCompartmentItems,
  transferReceivingToShelf,
  reverseShelfToReceiving,
} = require('../controllers/receiving-putaway.controller');
const { authorizeAnyPermission } = require('../middlewares/auth.middleware');

const router = express.Router();
const canOperateStock = authorizeAnyPermission(['inventory.putaway.execute']);
const canReadReceiving = authorizeAnyPermission(['inventory.receiving.read', 'inventory.receiving.write', 'inventory.putaway.execute']);

router.get('/warehouses/:warehouseId/receivings', canReadReceiving, getWarehouseReceivings);
router.get('/receivings/:receivingId/items', canReadReceiving, getReceivingItems);
router.get('/receivings/:receivingId/candidates', canOperateStock, getCompartmentCandidates);
router.get('/lookup/location-by-barcode', canOperateStock, lookupCompartmentByBarcode);
router.get('/lookup/variant-by-barcode', canOperateStock, lookupVariantByBarcode);
router.get('/warehouses/:warehouseId/compartments/occupied', canOperateStock, getOccupiedCompartments);
router.get('/compartments/:compartmentId/items', canOperateStock, getCompartmentItems);
router.post('/transfer', canOperateStock, transferReceivingToShelf);
router.post('/reverse', canOperateStock, reverseShelfToReceiving);

module.exports = router;
