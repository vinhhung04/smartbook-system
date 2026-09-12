const express = require('express');
const { handleVnpayReturn, handleVnpayIpn } = require('../controllers/vnpay-webhook.controller');

const router = express.Router();

router.get('/return', handleVnpayReturn);
router.get('/ipn', handleVnpayIpn);

module.exports = router;
