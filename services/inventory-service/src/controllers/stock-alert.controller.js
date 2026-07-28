const { PrismaClient } = require('@prisma/client');
const { pushToRooms } = require('../lib/socket-emitter');

const prisma = new PrismaClient();

const VALID_ALERT_TYPES = ['LOW_STOCK', 'OUT_OF_STOCK', 'STOCK_RISK', 'AGING_STOCK'];
const VALID_ALERT_LEVELS = ['LOW', 'MEDIUM', 'HIGH'];

// Shared by the HTTP endpoint (manual/AI-assistant creation) and periodic jobs
// (e.g. aging-inventory.job.js). Validates FKs, dedupes against any OPEN alert
// for the same variant+warehouse+type, and creates the alert if none exists.
async function upsertStockAlert({
  variant_id,
  warehouse_id,
  alert_type,
  alert_level,
  threshold_value,
  current_value,
  payload: extraPayload,
  source,
}) {
  const normalizedAlertType = String(alert_type).toUpperCase();
  const normalizedAlertLevel = String(alert_level).toUpperCase();

  if (!variant_id || !warehouse_id || !normalizedAlertType || !normalizedAlertLevel) {
    const err = new Error('variant_id, warehouse_id, alert_type, alert_level are required');
    err.statusCode = 400;
    throw err;
  }
  if (!VALID_ALERT_TYPES.includes(normalizedAlertType)) {
    const err = new Error(`alert_type must be one of: ${VALID_ALERT_TYPES.join(', ')}`);
    err.statusCode = 400;
    throw err;
  }
  if (!VALID_ALERT_LEVELS.includes(normalizedAlertLevel)) {
    const err = new Error(`alert_level must be one of: ${VALID_ALERT_LEVELS.join(', ')}`);
    err.statusCode = 400;
    throw err;
  }

  const [variant, warehouse] = await Promise.all([
    prisma.book_variants.findUnique({ where: { id: variant_id }, select: { id: true } }),
    prisma.warehouses.findUnique({ where: { id: warehouse_id }, select: { id: true } }),
  ]);

  if (!variant) {
    const err = new Error('book_variant not found');
    err.statusCode = 404;
    throw err;
  }
  if (!warehouse) {
    const err = new Error('warehouse not found');
    err.statusCode = 404;
    throw err;
  }

  const existing = await prisma.stock_alerts.findFirst({
    where: {
      variant_id,
      warehouse_id,
      alert_type: normalizedAlertType,
      status: 'OPEN',
    },
    select: { id: true, status: true, alert_level: true, first_triggered_at: true },
  });

  if (existing) {
    return { alert: existing, duplicate: true };
  }

  const alert = await prisma.stock_alerts.create({
    data: {
      variant_id,
      warehouse_id,
      alert_type: normalizedAlertType,
      alert_level: normalizedAlertLevel,
      threshold_value: threshold_value != null ? Number(threshold_value) : null,
      current_value: current_value != null ? Number(current_value) : null,
      status: 'OPEN',
      payload: {
        ...(extraPayload && typeof extraPayload === 'object' ? extraPayload : {}),
        source: source || 'SYSTEM',
      },
    },
  });

  setImmediate(() => void pushToRooms(['admin', 'warehouse_manager'], 'stock:low', {
    id: alert.id,
    alert_type: normalizedAlertType,
    alert_level: normalizedAlertLevel,
    variant_id,
    warehouse_id,
    source: source || 'SYSTEM',
  }));

  return { alert, duplicate: false };
}

async function createStockAlert(req, res) {
  const userId = req.user?.id || req.user?.sub;
  if (!userId) {
    return res.status(401).json({ message: 'Invalid current user context' });
  }

  const {
    variant_id,
    warehouse_id,
    alert_type,
    alert_level,
    threshold_value,
    current_value,
    payload: extraPayload,
  } = req.body;

  try {
    const { alert, duplicate } = await upsertStockAlert({
      variant_id,
      warehouse_id,
      alert_type,
      alert_level,
      threshold_value,
      current_value,
      payload: { ...(extraPayload && typeof extraPayload === 'object' ? extraPayload : {}), created_by_user_id: userId },
      source: 'AI_ASSISTANT',
    });

    if (duplicate) {
      return res.status(200).json({
        data: alert,
        duplicate: true,
        message: 'Cảnh báo OPEN cho variant+warehouse+type này đã tồn tại, bỏ qua.',
      });
    }

    return res.status(201).json({ data: alert });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.error('[stock-alert] createStockAlert error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function listStockAlerts(req, res) {
  const { status, alert_type, warehouse_id, page = 1, limit = 50 } = req.query;

  const where = {};
  if (status) where.status = String(status).toUpperCase();
  if (alert_type) where.alert_type = String(alert_type).toUpperCase();
  if (warehouse_id) where.warehouse_id = warehouse_id;

  try {
    const [alerts, total] = await Promise.all([
      prisma.stock_alerts.findMany({
        where,
        include: {
          book_variants: {
            select: {
              id: true,
              sku: true,
              isbn13: true,
              books: { select: { id: true, title: true } },
            },
          },
          warehouses: { select: { id: true, code: true, name: true } },
        },
        orderBy: { first_triggered_at: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      }),
      prisma.stock_alerts.count({ where }),
    ]);

    return res.json({ data: alerts, total, page: Number(page), limit: Number(limit) });
  } catch (error) {
    console.error('[stock-alert] listStockAlerts error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

module.exports = { createStockAlert, listStockAlerts, upsertStockAlert };
