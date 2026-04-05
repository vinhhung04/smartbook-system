const express = require('express');
const {
  getMyReservations,
  createMyReservation,
  cancelMyReservation,
  getMyLoans,
  getMyLoanById,
  requestMyLoanRenewal,
  getMyAccount,
  topupMyAccount,
  getMyAccountLedger,
  getMyFines,
  payMyFine,
  getMyNotifications,
} = require('../controllers/my.controller');
const {
  createOrUpdateMyReview,
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
router.post('/account/topup', topupMyAccount);
router.get('/account/ledger', getMyAccountLedger);
router.get('/fines', getMyFines);
router.post('/fines/payments', payMyFine);
router.get('/notifications', getMyNotifications);
router.patch('/notifications/:id/read', async (req, res) => {
  try {
    const { ensureCurrentCustomer } = require('../controllers/customer.controller');
    const customer = await ensureCurrentCustomer(req);
    if (!customer) return res.status(404).json({ message: 'Customer not found' });
    const { prisma } = require('../lib/prisma');
    await prisma.customer_notifications.updateMany({
      where: { id: req.params.id, customer_id: customer.id, read_at: null },
      data: { read_at: new Date() },
    });
    return res.json({ message: 'Marked as read' });
  } catch (err) {
    console.error('markNotificationRead error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});
router.patch('/notifications/read-all', async (req, res) => {
  try {
    const { ensureCurrentCustomer } = require('../controllers/customer.controller');
    const customer = await ensureCurrentCustomer(req);
    if (!customer) return res.status(404).json({ message: 'Customer not found' });
    const { prisma } = require('../lib/prisma');
    const result = await prisma.customer_notifications.updateMany({
      where: { customer_id: customer.id, read_at: null },
      data: { read_at: new Date() },
    });
    return res.json({ message: 'All marked as read', count: result.count });
  } catch (err) {
    console.error('markAllNotificationsRead error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

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
router.get('/reviews/book/:bookId', getMyReviewForBook);
router.delete('/reviews/book/:bookId', deleteMyReview);

router.get('/wishlists', getMyWishlist);
router.post('/wishlists', addToWishlist);
router.delete('/wishlists/:bookId', removeFromWishlist);

router.get('/availability-alerts', getMyAvailabilityAlerts);
router.post('/availability-alerts', subscribeAvailabilityAlert);
router.delete('/availability-alerts/:bookId', unsubscribeAvailabilityAlert);

module.exports = router;
