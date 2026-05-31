const express = require('express');
const { getLowStockByWarehouse } = require('../controllers/stock-balance.controller');
const { authorizeManagerRead } = require('../middlewares/auth.middleware');

const router = express.Router();

// GET /api/stock-balances/low-stock
// Returns per-warehouse low-stock items with variant_id and warehouse_id.
// Used by AI agent to build per-warehouse purchase requests.
router.get('/low-stock', authorizeManagerRead(['inventory.stock.read']), getLowStockByWarehouse);

module.exports = router;
