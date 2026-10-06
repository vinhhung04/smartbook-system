const assert = require('node:assert/strict');
const test = require('node:test');

// Customer notification center (/my/notifications*). The controller is loaded
// with stubbed prisma/customer modules (as in review-write-customer.test.js);
// the customer always comes from the session, never from the request.

const A = 'cust-a';
const B = 'cust-b';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function cond(value, expected) {
  if (expected === null) return value === null || value === undefined;
  if (expected && typeof expected === 'object' && 'not' in expected) return expected.not === null ? value != null : value !== expected.not;
  return value === expected;
}

function createStore(rows) {
  const state = { rows: rows.map((row) => ({ read_at: null, ...row })) };
  const matching = (where = {}) => state.rows.filter((row) => Object.entries(where).every(([key, expected]) => cond(row[key], expected)));
  const prisma = {
    customer_notifications: {
      async findMany({ where, skip = 0, take = Infinity }) {
        return matching(where).sort((x, y) => y.scheduled_at - x.scheduled_at).slice(skip, skip + take).map((row) => ({ ...row }));
      },
      async count({ where }) { return matching(where).length; },
      async findFirst({ where }) { const row = matching(where)[0]; return row ? { id: row.id, read_at: row.read_at } : null; },
      async updateMany({ where, data }) {
        const hits = matching(where);
        hits.forEach((row) => Object.assign(row, data));
        return { count: hits.length };
      },
    },
  };
  return { state, prisma };
}

function loadController(store) {
  const prismaPath = require.resolve('../src/lib/prisma');
  const customerControllerPath = require.resolve('../src/controllers/customer.controller');
  const controllerPath = require.resolve('../src/controllers/notification.controller');
  const saved = [prismaPath, customerControllerPath].map((path) => [path, require.cache[path]]);
  require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: { prisma: store.prisma } };
  require.cache[customerControllerPath] = {
    id: customerControllerPath, filename: customerControllerPath, loaded: true,
    exports: { ensureCurrentCustomer: async (req) => (req.user?.customer_id ? { id: req.user.customer_id } : null) },
  };
  delete require.cache[controllerPath];
  const controller = require('../src/controllers/notification.controller');
  for (const [path, entry] of saved) {
    if (entry) require.cache[path] = entry;
    else delete require.cache[path];
  }
  return controller;
}

async function call(handler, { customer, query = {}, params = {} }) {
  const res = {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  await handler({ user: { customer_id: customer }, query, params }, res);
  return res;
}

function seed() {
  const at = (minutes) => new Date(Date.UTC(2026, 9, 6, 8, minutes));
  return createStore([
    { id: id(1), customer_id: A, subject: 'Đặt trước thành công', scheduled_at: at(1) },
    { id: id(2), customer_id: A, subject: 'Sách sẵn sàng để nhận', scheduled_at: at(2) },
    { id: id(3), customer_id: A, subject: 'Đã trả sách', scheduled_at: at(3), read_at: at(4) },
    { id: id(4), customer_id: B, subject: 'Phí phạt mới', scheduled_at: at(5) },
  ]);
}

test('list returns only the caller\'s notifications, newest first, with the real unread count', async () => {
  const controller = loadController(seed());
  const res = await call(controller.getMyNotifications, { customer: A, query: { pageSize: '1' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data.map((row) => row.id), [id(3)]);
  assert.equal(res.body.meta.total, 3);
  // Counted over every page, not just the one returned.
  assert.equal(res.body.meta.unread_count, 2);
});

test('status filter is applied on the server', async () => {
  const controller = loadController(seed());
  const unread = await call(controller.getMyNotifications, { customer: A, query: { status: 'unread' } });
  assert.deepEqual(unread.body.data.map((row) => row.id), [id(2), id(1)]);
  const read = await call(controller.getMyNotifications, { customer: A, query: { status: 'read' } });
  assert.deepEqual(read.body.data.map((row) => row.id), [id(3)]);
});

test('unread-count endpoint counts only the caller\'s unread notifications', async () => {
  const controller = loadController(seed());
  assert.deepEqual((await call(controller.getMyUnreadNotificationCount, { customer: A })).body, { data: { unread_count: 2 } });
  assert.deepEqual((await call(controller.getMyUnreadNotificationCount, { customer: B })).body, { data: { unread_count: 1 } });
});

test('mark one as read updates it, is idempotent and returns the new unread count', async () => {
  const store = seed();
  const controller = loadController(store);
  let res = await call(controller.markMyNotificationRead, { customer: A, params: { id: id(1) } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.unread_count, 1);
  const firstReadAt = store.state.rows.find((row) => row.id === id(1)).read_at;
  assert.ok(firstReadAt instanceof Date);

  res = await call(controller.markMyNotificationRead, { customer: A, params: { id: id(1) } });
  assert.equal(res.statusCode, 200);
  assert.equal(store.state.rows.find((row) => row.id === id(1)).read_at, firstReadAt, 'first read time kept');
});

test('mark all as read only touches the caller\'s notifications', async () => {
  const store = seed();
  const controller = loadController(store);
  const res = await call(controller.markAllMyNotificationsRead, { customer: A });
  assert.equal(res.body.count, 2);
  assert.equal(res.body.data.unread_count, 0);
  assert.equal(store.state.rows.find((row) => row.id === id(4)).read_at, null, 'customer B untouched');
  assert.equal((await call(controller.getMyUnreadNotificationCount, { customer: B })).body.data.unread_count, 1);
});

test('customer A cannot read or mark customer B\'s notification', async () => {
  const store = seed();
  const controller = loadController(store);
  const list = await call(controller.getMyNotifications, { customer: A, query: { pageSize: '100' } });
  assert.equal(list.body.data.some((row) => row.customer_id === B), false);

  const res = await call(controller.markMyNotificationRead, { customer: A, params: { id: id(4) } });
  assert.equal(res.statusCode, 404, 'same answer as an unknown id — no ownership leak');
  assert.equal(store.state.rows.find((row) => row.id === id(4)).read_at, null);
});

test('malformed ids are rejected before touching the database, and no session means no data', async () => {
  const controller = loadController(seed());
  assert.equal((await call(controller.markMyNotificationRead, { customer: A, params: { id: 'abc' } })).statusCode, 400);
  assert.equal((await call(controller.getMyNotifications, { customer: null })).statusCode, 404);
});
