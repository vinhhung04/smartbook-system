// Warehouse staff assignment - inventory side:
// - /api/my-warehouse-tasks/available lists only the caller's readable
//   warehouses and marks `claimable` only where they can WRITE;
// - claim / scan / confirm routes check the STORED record's warehouse
//   (requireRecordWarehouse), READ never claims, auth down = 503;
// - staff tasks: a warehouse first, an assignee who is active warehouse staff
//   with WRITE there, safe reassignment, staff moved out / locked cannot work
//   their old tasks, managers see them flagged.
// An in-memory Prisma and a fake scope resolver stand in for the database and
// auth-service.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const HN = '00000000-0000-4000-8000-000000000003';
const HCM = '00000000-0000-4000-8000-000000000002';
const ORDER_HN = '10000000-0000-4000-8000-000000000001';
const ORDER_HCM = '10000000-0000-4000-8000-000000000002';
const TRANSFER_TO_HN = '10000000-0000-4000-8000-000000000003';
const PACK_HCM = '10000000-0000-4000-8000-000000000004';

// ── in-memory prisma ───────────────────────────────────────────────────────
function cond(value, c) {
  if (c && typeof c === 'object' && !Array.isArray(c) && !(c instanceof Date)) {
    if ('in' in c) return c.in.includes(value);
    if ('lt' in c) return value != null && value < c.lt;
    if ('gte' in c) return value != null && value >= c.gte;
    if ('some' in c || 'not' in c) return true;
    return true;
  }
  return value === c;
}
function matches(row, where) {
  if (!where) return true;
  return Object.entries(where).every(([key, c]) => {
    if (key === 'OR') return c.some((w) => matches(row, w));
    if (key === 'AND') return c.every((w) => matches(row, w));
    return cond(row[key], c);
  });
}

const db = {
  warehouses: [{ id: HN, is_active: true, code: 'WH-HN-01', name: 'HN' }, { id: HCM, is_active: true, code: 'WH-HCM-01', name: 'HCM' }],
  outbound_orders: [
    { id: ORDER_HN, outbound_number: 'OUT-HN', status: 'APPROVED', processed_by_user_id: null, warehouse_id: HN, requested_at: new Date(1), created_at: new Date(1) },
    { id: ORDER_HCM, outbound_number: 'OUT-HCM', status: 'APPROVED', processed_by_user_id: null, warehouse_id: HCM, requested_at: new Date(2), created_at: new Date(2) },
  ],
  transfer_orders: [
    { id: TRANSFER_TO_HN, transfer_number: 'TR-1', status: 'IN_TRANSIT', from_warehouse_id: HCM, to_warehouse_id: HN, received_by_user_id: null, requested_at: new Date(3), created_at: new Date(3) },
  ],
  packing_tasks: [{ id: PACK_HCM, warehouse_id: HCM }],
  locations: [],
  staff_tasks: [],
  inventory_audit_logs: [],
  warehouse_exception_reports: [{ id: 'ex-hcm', warehouse_id: HCM }],
  purchase_requests: [],
};

const hooks = {};
function model(name) {
  return {
    findMany: async ({ where, take } = {}) => db[name].filter((r) => matches(r, where)).slice(0, take),
    findUnique: async ({ where }) => {
      const row = db[name].find((r) => r.id === where.id);
      if (!row) return null;
      const copy = { ...row };
      hooks.afterRead?.(row); // lets a test change the row between a read and the write
      return copy;
    },
    count: async ({ where } = {}) => db[name].filter((r) => matches(r, where)).length,
    create: async ({ data }) => {
      const row = { id: `${name}-${db[name].length + 1}`, created_at: new Date(), updated_at: new Date(), completed_at: null, ...data };
      db[name].push(row);
      return row;
    },
    updateMany: async ({ where, data }) => {
      const rows = db[name].filter((r) => matches(r, where));
      for (const row of rows) Object.assign(row, data);
      return { count: rows.length };
    },
    update: async ({ where, data }) => Object.assign(db[name].find((r) => r.id === where.id), data),
    groupBy: async ({ by, where }) => {
      const groups = new Map();
      for (const row of db[name].filter((r) => matches(r, where))) {
        const key = by.map((f) => row[f]).join('|');
        const g = groups.get(key) || { ...Object.fromEntries(by.map((f) => [f, row[f]])), _count: { _all: 0 } };
        g._count._all += 1;
        groups.set(key, g);
      }
      return [...groups.values()];
    },
  };
}
class FakePrisma {
  constructor() {
    for (const name of Object.keys(db)) this[name] = model(name);
  }
}
const realLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === '@prisma/client') return { PrismaClient: FakePrisma, Prisma: {} };
  if (request.endsWith('lib/socket-emitter')) return { pushEvents: async () => {}, pushToRooms: async () => {} };
  return realLoad.call(this, request, parent, isMain);
};

