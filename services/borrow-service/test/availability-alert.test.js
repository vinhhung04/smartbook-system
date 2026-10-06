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
        async findUnique({ where }) {
          const key = where.customer_id_book_id;
          const row = target.availability_alerts.find((item) => item.customer_id === key.customer_id && item.book_id === key.book_id);
          return row ? { ...row } : null;
        },
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

/** Loads wishlist.controller with stubbed prisma, session and inventory.
 *  `availability` is what inventory reports for the book: a value, a function
 *  of the book id, or an Error (inventory unreachable). */
function loadControllerWith(store, availability = warehouseOnly) {
  const prismaPath = require.resolve('../src/lib/prisma');
  const customerControllerPath = require.resolve('../src/controllers/customer.controller');
  const inventoryPath = require.resolve('../src/services/inventory-integration.service');
  const controllerPath = require.resolve('../src/controllers/wishlist.controller');
  const saved = [prismaPath, customerControllerPath, inventoryPath, controllerPath].map((path) => [path, require.cache[path]]);
  const calls = [];
  require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: { prisma: store.prisma } };
  require.cache[customerControllerPath] = {
    id: customerControllerPath, filename: customerControllerPath, loaded: true,
    exports: { ensureCurrentCustomer: async (req) => ({ id: req.user.customer_id }) },
  };
  require.cache[inventoryPath] = {
    id: inventoryPath, filename: inventoryPath, loaded: true,
    exports: {
      getBookPublicAvailability: async ({ bookId }) => {
        calls.push(bookId);
        const value = typeof availability === 'function' ? availability(bookId) : availability;
        if (value instanceof Error) throw value;
        return value;
      },
    },
  };
  delete require.cache[controllerPath];
  const controller = require('../src/controllers/wishlist.controller');
  for (const [path, entry] of saved) {
    if (entry) require.cache[path] = entry;
    else delete require.cache[path];
  }
  return { controller, calls };
}

function response() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

async function subscribe(controller, customerId, bookId = BOOK_ID, extraBody = {}) {
  const res = response();
  await controller.subscribeAvailabilityAlert({ user: { customer_id: customerId }, body: { book_id: bookId, ...extraBody } }, res);
  return res;
}

test('case 1: no public copy → 201, ACTIVE alert owned by the session customer (never the body)', async () => {
  const store = createStore();
  const { controller, calls } = loadControllerWith(store, { ...branchAvailability, available_quantity: 0, pickup_branches: [] });
  const res = await subscribe(controller, 'cust-a', BOOK_ID, { customer_id: 'cust-b' });
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.customer_id, 'cust-a');
  assert.equal(res.body.data.status, 'ACTIVE');
  // Checked before the upsert and again after it (race guard).
  assert.deepEqual(calls, [BOOK_ID, BOOK_ID]);
  assert.equal((await subscribe(controller, 'cust-a', 'nope')).statusCode, 400);
});

test('case 2: book on a public shelf → 409 with a Vietnamese message, no alert created', async () => {
  const store = createStore();
  const { controller } = loadControllerWith(store, branchAvailability);
  const res = await subscribe(controller, 'cust-a');
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.message, 'Sách hiện đang có sẵn tại chi nhánh, bạn có thể đặt trước ngay.');
  assert.equal(store.state.availability_alerts.length, 0);
});

test('case 3: copies only in an internal warehouse (public stock 0) → subscribing still works', async () => {
  const store = createStore();
  // Inventory applies the BRANCH/LIBRARY rule, so warehouse-only copies report as 0.
  const { controller } = loadControllerWith(store, warehouseOnly);
  assert.equal((await subscribe(controller, 'cust-a')).statusCode, 201);
  assert.equal(store.state.availability_alerts[0].status, 'ACTIVE');
});

test('case 4: a NOTIFIED alert is re-armed (ACTIVE, notified_at null) when the book is gone again', async () => {
  const store = createStore([alert('alert-old', 'cust-b', { status: 'NOTIFIED', notified_at: new Date('2026-09-01') })]);
  const { controller } = loadControllerWith(store, warehouseOnly);
  assert.equal((await subscribe(controller, 'cust-b')).statusCode, 201);
  const row = store.state.availability_alerts.find((item) => item.customer_id === 'cust-b');
  assert.equal(row.status, 'ACTIVE');
  assert.equal(row.notified_at, null);
});

