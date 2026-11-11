const express = require('express');
const {
  register,
  login,
  refresh,
  revokeRefresh,
  me,
  listWarehouseStaff,
  updateMe,
  logout,
  changePassword,
  requestPasswordReset,
  confirmPasswordReset,
  resendVerification,
  verifyEmailOtp,
  resendEmailOtp,
  verifyLoginOtp,
} = require('../controllers/auth.controller');
const { authenticateToken } = require('../middlewares/auth.middleware');
const { createRateLimiter } = require('@smartbook/shared/runtime');

const router = express.Router();
// Overridable so CI can run many scripted logins in one 15-minute window without
// weakening the production default (10) — unset locally/in prod, it's a no-op.
// trustedProxyHops: 2 — requests reach this service through nginx then api-gateway, both of
// which append to X-Forwarded-For; trusting exactly those 2 hops recovers the real client IP
// instead of the client-spoofable leftmost entry (see packages/shared/runtime/index.cjs).
const authRateLimit = createRateLimiter({
  max: Number(process.env.AUTH_LOGIN_RATE_LIMIT_MAX) || 10,
  windowMs: 15 * 60 * 1000,
  trustedProxyHops: 2,
});
const resetRateLimit = createRateLimiter({ max: 5, windowMs: 15 * 60 * 1000, trustedProxyHops: 2 });
// Email OTP: per-IP budgets on top of the per-challenge (5 guesses) and per-account
// (10 codes an hour) limits enforced in lib/email-otp.js.
const otpVerifyRateLimit = createRateLimiter({ max: Number(process.env.AUTH_OTP_VERIFY_RATE_LIMIT_MAX) || 30, windowMs: 15 * 60 * 1000, trustedProxyHops: 2 });
const otpResendRateLimit = createRateLimiter({ max: Number(process.env.AUTH_OTP_RESEND_RATE_LIMIT_MAX) || 10, windowMs: 15 * 60 * 1000, trustedProxyHops: 2 });
const refreshRateLimit = createRateLimiter({ max: Number(process.env.AUTH_REFRESH_RATE_LIMIT_MAX) || 30, windowMs: 15 * 60 * 1000, trustedProxyHops: 2 });

// Public endpoints
router.post('/register', authRateLimit, register);
router.post('/login', authRateLimit, login);
// Mobile session renewal. Separate budget from login: a refresh is not a password
// guess, but it is still bounded so a stolen token cannot be hammered.
router.post('/refresh', refreshRateLimit, refresh);
router.post('/refresh/revoke', refreshRateLimit, revokeRefresh);
router.post('/logout', authenticateToken, logout);
router.get('/me', authenticateToken, me);
router.get('/warehouse-staff', authenticateToken, listWarehouseStaff);
router.patch('/me', authenticateToken, updateMe);
router.post('/change-password', authenticateToken, changePassword);
router.post('/password-reset/request', resetRateLimit, requestPasswordReset);
router.post('/password-reset/confirm', resetRateLimit, confirmPasswordReset);
router.post('/email-otp/verify', otpVerifyRateLimit, verifyEmailOtp);
router.post('/email-otp/resend', otpResendRateLimit, resendEmailOtp);
router.post('/login/verify-otp', otpVerifyRateLimit, verifyLoginOtp);
router.post('/resend-verification', authenticateToken, otpResendRateLimit, resendVerification);

module.exports = router;
