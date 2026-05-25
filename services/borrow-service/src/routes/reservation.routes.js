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
const { authorizeBorrowAdminRead, authorizeBorrowAdminWrite } = require('../middlewares/auth.middleware');

const router = express.Router();

router.get('/', authorizeBorrowAdminRead, listReservations);
router.post('/jobs/expire', authorizeBorrowAdminWrite, runExpiredReservationSweepNow);
router.post('/pickup/convert-to-loan', authorizeBorrowAdminWrite, convertReservationPickupCodeToLoan);
router.get('/:id', authorizeBorrowAdminRead, getReservationById);
router.post('/', authorizeBorrowAdminWrite, createReservation);
router.patch('/:id/confirm', authorizeBorrowAdminWrite, confirmReservation);
router.patch('/:id/cancel', authorizeBorrowAdminWrite, cancelReservation);
router.post('/:id/convert-to-loan', authorizeBorrowAdminWrite, convertReservationToLoan);

module.exports = router;
