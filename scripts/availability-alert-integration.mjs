// "Báo khi có sách" end to end, against a running stack (gateway :3000):
//   inventory mutation → integration_outbox → RabbitMQ → borrow-service consumer
//   → customer_notifications + availability_alerts.notified_at
//
// Every run uses fresh synthetic customers (self-signed JWTs, auto-provisioned
// by borrow-service with the default membership plan), so no state is shared
// with the demo accounts or with earlier runs. Stock is put back on a shelf by
// reserving a copy and having staff cancel it (inventory.reservation.released).
//
//   JWT_SECRET=... node scripts/availability-alert-integration.mjs

import crypto from 'node:crypto';

const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
const jwtSecret = process.env.JWT_SECRET || 'smartbook_shared_jwt_secret';
const WAIT_FOR_NOTIFICATION_MS = Number(process.env.ALERT_WAIT_MS || 60_000);
const QUIET_PERIOD_MS = Number(process.env.ALERT_QUIET_MS || 25_000);

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signJwt(payload) {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', jwtSecret).update(`${head}.${body}`).digest('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${head}.${body}.${signature}`;
}

const now = () => Math.floor(Date.now() / 1000);
const runId = `${Date.now()}`;

const staffToken = signJwt({
  id: crypto.randomUUID(),
  email: `alert.itest.staff.${runId}@smartbook.local`,
  full_name: 'Alert Integration Staff',
  is_superuser: true,
  permissions: ['borrow.read', 'borrow.write'],
  iat: now(),
  exp: now() + 3600,
});

function customerToken(label) {
  return signJwt({
    id: crypto.randomUUID(),
    email: `alert.itest.${label}.${runId}@smartbook.local`,
    full_name: `Alert Itest ${label}`,
    roles: ['CUSTOMER'],
    permissions: ['customer.self.read', 'customer.self.write'],
    iat: now(),
    exp: now() + 3600,
  });
}

async function call(token, method, path, body, extraHeaders = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extraHeaders },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

const idem = () => ({ 'Idempotency-Key': crypto.randomUUID() });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = [];
function check(name, passed, detail = '') {
  results.push({ name, passed: Boolean(passed) });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function alertNotifications(token, bookId) {
  const res = await call(token, 'GET', '/my/notifications?pageSize=100');
  return (res.data?.data || []).filter((n) => n.template_code === 'AVAILABILITY_ALERT' && n.reference_id === bookId);
}

async function myAlert(token, bookId) {
  const res = await call(token, 'GET', '/my/availability-alerts');
  return (res.data?.data || []).find((alert) => alert.book_id === bookId) || null;
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await sleep(2000);
  }
  return null;
}

/** Reserve one copy as `token`'s customer at the branch, then have staff cancel it. */
async function releaseOneCopy(token, variantId, warehouseId) {
  const reserved = await call(token, 'POST', '/my/reservations', { variant_id: variantId, warehouse_id: warehouseId, quantity: 1 }, idem());
  if (!reserved.ok) return { ok: false, step: 'reserve', status: reserved.status, message: reserved.data?.message };
  const cancelled = await call(staffToken, 'PATCH', `/borrow/reservations/${reserved.data.data.id}/cancel`, null, idem());
  return { ok: cancelled.ok, step: 'cancel', status: cancelled.status };
}

async function main() {
  const watcherA = customerToken('watcher-a');
  const watcherB = customerToken('watcher-b');
  const trigger = customerToken('trigger');

  // Provision the three readers (ensureCurrentCustomer) before using them.
  for (const token of [watcherA, watcherB, trigger]) {
    const profile = await call(token, 'GET', '/my/profile');
    if (!profile.ok) throw new Error(`could not provision a synthetic customer (${profile.status} ${profile.data?.message || ''})`);
  }

  // ── public branch stock notifies every waiting reader once ──────────────────
  const catalog = await (await fetch(`${baseUrl}/public/catalog/books?availability=available&pageSize=48`)).json();
  const book = (catalog.data || []).find((item) => item.reservable && item.variant_id && item.pickup_branches?.length);
  if (!book) throw new Error('no reservable book at a public branch in the demo data');
  const branch = book.pickup_branches[0];
  console.log(`book: ${book.title} (${book.id}) — branch ${branch.warehouse_name}`);

  for (const token of [watcherA, watcherB]) {
    const sub = await call(token, 'POST', '/my/availability-alerts', { book_id: book.id });
    check('reader subscribes to the book', sub.status === 201 && sub.data?.data?.status === 'ACTIVE', `status ${sub.status}`);
  }

  const released = await releaseOneCopy(trigger, book.variant_id, branch.warehouse_id);
  check('a copy goes back on the branch shelf (reserve + staff cancel)', released.ok, JSON.stringify(released));

  const notifiedA = await waitFor(async () => (await alertNotifications(watcherA, book.id)).length > 0, WAIT_FOR_NOTIFICATION_MS);
  const notifiedB = await waitFor(async () => (await alertNotifications(watcherB, book.id)).length > 0, 10_000);
  check('reader A receives the "có sách" notification', notifiedA);
  check('reader B (same book) receives it too', notifiedB);

  const [notification] = await alertNotifications(watcherA, book.id);
  check('notification links to the book and names a public branch',
    notification?.reference_type === 'BOOK' && /đã có lại tại/.test(notification?.body || ''), notification?.body);

  const alertA = await myAlert(watcherA, book.id);
  check('alert is marked NOTIFIED with notified_at', alertA?.status === 'NOTIFIED' && Boolean(alertA?.notified_at), JSON.stringify(alertA));

  // ── no duplicate on the next restock ────────────────────────────────────────
  const again = await releaseOneCopy(trigger, book.variant_id, branch.warehouse_id);
  check('second restock of the same book happens', again.ok, JSON.stringify(again));
  await sleep(QUIET_PERIOD_MS);
  check('the same alert is not notified twice', (await alertNotifications(watcherA, book.id)).length === 1);

  // ── re-arm and cancel ───────────────────────────────────────────────────────
  const rearm = await call(watcherA, 'POST', '/my/availability-alerts', { book_id: book.id });
  check('subscribing again re-arms the alert', rearm.data?.data?.status === 'ACTIVE' && rearm.data?.data?.notified_at === null);
  const cancel = await call(watcherA, 'DELETE', `/my/availability-alerts/${book.id}`);
  check('reader can cancel the alert', cancel.ok && (await myAlert(watcherA, book.id)) === null);
  await call(watcherB, 'DELETE', `/my/availability-alerts/${book.id}`);

  // ── stock in an internal WAREHOUSE never notifies ───────────────────────────
  const staffBooks = await call(staffToken, 'GET', '/api/books');
  let internal = null;
  for (const item of Array.isArray(staffBooks.data) ? staffBooks.data : []) {
    if (!item?.variant_id || !item?.default_warehouse_id || Number(item.quantity || 0) < 1) continue;
    const pub = await call(staffToken, 'GET', `/api/borrow-integration/variants/${item.variant_id}/public-availability`);
    if (pub.ok && pub.data?.data?.available_quantity === 0) {
      internal = { variantId: item.variant_id, warehouseId: item.default_warehouse_id, bookId: pub.data.data.book_id, title: pub.data.data.title };
      break;
    }
  }
  if (!internal) {
    console.log('SKIP internal-warehouse case: no book with stock only in an internal warehouse in this dataset');
  } else {
    console.log(`internal-only book: ${internal.title} (${internal.bookId})`);
    await call(watcherB, 'POST', '/my/availability-alerts', { book_id: internal.bookId });
    const triggerProfile = await call(trigger, 'GET', '/my/profile');
    // Staff flow (no CUSTOMER channel) may hold stock in an internal warehouse.
    const staffReservation = await call(staffToken, 'POST', '/borrow/reservations', {
      customer_id: triggerProfile.data.data.id, variant_id: internal.variantId, warehouse_id: internal.warehouseId, quantity: 1,
    }, idem());
    check('staff can still reserve in an internal warehouse', staffReservation.ok, `status ${staffReservation.status} ${staffReservation.data?.message || ''}`);
    if (staffReservation.ok) {
      await call(staffToken, 'PATCH', `/borrow/reservations/${staffReservation.data.data.id}/cancel`, null, idem());
      await sleep(QUIET_PERIOD_MS);
      check('internal-warehouse restock does not notify', (await alertNotifications(watcherB, internal.bookId)).length === 0);
      const alertB = await myAlert(watcherB, internal.bookId);
      check('alert stays ACTIVE without notified_at', alertB?.status === 'ACTIVE' && alertB?.notified_at === null);
    }
    await call(watcherB, 'DELETE', `/my/availability-alerts/${internal.bookId}`);
  }

  // A customer cannot buy their way into someone else's alert or notification.
  const foreign = await call(watcherB, 'PATCH', `/my/notifications/${notification?.id}/read`);
  check('reader B cannot mark reader A\'s notification', foreign.status === 404, `status ${foreign.status}`);
}

main()
  .catch((error) => {
    check('run completed', false, error.message);
  })
  .finally(() => {
    const passed = results.filter((r) => r.passed).length;
    console.log(`PASS=${passed} TOTAL=${results.length}`);
    process.exitCode = passed === results.length && results.length > 0 ? 0 : 1;
  });
