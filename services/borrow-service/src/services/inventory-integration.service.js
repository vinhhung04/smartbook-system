const INVENTORY_SERVICE_URL = process.env.INVENTORY_SERVICE_URL || 'http://inventory-service:3001';

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
        Authorization: authHeader,
      },
    }
  );
}

async function reserveStock({ reservation_id, reservation_number, customer_id, variant_id, warehouse_id, quantity, expires_at, created_by_user_id, idempotency_key, authHeader }) {
  return requestInventory('/api/borrow-integration/reservations/reserve', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader,
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
      Authorization: authHeader,
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
      Authorization: authHeader,
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

async function returnBorrowedStock({ loan_id, loan_item_id, variant_id, warehouse_id, quantity, location_id, inventory_unit_id, idempotency_key, handled_by_user_id, authHeader }) {
  return requestInventory('/api/borrow-integration/loans/return', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader,
    },
    body: JSON.stringify({
      loan_id,
      loan_item_id,
      variant_id,
      warehouse_id,
      quantity,
      location_id,
      inventory_unit_id,
      idempotency_key,
      handled_by_user_id,
    }),
  });
}

module.exports = {
  checkAvailability,
  reserveStock,
  releaseReservation,
  consumeReservation,
  returnBorrowedStock,
};
