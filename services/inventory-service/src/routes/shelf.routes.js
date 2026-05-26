const express = require('express');

const {
  getShelfOverview,
  getShelfDetail,
} = require('../controllers/shelf.controller');
const { authorizeManagerRead } = require('../middlewares/auth.middleware');

const router = express.Router();

router.get('/', authorizeManagerRead(['inventory.stock.read', 'inventory.warehouse.read']), getShelfOverview);
router.get('/:id', authorizeManagerRead(['inventory.stock.read', 'inventory.warehouse.read']), getShelfDetail);

module.exports = router;