test('case 5: a NOTIFIED alert is not re-armed while the book is on a public shelf', async () => {
  const notifiedAt = new Date('2026-09-01');
  const store = createStore([alert('alert-old', 'cust-b', { status: 'NOTIFIED', notified_at: notifiedAt })]);
  const { controller } = loadControllerWith(store, branchAvailability);
  assert.equal((await subscribe(controller, 'cust-b')).statusCode, 409);
  const row = store.state.availability_alerts[0];
  assert.equal(row.status, 'NOTIFIED');
  assert.equal(row.notified_at, notifiedAt);
});

test('case 6: inventory unreachable → 503 and no alert (fail closed); unknown book → 404, no orphan alert', async () => {
  const store = createStore();
  const down = loadControllerWith(store, new Error('inventory unreachable'));
  const res = await subscribe(down.controller, 'cust-a');
  assert.equal(res.statusCode, 503);
  assert.match(res.body.message, /thử lại/);

  const missing = loadControllerWith(store, null);
  assert.equal((await subscribe(missing.controller, 'cust-a')).statusCode, 404);
  assert.equal(store.state.availability_alerts.length, 0);
});

test('case 7: subscribed at 0, a copy comes back → exactly one notification and notified_at set', async () => {
  let publicStock = warehouseOnly;
  const store = createStore();
  const { controller } = loadControllerWith(store, () => publicStock);
  assert.equal((await subscribe(controller, 'cust-a')).statusCode, 201);

  // A positive event while public stock is still 0 (e.g. into the internal warehouse) does nothing.
  await dispatch(store, publicStock, stockChanged({ warehouse_id: 'wh-internal' }));
  assert.equal(store.state.customer_notifications.length, 0);

  publicStock = branchAvailability; // 0 → >0 at a branch
  await dispatch(store, publicStock, stockChanged());
  await dispatch(store, publicStock, stockChanged()); // redelivery / next restock
  assert.deepEqual(notifiedCustomers(store), ['cust-a']);
  const row = store.state.availability_alerts[0];
  assert.equal(row.status, 'NOTIFIED');
  assert.ok(row.notified_at instanceof Date);

  // While the copy is still on the shelf, re-subscribing is refused.
  assert.equal((await subscribe(controller, 'cust-a')).statusCode, 409);
});

// ── subscription race: stock appears between the check and the upsert ────────

/** Inventory answers in order: first call, second call, … (last answer repeats). */
function answers(...values) {
  let call = 0;
  return () => {
    const value = values[Math.min(call, values.length - 1)];
    call += 1;
    return typeof value === 'function' ? value() : value;
  };
}

test('race: 0 at the first check, a copy appears before the second → 409 and no alert left behind', async () => {
  const store = createStore();
  const { controller, calls } = loadControllerWith(store, answers(warehouseOnly, branchAvailability));
  const res = await subscribe(controller, 'cust-a');
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.message, 'Sách hiện đang có sẵn tại chi nhánh, bạn có thể đặt trước ngay.');
  assert.equal(calls.length, 2);
  assert.equal(store.state.availability_alerts.length, 0, 'the alert this request created is removed');

  // A restock event processed afterwards has nobody to notify.
  await dispatch(store, branchAvailability, stockChanged());
  assert.equal(store.state.customer_notifications.length, 0);
});

test('race on re-arm: NOTIFIED alert is restored (not left ACTIVE) when the second check finds stock', async () => {
  const notifiedAt = new Date('2026-09-01');
  const store = createStore([alert('alert-old', 'cust-a', { status: 'NOTIFIED', notified_at: notifiedAt })]);
  const { controller } = loadControllerWith(store, answers(warehouseOnly, branchAvailability));
  assert.equal((await subscribe(controller, 'cust-a')).statusCode, 409);
  const row = store.state.availability_alerts[0];
  assert.equal(row.status, 'NOTIFIED');
  assert.equal(row.notified_at.getTime(), notifiedAt.getTime());
});

test('race: inventory fails on the second check → 503 and the alert state is rolled back (fail closed)', async () => {
  const notifiedAt = new Date('2026-09-01');
  const store = createStore([alert('alert-old', 'cust-b', { status: 'NOTIFIED', notified_at: notifiedAt })]);
  const { controller } = loadControllerWith(store, answers(warehouseOnly, new Error('inventory unreachable')));

  const fresh = await subscribe(controller, 'cust-a');
  assert.equal(fresh.statusCode, 503);
  assert.equal(store.state.availability_alerts.some((row) => row.customer_id === 'cust-a'), false);

  const { controller: again } = loadControllerWith(store, answers(warehouseOnly, new Error('inventory unreachable')));
  assert.equal((await subscribe(again, 'cust-b')).statusCode, 503);
  const restored = store.state.availability_alerts.find((row) => row.customer_id === 'cust-b');
  assert.equal(restored.status, 'NOTIFIED');
  assert.equal(restored.notified_at.getTime(), notifiedAt.getTime());
});

