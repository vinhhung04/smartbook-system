const express = require('express');
const {
  listCustomers,
  createCustomer,
  getCustomerById,
  updateCustomer,
  getActiveMembership,
  getMyProfile,
  updateMyProfile,
  getMyMembership,
} = require('../controllers/customer.controller');
const { authorizeBorrowAdminRead, authorizeBorrowAdminWrite } = require('../middlewares/auth.middleware');

const router = express.Router();

router.get('/me/profile', getMyProfile);
router.patch('/me/profile', updateMyProfile);
router.get('/me/membership', getMyMembership);

router.get('/', authorizeBorrowAdminRead, listCustomers);
router.post('/', authorizeBorrowAdminWrite, createCustomer);
router.get('/:id', authorizeBorrowAdminRead, getCustomerById);
router.patch('/:id', authorizeBorrowAdminWrite, updateCustomer);
router.get('/:id/membership/active', authorizeBorrowAdminRead, getActiveMembership);

module.exports = router;
