const jwt = require('jsonwebtoken');

const INVENTORY_SERVICE_URL = process.env.INVENTORY_SERVICE_URL || 'http://inventory-service:3001';
const SERVICE_ACTOR_ID = '00000000-0000-0000-0000-000000000001';

function createServiceAuthHeader() {
  const token = jwt.sign(
    {
      id: SERVICE_ACTOR_ID,
      sub: SERVICE_ACTOR_ID,
      email: 'borrow-service@smartbook.local',
      full_name: 'Borrow Service',
      is_superuser: true,
      permissions: ['borrow.read', 'borrow.write', 'inventory.stock.read', 'inventory.stock.write'],
    },
    process.env.JWT_SECRET,
    { expiresIn: '10m' }
  );

  return `Bearer ${token}`;
}

function getInventoryAuthHeader(authHeader) {
  if (!authHeader) {
    return createServiceAuthHeader();
  }

  const [, token] = String(authHeader).split(' ');
  const payload = token ? jwt.decode(token) : null;
  const permissions = Array.isArray(payload?.permissions) ? payload.permissions : [];
  const canUseUserToken = Boolean(payload?.is_superuser) || permissions.some((permission) => [
    'borrow.read',
    'borrow.write',
    'inventory.stock.read',
    'inventory.stock.write',
  ].includes(permission));

  return canUseUserToken ? authHeader : createServiceAuthHeader();
}

async function requestInventory(path, options = {}) {
  const response = await fetch(`${INVENTORY_SERVICE_URL}${path}`, options);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = payload?.message || 'Inventory integration request failed';
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return payload;
}

async function checkAvailability({ variant_id, warehouse_id, quantity, authHeader }) {
  return requestInventory(
    `/api/borrow-integration/availability?variant_id=${encodeURIComponent(variant_id)}&warehouse_id=${encodeURIComponent(warehouse_id)}&quantity=${encodeURIComponent(String(quantity || 1))}`,
    {
      method: 'GET',
      headers: {
        Authorization: getInventoryAuthHeader(authHeader),
      },
    }
  );
}

async function reserveStock({ reservation_id, reservation_number, customer_id, variant_id, warehouse_id, quantity, expires_at, created_by_user_id, idempotency_key, authHeader }) {
  return requestInventory('/api/borrow-integration/reservations/reserve', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: getInventoryAuthHeader(authHeader),
    },
    body: JSON.stringify({
      reservation_id,
      reservation_number,
      customer_id,
      variant_id,
      warehouse_id,
      quantity,
      expires_at,
      created_by_user_id,
      idempotency_key,
    }),
  });
}

async function releaseReservation({ reservation_id, reason, idempotency_key, authHeader }) {
  return requestInventory('/api/borrow-integration/reservations/release', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: getInventoryAuthHeader(authHeader),
    },
    body: JSON.stringify({
      reservation_id,
      reason,
      idempotency_key,
    }),
  });
}

async function consumeReservation({ reservation_id, loan_id, loan_number, warehouse_id, idempotency_key, handled_by_user_id, authHeader }) {
  return requestInventory('/api/borrow-integration/reservations/consume', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: getInventoryAuthHeader(authHeader),
    },
    body: JSON.stringify({
      reservation_id,
      loan_id,
      loan_number,
      warehouse_id,
      idempotency_key,
      handled_by_user_id,
    }),
  });
}

async function returnBorrowedStock({
  loan_id,
  loan_item_id,
  variant_id,
  warehouse_id,
  quantity,
  location_id,
  inventory_unit_id,
  item_condition_on_return,
  mark_lost,
  idempotency_key,
  handled_by_user_id,
  authHeader,
}) {
  return requestInventory('/api/borrow-integration/loans/return', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: getInventoryAuthHeader(authHeader),
    },
    body: JSON.stringify({
      loan_id,
      loan_item_id,
      variant_id,
      warehouse_id,
      quantity,
      location_id,
      inventory_unit_id,
      item_condition_on_return,
      mark_lost,
      idempotency_key,
      handled_by_user_id,
    }),
  });
}

async function getVariantDetails({ variantIds, authHeader }) {
  const uniqueIds = [...new Set((variantIds || []).filter(Boolean))];
  if (uniqueIds.length === 0) return [];

  const result = await requestInventory(
    `/api/borrow-integration/variants/details?ids=${uniqueIds.map(encodeURIComponent).join(',')}`,
    {
      method: 'GET',
      headers: {
        Authorization: getInventoryAuthHeader(authHeader),
      },
    }
  );

  return Array.isArray(result?.data) ? result.data : [];
}

module.exports = {
  checkAvailability,
  reserveStock,
  releaseReservation,
  consumeReservation,
  returnBorrowedStock,
  getVariantDetails,
};
