const express = require('express');
const {
  searchBorrowVariants,
  listBorrowWarehouses,
  getAvailability,
  reserveFromBorrow,
  releaseBorrowReservation,
  consumeBorrowReservation,
  returnBorrowedLoan,
} = require('../controllers/borrow-integration.controller');
const { authorizeAnyPermission, requireInternalServiceKey } = require('../middlewares/auth.middleware');

const router = express.Router();

router.get('/variants/search', authorizeAnyPermission(['borrow.loans.read', 'borrow.loans.write', 'inventory.catalog.read', 'inventory.stock.read']), searchBorrowVariants);
router.get('/warehouses', authorizeAnyPermission(['borrow.loans.read', 'borrow.loans.write', 'inventory.warehouse.read', 'inventory.stock.read']), listBorrowWarehouses);
router.get('/availability', authorizeAnyPermission(['borrow.loans.read', 'borrow.loans.write', 'inventory.stock.read']), getAvailability);
router.post('/reservations/reserve', requireInternalServiceKey, authorizeAnyPermission(['borrow.loans.write', 'inventory.stock.write']), reserveFromBorrow);
router.post('/reservations/release', requireInternalServiceKey, authorizeAnyPermission(['borrow.loans.write', 'inventory.stock.write']), releaseBorrowReservation);
router.post('/reservations/consume', requireInternalServiceKey, authorizeAnyPermission(['borrow.loans.write', 'inventory.stock.write']), consumeBorrowReservation);
router.post('/loans/return', requireInternalServiceKey, authorizeAnyPermission(['borrow.loans.write', 'inventory.stock.write']), returnBorrowedLoan);

module.exports = router;
