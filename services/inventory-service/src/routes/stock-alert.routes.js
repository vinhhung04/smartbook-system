const express = require('express');
const { createStockAlert, listStockAlerts } = require('../controllers/stock-alert.controller');
const { authorizeManagerDecision, authorizeManagerRead } = require('../middlewares/auth.middleware');

const router = express.Router();

// POST /api/stock-alerts — create a new stock alert (manager/admin only)
router.post('/', authorizeManagerDecision(), createStockAlert);

// GET /api/stock-alerts — list stock alerts (manager/admin read)
router.get('/', authorizeManagerRead(['inventory.stock.read']), listStockAlerts);

module.exports = router;
