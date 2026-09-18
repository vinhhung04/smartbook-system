// SB-10 scenario 2: many customers racing to reserve the same low-stock
// variant, measured under real k6 load (not just a correctness assertion —
// that was already proven with real numbers in scripts/reservation-concurrency-race-integration.mjs,
// Đợt 1). No DB mutation here (k6 has no Postgres driver, and per the
// roadmap's own guidance we don't force an artificial target): setup()
// discovers whatever low-but-nonzero stock already exists in the demo data
// and measures against that real baseline.
//
// 201 and 409 are BOTH "correct" outcomes under contention — only a
// 5xx/timeout counts as a real failure. Each VU acts as a distinct test
// customer (email prefixed `k6.loadtest.` so scripts/k6-reservation-race-cleanup.mjs
// can find and release them afterward — k6 VUs can't share mutable state to
// clean up after themselves).
import http from 'k6/http';
import crypto from 'k6/crypto';
import encoding from 'k6/encoding';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://api-gateway:3000';
const JWT_SECRET = __ENV.JWT_SECRET;
const TARGET_VUS = Number(__ENV.VUS) || 30;
const RUN_TAG = `${Date.now()}`;

const wonReservation = new Counter('reservation_won_total');
const lostReservation = new Counter('reservation_lost_total');
const unexpectedErrors = new Counter('unexpected_errors_total');

export const options = {
  vus: TARGET_VUS,
  iterations: TARGET_VUS, // exactly one reservation attempt per VU
};

function base64UrlEncodeJson(obj) {
  return encoding.b64encode(JSON.stringify(obj), 'rawurl');
}

function signJwt(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncodeJson(header);
  const encodedPayload = base64UrlEncodeJson(payload);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.hmac('sha256', secret, signingInput, 'base64rawurl');
  return `${signingInput}.${signature}`;
}

function adminHeaders(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export function setup() {
  const token = signJwt({
    id: '00000000-0000-4000-8000-000000000098',
    email: 'k6.reservation-race@smartbook.local',
    is_superuser: true,
    permissions: [],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  }, JWT_SECRET);

  const booksRes = http.get(`${BASE_URL}/api/books`, { headers: adminHeaders(token) });
  if (booksRes.status !== 200) {
    throw new Error(`setup: GET /api/books failed (${booksRes.status}): ${booksRes.body}`);
  }
  const books = booksRes.json();
  const candidates = books.filter((b) => b.default_warehouse_id && Number(b.available_quantity || 0) > 0);
  if (candidates.length === 0) {
    throw new Error('setup: no borrowable variant with available_quantity > 0 found in demo data');
  }
  candidates.sort((a, b) => Number(a.available_quantity) - Number(b.available_quantity));
  const target = candidates[0];

  const customers = [];
  for (let i = 0; i < TARGET_VUS; i += 1) {
    const email = `k6.loadtest.${RUN_TAG}.${i}@smartbook.local`;
    const custRes = http.post(`${BASE_URL}/borrow/customers`, JSON.stringify({
      full_name: `k6 Reservation Race ${i}`,
      email,
      status: 'ACTIVE',
    }), { headers: adminHeaders(token) });
    if (custRes.status !== 201) {
      throw new Error(`setup: failed to create test customer ${i} (${custRes.status}): ${custRes.body}`);
    }
    customers.push(custRes.json('data.id'));
  }

  console.log(`[setup] target variant=${target.variant_id} warehouse=${target.default_warehouse_id} available_before=${target.available_quantity} customers=${customers.length}`);

  return {
    token,
    variant_id: target.variant_id,
    warehouse_id: target.default_warehouse_id,
    available_before: target.available_quantity,
    customers,
  };
}

export default function (data) {
  const customerId = data.customers[(__VU - 1) % data.customers.length];
  const idempotencyKey = `k6-${RUN_TAG}-${__VU}-${__ITER}`;

  const res = http.post(`${BASE_URL}/borrow/reservations`, JSON.stringify({
    customer_id: customerId,
    variant_id: data.variant_id,
    warehouse_id: data.warehouse_id,
    quantity: 1,
    source_channel: 'COUNTER',
    notes: 'k6 reservation-race load test',
  }), {
    headers: { ...adminHeaders(data.token), 'Idempotency-Key': idempotencyKey },
  });

  if (res.status === 201) {
    wonReservation.add(1);
  } else if (res.status === 409) {
    lostReservation.add(1);
  } else {
    unexpectedErrors.add(1);
  }

  check(res, {
    'POST /borrow/reservations -> 201 (won) or 409 (lost to contention)': (r) => r.status === 201 || r.status === 409,
  });
}

export function teardown(data) {
  console.log(`[teardown] run_tag=${RUN_TAG} target variant=${data.variant_id} warehouse=${data.warehouse_id} available_before=${data.available_before} — run scripts/k6-reservation-race-cleanup.mjs now to release held stock.`);
}
