const express = require('express');

const {
  getShelfOverview,
  getShelfDetail,
} = require('../controllers/shelf.controller');

const router = express.Router();

router.get('/', getShelfOverview);
router.get('/:id', getShelfDetail);

module.exports = router;
