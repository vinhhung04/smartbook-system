const express = require('express');

const {
  getAllWarehouses,
  getWarehouseById,
  createWarehouse,
  updateWarehouse,
  deleteWarehouse,
} = require('../controllers/warehouse.controller');
const { getZonesAndBinsByWarehouse } = require('../controllers/location.controller');
const { authorizeManagerDecision, authorizeManagerRead, authorizeTaskProgress } = require('../middlewares/auth.middleware');

const router = express.Router();
const canListWarehouses = authorizeManagerRead(['inventory.warehouse.read', 'inventory.stock.read']);
const canReadWarehouse = authorizeTaskProgress(['inventory.task.progress', 'inventory.warehouse.read', 'inventory.stock.read']);
const canWriteWarehouse = authorizeManagerDecision(['inventory.warehouse.write']);

router.get('/', canListWarehouses, getAllWarehouses);
router.get('/:id', canReadWarehouse, getWarehouseById);
router.post('/', canWriteWarehouse, createWarehouse);
router.put('/:id', canWriteWarehouse, updateWarehouse);
router.delete('/:id', canWriteWarehouse, deleteWarehouse);
router.get('/:warehouseId/locations', canReadWarehouse, getZonesAndBinsByWarehouse);

module.exports = router;
