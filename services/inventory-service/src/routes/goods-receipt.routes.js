const express = require('express');

const {
	getGoodsReceipts,
	getGoodsReceiptById,
	createGoodsReceipt,
	updateGoodsReceipt,
} = require('../controllers/goods-receipt.controller');
const { authorizeAnyPermission, authorizeManagerDecision } = require('../middlewares/auth.middleware');

const router = express.Router();
const canReadReceiving = authorizeAnyPermission(['inventory.stock.read', 'inventory.receiving.read', 'inventory.task.read']);
const canDecideReceiving = authorizeManagerDecision(['inventory.operation.decide']);

router.get('/', canReadReceiving, getGoodsReceipts);
router.get('/:id', canReadReceiving, getGoodsReceiptById);
router.post('/', canDecideReceiving, createGoodsReceipt);
router.patch('/:id', canDecideReceiving, updateGoodsReceipt);

module.exports = router;
