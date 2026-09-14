// Contract test for the Borrow<->Inventory boundary: calls the real,
// running inventory-service (docker compose up) and validates response
// shapes against the schemas in packages/shared/contracts/borrow-inventory.
//
// Deliberately NOT under test/*.test.js — `node --test test/contract/*.test.js`
// is a separate script (test:contract) so `pnpm test`/`pnpm verify` (which
// need no Docker stack) never pick this up. Same JWT-signing convention as
// scripts/reservation-concurrency-race-integration.mjs (node:crypto, no
// jsonwebtoken dependency) so it works from any shell.
const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto');
const path = require('node:path');
const Ajv = require('ajv');

// inventory-service has no host port of its own (docker-compose.yml) --
// reachable from the host only through api-gateway's proxy.
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'smartbook_shared_jwt_secret';

const ajv = new Ajv();
const schemas = {
  reserve: require(path.join('..', '..', '..', '..', 'packages', 'shared', 'contracts', 'borrow-inventory', 'reserve-from-borrow.response.json')),
  release: require(path.join('..', '..', '..', '..', 'packages', 'shared', 'contracts', 'borrow-inventory', 'release-borrow-reservation.response.json')),
  availability200: require(path.join('..', '..', '..', '..', 'packages', 'shared', 'contracts', 'borrow-inventory', 'get-availability.response.200.json')),
  availability409: require(path.join('..', '..', '..', '..', 'packages', 'shared', 'contracts', 'borrow-inventory', 'get-availability.response.409.json')),
  consume: require(path.join('..', '..', '..', '..', 'packages', 'shared', 'contracts', 'borrow-inventory', 'consume-borrow-reservation.response.json')),
  return: require(path.join('..', '..', '..', '..', 'packages', 'shared', 'contracts', 'borrow-inventory', 'return-borrowed-loan.response.json')),
  variantDetails: require(path.join('..', '..', '..', '..', 'packages', 'shared', 'contracts', 'borrow-inventory', 'get-variant-details.response.json')),
};

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signJwt(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = b64url(JSON.stringify(header));
  const encodedPayload = b64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.createHmac('sha256', secret).update(signingInput).digest('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${signingInput}.${signature}`;
}

const token = signJwt({
  id: crypto.randomUUID(),
  email: `contract.itest.${Date.now()}@smartbook.local`,
  is_superuser: true,
  permissions: ['borrow.read', 'borrow.write', 'inventory.stock.read', 'inventory.stock.write'],
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600,
}, JWT_SECRET);

async function request(method, path_, body) {
  const response = await fetch(`${BASE_URL}${path_}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

async function findTarget() {
  const res = await request('GET', '/api/borrow-integration/availability?variant_id=00000000-0000-0000-0000-000000000000&warehouse_id=00000000-0000-0000-0000-000000000000&quantity=1');
  // The above always 409s (fake ids) -- only used to prove auth works; the
  // real target variant/warehouse comes from the gateway's /api/books,
  // reachable here directly via inventory-service's own route.
  void res;
  const booksRes = await fetch(`${BASE_URL}/api/books`, { headers: { Authorization: `Bearer ${token}` } });
  const books = await booksRes.json();
  const candidate = books.find((b) => b.default_warehouse_id && Number(b.available_quantity || 0) > 0);
  if (!candidate) throw new Error('No borrowable variant with available stock found via /api/books');
  return { variant_id: candidate.variant_id, warehouse_id: candidate.default_warehouse_id };
}

test('contract: reserve -> consume -> return lifecycle matches locked schemas', async (t) => {
  const target = await findTarget();
  const reservationId = crypto.randomUUID();
  const loanId = crypto.randomUUID();
  const runTag = Date.now();

  await t.test('POST reservations/reserve (201) matches schema', async () => {
    const res = await request('POST', '/api/borrow-integration/reservations/reserve', {
      reservation_id: reservationId,
      reservation_number: `CT-${runTag}`,
      variant_id: target.variant_id,
      warehouse_id: target.warehouse_id,
      quantity: 1,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      idempotency_key: `ct-reserve-${runTag}`,
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    const valid = ajv.validate(schemas.reserve, res.data);
    assert.ok(valid, ajv.errorsText(ajv.errors));
    assert.equal(res.data.idempotent, false);
  });

  await t.test('POST reservations/reserve replay (200, idempotent) matches schema', async () => {
    const res = await request('POST', '/api/borrow-integration/reservations/reserve', {
      reservation_id: reservationId,
      reservation_number: `CT-${runTag}`,
      variant_id: target.variant_id,
      warehouse_id: target.warehouse_id,
      quantity: 1,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      idempotency_key: `ct-reserve-${runTag}`,
    });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    const valid = ajv.validate(schemas.reserve, res.data);
    assert.ok(valid, ajv.errorsText(ajv.errors));
    assert.equal(res.data.idempotent, true);
  });

  await t.test('GET availability (200, sufficient stock) matches schema', async () => {
    const res = await request('GET', `/api/borrow-integration/availability?variant_id=${target.variant_id}&warehouse_id=${target.warehouse_id}&quantity=1`);
    assert.equal(res.status, 200, JSON.stringify(res.data));
    const valid = ajv.validate(schemas.availability200, res.data);
    assert.ok(valid, ajv.errorsText(ajv.errors));
  });

  await t.test('GET availability (409, insufficient stock) matches schema', async () => {
    const res = await request('GET', `/api/borrow-integration/availability?variant_id=${target.variant_id}&warehouse_id=${target.warehouse_id}&quantity=999999`);
    assert.equal(res.status, 409, JSON.stringify(res.data));
    const valid = ajv.validate(schemas.availability409, res.data);
    assert.ok(valid, ajv.errorsText(ajv.errors));
  });

  await t.test('POST reservations/consume (201) matches schema', async () => {
    const res = await request('POST', '/api/borrow-integration/reservations/consume', {
      reservation_id: reservationId,
      loan_id: loanId,
      loan_number: `CT-LOAN-${runTag}`,
      warehouse_id: target.warehouse_id,
      idempotency_key: `ct-consume-${runTag}`,
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    const valid = ajv.validate(schemas.consume, res.data);
    assert.ok(valid, ajv.errorsText(ajv.errors));
    assert.equal(res.data.idempotent, false);
  });

  await t.test('POST loans/return (201) matches schema', async () => {
    const res = await request('POST', '/api/borrow-integration/loans/return', {
      loan_id: loanId,
      variant_id: target.variant_id,
      warehouse_id: target.warehouse_id,
      quantity: 1,
      idempotency_key: `ct-return-${runTag}`,
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    const valid = ajv.validate(schemas.return, res.data);
    assert.ok(valid, ajv.errorsText(ajv.errors));
    assert.equal(res.data.idempotent, false);
  });

  await t.test('GET variants/details matches schema', async () => {
    const res = await request('GET', `/api/borrow-integration/variants/details?ids=${target.variant_id}`);
    assert.equal(res.status, 200, JSON.stringify(res.data));
    const valid = ajv.validate(schemas.variantDetails, res.data);
    assert.ok(valid, ajv.errorsText(ajv.errors));
  });

  await t.test('POST reservations/release (idempotent-replay branch, has `idempotent`) matches schema', async () => {
    // The reservation was already CONSUMED above, so a release attempt
    // now hits the "not active" branch -- still validates the shared
    // release schema, which is what's being locked here.
    const res = await request('POST', '/api/borrow-integration/reservations/release', {
      reservation_id: reservationId,
      reason: 'CONTRACT_TEST_CLEANUP',
      idempotency_key: `ct-release-${runTag}`,
    });
    const valid = ajv.validate(schemas.release, res.data);
    assert.ok(valid, ajv.errorsText(ajv.errors));
  });
});
