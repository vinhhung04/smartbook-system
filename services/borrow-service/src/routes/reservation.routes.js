const express = require('express');
const {
  listReservations,
  getReservationById,
  createReservation,
  cancelReservation,
  confirmReservation,
  runExpiredReservationSweepNow,
} = require('../controllers/reservation.controller');
const { convertReservationToLoan } = require('../controllers/loan.controller');
const { authorizeAnyPermission } = require('../middlewares/auth.middleware');

const router = express.Router();

router.get('/', authorizeAnyPermission(['borrow.read', 'borrow.write']), listReservations);
router.post('/jobs/expire', authorizeAnyPermission(['borrow.write']), runExpiredReservationSweepNow);
router.get('/:id', authorizeAnyPermission(['borrow.read', 'borrow.write']), getReservationById);
router.post('/', authorizeAnyPermission(['borrow.write']), createReservation);
router.patch('/:id/confirm', authorizeAnyPermission(['borrow.write']), confirmReservation);
router.patch('/:id/cancel', authorizeAnyPermission(['borrow.write']), cancelReservation);
router.post('/:id/convert-to-loan', authorizeAnyPermission(['borrow.write']), convertReservationToLoan);

module.exports = router;
