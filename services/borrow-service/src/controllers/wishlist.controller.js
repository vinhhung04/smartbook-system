const { prisma } = require('../lib/prisma');
const { ensureCurrentCustomer } = require('./customer.controller');
const { getBookPublicAvailability } = require('../services/inventory-integration.service');

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
      where: { customer_id_book_id: { customer_id: customer.id, book_id: bookId } },
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

const AVAILABLE_MESSAGE = 'Sách hiện đang có sẵn tại chi nhánh, bạn có thể đặt trước ngay.';
const UNVERIFIED_MESSAGE = 'Chưa kiểm tra được tình trạng sách, vui lòng thử lại sau.';
const NOT_FOUND_MESSAGE = 'Không tìm thấy sách trong danh mục.';

/**
 * Reverts what one subscribe request wrote — only while the row is still the
 * ACTIVE/un-notified state it wrote. If the consumer claimed it meanwhile, the
 * reader was notified and NOTIFIED is the correct final state, so it stays.
 * A previously ACTIVE alert is left alone: it existed before this request, so
 * the consumer handles every stock event since.
 */
async function undoAlertWrite(alert, previous) {
  const untouched = { id: alert.id, status: 'ACTIVE', notified_at: null };
  if (!previous) {
    await prisma.availability_alerts.deleteMany({ where: untouched });
  } else if (previous.status !== 'ACTIVE') {
    await prisma.availability_alerts.updateMany({
      where: untouched,
      data: { status: previous.status, notified_at: previous.notified_at },
    });
  }
}

async function subscribeAvailabilityAlert(req, res) {
  try {
    const customer = await ensureCurrentCustomer(req);
    if (!customer) return res.status(404).json({ message: 'Customer profile not found' });

    const bookId = String(req.body?.book_id || '').trim();
    if (!bookId) return res.status(400).json({ message: 'book_id is required' });
    if (!UUID_RE.test(bookId)) return res.status(400).json({ message: 'book_id must be a valid UUID' });

    // "Báo khi có sách" only makes sense for a book no reader can pick up today.
    // Checked here (not trusted to the UI) against inventory's live public
    // availability — the same BRANCH/LIBRARY rule as the catalog, so stock in an
    // internal warehouse or still in receiving does not count. Fails closed.
    let availability;
    try {
      availability = await getBookPublicAvailability({ bookId, requestId: req.requestId });
    } catch (error) {
      console.error('subscribeAvailabilityAlert availability check failed:', error.message);
      return res.status(503).json({ message: UNVERIFIED_MESSAGE });
    }
    if (!availability) {
      return res.status(404).json({ message: NOT_FOUND_MESSAGE });
    }
    if (Number(availability.available_quantity) > 0) {
      return res.status(409).json({ message: AVAILABLE_MESSAGE, data: { available_quantity: availability.available_quantity } });
    }

    const key = { customer_id_book_id: { customer_id: customer.id, book_id: bookId } };
    const previous = await prisma.availability_alerts.findUnique({ where: key });
    const alert = await prisma.availability_alerts.upsert({
      where: key,
      create: { customer_id: customer.id, book_id: bookId, status: 'ACTIVE' },
      update: { status: 'ACTIVE', notified_at: null },
    });

    // Second live check, after the alert exists. Inventory writes its stock
    // event in the same transaction as the stock change, so a restock the
    // consumer handled before this alert existed is already visible here; any
    // event handled after the upsert finds the alert and claims it. If a copy
    // appeared in between (or we cannot tell), undo this request's write and
    // tell the reader instead of leaving an ACTIVE alert that may never fire.
    let recheck;
    try {
      recheck = await getBookPublicAvailability({ bookId, requestId: req.requestId });
    } catch (error) {
      console.error('subscribeAvailabilityAlert re-check failed, undoing:', error.message);
      await undoAlertWrite(alert, previous);
      return res.status(503).json({ message: UNVERIFIED_MESSAGE });
    }
    if (!recheck) {
      // Deactivated/unpublished between the two checks: no alert for a book
      // that is no longer in the public catalog.
      await undoAlertWrite(alert, previous);
      return res.status(404).json({ message: NOT_FOUND_MESSAGE });
    }
    if (Number(recheck.available_quantity) > 0) {
      await undoAlertWrite(alert, previous);
      return res.status(409).json({ message: AVAILABLE_MESSAGE, data: { available_quantity: recheck.available_quantity } });
    }
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