const scopeUtils = require('../src/utils/warehouse-scope.utils');
const { WarehouseScopeUnavailableError } = require('@smartbook/shared/warehouse-scope');

// scopes per user id; `profiles` drive checkAssignee (status / roles)
const scopes = {
  'staff-hn': { read: [HN], write: [HN] },
  'staff-hcm': { read: [HCM], write: [HCM] },
  'reader-hn': { read: [HN], write: [] },
  'manager-hn': { read: [HN], write: [HN] },
  'librarian-hn': { read: [HN], write: [HN] },
  'locked-hn': { read: [], write: [] },
};
const profiles = {
  'staff-hn': { status: 'ACTIVE', roles: ['WAREHOUSE_STAFF'] },
  'staff-hcm': { status: 'ACTIVE', roles: ['WAREHOUSE_STAFF'] },
  'reader-hn': { status: 'ACTIVE', roles: ['WAREHOUSE_STAFF'] },
  'manager-hn': { status: 'ACTIVE', roles: ['WAREHOUSE_MANAGER'] },
  'librarian-hn': { status: 'ACTIVE', roles: ['LIBRARIAN'] },
  'locked-hn': { status: 'LOCKED', roles: ['WAREHOUSE_STAFF'] },
};
let authDown = false;
const scopeOf = (id) => {
  const s = scopes[id] || { read: [], write: [] };
  return { all: false, read: new Set(s.read), write: new Set(s.write) };
};
scopeUtils.setWarehouseScopeResolver({
  resolve: async (user) => {
    if (authDown || user?.id === 'auth-down') throw new WarehouseScopeUnavailableError();
    return user?.is_superuser ? { all: true, read: null, write: null } : scopeOf(user?.id);
  },
  canRead: async (user, wh) => {
    if (authDown || user?.id === 'auth-down') throw new WarehouseScopeUnavailableError();
    return Boolean(user?.is_superuser) || scopeOf(user?.id).read.has(wh);
  },
  canWrite: async (user, wh) => {
    if (authDown || user?.id === 'auth-down') throw new WarehouseScopeUnavailableError();
    return Boolean(user?.is_superuser) || scopeOf(user?.id).write.has(wh);
  },
  checkAssignee: async (id, wh, { roles }) => {
    if (authDown) throw new WarehouseScopeUnavailableError();
    const profile = profiles[id];
    if (!profile) return { ok: false, reason: 'NOT_FOUND' };
    if (profile.status !== 'ACTIVE') return { ok: false, reason: 'INACTIVE' };
    if (!profile.roles.some((r) => roles.includes(r))) return { ok: false, reason: 'ROLE_NOT_ALLOWED' };
    return scopeOf(id).write.has(wh) ? { ok: true } : { ok: false, reason: 'NO_WRITE_SCOPE' };
  },
});

const { getAvailableTasks } = require('../src/controllers/my-warehouse-tasks.controller');
const { requireRecordWarehouse, enforceRequestedWarehouseScope } = require('../src/middlewares/warehouse-scope.middleware');
const record = require('../src/utils/record-warehouse');
const staffTasks = require('../src/controllers/staff-task.controller');
const { createInternalWarehousesRouter } = require('../src/routes/internal-warehouses.routes');

const STAFF_HN = { id: 'staff-hn', roles: ['WAREHOUSE_STAFF'], permissions: ['inventory.task.read', 'inventory.task.progress'] };
const READER_HN = { id: 'reader-hn', roles: ['WAREHOUSE_STAFF'], permissions: ['inventory.task.read'] };
const MANAGER_HN = { id: 'manager-hn', roles: ['WAREHOUSE_MANAGER'], permissions: ['inventory.operation.decide'] };
const NOBODY = { id: 'nobody', roles: ['WAREHOUSE_STAFF'] };

