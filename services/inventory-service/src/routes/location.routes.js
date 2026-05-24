const express = require('express');

const {
  getLocationTreeByWarehouse,
  getLocationById,
  createLocation,
  updateLocation,
  deleteLocation,
} = require('../controllers/location.controller');
const { authorizeAnyPermission } = require('../middlewares/auth.middleware');

const router = express.Router();

router.get('/tree/:warehouseId', authorizeAnyPermission(['inventory.warehouse.read', 'inventory.warehouse.write']), getLocationTreeByWarehouse);
router.get('/:id', authorizeAnyPermission(['inventory.warehouse.read', 'inventory.warehouse.write']), getLocationById);
router.post('/', authorizeAnyPermission(['inventory.warehouse.write']), createLocation);
router.put('/:id', authorizeAnyPermission(['inventory.warehouse.write']), updateLocation);
router.delete('/:id', authorizeAnyPermission(['inventory.warehouse.write']), deleteLocation);

module.exports = router;
