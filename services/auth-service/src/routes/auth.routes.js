const express = require('express');
const { register, login, me, listWarehouseStaff, updateMe, logout, changePassword } = require('../controllers/auth.controller');
const { authenticateToken } = require('../middlewares/auth.middleware');

const router = express.Router();

// Public endpoints
router.post('/register', register);
router.post('/login', login);
router.post('/logout', authenticateToken, logout);
router.get('/me', authenticateToken, me);
router.get('/warehouse-staff', authenticateToken, listWarehouseStaff);
router.patch('/me', authenticateToken, updateMe);
router.post('/change-password', authenticateToken, changePassword);

module.exports = router;
