const express = require('express');
const {
  listLoans,
  getLoanById,
  createDirectLoan,
  convertReservationToLoan,
  listRenewalRequests,
  reviewLoanRenewal,
  returnLoan,
  runOverdueSweepNow,
} = require('../controllers/loan.controller');
const { authorizeAnyPermission } = require('../middlewares/auth.middleware');

const router = express.Router();

router.get('/', authorizeAnyPermission(['borrow.loans.read', 'borrow.loans.write']), listLoans);
router.get('/renewal-requests', authorizeAnyPermission(['borrow.loans.read', 'borrow.loans.write']), listRenewalRequests);
router.post('/direct', authorizeAnyPermission(['borrow.loans.write']), createDirectLoan);
router.post('/:id/renewals/review', authorizeAnyPermission(['borrow.loans.write']), reviewLoanRenewal);
router.get('/:id', authorizeAnyPermission(['borrow.loans.read', 'borrow.loans.write']), getLoanById);
router.post('/from-reservation/:id', authorizeAnyPermission(['borrow.loans.write']), convertReservationToLoan);
router.post('/:id/return', authorizeAnyPermission(['borrow.loans.write']), returnLoan);
router.post('/jobs/overdue-sweep', authorizeAnyPermission(['borrow.loans.write']), runOverdueSweepNow);

module.exports = router;
