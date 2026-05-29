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
const { authorizeManagerDecision, authorizeTaskProgress } = require('../middlewares/auth.middleware');

const router = express.Router();
const canReadTask = authorizeTaskProgress(['inventory.task.progress']);
const canExecuteTransfer = authorizeTaskProgress(['inventory.task.progress']);
const canDecideOperation = authorizeManagerDecision(['inventory.operation.decide']);

router.get('/warehouses/:warehouseId/receivings', canReadTask, getWarehouseReceivings);
router.get('/receivings/:receivingId/items', canReadTask, getReceivingItems);
router.get('/receivings/:receivingId/candidates', canReadTask, getCompartmentCandidates);
router.get('/lookup/location-by-barcode', canReadTask, lookupCompartmentByBarcode);
router.get('/lookup/variant-by-barcode', canReadTask, lookupVariantByBarcode);
router.get('/warehouses/:warehouseId/compartments/occupied', canReadTask, getOccupiedCompartments);
router.get('/compartments/:compartmentId/items', canReadTask, getCompartmentItems);
router.post('/transfer', canExecuteTransfer, transferReceivingToShelf);
router.post('/reverse', canDecideOperation, reverseShelfToReceiving);

module.exports = router;
