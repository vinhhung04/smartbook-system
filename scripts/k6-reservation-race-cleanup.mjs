// Cleanup for scripts/k6/reservation-race.js: k6 VUs can't share mutable
// state, so they can't cancel their own reservations after the run — this
// script finds every test customer it created (email prefix `k6.loadtest.`)
// and cancels any reservation still ACTIVE, releasing the held stock back.
// Run this immediately after every reservation-race.js run.
//
// Same conventions as scripts/reservation-concurrency-race-integration.mjs:
// reads .env directly (works from any shell), self-signs an admin JWT.
import crypto from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const envPath = resolve(root, '.env');
const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

function readEnvVar(name, fallback) {
  if (!existsSync(envPath)) return fallback;
  const contents = readFileSync(envPath, 'utf8');
  const match = contents.match(new RegExp(`^${name}=(.*)$`, 'm'));
  return match ? match[1].trim() : fallback;
}

const jwtSecret = process.env.JWT_SECRET || readEnvVar('JWT_SECRET', 'smartbook_shared_jwt_secret');

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
  email: `k6.cleanup.${Date.now()}@smartbook.local`,
  full_name: 'k6 Reservation Race Cleanup',
  is_superuser: true,
  permissions: ['borrow.read', 'borrow.write'],
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 60 * 60,
}, jwtSecret);

async function request(method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(method === 'PATCH' ? { 'Idempotency-Key': crypto.randomUUID() } : {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

const ACTIVE_RESERVATION_STATUSES = ['PENDING', 'CONFIRMED', 'READY_FOR_PICKUP'];

async function findLoadtestCustomers() {
  const customers = [];
  let page = 1;
  for (;;) {
    const res = await request('GET', `/borrow/customers?q=k6.loadtest.&page=${page}&pageSize=100`);
    if (!res.ok) {
      throw new Error(`Failed to list customers (page ${page}, status ${res.status}): ${JSON.stringify(res.data)}`);
    }
    const items = res.data?.data || [];
    customers.push(...items);
    if (page >= (res.data?.meta?.totalPages || 1)) break;
    page += 1;
  }
  return customers;
}

async function findActiveReservations(customerId) {
  const res = await request('GET', `/borrow/reservations?customer_id=${customerId}&pageSize=100`);
  if (!res.ok) {
    throw new Error(`Failed to list reservations for customer ${customerId} (status ${res.status}): ${JSON.stringify(res.data)}`);
  }
  const items = res.data?.data || [];
  return items.filter((r) => ACTIVE_RESERVATION_STATUSES.includes(r.status));
}

async function main() {
  const customers = await findLoadtestCustomers();
  console.log(`Found ${customers.length} k6.loadtest.* customer(s).`);

  let cancelled = 0;
  let failed = 0;

  for (const customer of customers) {
    const activeReservations = await findActiveReservations(customer.id);
    for (const reservation of activeReservations) {
      const res = await request('PATCH', `/borrow/reservations/${reservation.id}/cancel`);
      if (res.ok) {
        cancelled += 1;
        console.log(`Cancelled reservation ${reservation.id} (customer ${customer.email})`);
      } else {
        failed += 1;
        console.error(`FAILED to cancel reservation ${reservation.id} (status ${res.status}): ${JSON.stringify(res.data)}`);
      }
    }
  }

  console.log(`Done: ${cancelled} reservation(s) cancelled, ${failed} failure(s).`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
