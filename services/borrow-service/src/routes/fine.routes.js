const express = require('express');
const {
  listFines,
  getFineById,
  recordFinePayment,
  waiveFine,
} = require('../controllers/fine.controller');
const { authorizeBorrowAdminRead, authorizeBorrowAdminWrite } = require('../middlewares/auth.middleware');

const router = express.Router();

router.get('/', authorizeBorrowAdminRead, listFines);
router.get('/:id', authorizeBorrowAdminRead, getFineById);
router.post('/:id/payments', authorizeBorrowAdminWrite, recordFinePayment);
router.patch('/:id/waive', authorizeBorrowAdminWrite, waiveFine);

module.exports = router;
