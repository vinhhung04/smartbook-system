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

const router = express.Router();

// Public endpoints
router.post('/register', register);
router.post('/login', login);
router.post('/logout', authenticateToken, logout);
router.get('/me', authenticateToken, me);
router.get('/warehouse-staff', authenticateToken, listWarehouseStaff);
router.patch('/me', authenticateToken, updateMe);
router.post('/change-password', authenticateToken, changePassword);
router.post('/password-reset/request', requestPasswordReset);
router.post('/password-reset/confirm', confirmPasswordReset);
router.post('/verify-email', verifyEmail);

module.exports = router;
