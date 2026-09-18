// Checkpoint 1 (SB-03) proof: the outbox row written inside reserveFromBorrow's
// transaction is never silently lost, whether inventory-service crashes right
// after writing it, or RabbitMQ itself is unreachable when the publisher job
// tries to publish it. Requires the full docker compose stack running.
import crypto from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const envPath = resolve(root, '.env');
const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

function readEnvVar(name, fallback) {
  if (!existsSync(envPath)) return fallback;
  const contents = readFileSync(envPath, 'utf8');
  const match = contents.match(new RegExp(`^${name}=(.*)$`, 'm'));
  return match ? match[1].trim() : fallback;
}

const dbUser = readEnvVar('DB_USER', 'user');
const inventoryDbName = readEnvVar('INVENTORY_DB_NAME', 'inventory_db');
const jwtSecret = process.env.JWT_SECRET || readEnvVar('JWT_SECRET', 'smartbook_shared_jwt_secret');

function psql(sql) {
  const result = spawnSync(
    'docker',
    ['compose', 'exec', '-T', 'db', 'psql', '-U', dbUser, '-d', inventoryDbName, '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-F', '|'],
    { cwd: root, input: sql, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(`psql failed (status ${result.status}): ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function psqlRows(sql) {
  const out = psql(sql);
  if (!out) return [];
  return out.split('\n').filter(Boolean).map((line) => line.split('|'));
}

function compose(...args) {
  const result = spawnSync('docker', ['compose', ...args], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`docker compose ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHealthy(service, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const out = compose('ps', service, '--format', 'json').trim();
    if (out) {
      try {
        const status = JSON.parse(out.split('\n')[0]).Health;
        if (status === 'healthy') return;
      } catch { /* keep polling */ }
    }
    await sleep(2000);
  }
  throw new Error(`${service} did not become healthy within ${timeoutMs}ms`);
}

async function waitForOutboxStatus(outboxId, expectedStatuses, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const rows = psqlRows(`SELECT status FROM integration_outbox WHERE id = '${outboxId}';`);
    last = rows[0]?.[0] || null;
    if (expectedStatuses.includes(last)) return last;
    await sleep(2000);
  }
  throw new Error(`outbox row ${outboxId} did not reach ${expectedStatuses.join('/')} within ${timeoutMs}ms (last seen: ${last})`);
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
  email: `outbox.durability.itest.${Date.now()}@smartbook.local`,
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

async function resolveTarget() {
  const response = await request('GET', '/api/books');
  const books = Array.isArray(response.data) ? response.data : [];
  const candidate = books.find((b) => b.default_warehouse_id && Number(b.available_quantity || 0) >= 1);
  if (!candidate) throw new Error('No borrowable variant with available stock found via /api/books');
  return { variant_id: candidate.variant_id, warehouse_id: candidate.default_warehouse_id };
}

async function createTestCustomer(label) {
  const response = await request('POST', '/borrow/customers', {
    full_name: `Outbox Durability Test ${label}`,
    email: `outbox.durability.itest.${Date.now()}.${label}@smartbook.local`,
    status: 'ACTIVE',
  });
  if (!response.ok || !response.data?.data?.id) {
    throw new Error(`Failed to create test customer: ${JSON.stringify(response.data)}`);
  }
  return response.data.data.id;
}

async function createReservation(target, label) {
  const customerId = await createTestCustomer(label);
  const response = await request('POST', '/borrow/reservations', {
    customer_id: customerId,
    variant_id: target.variant_id,
    warehouse_id: target.warehouse_id,
    quantity: 1,
    source_channel: 'COUNTER',
    notes: `outbox durability integration test (${label})`,
  }, { 'Idempotency-Key': crypto.randomUUID() });
  if (!response.ok) {
    throw new Error(`Failed to create reservation (${label}): status=${response.status} ${JSON.stringify(response.data)}`);
  }
  return response.data.data.id;
}

function latestOutboxIdForReservation(reservationId) {
  const rows = psqlRows(`
    SELECT id FROM integration_outbox
    WHERE aggregate_type = 'STOCK_RESERVATION'
      AND payload->>'reservation_id' = '${reservationId}'
    ORDER BY occurred_at DESC LIMIT 1;
  `);
  return rows[0]?.[0] || null;
}

const results = [];
function add(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${detail ? ` :: ${detail}` : ''}`);
}

// This is a shared dev/demo database and the target location only has
// available_qty=1 — each scenario must release its own reservation before the
// next one runs (not batched at the end), or later scenarios starve for stock.
async function cancelReservation(reservationId) {
  const response = await request('PATCH', `/borrow/reservations/${reservationId}/cancel`, {}, { 'Idempotency-Key': crypto.randomUUID() });
  if (!response.ok) {
    console.warn(`Cleanup: failed to cancel reservation ${reservationId}: ${JSON.stringify(response.data)}`);
  }
}

async function scenarioNormalPublish(target) {
  const reservationId = await createReservation(target, 'normal');
  const outboxId = latestOutboxIdForReservation(reservationId);
  add('1. reservation creates a PENDING outbox row', Boolean(outboxId), `outbox_id=${outboxId}`);
  const status = await waitForOutboxStatus(outboxId, ['PUBLISHED', 'FAILED']);
  add('1. outbox row reaches PUBLISHED under normal operation', status === 'PUBLISHED', `status=${status}`);
  await cancelReservation(reservationId);
}

async function scenarioServiceRestart(target) {
  const reservationId = await createReservation(target, 'restart');
  const outboxId = latestOutboxIdForReservation(reservationId);
  add('2. reservation creates a PENDING outbox row before restart', Boolean(outboxId), `outbox_id=${outboxId}`);

  // Kill immediately, before the 10s publisher tick has a chance to run.
  compose('kill', 'inventory-service');
  compose('start', 'inventory-service');
  await waitForHealthy('inventory-service');

  const status = await waitForOutboxStatus(outboxId, ['PUBLISHED', 'FAILED']);
  add('2. outbox row still reaches PUBLISHED after a mid-flight service restart (not lost)', status === 'PUBLISHED', `status=${status}`);
  await cancelReservation(reservationId);
}

async function scenarioBrokerDown(target) {
  compose('stop', 'rabbitmq');

  let reservationId;
  let httpFailed = false;
  try {
    reservationId = await createReservation(target, 'broker-down');
  } catch (error) {
    httpFailed = true;
    add('3. reservation API still succeeds while the broker is down', false, error.message);
  }

  if (!httpFailed) {
    add('3. reservation API still succeeds while the broker is down', true, `reservation_id=${reservationId}`);
    const outboxId = latestOutboxIdForReservation(reservationId);
    // amqp-connection-manager buffers publishes briefly while reconnecting rather
    // than rejecting instantly, so retry_count may still be 0 this soon — the
    // invariant that matters is "still PENDING, never silently dropped/marked
    // something else", not how many attempts have failed yet.
    await sleep(15_000);
    const stuckStatus = psqlRows(`SELECT status, retry_count FROM integration_outbox WHERE id = '${outboxId}';`)[0];
    add(
      '3. outbox row stays PENDING (not silently dropped) while broker is down',
      stuckStatus?.[0] === 'PENDING',
      `status=${stuckStatus?.[0]} retry_count=${stuckStatus?.[1]}`,
    );

    compose('start', 'rabbitmq');
    await waitForHealthy('rabbitmq');
    const finalStatus = await waitForOutboxStatus(outboxId, ['PUBLISHED', 'FAILED'], 40_000);
    add('3. outbox row eventually reaches PUBLISHED once the broker recovers', finalStatus === 'PUBLISHED', `status=${finalStatus}`);
    await cancelReservation(reservationId);
  }
}

async function run() {
  const target = await resolveTarget();
  console.log(`Target: variant=${target.variant_id} warehouse=${target.warehouse_id}`);

  await scenarioNormalPublish(target);
  await scenarioServiceRestart(target);
  await scenarioBrokerDown(target);

  console.table(results);
  const pass = results.filter((r) => r.ok).length;
  console.log(`PASS=${pass} TOTAL=${results.length}`);
  process.exitCode = pass === results.length ? 0 : 1;
}

run().catch((error) => {
  console.error('Unhandled error in outbox-durability-integration:', error);
  process.exitCode = 1;
});
