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
// Overridable so CI can run many scripted logins in one 15-minute window without
// weakening the production default (10) — unset locally/in prod, it's a no-op.
const authRateLimit = createRateLimiter({
  max: Number(process.env.AUTH_LOGIN_RATE_LIMIT_MAX) || 10,
  windowMs: 15 * 60 * 1000,
});
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
