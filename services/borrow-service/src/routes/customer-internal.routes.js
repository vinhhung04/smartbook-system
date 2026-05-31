const express = require('express');
const { provisionCustomerFromAuth, resolveCustomerByAuth } = require('../controllers/customer.controller');

const router = express.Router();

router.post('/provision', provisionCustomerFromAuth);
// Used by API gateway to resolve customer_id from user_id/email during socket auth
router.get('/resolve', resolveCustomerByAuth);

module.exports = router;
