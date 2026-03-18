const express = require('express');

const { getStockMovements } = require('../controllers/stock-movement.controller');

const router = express.Router();

router.get('/', getStockMovements);

module.exports = router;
