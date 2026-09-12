// Checkpoint 2 (SB-04) proof: the gateway's RabbitMQ consumer actually
// consumes (not just connects), a malformed message lands in the dead-letter
// queue instead of being silently dropped or crashing the consumer, and the
// integration_inbox unique constraint really rejects a duplicate delivery.
// Requires the full docker compose stack running.
import crypto from 'node:crypto';
import amqp from 'amqplib';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const envPath = resolve(root, '.env');
const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
const managementUrl = process.env.RABBITMQ_MANAGEMENT_URL || 'http://localhost:15672';

function readEnvVar(name, fallback) {
  if (!existsSync(envPath)) return fallback;
  const contents = readFileSync(envPath, 'utf8');
  const match = contents.match(new RegExp(`^${name}=(.*)$`, 'm'));
  return match ? match[1].trim() : fallback;
}

const dbUser = readEnvVar('DB_USER', 'user');
const borrowDbName = readEnvVar('BORROW_DB_NAME', 'borrow_db');
const jwtSecret = process.env.JWT_SECRET || readEnvVar('JWT_SECRET', 'smartbook_shared_jwt_secret');
const rabbitUser = process.env.RABBITMQ_USER || readEnvVar('RABBITMQ_USER', 'smartbook');
const rabbitPassword = process.env.RABBITMQ_PASSWORD || readEnvVar('RABBITMQ_PASSWORD', '');
const rabbitUrl = process.env.RABBITMQ_URL || `amqp://${rabbitUser}:${rabbitPassword}@localhost:5672`;

function psql(dbName, sql) {
  const result = spawnSync(
    'docker',
    ['compose', 'exec', '-T', 'db', 'psql', '-U', dbUser, '-d', dbName, '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-F', '|'],
    { cwd: root, input: sql, encoding: 'utf8' },
  );
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr };
}

async function managementApi(path) {
  const auth = Buffer.from(`${rabbitUser}:${rabbitPassword}`).toString('base64');
  const response = await fetch(`${managementUrl}${path}`, { headers: { Authorization: `Basic ${auth}` } });
  if (!response.ok) throw new Error(`management API ${path} -> ${response.status}`);
  return response.json();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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
  email: `gateway.consumer.itest.${Date.now()}@smartbook.local`,
  is_superuser: true,
  permissions: [],
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 4 * 60 * 60,
}, jwtSecret);

function makeHeaders(extra = {}) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extra };
}

