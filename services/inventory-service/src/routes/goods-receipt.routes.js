const express = require('express');

const {
	getGoodsReceipts,
	getGoodsReceiptById,
	createGoodsReceipt,
	updateGoodsReceipt,
	assignGoodsReceipt,
} = require('../controllers/goods-receipt.controller');
const {
	authorizeManagerDecision,
	authorizeManagerRead,
	authorizeTaskRead,
	authorizeTaskProgress,
} = require('../middlewares/auth.middleware');

const router = express.Router();
const canReadReceiving = authorizeManagerRead(['inventory.receiving.read', 'inventory.stock.read']);
const canDecideReceiving = authorizeManagerDecision(['inventory.operation.decide']);
const canReadAssignedReceiving = authorizeTaskRead(['inventory.task.read']);
const canUpdateAssignedReceiving = authorizeTaskProgress(['inventory.task.progress']);

router.get('/', canReadReceiving, getGoodsReceipts);
router.get('/:id', canReadAssignedReceiving, getGoodsReceiptById);
router.post('/', canUpdateAssignedReceiving, createGoodsReceipt);
router.patch('/:id', canUpdateAssignedReceiving, updateGoodsReceipt);
router.patch('/:id/assign', canDecideReceiving, assignGoodsReceipt);

module.exports = router;
