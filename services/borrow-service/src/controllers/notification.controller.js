const { prisma } = require('../lib/prisma');
const { ensureCurrentCustomer } = require('./customer.controller');

// The signed-in customer's notification center. Ownership is never taken from
// the request: every query is scoped to the customer resolved from the JWT, so
// another customer's notification id behaves exactly like an unknown id (404).

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parsePagination(query) {
  const page = Math.max(1, Number.parseInt(String(query.page || '1'), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(query.pageSize || '20'), 10) || 20));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

function readFilter(status) {
  const value = String(status || '').toLowerCase();
  if (value === 'unread') return { read_at: null };
  if (value === 'read') return { read_at: { not: null } };
  return {};
}

async function getMyNotifications(req, res) {
  try {
    const customer = await ensureCurrentCustomer(req);
    if (!customer) return res.status(404).json({ message: 'Customer profile not found' });

    const pagination = parsePagination(req.query);
    const where = { customer_id: customer.id, ...readFilter(req.query.status) };
    const [items, total, unreadCount] = await Promise.all([
      prisma.customer_notifications.findMany({
        where,
        orderBy: [{ scheduled_at: 'desc' }],
        skip: pagination.skip,
        take: pagination.take,
      }),
      prisma.customer_notifications.count({ where }),
      prisma.customer_notifications.count({ where: { customer_id: customer.id, read_at: null } }),
    ]);

    return res.json({
      data: items,
      meta: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total,
        totalPages: Math.ceil(total / pagination.pageSize) || 1,
        unread_count: unreadCount,
      },
    });
  } catch (error) {
    console.error('getMyNotifications error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function getMyUnreadNotificationCount(req, res) {
  try {
    const customer = await ensureCurrentCustomer(req);
    if (!customer) return res.status(404).json({ message: 'Customer profile not found' });
    const unreadCount = await prisma.customer_notifications.count({ where: { customer_id: customer.id, read_at: null } });
    return res.json({ data: { unread_count: unreadCount } });
  } catch (error) {
    console.error('getMyUnreadNotificationCount error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function markMyNotificationRead(req, res) {
  try {
    const customer = await ensureCurrentCustomer(req);
    if (!customer) return res.status(404).json({ message: 'Customer not found' });

    const id = String(req.params.id || '');
    if (!UUID_PATTERN.test(id)) return res.status(400).json({ message: 'Invalid notification id' });

    const notification = await prisma.customer_notifications.findFirst({
      where: { id, customer_id: customer.id },
      select: { id: true, read_at: true },
    });
    if (!notification) return res.status(404).json({ message: 'Notification not found' });

    // Idempotent: marking an already-read notification keeps its first read time.
    if (!notification.read_at) {
      await prisma.customer_notifications.updateMany({
        where: { id, customer_id: customer.id, read_at: null },
        data: { read_at: new Date() },
      });
    }
    const unreadCount = await prisma.customer_notifications.count({ where: { customer_id: customer.id, read_at: null } });
    return res.json({ message: 'Marked as read', data: { id, unread_count: unreadCount } });
  } catch (error) {
    console.error('markNotificationRead error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function markAllMyNotificationsRead(req, res) {
  try {
    const customer = await ensureCurrentCustomer(req);
    if (!customer) return res.status(404).json({ message: 'Customer not found' });
    const result = await prisma.customer_notifications.updateMany({
      where: { customer_id: customer.id, read_at: null },
      data: { read_at: new Date() },
    });
    return res.json({ message: 'All marked as read', count: result.count, data: { unread_count: 0 } });
  } catch (error) {
    console.error('markAllNotificationsRead error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

module.exports = {
  getMyNotifications,
  getMyUnreadNotificationCount,
  markMyNotificationRead,
  markAllMyNotificationsRead,
};
