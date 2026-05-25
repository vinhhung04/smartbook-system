const express = require('express');

const {
  getShelfOverview,
  getShelfDetail,
} = require('../controllers/shelf.controller');
const { authorizeAnyPermission } = require('../middlewares/auth.middleware');

const router = express.Router();

router.get('/', authorizeAnyPermission(['inventory.stock.read', 'inventory.warehouse.read']), getShelfOverview);
router.get('/:id', authorizeAnyPermission(['inventory.stock.read', 'inventory.warehouse.read']), getShelfDetail);

module.exports = router;