async function request(method, path, body, extraHeaders = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: makeHeaders(extraHeaders),
    body: body == null ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

const results = [];
function add(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${detail ? ` :: ${detail}` : ''}`);
}

// Shared dev/demo database — cancel any reservation this script creates so it
// doesn't leave demo stock permanently drained for other integration scripts.
const createdReservationIds = [];

async function cancelCreatedReservations() {
  for (const reservationId of createdReservationIds) {
    const response = await request('PATCH', `/borrow/reservations/${reservationId}/cancel`, {}, { 'Idempotency-Key': crypto.randomUUID() });
    if (!response.ok) {
      console.warn(`Cleanup: failed to cancel reservation ${reservationId}: ${JSON.stringify(response.data)}`);
    }
  }
  console.log(`Cleanup: cancelled ${createdReservationIds.length} test reservation(s), restoring their held stock.`);
}

async function scenarioRealMessageConsumed() {
  const booksRes = await request('GET', '/api/books');
  const candidate = (Array.isArray(booksRes.data) ? booksRes.data : []).find(
    (b) => b.default_warehouse_id && Number(b.available_quantity || 0) >= 1,
  );
  if (!candidate) throw new Error('No borrowable variant with available stock found via /api/books');

  const custRes = await request('POST', '/borrow/customers', {
    full_name: 'Gateway Consumer Test Customer',
    email: `gateway.consumer.itest.${Date.now()}@smartbook.local`,
    status: 'ACTIVE',
  });
  if (!custRes.ok) throw new Error(`Failed to create customer: ${JSON.stringify(custRes.data)}`);

  const before = await managementApi('/api/queues/%2f/gateway-push.reservation-created.queue');

  const resRes = await request('POST', '/borrow/reservations', {
    customer_id: custRes.data.data.id,
    variant_id: candidate.variant_id,
    warehouse_id: candidate.default_warehouse_id,
    quantity: 1,
    source_channel: 'COUNTER',
    notes: 'gateway consumer durability integration test',
  }, { 'Idempotency-Key': crypto.randomUUID() });
  if (!resRes.ok) throw new Error(`Failed to create reservation: ${JSON.stringify(resRes.data)}`);
  createdReservationIds.push(resRes.data.data.id);

  await sleep(15_000); // outbox publisher tick (10s) + consumer processing
  const after = await managementApi('/api/queues/%2f/gateway-push.reservation-created.queue');

  add(
    '1. reservation event is consumed off the queue (not just published)',
    after.messages === 0,
    `messages_ready before=${before.messages} after=${after.messages}, message_stats.deliver_get=${after.message_stats?.deliver_get ?? 0}`,
  );
}

async function scenarioMalformedMessageGoesToDlq() {
  const connection = await amqp.connect(rabbitUrl);
  const channel = await connection.createChannel();

  // Purge first so the count is deterministic across repeated runs of this
  // script — the management API's own message-count stat also lags a few
  // seconds behind reality, so purge via AMQP directly (not the HTTP API)
  // and poll afterward instead of trusting a single snapshot.
  await channel.purgeQueue('gateway-push.reservation-created.dlq').catch(() => {});

  const malformed = { event_id: crypto.randomUUID(), event_type: 'inventory.reservation.created', payload: { reservation_id: 'no-customer-id-here' } };
  channel.publish('smartbook.events', 'inventory.reservation.created', Buffer.from(JSON.stringify(malformed)), { persistent: true });

  let after = { messages: 0 };
  for (let i = 0; i < 8; i += 1) {
    await sleep(2_000);
    after = await managementApi('/api/queues/%2f/gateway-push.reservation-created.dlq').catch(() => ({ messages: 0 }));
    if (after.messages >= 1) break;
  }

  add(
    '2. a message missing payload.customer_id lands in the dead-letter queue',
    after.messages >= 1,
    `dlq messages after purge+publish=${after.messages}`,
  );

  await channel.close();
  await connection.close();
}

async function scenarioInboxDedup() {
  const sourceService = 'GATEWAY_CONSUMER_ITEST';
  const eventId = crypto.randomUUID();

  const first = psql(borrowDbName, `
    INSERT INTO integration_inbox (source_service, event_id, event_type, payload)
    VALUES ('${sourceService}', '${eventId}', 'inventory.reservation.created', '{}');
  `);
  add('3. first insert into integration_inbox for a new (source_service, event_id) succeeds', first.status === 0, first.stderr?.trim());

  const second = psql(borrowDbName, `
    INSERT INTO integration_inbox (source_service, event_id, event_type, payload)
    VALUES ('${sourceService}', '${eventId}', 'inventory.reservation.created', '{}');
  `);
  add(
    '3. duplicate (source_service, event_id) is rejected by the unique constraint (23505)',
    second.status !== 0 && /23505|duplicate key/i.test(second.stderr || ''),
    second.stderr?.trim().split('\n').pop(),
  );

  psql(borrowDbName, `DELETE FROM integration_inbox WHERE source_service = '${sourceService}';`);
}

async function run() {
  try {
    await scenarioRealMessageConsumed();
    await scenarioMalformedMessageGoesToDlq();
    await scenarioInboxDedup();
  } finally {
    await cancelCreatedReservations();
  }

  console.table(results);
  const pass = results.filter((r) => r.ok).length;
  console.log(`PASS=${pass} TOTAL=${results.length}`);
  process.exitCode = pass === results.length ? 0 : 1;
}

run().catch((error) => {
  console.error('Unhandled error in gateway-consumer-durability-integration:', error);
  process.exitCode = 1;
});
