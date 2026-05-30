const express = require('express');

const {
  getAllBooks,
  getBookById,
  findBookByBarcode,
  findBookByIsbn13,
  createIncompleteBook,
  updateBookDetails,
  deleteBook,
} = require('../controllers/book.controller');
const {
  authorizeAnyPermission,
  authorizeAnyRole,
  authorizeManagerDecision,
  authorizeTaskProgress,
} = require('../middlewares/auth.middleware');

const router = express.Router();
const canReadCatalog = authorizeAnyPermission(['inventory.catalog.read', 'inventory.catalog.write']);
const canWriteCatalog = authorizeManagerDecision(['inventory.catalog.write']);
const canCreateIncompleteFromReceiving = authorizeTaskProgress(['inventory.task.progress']);
const canUpdateCatalogDetails = authorizeAnyRole(['ADMIN', 'WAREHOUSE_MANAGER', 'LIBRARIAN']);

router.get('/', canReadCatalog, getAllBooks);
router.get('/barcode/:barcode', canReadCatalog, findBookByBarcode);
router.get('/isbn13/:isbn13', canReadCatalog, findBookByIsbn13);
router.post('/incomplete', canCreateIncompleteFromReceiving, createIncompleteBook);
router.get('/:id', canReadCatalog, getBookById);
router.patch('/:id', canUpdateCatalogDetails, updateBookDetails);
router.delete('/:id', canWriteCatalog, deleteBook);

module.exports = router;
