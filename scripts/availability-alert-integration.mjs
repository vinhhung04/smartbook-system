// "Báo khi có sách" end to end, against a running stack (gateway :3000):
//   inventory mutation → integration_outbox → RabbitMQ → borrow-service consumer
//   → customer_notifications + availability_alerts.notified_at
//
// Business rule: a reader may only watch a book that has NO copy on a public
// (BRANCH/LIBRARY) shelf. So the flow first takes every public copy of a book
// with real customer reservations, subscribes while public stock is 0, then
// puts a copy back by having staff cancel one of those reservations
// (inventory.reservation.released). Everything goes through the APIs.
//
// Every run uses fresh synthetic customers (self-signed JWTs, auto-provisioned
// by borrow-service with the default membership plan), so no state is shared
// with the demo accounts or with earlier runs; holds are cancelled at the end.
//
//   JWT_SECRET=... node scripts/availability-alert-integration.mjs

import crypto from 'node:crypto';

const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
const jwtSecret = process.env.JWT_SECRET || 'smartbook_shared_jwt_secret';
const WAIT_FOR_NOTIFICATION_MS = Number(process.env.ALERT_WAIT_MS || 60_000);
const QUIET_PERIOD_MS = Number(process.env.ALERT_QUIET_MS || 25_000);
const MAX_HOLD_ROUNDS = 12;

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

