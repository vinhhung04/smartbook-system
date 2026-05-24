const express = require('express');
const {
  listFines,
  getFineById,
  recordFinePayment,
  waiveFine,
} = require('../controllers/fine.controller');
const { authorizeAnyPermission } = require('../middlewares/auth.middleware');

const router = express.Router();

router.get('/', authorizeAnyPermission(['borrow.fines.read', 'borrow.fines.manage']), listFines);
router.get('/:id', authorizeAnyPermission(['borrow.fines.read', 'borrow.fines.manage']), getFineById);
router.post('/:id/payments', authorizeAnyPermission(['borrow.fines.manage', 'borrow.payments.process']), recordFinePayment);
router.patch('/:id/waive', authorizeAnyPermission(['borrow.fines.manage']), waiveFine);

module.exports = router;
