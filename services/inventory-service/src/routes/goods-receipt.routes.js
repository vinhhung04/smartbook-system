const express = require('express');

const {
	getGoodsReceipts,
	getGoodsReceiptById,
	createGoodsReceipt,
	updateGoodsReceipt,
} = require('../controllers/goods-receipt.controller');

const router = express.Router();

router.get('/', getGoodsReceipts);
router.get('/:id', getGoodsReceiptById);
router.post('/', createGoodsReceipt);
router.patch('/:id', updateGoodsReceipt);

module.exports = router;
