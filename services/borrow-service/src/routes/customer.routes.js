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
const { authorizeAnyPermission } = require('../middlewares/auth.middleware');

const router = express.Router();

router.get('/me/profile', authorizeAnyPermission(['customer.self.read']), getMyProfile);
router.patch('/me/profile', authorizeAnyPermission(['customer.self.write']), updateMyProfile);
router.get('/me/membership', authorizeAnyPermission(['customer.self.read']), getMyMembership);

router.get('/', authorizeAnyPermission(['borrow.customers.read', 'borrow.customers.write']), listCustomers);
router.post('/', authorizeAnyPermission(['borrow.customers.write']), createCustomer);
router.get('/:id', authorizeAnyPermission(['borrow.customers.read', 'borrow.customers.write']), getCustomerById);
router.patch('/:id', authorizeAnyPermission(['borrow.customers.write']), updateCustomer);
router.get('/:id/membership/active', authorizeAnyPermission(['borrow.customers.read', 'borrow.customers.write']), getActiveMembership);

module.exports = router;
