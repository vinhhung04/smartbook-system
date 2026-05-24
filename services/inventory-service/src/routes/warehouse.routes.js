const express = require('express');

const {
  getAllWarehouses,
  getWarehouseById,
  createWarehouse,
  updateWarehouse,
  deleteWarehouse,
} = require('../controllers/warehouse.controller');
const { getZonesAndBinsByWarehouse } = require('../controllers/location.controller');
const { authorizeAnyPermission } = require('../middlewares/auth.middleware');

const router = express.Router();

router.get('/', authorizeAnyPermission(['inventory.warehouse.read', 'inventory.warehouse.write']), getAllWarehouses);
router.get('/:id', authorizeAnyPermission(['inventory.warehouse.read', 'inventory.warehouse.write']), getWarehouseById);
router.post('/', authorizeAnyPermission(['inventory.warehouse.write']), createWarehouse);
router.put('/:id', authorizeAnyPermission(['inventory.warehouse.write']), updateWarehouse);
router.delete('/:id', authorizeAnyPermission(['inventory.warehouse.write']), deleteWarehouse);
router.get('/:warehouseId/locations', authorizeAnyPermission(['inventory.warehouse.read', 'inventory.warehouse.write']), getZonesAndBinsByWarehouse);

module.exports = router;
