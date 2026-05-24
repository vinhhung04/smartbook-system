const express = require('express');
const {
  listReservations,
  getReservationById,
  createReservation,
  cancelReservation,
  confirmReservation,
  runExpiredReservationSweepNow,
} = require('../controllers/reservation.controller');
const {
  convertReservationPickupCodeToLoan,
  convertReservationToLoan,
} = require('../controllers/loan.controller');
const { authorizeAnyPermission } = require('../middlewares/auth.middleware');

const router = express.Router();

router.get('/', authorizeAnyPermission(['borrow.loans.read', 'borrow.loans.write']), listReservations);
router.post('/jobs/expire', authorizeAnyPermission(['borrow.loans.write']), runExpiredReservationSweepNow);
router.post('/pickup/convert-to-loan', authorizeAnyPermission(['borrow.loans.write']), convertReservationPickupCodeToLoan);
router.get('/:id', authorizeAnyPermission(['borrow.loans.read', 'borrow.loans.write']), getReservationById);
router.post('/', authorizeAnyPermission(['borrow.loans.write']), createReservation);
router.patch('/:id/confirm', authorizeAnyPermission(['borrow.loans.write']), confirmReservation);
router.patch('/:id/cancel', authorizeAnyPermission(['borrow.loans.write']), cancelReservation);
router.post('/:id/convert-to-loan', authorizeAnyPermission(['borrow.loans.write']), convertReservationToLoan);

module.exports = router;
