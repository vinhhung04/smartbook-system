const express = require('express');

const {
  getLocationTreeByWarehouse,
  getLocationById,
  createLocation,
  updateLocation,
  deleteLocation,
} = require('../controllers/location.controller');

const router = express.Router();

router.get('/tree/:warehouseId', getLocationTreeByWarehouse);
router.get('/:id', getLocationById);
router.post('/', createLocation);
router.put('/:id', updateLocation);
router.delete('/:id', deleteLocation);

module.exports = router;