function res() {
  return { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
}
async function call(handler, user, { query = {}, params = {}, body = {}, method = 'GET', originalUrl = '/api/x' } = {}) {
  const r = res();
  await handler({ user, query, params, body, method, originalUrl, headers: {} }, r);
  return r;
}
async function guard(middleware, user, params) {
  const r = res();
  let passed = false;
  await middleware({ user, params, headers: {} }, r, () => { passed = true; });
  return passed ? 'next' : r.statusCode;
}

// ── P0: available tasks ─────────────────────────────────────────────────────

test('D1 available tasks without warehouse_id list only the caller\'s warehouses, never all', async () => {
  const r = await call(getAvailableTasks, STAFF_HN);
  assert.equal(r.statusCode, 200);
  const titles = r.body.data.map((t) => t.title).sort();
  assert.deepEqual(titles, ['OUT-HN', 'TR-1']); // TR-1 is received by HN
  assert.ok(!JSON.stringify(r.body).includes('OUT-HCM'));
  assert.deepEqual((await call(getAvailableTasks, NOBODY)).body.data, []); // no scope = nothing
});

test('D2 READ scope sees the task but it is not claimable; WRITE scope can claim', async () => {
  const reader = await call(getAvailableTasks, READER_HN);
  assert.ok(reader.body.data.length > 0);
  assert.ok(reader.body.data.every((t) => t.claimable === false));
  const writer = await call(getAvailableTasks, STAFF_HN);
  assert.ok(writer.body.data.every((t) => t.claimable === true));
});

test('D3 naming another warehouse is refused before the list (403), auth down is 503', async () => {
  const mw = enforceRequestedWarehouseScope();
  const r = res();
  let passed = false;
  await mw({ user: STAFF_HN, method: 'GET', query: { warehouse_id: HCM }, body: {}, originalUrl: `/api/my-warehouse-tasks/available?warehouse_id=${HCM}` }, r, () => { passed = true; });
  assert.equal(passed, false);
  assert.equal(r.statusCode, 403);
  assert.equal((await call(getAvailableTasks, { id: 'auth-down', roles: ['WAREHOUSE_STAFF'] })).statusCode, 503);
});

// ── P0: claims / mutations check the stored record ──────────────────────────

test('D4 claiming an order of another warehouse is 403 even with a valid task id', async () => {
  const claim = requireRecordWarehouse(record.taskOrderWarehouse(), { fresh: true });
  assert.equal(await guard(claim, STAFF_HN, { taskType: 'outbound', taskId: ORDER_HCM }), 403);
  assert.equal(await guard(claim, STAFF_HN, { taskType: 'outbound', taskId: ORDER_HN }), 'next');
});

test('D5 READ-only scope cannot claim or work a task in its own warehouse', async () => {
  const claim = requireRecordWarehouse(record.taskOrderWarehouse());
  assert.equal(await guard(claim, READER_HN, { taskType: 'outbound', taskId: ORDER_HN }), 403);
  const readOnly = requireRecordWarehouse(record.taskOrderWarehouse(), { access: 'read' });
  assert.equal(await guard(readOnly, READER_HN, { taskType: 'outbound', taskId: ORDER_HN }), 'next');
});

test('D6 transfer receiving is checked on the destination, packing on the task warehouse', async () => {
  const receive = requireRecordWarehouse(record.transferDestinationWarehouse);
  assert.equal(await guard(receive, STAFF_HN, { id: TRANSFER_TO_HN }), 'next');
  assert.equal(await guard(receive, { id: 'staff-hcm', roles: ['WAREHOUSE_STAFF'] }, { id: TRANSFER_TO_HN }), 403);
  const pack = requireRecordWarehouse(record.packingTaskWarehouse);
  assert.equal(await guard(pack, STAFF_HN, { taskId: PACK_HCM }), 403);
});

test('D7 unknown record falls through to the controller 404; auth down is 503 (fail closed)', async () => {
  const claim = requireRecordWarehouse(record.taskOrderWarehouse());
  assert.equal(await guard(claim, STAFF_HN, { taskType: 'outbound', taskId: '10000000-0000-4000-8000-0000000000ff' }), 'next');
  assert.equal(await guard(claim, { id: 'auth-down' }, { taskType: 'outbound', taskId: ORDER_HN }), 503);
  assert.equal(await guard(claim, undefined, { taskType: 'outbound', taskId: ORDER_HN }), 401);
});

// ── P1: staff tasks ─────────────────────────────────────────────────────────

const baseTask = { title: 'Kiểm kệ A1', task_type: 'CHECK_SHELF', priority: 'MEDIUM' };

test('E1 a task needs a warehouse first', async () => {
  const r = await call(staffTasks.createStaffTask, MANAGER_HN, { body: { ...baseTask, assignee_user_id: 'staff-hn' } });
  assert.equal(r.statusCode, 400);
  assert.equal(r.body.code, 'WAREHOUSE_REQUIRED');
});

test('E2 the assignee must be active warehouse staff with WRITE scope in that warehouse', async () => {
  const create = (assignee) => call(staffTasks.createStaffTask, MANAGER_HN, { body: { ...baseTask, warehouse_id: HN, assignee_user_id: assignee } });
  assert.equal((await create('staff-hcm')).body.code, 'ASSIGNEE_OUT_OF_SCOPE');
  assert.equal((await create('reader-hn')).body.code, 'ASSIGNEE_OUT_OF_SCOPE'); // READ never makes someone assignable
  assert.equal((await create('locked-hn')).body.code, 'ASSIGNEE_INACTIVE');
  assert.equal((await create('librarian-hn')).body.code, 'ASSIGNEE_ROLE_NOT_ALLOWED');
  assert.equal((await create('ghost')).body.code, 'ASSIGNEE_NOT_FOUND');
  const ok = await create('staff-hn');
  assert.equal(ok.statusCode, 201);
  assert.equal(ok.body.data.warehouse_id, HN);
});

test('E3 a linked record of another warehouse cannot be attached to the task', async () => {
  const r = await call(staffTasks.createStaffTask, { id: 'admin', is_superuser: true, roles: ['ADMIN'] }, {
    body: { ...baseTask, warehouse_id: HN, assignee_user_id: 'staff-hn', related_entity_type: 'EXCEPTION_REPORT', related_entity_id: 'ex-hcm' },
  });
  assert.equal(r.statusCode, 400);
  assert.equal(r.body.code, 'ENTITY_WAREHOUSE_MISMATCH');
});

test('E4 the assignee works the task forward; a closed task stays closed (409)', async () => {
  const task = (await call(staffTasks.createStaffTask, MANAGER_HN, { body: { ...baseTask, warehouse_id: HN, assignee_user_id: 'staff-hn' } })).body.data;
  const move = (status) => call(staffTasks.updateStaffTaskStatus, STAFF_HN, { params: { id: task.id }, body: { status } });
  assert.equal((await move('IN_PROGRESS')).statusCode, 200);
  assert.equal((await move('DONE')).statusCode, 200);
  const again = await move('IN_PROGRESS');
  assert.equal(again.statusCode, 409);
  assert.equal(again.body.code, 'TASK_CLOSED');
});

test('E5 staff transferred out of the warehouse can no longer work their open task; the manager sees it flagged', async () => {
  const task = (await call(staffTasks.createStaffTask, MANAGER_HN, { body: { ...baseTask, warehouse_id: HN, assignee_user_id: 'staff-hn' } })).body.data;
  scopes['staff-hn'] = { read: [HCM], write: [HCM] }; // moved to HCM
  try {
    const r = await call(staffTasks.updateStaffTaskStatus, STAFF_HN, { params: { id: task.id }, body: { status: 'IN_PROGRESS' } });
    assert.equal(r.statusCode, 403);
    const list = await call(staffTasks.listStaffTasks, MANAGER_HN, { query: {} });
    const row = list.body.data.find((t) => t.id === task.id);
    assert.equal(row.assignee_can_work, false);
  } finally {
    scopes['staff-hn'] = { read: [HN], write: [HN] };
  }
  const list = await call(staffTasks.listStaffTasks, MANAGER_HN, { query: {} });
  assert.equal(list.body.data.find((t) => t.id === task.id).assignee_can_work, true);
});

test('E6 reassignment re-validates the new assignee; closed tasks cannot be reassigned', async () => {
  scopes['staff-hn-2'] = { read: [HN], write: [HN] };
  profiles['staff-hn-2'] = { status: 'ACTIVE', roles: ['WAREHOUSE_STAFF'] };
  const task = (await call(staffTasks.createStaffTask, MANAGER_HN, { body: { ...baseTask, warehouse_id: HN, assignee_user_id: 'staff-hn' } })).body.data;
  const reassign = (assignee) => call(staffTasks.updateStaffTask, MANAGER_HN, { params: { id: task.id }, body: { assignee_user_id: assignee } });
  assert.equal((await reassign('staff-hcm')).body.code, 'ASSIGNEE_OUT_OF_SCOPE');
  const ok = await reassign('staff-hn-2');
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.data.assignee_user_id, 'staff-hn-2');
  assert.ok(db.inventory_audit_logs.some((l) => l.action_name === 'STAFF_TASK_REASSIGNED' && l.entity_id === task.id));
  await call(staffTasks.updateStaffTaskStatus, MANAGER_HN, { params: { id: task.id }, body: { status: 'CANCELLED' } });
  const closed = await reassign('staff-hn');
  assert.equal(closed.statusCode, 409);
  assert.equal(closed.body.code, 'TASK_CLOSED');
});

