const assert = require('node:assert/strict');
const test = require('node:test');

const { dispatchAvailabilityAlerts } = require('../src/services/availability-alert.service');
const { handleMessage } = require('../src/lib/rabbitmq-consumer');

// "Báo khi có sách": subscribe → inventory stock event → one notification.
// The controller is loaded with stubbed prisma/customer modules (same technique
// as review-write-customer.test.js); the dispatcher takes its dependencies as
// arguments and runs against an in-memory store with real rollback.

const BOOK_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_BOOK_ID = '22222222-2222-4222-8222-222222222222';
const VARIANT_ID = '33333333-3333-4333-8333-333333333333';
const BRANCH_Q1 = { warehouse_id: 'aaaaaaaa-0000-4000-8000-000000000001', warehouse_name: 'Chi nhánh Quận 1', available_quantity: 2 };
const LIBRARY = { warehouse_id: 'aaaaaaaa-0000-4000-8000-000000000002', warehouse_name: 'Thư viện Trung tâm', available_quantity: 1 };

const branchAvailability = { book_id: BOOK_ID, title: 'Dế Mèn Phiêu Lưu Ký', available_quantity: 3, reservable: true, pickup_branches: [BRANCH_Q1, LIBRARY] };
// What inventory reports when the only copies sit in an internal WAREHOUSE.
const warehouseOnly = { book_id: BOOK_ID, title: 'Dế Mèn Phiêu Lưu Ký', available_quantity: 0, reservable: false, pickup_branches: [] };

const alert = (id, customerId, overrides = {}) => ({ id, customer_id: customerId, book_id: BOOK_ID, status: 'ACTIVE', notified_at: null, created_at: new Date('2026-10-01'), ...overrides });

const stockChanged = (overrides = {}) => ({
  event_id: 'evt-1',
  event_type: 'inventory.stock.changed',
  payload: { variant_id: VARIANT_ID, warehouse_id: BRANCH_Q1.warehouse_id, delta_qty: 1, reason_code: 'LOAN_RETURNED', ...overrides },
});

// ── in-memory store ──────────────────────────────────────────────────────────

function matches(row, where = {}) {
  return Object.entries(where).every(([key, cond]) => row[key] === cond);
}

/** Transactions run one at a time (as Postgres serializes the conditional
 *  UPDATE on the alert row) on a copy that is committed only on success. */
function createStore(alerts = [], { failNotificationWrites = 0 } = {}) {
  const state = { availability_alerts: alerts.map((row) => ({ ...row })), customer_notifications: [] };
  let failuresLeft = failNotificationWrites;
  let lock = Promise.resolve();

  function client(target) {
    return {
      availability_alerts: {
        async findMany({ where }) { return target.availability_alerts.filter((row) => matches(row, where)).map((row) => ({ ...row })); },
        async updateMany({ where, data }) {
          const hits = target.availability_alerts.filter((row) => matches(row, where));
          hits.forEach((row) => Object.assign(row, data));
          return { count: hits.length };
        },
        async upsert({ where, create, update }) {
          const key = where.customer_id_book_id;
          const row = target.availability_alerts.find((item) => item.customer_id === key.customer_id && item.book_id === key.book_id);
          if (row) { Object.assign(row, update); return { ...row }; }
          const created = { id: `alert-${target.availability_alerts.length + 1}`, notified_at: null, created_at: new Date(), ...create };
          target.availability_alerts.push(created);
          return { ...created };
        },
        async deleteMany({ where }) {
          const before = target.availability_alerts.length;
          target.availability_alerts = target.availability_alerts.filter((row) => !matches(row, where));
          return { count: before - target.availability_alerts.length };
        },
      },
      customer_notifications: {
        async create({ data }) {
          if (failuresLeft > 0) {
            failuresLeft -= 1;
            throw new Error('database unavailable');
          }
          target.customer_notifications.push(data);
          return data;
        },
      },
    };
  }

  const prisma = {
    ...client(state),
    $transaction(fn) {
      const run = lock.then(async () => {
        const draft = structuredClone(state);
        const result = await fn(client(draft));
        state.availability_alerts = draft.availability_alerts;
        state.customer_notifications = draft.customer_notifications;
        return result;
      });
      lock = run.catch(() => {});
      return run;
    },
  };
  return { state, prisma };
}

async function dispatch(store, availability, envelope) {
  const calls = [];
  const result = await dispatchAvailabilityAlerts(envelope, {
    prisma: store.prisma,
    getAvailability: async (variantId) => { calls.push(variantId); return availability; },
    // Same contract as lib/notifications.js createNotificationRecord.
    createNotification: (tx, payload) => tx.customer_notifications.create({ data: payload }),
    now: () => new Date('2026-10-06T08:00:00.000Z'),
  });
  return { result, calls };
}

const notifiedCustomers = (store) => store.state.customer_notifications.map((n) => n.customer_id).sort();

