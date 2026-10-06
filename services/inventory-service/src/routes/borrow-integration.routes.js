const express = require('express');
const {
  searchBorrowVariants,
  listBorrowWarehouses,
  getAvailability,
  reserveFromBorrow,
  releaseBorrowReservation,
  consumeBorrowReservation,
  returnBorrowedLoan,
  getVariantDetails,
  getVariantPublicAvailability,
  getBookVariantIds,
} = require('../controllers/borrow-integration.controller');
const { authorizeAnyPermission } = require('../middlewares/auth.middleware');

const router = express.Router();

router.get('/variants/search', authorizeAnyPermission(['borrow.read', 'borrow.write', 'inventory.stock.read']), searchBorrowVariants);
router.get('/variants/details', authorizeAnyPermission(['borrow.read', 'borrow.write', 'inventory.stock.read']), getVariantDetails);
router.get('/variants/:variantId/public-availability', authorizeAnyPermission(['borrow.read', 'borrow.write', 'inventory.stock.read']), getVariantPublicAvailability);
router.get('/books/:bookId/variant-ids', authorizeAnyPermission(['borrow.read', 'borrow.write', 'inventory.stock.read']), getBookVariantIds);
router.get('/warehouses', authorizeAnyPermission(['borrow.read', 'borrow.write', 'inventory.stock.read']), listBorrowWarehouses);
router.get('/availability', authorizeAnyPermission(['borrow.read', 'borrow.write', 'inventory.stock.read']), getAvailability);
router.post('/reservations/reserve', authorizeAnyPermission(['borrow.write', 'inventory.stock.write']), reserveFromBorrow);
router.post('/reservations/release', authorizeAnyPermission(['borrow.write', 'inventory.stock.write']), releaseBorrowReservation);
router.post('/reservations/consume', authorizeAnyPermission(['borrow.write', 'inventory.stock.write']), consumeBorrowReservation);
router.post('/loans/return', authorizeAnyPermission(['borrow.write', 'inventory.stock.write']), returnBorrowedLoan);

module.exports = router;
