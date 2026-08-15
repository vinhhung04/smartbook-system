const express = require('express');
const {
  register,
  login,
  me,
  listWarehouseStaff,
  updateMe,
  logout,
  changePassword,
  requestPasswordReset,
  confirmPasswordReset,
  verifyEmail,
} = require('../controllers/auth.controller');
const { authenticateToken } = require('../middlewares/auth.middleware');
const { createRateLimiter } = require('@smartbook/shared/runtime');

const router = express.Router();
const authRateLimit = createRateLimiter({ max: 10, windowMs: 15 * 60 * 1000 });
const resetRateLimit = createRateLimiter({ max: 5, windowMs: 15 * 60 * 1000 });

// Public endpoints
router.post('/register', authRateLimit, register);
router.post('/login', authRateLimit, login);
router.post('/logout', authenticateToken, logout);
router.get('/me', authenticateToken, me);
router.get('/warehouse-staff', authenticateToken, listWarehouseStaff);
router.patch('/me', authenticateToken, updateMe);
router.post('/change-password', authenticateToken, changePassword);
router.post('/password-reset/request', resetRateLimit, requestPasswordReset);
router.post('/password-reset/confirm', resetRateLimit, confirmPasswordReset);
router.post('/verify-email', resetRateLimit, verifyEmail);

module.exports = router;
