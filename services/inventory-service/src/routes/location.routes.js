const express = require('express');

const {
  getLocationTreeByWarehouse,
  getLocationById,
  createLocation,
  updateLocation,
  deleteLocation,
} = require('../controllers/location.controller');
const { authorizeManagerDecision, authorizeManagerRead } = require('../middlewares/auth.middleware');

const router = express.Router();
const canReadWarehouse = authorizeManagerRead(['inventory.warehouse.read']);
const canWriteWarehouse = authorizeManagerDecision(['inventory.warehouse.write']);

router.get('/tree/:warehouseId', canReadWarehouse, getLocationTreeByWarehouse);
router.get('/:id', canReadWarehouse, getLocationById);
router.post('/', canWriteWarehouse, createLocation);
router.put('/:id', canWriteWarehouse, updateLocation);
router.delete('/:id', canWriteWarehouse, deleteLocation);

module.exports = router;