test('E7 a concurrent change wins: a write based on a stale read is refused (409), never applied', async () => {
  const task = (await call(staffTasks.createStaffTask, MANAGER_HN, { body: { ...baseTask, warehouse_id: HN, assignee_user_id: 'staff-hn' } })).body.data;
  // the manager cancels the task right after the staff member's request read it as OPEN
  hooks.afterRead = (row) => { if (row.id === task.id) row.status = 'CANCELLED'; };
  try {
    const r = await call(staffTasks.updateStaffTaskStatus, STAFF_HN, { params: { id: task.id }, body: { status: 'IN_PROGRESS' } });
    assert.equal(r.statusCode, 409);
    assert.equal(r.body.code, 'TASK_CONCURRENT_UPDATE');
  } finally {
    delete hooks.afterRead;
  }
  assert.equal(db.staff_tasks.find((t) => t.id === task.id).status, 'CANCELLED');
});

test('E8 open-summary and workload count each task once, in the caller\'s scope only', async () => {
  db.staff_tasks.push(
    { id: 'w1', assignee_user_id: 'staff-hn', warehouse_id: HN, status: 'OPEN', due_date: new Date(0), completed_at: null },
    { id: 'w2', assignee_user_id: 'staff-hn', warehouse_id: HN, status: 'IN_PROGRESS', due_date: null, completed_at: null },
    { id: 'w3', assignee_user_id: 'staff-hn', warehouse_id: HCM, status: 'OPEN', due_date: null, completed_at: null },
  );
  const summary = await call(staffTasks.getOpenTaskSummary, MANAGER_HN, { query: { assignee_user_id: 'staff-hn' } });
  assert.equal(summary.statusCode, 200);
  assert.ok(summary.body.data.every((row) => row.warehouse_id === HN), 'HCM tasks stay hidden from a HN manager');
  const workload = await call(staffTasks.getStaffWorkload, MANAGER_HN, { query: { warehouse_id: HN } });
  const mine = workload.body.data.find((row) => row.assignee_user_id === 'staff-hn');
  const openHn = db.staff_tasks.filter((t) => t.assignee_user_id === 'staff-hn' && t.warehouse_id === HN && t.status === 'OPEN').length;
  const progressHn = db.staff_tasks.filter((t) => t.assignee_user_id === 'staff-hn' && t.warehouse_id === HN && t.status === 'IN_PROGRESS').length;
  assert.equal(mine.open, openHn);
  assert.equal(mine.in_progress, progressHn);
  assert.equal(mine.overdue, 1);
  assert.ok(mine.overdue <= mine.open + mine.in_progress, 'overdue is a subset, not double counted');
});

