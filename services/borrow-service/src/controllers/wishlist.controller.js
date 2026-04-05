const { prisma } = require('../lib/prisma');
const { ensureCurrentCustomer } = require('./customer.controller');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getMyWishlist(req, res) {
  try {
    const customer = await ensureCurrentCustomer(req);
    if (!customer) return res.status(404).json({ message: 'Customer profile not found' });

    const items = await prisma.book_wishlists.findMany({
      where: { customer_id: customer.id },
      orderBy: { created_at: 'desc' },
    });
    return res.json({ data: items });
  } catch (error) {
    console.error('getMyWishlist error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function addToWishlist(req, res) {
  try {
    const customer = await ensureCurrentCustomer(req);
    if (!customer) return res.status(404).json({ message: 'Customer profile not found' });

    const bookId = String(req.body?.book_id || '').trim();
    if (!bookId) return res.status(400).json({ message: 'book_id is required' });
    if (!UUID_RE.test(bookId)) return res.status(400).json({ message: 'book_id must be a valid UUID' });

    const item = await prisma.book_wishlists.upsert({
      where: { uniq_book_wishlists_customer_book: { customer_id: customer.id, book_id: bookId } },
      create: { customer_id: customer.id, book_id: bookId },
      update: {},
    });
    return res.status(201).json({ data: item });
  } catch (error) {
    console.error('addToWishlist error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function removeFromWishlist(req, res) {
  try {
    const customer = await ensureCurrentCustomer(req);
    if (!customer) return res.status(404).json({ message: 'Customer profile not found' });

    const bookId = String(req.params.bookId || '').trim();
    await prisma.book_wishlists.deleteMany({
      where: { customer_id: customer.id, book_id: bookId },
    });
    return res.json({ message: 'Removed from wishlist' });
  } catch (error) {
    console.error('removeFromWishlist error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function getMyAvailabilityAlerts(req, res) {
  try {
    const customer = await ensureCurrentCustomer(req);
    if (!customer) return res.status(404).json({ message: 'Customer profile not found' });

    const alerts = await prisma.availability_alerts.findMany({
      where: { customer_id: customer.id },
      orderBy: { created_at: 'desc' },
    });
    return res.json({ data: alerts });
  } catch (error) {
    console.error('getMyAvailabilityAlerts error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function subscribeAvailabilityAlert(req, res) {
  try {
    const customer = await ensureCurrentCustomer(req);
    if (!customer) return res.status(404).json({ message: 'Customer profile not found' });

    const bookId = String(req.body?.book_id || '').trim();
    if (!bookId) return res.status(400).json({ message: 'book_id is required' });
    if (!UUID_RE.test(bookId)) return res.status(400).json({ message: 'book_id must be a valid UUID' });

    const alert = await prisma.availability_alerts.upsert({
      where: { uniq_availability_alerts_customer_book: { customer_id: customer.id, book_id: bookId } },
      create: { customer_id: customer.id, book_id: bookId, status: 'ACTIVE' },
      update: { status: 'ACTIVE', notified_at: null },
    });
    return res.status(201).json({ data: alert });
  } catch (error) {
    console.error('subscribeAvailabilityAlert error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function unsubscribeAvailabilityAlert(req, res) {
  try {
    const customer = await ensureCurrentCustomer(req);
    if (!customer) return res.status(404).json({ message: 'Customer profile not found' });

    const bookId = String(req.params.bookId || '').trim();
    await prisma.availability_alerts.deleteMany({
      where: { customer_id: customer.id, book_id: bookId },
    });
    return res.json({ message: 'Unsubscribed' });
  } catch (error) {
    console.error('unsubscribeAvailabilityAlert error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

module.exports = {
  getMyWishlist,
  addToWishlist,
  removeFromWishlist,
  getMyAvailabilityAlerts,
  subscribeAvailabilityAlert,
  unsubscribeAvailabilityAlert,
};
