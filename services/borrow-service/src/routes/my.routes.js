const express = require('express');
const {
  getMyReservations,
  createMyReservation,
  cancelMyReservation,
  getMyLoans,
  getMyLoanById,
  requestMyLoanRenewal,
  getMyAccount,
  getMyAccountLedger,
  getMyFines,
} = require('../controllers/my.controller');
const {
  getMyNotifications,
  getMyUnreadNotificationCount,
  markMyNotificationRead,
  markAllMyNotificationsRead,
} = require('../controllers/notification.controller');
const {
  createOrUpdateMyReview,
  getMyReviews,
  getMyReviewForBook,
  deleteMyReview,
} = require('../controllers/review.controller');
const {
  getMyWishlist,
  addToWishlist,
  removeFromWishlist,
  getMyAvailabilityAlerts,
  subscribeAvailabilityAlert,
  unsubscribeAvailabilityAlert,
} = require('../controllers/wishlist.controller');
const {
  createVnpayFinePayment,
  getVnpayFinePaymentStatus,
} = require('../controllers/vnpay-payment.controller');

const router = express.Router();

router.get('/profile', require('../controllers/customer.controller').getMyProfile);
router.patch('/profile', require('../controllers/customer.controller').updateMyProfile);
router.get('/membership', require('../controllers/customer.controller').getMyMembership);

router.get('/reservations', getMyReservations);
router.post('/reservations', createMyReservation);
router.patch('/reservations/:id/cancel', cancelMyReservation);

router.get('/loans', getMyLoans);
router.get('/loans/:id', getMyLoanById);
router.post('/loans/:id/renew-request', requestMyLoanRenewal);

router.get('/account', getMyAccount);
router.get('/account/ledger', getMyAccountLedger);
router.get('/fines', getMyFines);
router.post('/fines/payments/vnpay/create', createVnpayFinePayment);
router.get('/fines/payments/vnpay/status/:txnRef', getVnpayFinePaymentStatus);
router.get('/notifications', getMyNotifications);
router.get('/notifications/unread-count', getMyUnreadNotificationCount);
router.patch('/notifications/read-all', markAllMyNotificationsRead);
router.patch('/notifications/:id/read', markMyNotificationRead);

router.get('/preferences', async (req, res) => {
  try {
    const { ensureCurrentCustomer } = require('../controllers/customer.controller');
    const customer = await ensureCurrentCustomer(req);
    if (!customer) return res.status(404).json({ message: 'Customer not found' });
    const { prisma } = require('../lib/prisma');
    let prefs = await prisma.customer_preferences.findFirst({ where: { customer_id: customer.id } });
    if (!prefs) {
      prefs = await prisma.customer_preferences.create({
        data: { customer_id: customer.id },
      });
    }
    return res.json({ data: prefs });
  } catch (err) {
    console.error('getPreferences error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});
router.patch('/preferences', async (req, res) => {
  try {
    const { ensureCurrentCustomer } = require('../controllers/customer.controller');
    const customer = await ensureCurrentCustomer(req);
    if (!customer) return res.status(404).json({ message: 'Customer not found' });
    const { prisma } = require('../lib/prisma');
    const allowed = ['notify_email', 'notify_sms', 'notify_in_app', 'preferred_language'];
    const data = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        data[key] = typeof req.body[key] === 'boolean' ? req.body[key] : req.body[key];
      }
    }
    const prefs = await prisma.customer_preferences.upsert({
      where: { customer_id: customer.id },
      create: { customer_id: customer.id, ...data },
      update: data,
    });
    return res.json({ data: prefs });
  } catch (err) {
    console.error('updatePreferences error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/reviews', createOrUpdateMyReview);
router.get('/reviews', getMyReviews);
router.get('/reviews/book/:bookId', getMyReviewForBook);
router.delete('/reviews/book/:bookId', deleteMyReview);

router.get('/wishlists', getMyWishlist);
router.post('/wishlists', addToWishlist);
router.delete('/wishlists/:bookId', removeFromWishlist);

router.get('/availability-alerts', getMyAvailabilityAlerts);
router.post('/availability-alerts', subscribeAvailabilityAlert);
router.delete('/availability-alerts/:bookId', unsubscribeAvailabilityAlert);

module.exports = router;