// ── subscribe / cancel (wishlist.controller) ─────────────────────────────────

function loadControllerWith(store) {
  const prismaPath = require.resolve('../src/lib/prisma');
  const customerControllerPath = require.resolve('../src/controllers/customer.controller');
  const controllerPath = require.resolve('../src/controllers/wishlist.controller');
  const saved = [prismaPath, customerControllerPath, controllerPath].map((path) => [path, require.cache[path]]);
  require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: { prisma: store.prisma } };
  require.cache[customerControllerPath] = {
    id: customerControllerPath, filename: customerControllerPath, loaded: true,
    exports: { ensureCurrentCustomer: async (req) => ({ id: req.user.customer_id }) },
  };
  delete require.cache[controllerPath];
  const controller = require('../src/controllers/wishlist.controller');
  for (const [path, entry] of saved) {
    if (entry) require.cache[path] = entry;
    else delete require.cache[path];
  }
  return controller;
}

function response() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

test('subscribing creates an ACTIVE alert for the signed-in customer; re-subscribing re-arms a notified one', async () => {
  const store = createStore([alert('alert-old', 'cust-b', { status: 'NOTIFIED', notified_at: new Date('2026-09-01') })]);
  const controller = loadControllerWith(store);

  const res = response();
  await controller.subscribeAvailabilityAlert({ user: { customer_id: 'cust-a' }, body: { book_id: BOOK_ID, customer_id: 'cust-b' } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.customer_id, 'cust-a', 'owner comes from the session, never the body');
  assert.equal(res.body.data.status, 'ACTIVE');

  await controller.subscribeAvailabilityAlert({ user: { customer_id: 'cust-b' }, body: { book_id: BOOK_ID } }, response());
  const rearmed = store.state.availability_alerts.find((row) => row.customer_id === 'cust-b');
  assert.equal(rearmed.status, 'ACTIVE');
  assert.equal(rearmed.notified_at, null);

  const bad = response();
  await controller.subscribeAvailabilityAlert({ user: { customer_id: 'cust-a' }, body: { book_id: 'nope' } }, bad);
  assert.equal(bad.statusCode, 400);
});

test('cancelling removes only the caller\'s alert, and a cancelled alert is never notified', async () => {
  const store = createStore([alert('alert-a', 'cust-a'), alert('alert-b', 'cust-b')]);
  const controller = loadControllerWith(store);

  await controller.unsubscribeAvailabilityAlert({ user: { customer_id: 'cust-a' }, params: { bookId: BOOK_ID } }, response());
  assert.deepEqual(store.state.availability_alerts.map((row) => row.id), ['alert-b']);

  await dispatch(store, branchAvailability, stockChanged());
  assert.deepEqual(notifiedCustomers(store), ['cust-b']);
});

// ── dispatch ─────────────────────────────────────────────────────────────────

test('stock that only reaches an internal warehouse does not notify anyone', async () => {
  const store = createStore([alert('alert-a', 'cust-a')]);
  const { result } = await dispatch(store, warehouseOnly, stockChanged({ warehouse_id: 'wh-internal' }));
  assert.equal(result.skipped, 'no_public_stock');
  assert.equal(store.state.customer_notifications.length, 0);
  assert.equal(store.state.availability_alerts[0].notified_at, null);
  assert.equal(store.state.availability_alerts[0].status, 'ACTIVE');
});

test('available quantity still 0, or a book no longer public, does not notify', async () => {
  const store = createStore([alert('alert-a', 'cust-a')]);
  const zero = { ...branchAvailability, available_quantity: 0, pickup_branches: [{ ...BRANCH_Q1, available_quantity: 0 }] };
  await dispatch(store, zero, stockChanged());
  await dispatch(store, null, stockChanged());
  assert.equal(store.state.customer_notifications.length, 0);
  assert.equal(store.state.availability_alerts[0].status, 'ACTIVE');
});

test('decreases and unrelated events are ignored without calling inventory', async () => {
  const store = createStore([alert('alert-a', 'cust-a')]);
  for (const envelope of [
    stockChanged({ delta_qty: -1 }),
    stockChanged({ delta_qty: 0 }),
    stockChanged({ variant_id: 'not-a-uuid' }),
    { event_type: 'inventory.reservation.created', payload: { variant_id: VARIANT_ID } },
  ]) {
    const { result, calls } = await dispatch(store, branchAvailability, envelope);
    assert.equal(result.skipped, 'not_a_restock');
    assert.equal(calls.length, 0);
  }
});

test('public branch stock notifies the waiting customer, sets notified_at and links the book', async () => {
  const store = createStore([alert('alert-a', 'cust-a')]);
  const { result, calls } = await dispatch(store, branchAvailability, stockChanged());

  assert.deepEqual(calls, [VARIANT_ID]);
  assert.equal(result.notified, 1);
  const [sent] = store.state.customer_notifications;
  assert.equal(sent.customer_id, 'cust-a');
  assert.equal(sent.template_code, 'AVAILABILITY_ALERT');
  assert.equal(sent.reference_type, 'BOOK');
  assert.equal(sent.reference_id, BOOK_ID);
  assert.match(sent.body, /Dế Mèn Phiêu Lưu Ký/);
  assert.match(sent.body, /Chi nhánh Quận 1 \(còn 2 cuốn\)/);
  assert.match(sent.body, /Thư viện Trung tâm \(còn 1 cuốn\)/);
  assert.deepEqual(sent.metadata.pickup_branches.map((b) => b.warehouse_id), [BRANCH_Q1.warehouse_id, LIBRARY.warehouse_id]);

  const row = store.state.availability_alerts[0];
  assert.equal(row.status, 'NOTIFIED');
  assert.equal(row.notified_at.toISOString(), '2026-10-06T08:00:00.000Z');
});

test('a released reservation (copy back on the shelf) also triggers the check', async () => {
  const store = createStore([alert('alert-a', 'cust-a')]);
  await dispatch(store, branchAvailability, { event_id: 'evt-r', event_type: 'inventory.reservation.released', payload: { variant_id: VARIANT_ID, quantity: 1 } });
  assert.deepEqual(notifiedCustomers(store), ['cust-a']);
});

test('the same alert is never notified twice — redelivery or a later restock', async () => {
  const store = createStore([alert('alert-a', 'cust-a')]);
  await dispatch(store, branchAvailability, stockChanged());
  await dispatch(store, branchAvailability, stockChanged());
  await dispatch(store, branchAvailability, stockChanged({ delta_qty: 3 }));
  assert.deepEqual(notifiedCustomers(store), ['cust-a']);
});

test('every customer waiting for the book is notified once; other books and already-notified alerts are untouched', async () => {
  const store = createStore([
    alert('alert-a', 'cust-a'),
    alert('alert-b', 'cust-b'),
    alert('alert-c', 'cust-c'),
    alert('alert-done', 'cust-d', { status: 'NOTIFIED', notified_at: new Date('2026-09-01') }),
    alert('alert-other', 'cust-a', { book_id: OTHER_BOOK_ID }),
  ]);
  await dispatch(store, branchAvailability, stockChanged());
  assert.deepEqual(notifiedCustomers(store), ['cust-a', 'cust-b', 'cust-c']);
  assert.equal(new Set(store.state.customer_notifications.map((n) => n.metadata.availability_alert_id)).size, 3);
  assert.equal(store.state.availability_alerts.find((row) => row.id === 'alert-other').status, 'ACTIVE');
});

test('a failed notification write rolls its claim back; the retry notifies exactly once', async () => {
  const store = createStore([alert('alert-a', 'cust-a'), alert('alert-b', 'cust-b')], { failNotificationWrites: 1 });

  await assert.rejects(dispatch(store, branchAvailability, stockChanged()), /database unavailable/);
  assert.equal(store.state.customer_notifications.length, 0);
  assert.equal(store.state.availability_alerts.find((row) => row.id === 'alert-a').notified_at, null, 'claim rolled back with the failed write');

  await dispatch(store, branchAvailability, stockChanged()); // broker redelivery
  await dispatch(store, branchAvailability, stockChanged()); // and once more for good measure
  assert.deepEqual(notifiedCustomers(store), ['cust-a', 'cust-b']);
});

test('two consumers racing on the same event send one notification per alert', async () => {
  const store = createStore([alert('alert-a', 'cust-a'), alert('alert-b', 'cust-b')]);
  await Promise.all([
    dispatch(store, branchAvailability, stockChanged()),
    dispatch(store, branchAvailability, stockChanged()),
  ]);
  assert.deepEqual(notifiedCustomers(store), ['cust-a', 'cust-b']);
});

// ── consumer ack / retry policy ──────────────────────────────────────────────

test('consumer acks processed messages, requeues a first failure once, then dead-letters', async () => {
  const log = [];
  const channel = {
    ack: (msg) => log.push(['ack', msg.id]),
    nack: (msg, _allUpTo, requeue) => log.push(['nack', msg.id, requeue]),
  };
  const message = (id, body, redelivered = false) => ({
    id,
    content: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)),
    fields: { redelivered },
  });
  const ok = async () => ({ notified: 0 });
  const boom = async () => { throw new Error('inventory unreachable'); };

  await handleMessage(channel, message('m1', stockChanged()), ok);
  await handleMessage(channel, message('m2', stockChanged()), boom);
  await handleMessage(channel, message('m3', stockChanged(), true), boom);
  await handleMessage(channel, message('m4', 'not json'), ok);
  await handleMessage(channel, null, ok);

  assert.deepEqual(log, [
    ['ack', 'm1'],
    ['nack', 'm2', true],
    ['nack', 'm3', false],
    ['nack', 'm4', false],
  ]);
});
