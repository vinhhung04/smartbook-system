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
const { authorizeBorrowAdminRead, authorizeBorrowAdminWrite } = require('../middlewares/auth.middleware');

const router = express.Router();

router.get('/', authorizeBorrowAdminRead, listLoans);
router.get('/renewal-requests', authorizeBorrowAdminRead, listRenewalRequests);
router.post('/direct', authorizeBorrowAdminWrite, createDirectLoan);
router.post('/:id/renewals/review', authorizeBorrowAdminWrite, reviewLoanRenewal);
router.get('/:id', authorizeBorrowAdminRead, getLoanById);
router.post('/from-reservation/:id', authorizeBorrowAdminWrite, convertReservationToLoan);
router.post('/:id/return', authorizeBorrowAdminWrite, returnLoan);
router.post('/jobs/overdue-sweep', authorizeBorrowAdminWrite, runOverdueSweepNow);

module.exports = router;
