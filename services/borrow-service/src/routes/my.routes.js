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
const { authorizeAnyPermission, authorizeAnyRole } = require('../middlewares/auth.middleware');

const router = express.Router();

router.use(authorizeAnyRole(['CUSTOMER']));

router.get('/profile', authorizeAnyPermission(['customer.self.read']), require('../controllers/customer.controller').getMyProfile);
router.patch('/profile', authorizeAnyPermission(['customer.self.write']), require('../controllers/customer.controller').updateMyProfile);
router.get('/membership', authorizeAnyPermission(['customer.self.read']), require('../controllers/customer.controller').getMyMembership);

router.get('/reservations', authorizeAnyPermission(['borrow.self.read']), getMyReservations);
router.post('/reservations', authorizeAnyPermission(['borrow.self.write']), createMyReservation);
router.patch('/reservations/:id/cancel', authorizeAnyPermission(['borrow.self.write']), cancelMyReservation);

router.get('/loans', authorizeAnyPermission(['borrow.self.read']), getMyLoans);
router.get('/loans/:id', authorizeAnyPermission(['borrow.self.read']), getMyLoanById);
router.post('/loans/:id/renew-request', authorizeAnyPermission(['borrow.self.write']), requestMyLoanRenewal);

router.get('/account', authorizeAnyPermission(['account.self.read']), getMyAccount);
router.post('/account/topup', authorizeAnyPermission(['account.self.read']), topupMyAccount);
router.get('/account/ledger', authorizeAnyPermission(['account.self.read']), getMyAccountLedger);
router.get('/fines', authorizeAnyPermission(['fine.self.read']), getMyFines);
router.post('/fines/payments', authorizeAnyPermission(['borrow.self.write']), payMyFine);
router.get('/notifications', authorizeAnyPermission(['notification.self.read']), getMyNotifications);
router.patch('/notifications/:id/read', authorizeAnyPermission(['notification.self.read']), async (req, res) => {
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
router.patch('/notifications/read-all', authorizeAnyPermission(['notification.self.read']), async (req, res) => {
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

router.get('/preferences', authorizeAnyPermission(['customer.self.read']), async (req, res) => {
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
router.patch('/preferences', authorizeAnyPermission(['customer.self.write']), async (req, res) => {
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

router.post('/reviews', authorizeAnyPermission(['borrow.self.write']), createOrUpdateMyReview);
router.get('/reviews/book/:bookId', authorizeAnyPermission(['borrow.self.read']), getMyReviewForBook);
router.delete('/reviews/book/:bookId', authorizeAnyPermission(['borrow.self.write']), deleteMyReview);

router.get('/wishlists', authorizeAnyPermission(['borrow.self.read']), getMyWishlist);
router.post('/wishlists', authorizeAnyPermission(['borrow.self.write']), addToWishlist);
router.delete('/wishlists/:bookId', authorizeAnyPermission(['borrow.self.write']), removeFromWishlist);

router.get('/availability-alerts', authorizeAnyPermission(['borrow.self.read']), getMyAvailabilityAlerts);
router.post('/availability-alerts', authorizeAnyPermission(['borrow.self.write']), subscribeAvailabilityAlert);
router.delete('/availability-alerts/:bookId', authorizeAnyPermission(['borrow.self.write']), unsubscribeAvailabilityAlert);

module.exports = router;
