const express = require('express');
const {
  listReservations,
  getReservationById,
  createReservation,
  cancelReservation,
} = require('../controllers/reservation.controller');
const { convertReservationToLoan } = require('../controllers/loan.controller');
const { authorizeAnyPermission } = require('../middlewares/auth.middleware');

const router = express.Router();

router.get('/', authorizeAnyPermission(['borrow.read', 'borrow.write']), listReservations);
router.get('/:id', authorizeAnyPermission(['borrow.read', 'borrow.write']), getReservationById);
router.post('/', authorizeAnyPermission(['borrow.write']), createReservation);
router.patch('/:id/cancel', authorizeAnyPermission(['borrow.write']), cancelReservation);
router.post('/:id/convert-to-loan', authorizeAnyPermission(['borrow.write']), convertReservationToLoan);

module.exports = router;
