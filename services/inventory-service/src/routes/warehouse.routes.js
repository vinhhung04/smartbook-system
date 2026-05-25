const express = require('express');

const {
  getAllWarehouses,
  getWarehouseById,
  createWarehouse,
  updateWarehouse,
  deleteWarehouse,
} = require('../controllers/warehouse.controller');
const { getZonesAndBinsByWarehouse } = require('../controllers/location.controller');
const { authorizeManagerDecision, authorizeManagerRead } = require('../middlewares/auth.middleware');

const router = express.Router();
const canReadWarehouse = authorizeManagerRead(['inventory.warehouse.read']);
const canWriteWarehouse = authorizeManagerDecision(['inventory.warehouse.write']);

router.get('/', canReadWarehouse, getAllWarehouses);
router.get('/:id', canReadWarehouse, getWarehouseById);
router.post('/', canWriteWarehouse, createWarehouse);
router.put('/:id', canWriteWarehouse, updateWarehouse);
router.delete('/:id', canWriteWarehouse, deleteWarehouse);
router.get('/:warehouseId/locations', canReadWarehouse, getZonesAndBinsByWarehouse);

module.exports = router;