let customerCount = 0;
function customerToken(label) {
  customerCount += 1;
  return signJwt({
    id: crypto.randomUUID(),
    email: `alert.itest.${label}.${customerCount}.${runId}@smartbook.local`,
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

async function provisionedCustomer(label) {
  const token = customerToken(label);
  const profile = await call(token, 'GET', '/my/profile');
  if (!profile.ok) throw new Error(`could not provision a synthetic customer (${profile.status} ${profile.data?.message || ''})`);
  return token;
}

async function alertNotifications(token, bookId) {
  const res = await call(token, 'GET', '/my/notifications?pageSize=100');
  return (res.data?.data || []).filter((n) => n.template_code === 'AVAILABILITY_ALERT' && n.reference_id === bookId);
}

async function myAlert(token, bookId) {
  const res = await call(token, 'GET', '/my/availability-alerts');
  return (res.data?.data || []).find((alert) => alert.book_id === bookId) || null;
}

const subscribe = (token, bookId) => call(token, 'POST', '/my/availability-alerts', { book_id: bookId });

/** Live public availability, the same read the subscribe rule and the consumer use. */
async function publicStock(bookId) {
  const res = await call(staffToken, 'GET', `/api/borrow-integration/books/${bookId}/public-availability`);
  if (!res.ok) throw new Error(`public availability ${res.status}`);
  return Number(res.data.data.available_quantity);
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

/** Reserve every public copy of the book with fresh readers (one reservation
 *  each, up to the default plan's limit) until public stock is 0. */
async function holdAllPublicCopies(bookId) {
  const holds = [];
  for (let round = 0; round < MAX_HOLD_ROUNDS; round += 1) {
    const detail = await (await fetch(`${baseUrl}/public/catalog/books/${bookId}`)).json();
    if (!detail.reservable || !detail.pickup_branches?.length) break;
    const branch = detail.pickup_branches[0];
    const holder = await provisionedCustomer('holder');
    const quantity = Math.min(branch.available_quantity, 3);
    const reserved = await call(holder, 'POST', '/my/reservations', { variant_id: detail.variant_id, warehouse_id: branch.warehouse_id, quantity }, idem());
    if (!reserved.ok) throw new Error(`could not hold copies (${reserved.status} ${reserved.data?.message || ''})`);
    holds.push(reserved.data.data.id);
  }
  return holds;
}

async function release(reservationId) {
  const res = await call(staffToken, 'PATCH', `/borrow/reservations/${reservationId}/cancel`, null, idem());
  return res.ok;
}

async function main(holds) {
  const watcherA = await provisionedCustomer('watcher-a');
  const watcherB = await provisionedCustomer('watcher-b');

  // Book with the fewest public copies, so holding all of them takes few reservations.
  const catalog = await (await fetch(`${baseUrl}/public/catalog/books?availability=available&pageSize=48`)).json();
  const book = (catalog.data || [])
    .filter((item) => item.reservable && item.variant_id && item.pickup_branches?.length)
    .sort((a, b) => a.available_quantity - b.available_quantity)[0];
  if (!book) throw new Error('no reservable book at a public branch in the demo data');
  console.log(`book: ${book.title} (${book.id}) — ${book.available_quantity} public copies`);

  // ── available book: no alert ────────────────────────────────────────────────
  const refused = await subscribe(watcherA, book.id);
  check('book on a public shelf → 409, no alert', refused.status === 409 && (await myAlert(watcherA, book.id)) === null,
    `${refused.status} ${refused.data?.message || ''}`);

  // ── take every public copy, then watch ──────────────────────────────────────
  holds.push(...await holdAllPublicCopies(book.id));
  check('every public copy is held by real reservations (public stock 0)', (await publicStock(book.id)) === 0, `${holds.length} reservations`);

  for (const [name, token] of [['A', watcherA], ['B', watcherB]]) {
    const sub = await subscribe(token, book.id);
    check(`reader ${name} subscribes while public stock is 0 → 201 ACTIVE`, sub.status === 201 && sub.data?.data?.status === 'ACTIVE', `status ${sub.status}`);
  }

  // ── a copy comes back → each reader notified once ───────────────────────────
  check('staff cancels one hold, copies go back on the shelf', await release(holds.shift()));
  const notifiedA = await waitFor(async () => (await alertNotifications(watcherA, book.id)).length > 0, WAIT_FOR_NOTIFICATION_MS);
  const notifiedB = await waitFor(async () => (await alertNotifications(watcherB, book.id)).length > 0, 10_000);
  check('reader A receives the "có sách" notification', notifiedA);
  check('reader B (same book) receives it too', notifiedB);

  const [notification] = await alertNotifications(watcherA, book.id);
  check('notification links to the book and names a public branch',
    notification?.reference_type === 'BOOK' && /đã có lại tại/.test(notification?.body || ''), notification?.body);
  const alertA = await myAlert(watcherA, book.id);
  check('alert is marked NOTIFIED with notified_at', alertA?.status === 'NOTIFIED' && Boolean(alertA?.notified_at));

  // ── no re-arm while the book is available ───────────────────────────────────
  const tooEarly = await subscribe(watcherA, book.id);
  const stillNotified = await myAlert(watcherA, book.id);
  check('re-subscribing while copies are on the shelf → 409, alert stays NOTIFIED',
    tooEarly.status === 409 && stillNotified?.status === 'NOTIFIED' && stillNotified?.notified_at === alertA?.notified_at);

  // ── gone again → A re-arms; next restock notifies A again but not B ─────────
  holds.push(...await holdAllPublicCopies(book.id));
  check('book is unavailable again', (await publicStock(book.id)) === 0);
  const rearm = await subscribe(watcherA, book.id);
  check('re-subscribing at 0 re-arms the alert (ACTIVE, notified_at null)',
    rearm.status === 201 && rearm.data?.data?.status === 'ACTIVE' && rearm.data?.data?.notified_at === null);

  check('second restock of the same book happens', await release(holds.pop()));
  const secondForA = await waitFor(async () => (await alertNotifications(watcherA, book.id)).length === 2, WAIT_FOR_NOTIFICATION_MS);
  check('the re-armed reader is notified for the new restock', secondForA);
  await sleep(QUIET_PERIOD_MS / 2);
  check('the reader who did not re-arm is not notified twice', (await alertNotifications(watcherB, book.id)).length === 1);

  const cancel = await call(watcherA, 'DELETE', `/my/availability-alerts/${book.id}`);
  check('reader can cancel the alert', cancel.ok && (await myAlert(watcherA, book.id)) === null);
  await call(watcherB, 'DELETE', `/my/availability-alerts/${book.id}`);

  // ── stock in an internal WAREHOUSE: subscribable, never notifies ────────────
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
    const sub = await subscribe(watcherB, internal.bookId);
    check('internal-warehouse stock but public stock 0 → subscribe 201', sub.status === 201, `status ${sub.status}`);
    const holder = await provisionedCustomer('internal');
    const holderProfile = await call(holder, 'GET', '/my/profile');
    // Staff flow (no CUSTOMER channel) may hold stock in an internal warehouse.
    const staffReservation = await call(staffToken, 'POST', '/borrow/reservations', {
      customer_id: holderProfile.data.data.id, variant_id: internal.variantId, warehouse_id: internal.warehouseId, quantity: 1,
    }, idem());
    check('staff can still reserve in an internal warehouse', staffReservation.ok, `status ${staffReservation.status} ${staffReservation.data?.message || ''}`);
    if (staffReservation.ok) {
      await release(staffReservation.data.data.id);
      await sleep(QUIET_PERIOD_MS);
      check('internal-warehouse restock does not notify', (await alertNotifications(watcherB, internal.bookId)).length === 0);
      const alertB = await myAlert(watcherB, internal.bookId);
      check('alert stays ACTIVE without notified_at', alertB?.status === 'ACTIVE' && alertB?.notified_at === null);
    }
    await call(watcherB, 'DELETE', `/my/availability-alerts/${internal.bookId}`);
  }

  // A customer cannot touch someone else's notification.
  const foreign = await call(watcherB, 'PATCH', `/my/notifications/${notification?.id}/read`);
  check('reader B cannot mark reader A\'s notification', foreign.status === 404, `status ${foreign.status}`);
}

const holds = [];
main(holds)
  .catch((error) => {
    check('run completed', false, error.message);
  })
  .finally(async () => {
    // Give the held copies back so the demo catalog is unchanged.
    for (const id of holds) await release(id).catch(() => false);
    const passed = results.filter((r) => r.passed).length;
    console.log(`PASS=${passed} TOTAL=${results.length}`);
    process.exitCode = passed === results.length && results.length > 0 ? 0 : 1;
  });