test('book leaves the public catalog between the checks → 404 and the new alert is removed', async () => {
  const store = createStore();
  const { controller, calls } = loadControllerWith(store, answers(warehouseOnly, null));
  const res = await subscribe(controller, 'cust-a');
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.message, 'Không tìm thấy sách trong danh mục.');
  assert.equal(calls.length, 2);
  assert.equal(store.state.availability_alerts.length, 0, 'no orphan ACTIVE alert');
});

test('book leaves the public catalog during a re-arm → 404 and the previous NOTIFIED state is restored', async () => {
  const notifiedAt = new Date('2026-09-01');
  const store = createStore([alert('alert-old', 'cust-a', { status: 'NOTIFIED', notified_at: notifiedAt })]);
  const { controller } = loadControllerWith(store, answers(warehouseOnly, null));
  assert.equal((await subscribe(controller, 'cust-a')).statusCode, 404);
  const row = store.state.availability_alerts[0];
  assert.equal(row.status, 'NOTIFIED');
  assert.equal(row.notified_at.getTime(), notifiedAt.getTime());
});

test('null re-check after the consumer already claimed the alert → NOTIFIED is kept, not reverted', async () => {
  const store = createStore();
  const consumerClaimsThenUnpublished = async () => {
    await dispatch(store, branchAvailability, stockChanged());
    return null;
  };
  const { controller } = loadControllerWith(store, answers(warehouseOnly, consumerClaimsThenUnpublished));
  assert.equal((await subscribe(controller, 'cust-a')).statusCode, 404);
  assert.equal(store.state.availability_alerts[0].status, 'NOTIFIED');
  assert.deepEqual(notifiedCustomers(store), ['cust-a']);
});

test('race: the consumer claims the new alert before the second check → one notification, NOTIFIED kept', async () => {
  const store = createStore();
  // Between upsert and re-check the restock event is processed by the consumer.
  const consumerRunsThenStock = async () => {
    await dispatch(store, branchAvailability, stockChanged());
    return branchAvailability;
  };
  const { controller } = loadControllerWith(store, answers(warehouseOnly, consumerRunsThenStock));
  const res = await subscribe(controller, 'cust-a');
  assert.equal(res.statusCode, 409);
  assert.deepEqual(notifiedCustomers(store), ['cust-a']);
  const row = store.state.availability_alerts[0];
  assert.equal(row.status, 'NOTIFIED', 'the claim by the consumer is not undone');
  assert.ok(row.notified_at instanceof Date);

  await dispatch(store, branchAvailability, stockChanged()); // redelivery
  assert.equal(store.state.customer_notifications.length, 1);
});

test('race: stock 0 at both checks, restock right after → the consumer notifies exactly once', async () => {
  const store = createStore();
  const { controller } = loadControllerWith(store, answers(warehouseOnly, warehouseOnly));
  assert.equal((await subscribe(controller, 'cust-a')).statusCode, 201);
  await dispatch(store, branchAvailability, stockChanged());
  await dispatch(store, branchAvailability, stockChanged());
  assert.deepEqual(notifiedCustomers(store), ['cust-a']);
  assert.equal(store.state.availability_alerts[0].status, 'NOTIFIED');
});

test('racing subscribe requests from the same customer and book keep one alert and one notification', async () => {
  const store = createStore();
  const { controller } = loadControllerWith(store, warehouseOnly);
  const results = await Promise.all([subscribe(controller, 'cust-a'), subscribe(controller, 'cust-a'), subscribe(controller, 'cust-a')]);
  assert.deepEqual(results.map((res) => res.statusCode), [201, 201, 201]);
  assert.equal(store.state.availability_alerts.length, 1);
  await Promise.all([dispatch(store, branchAvailability, stockChanged()), dispatch(store, branchAvailability, stockChanged())]);
  assert.equal(store.state.customer_notifications.length, 1);
});

test('cancelling removes only the caller\'s alert, and a cancelled alert is never notified', async () => {
  const store = createStore([alert('alert-a', 'cust-a'), alert('alert-b', 'cust-b')]);
  const { controller } = loadControllerWith(store);

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
