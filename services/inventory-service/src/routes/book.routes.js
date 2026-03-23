const express = require('express');

const {
	getAllBooks,
	getBookById,
	findBookByBarcode,
	findBookByIsbn13,
	createIncompleteBook,
	updateBookDetails,
} = require('../controllers/book.controller');
const { authorizeAnyPermission } = require('../middlewares/auth.middleware');

const router = express.Router();

router.get('/', authorizeAnyPermission(['inventory.catalog.read', 'inventory.catalog.write']), getAllBooks);
router.get('/barcode/:barcode', authorizeAnyPermission(['inventory.catalog.read', 'inventory.catalog.write']), findBookByBarcode);
router.get('/isbn13/:isbn13', authorizeAnyPermission(['inventory.catalog.read', 'inventory.catalog.write']), findBookByIsbn13);
router.post('/incomplete', authorizeAnyPermission(['inventory.catalog.write']), createIncompleteBook);
router.get('/:id', authorizeAnyPermission(['inventory.catalog.read', 'inventory.catalog.write']), getBookById);
router.patch('/:id', authorizeAnyPermission(['inventory.catalog.write']), updateBookDetails);

module.exports = router;