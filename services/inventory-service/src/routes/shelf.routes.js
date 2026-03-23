const express = require('express');

const {
  getShelfOverview,
  getShelfDetail,
} = require('../controllers/shelf.controller');
const { authorizeAnyPermission } = require('../middlewares/auth.middleware');

const router = express.Router();

router.get('/', authorizeAnyPermission(['inventory.stock.read', 'inventory.stock.write']), getShelfOverview);
router.get('/:id', authorizeAnyPermission(['inventory.stock.read', 'inventory.stock.write']), getShelfDetail);

module.exports = router;
