const express = require('express');

const { getStockMovements } = require('../controllers/stock-movement.controller');
const { authorizeManagerRead } = require('../middlewares/auth.middleware');

const router = express.Router();

router.get('/', authorizeManagerRead(['inventory.stock.read']), getStockMovements);

module.exports = router;
