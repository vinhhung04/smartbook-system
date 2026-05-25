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
const { authorizeAnyPermission, authorizeManagerDecision } = require('../middlewares/auth.middleware');

const router = express.Router();
const canReadTask = authorizeAnyPermission(['inventory.stock.read', 'inventory.task.read', 'inventory.putaway.read']);
const canDecideOperation = authorizeManagerDecision(['inventory.operation.decide']);

router.get('/warehouses/:warehouseId/receivings', canReadTask, getWarehouseReceivings);
router.get('/receivings/:receivingId/items', canReadTask, getReceivingItems);
router.get('/receivings/:receivingId/candidates', canReadTask, getCompartmentCandidates);
router.get('/lookup/location-by-barcode', canReadTask, lookupCompartmentByBarcode);
router.get('/lookup/variant-by-barcode', canReadTask, lookupVariantByBarcode);
router.get('/warehouses/:warehouseId/compartments/occupied', canReadTask, getOccupiedCompartments);
router.get('/compartments/:compartmentId/items', canReadTask, getCompartmentItems);
router.post('/transfer', canDecideOperation, transferReceivingToShelf);
router.post('/reverse', canDecideOperation, reverseShelfToReceiving);

module.exports = router;
