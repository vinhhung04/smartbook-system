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

router.get('/tree/:warehouseId', authorizeAnyPermission(['inventory.stock.read', 'inventory.stock.write']), getLocationTreeByWarehouse);
router.get('/:id', authorizeAnyPermission(['inventory.stock.read', 'inventory.stock.write']), getLocationById);
router.post('/', authorizeAnyPermission(['inventory.stock.write']), createLocation);
router.put('/:id', authorizeAnyPermission(['inventory.stock.write']), updateLocation);
router.delete('/:id', authorizeAnyPermission(['inventory.stock.write']), deleteLocation);

module.exports = router;
