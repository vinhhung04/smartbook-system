const express = require('express');

const {
	getGoodsReceipts,
	getGoodsReceiptById,
	createGoodsReceipt,
	updateGoodsReceipt,
} = require('../controllers/goods-receipt.controller');
const { authorizeAnyPermission } = require('../middlewares/auth.middleware');

const router = express.Router();

router.get('/', authorizeAnyPermission(['inventory.receiving.read', 'inventory.receiving.write']), getGoodsReceipts);
router.get('/:id', authorizeAnyPermission(['inventory.receiving.read', 'inventory.receiving.write']), getGoodsReceiptById);
router.post('/', authorizeAnyPermission(['inventory.receiving.write']), createGoodsReceipt);
router.patch('/:id', authorizeAnyPermission(['inventory.receiving.write']), updateGoodsReceipt);

module.exports = router;
