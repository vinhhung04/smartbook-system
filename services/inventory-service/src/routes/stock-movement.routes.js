const express = require('express');

const { getStockMovements } = require('../controllers/stock-movement.controller');
const { authorizeAnyPermission } = require('../middlewares/auth.middleware');

const router = express.Router();

router.get('/', authorizeAnyPermission(['inventory.stock.read']), getStockMovements);

module.exports = router;
