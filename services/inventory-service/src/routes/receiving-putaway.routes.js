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
const { requireRecordWarehouse } = require('../middlewares/warehouse-scope.middleware');
const { locationWarehouse, pathWarehouse } = require('../utils/record-warehouse');

const router = express.Router();
const canReadTask = authorizeTaskProgress(['inventory.task.progress']);
const canExecuteTransfer = authorizeTaskProgress(['inventory.task.progress']);
const canDecideOperation = authorizeManagerDecision(['inventory.operation.decide']);
// reads by path id: the named warehouse / the location's own warehouse must be readable
const readsPathWarehouse = requireRecordWarehouse(pathWarehouse('warehouseId'), { access: 'read' });
const readsReceiving = requireRecordWarehouse(locationWarehouse('receivingId'), { access: 'read' });
const readsCompartment = requireRecordWarehouse(locationWarehouse('compartmentId'), { access: 'read' });

router.get('/warehouses/:warehouseId/receivings', canReadTask, readsPathWarehouse, getWarehouseReceivings);
router.get('/receivings/:receivingId/items', canReadTask, readsReceiving, getReceivingItems);
router.get('/receivings/:receivingId/candidates', canReadTask, readsReceiving, getCompartmentCandidates);
router.get('/lookup/location-by-barcode', canReadTask, lookupCompartmentByBarcode);
router.get('/lookup/variant-by-barcode', canReadTask, lookupVariantByBarcode);
router.get('/warehouses/:warehouseId/compartments/occupied', canReadTask, readsPathWarehouse, getOccupiedCompartments);
router.get('/compartments/:compartmentId/items', canReadTask, readsCompartment, getCompartmentItems);
router.post('/transfer', canExecuteTransfer, transferReceivingToShelf);
router.post('/reverse', canDecideOperation, reverseShelfToReceiving);

module.exports = router;
