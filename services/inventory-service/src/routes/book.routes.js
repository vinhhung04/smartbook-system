const express = require('express');

const {
	getAllBooks,
	getBookById,
	findBookByBarcode,
	createIncompleteBook,
	updateBookDetails,
} = require('../controllers/book.controller');

const router = express.Router();

router.get('/', getAllBooks);
router.get('/barcode/:barcode', findBookByBarcode);
router.post('/incomplete', createIncompleteBook);
router.get('/:id', getBookById);
router.patch('/:id', updateBookDetails);

module.exports = router;