test('E9 the assignee check fails closed when auth-service is down (503, nothing created)', async () => {
  const before = db.staff_tasks.length;
  authDown = true;
  try {
    const r = await call(staffTasks.createStaffTask, { id: 'admin', is_superuser: true, roles: ['ADMIN'] }, { body: { ...baseTask, warehouse_id: HN, assignee_user_id: 'staff-hn' } });
    assert.equal(r.statusCode, 503);
  } finally {
    authDown = false;
  }
  assert.equal(db.staff_tasks.length, before);
});

// ── internal contract used by auth-service ──────────────────────────────────

test('F1 internal warehouse lookup and cache invalidation need the internal key', async () => {
  const express = require('express');
  const cleared = [];
  const app = express();
  app.use('/internal', createInternalWarehousesRouter({ prisma: new FakePrisma(), onScopeChanged: (id) => cleared.push(id), internalKey: () => 'secret' }));
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}/internal`;
    assert.equal((await fetch(`${base}/warehouses?ids=${HN}`)).status, 403);
    const ok = await fetch(`${base}/warehouses?ids=${HN},${HCM}`, { headers: { 'x-internal-service-key': 'secret' } });
    assert.equal(ok.status, 200);
    assert.deepEqual((await ok.json()).data.map((w) => w.code).sort(), ['WH-HCM-01', 'WH-HN-01']);
    assert.equal((await fetch(`${base}/warehouses?ids=nope`, { headers: { 'x-internal-service-key': 'secret' } })).status, 400);
    const inv = await fetch(`${base}/warehouse-scopes/invalidate`, {
      method: 'POST', headers: { 'x-internal-service-key': 'secret', 'content-type': 'application/json' },
      body: JSON.stringify({ user_id: ORDER_HN }),
    });
    assert.equal(inv.status, 204);
    assert.deepEqual(cleared, [ORDER_HN]);
  } finally {
    server.close();
  }
});
