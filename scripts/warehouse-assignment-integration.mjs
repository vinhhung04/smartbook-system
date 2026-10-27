// Warehouse staff assignment - integration checks against a running stack
// (docker compose up; demo seed). Calls the gateway like a client would.
// Creates one temporary WAREHOUSE_STAFF account (wsa-<timestamp>) and a few
// staff tasks, and leaves them INACTIVE / CANCELLED at the end.
//
//   node scripts/warehouse-assignment-integration.mjs     (DEMO_PASSWORD, GATEWAY_URL optional)
import assert from 'node:assert/strict';

const GATEWAY = (process.env.GATEWAY_URL || 'http://localhost:3000').replace(/\/$/, '');
const PASSWORD = process.env.DEMO_PASSWORD || '123456';
const results = [];

async function login(identifier, password = PASSWORD) {
  const res = await fetch(`${GATEWAY}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }),
  });
  assert.equal(res.status, 200, `login ${identifier}`);
  return (await res.json()).token;
}

async function call(token, path, init = {}) {
  const res = await fetch(`${GATEWAY}${path}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  let body = null;
  try { body = await res.json(); } catch { /* empty */ }
  return { status: res.status, body };
}
const put = (token, path, body) => call(token, path, { method: 'PUT', body: JSON.stringify(body) });
const post = (token, path, body) => call(token, path, { method: 'POST', body: JSON.stringify(body) });
const patch = (token, path, body) => call(token, path, { method: 'PATCH', body: JSON.stringify(body) });

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok   ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error: error.message });
    console.log(`  FAIL ${name}\n       ${error.message}`);
  }
}

const tokens = Object.fromEntries(await Promise.all(
  ['hung', 'manager01', 'staff01', 'curator01'].map(async (u) => [u, await login(u)]),
));
const warehouses = (await call(tokens.hung, '/api/warehouses')).body;
const byCode = Object.fromEntries(warehouses.map((w) => [w.code, w.id]));
const HCM = byCode['WH-HCM-01'];
const HN = byCode['WH-HN-01'];
const DN = byCode['WH-DN-01'];
const roles = (await call(tokens.hung, '/iam/roles')).body.data;
const staffRole = roles.find((r) => r.code === 'WAREHOUSE_STAFF');
const users = (await call(tokens.hung, '/iam/users')).body.data;
const idOf = (username) => users.find((u) => u.username === username)?.id;
const scopesPath = (id) => `/iam/users/${id}/warehouse-scopes`;

const username = `wsa-${Date.now()}`;
let tempId = null;
let tempToken = null;
const createdTasks = [];

await check('1. admin creates a staff account with its warehouse assignment (HN, primary HN) in one step', async () => {
  const res = await post(tokens.hung, '/iam/users', {
    username, full_name: 'WSA Integration', email: `${username}@smartbook.local`, password: 'Password123!',
    role_ids: [staffRole.id], warehouse_scopes: [{ warehouse_id: HN, access_level: 'OPERATOR' }], primary_warehouse_id: HN,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  tempId = res.body.data.id;
  assert.equal(res.body.data.primary_warehouse_id, HN);
  assert.deepEqual(res.body.data.warehouse_scopes, [{ warehouse_id: HN, access_level: 'OPERATOR' }]);
});

await check('2. creation refuses a primary warehouse outside the scopes (400) and an unknown warehouse (404)', async () => {
  const base = { full_name: 'x', password: 'Password123!', role_ids: [staffRole.id] };
  const a = await post(tokens.hung, '/iam/users', { ...base, username: `${username}-a`, email: `${username}-a@smartbook.local`, warehouse_scopes: [{ warehouse_id: HN, access_level: 'READ' }], primary_warehouse_id: HCM });
  assert.equal(a.status, 400, JSON.stringify(a.body));
  assert.equal(a.body.code, 'PRIMARY_NOT_IN_SCOPE');
  const b = await post(tokens.hung, '/iam/users', { ...base, username: `${username}-b`, email: `${username}-b@smartbook.local`, warehouse_scopes: [{ warehouse_id: '44444444-4444-4444-8444-444444444444', access_level: 'READ' }] });
  assert.equal(b.status, 404, JSON.stringify(b.body));
  assert.equal(b.body.code, 'WAREHOUSE_NOT_FOUND');
  // nothing was created for either
  const after = (await call(tokens.hung, `/iam/users?search=${username}-`)).body.data;
  assert.equal(after.length, 0);
});

await check('3. PUT validates levels and duplicates (400) and requires a decision when the primary is revoked (409)', async () => {
  assert.equal((await put(tokens.hung, scopesPath(tempId), { scopes: [{ warehouse_id: HN, access_level: 'ADMIN' }] })).body.code, 'INVALID_ACCESS_LEVEL');
  assert.equal((await put(tokens.hung, scopesPath(tempId), { scopes: [{ warehouse_id: HN, access_level: 'READ' }, { warehouse_id: HN, access_level: 'FULL' }] })).body.code, 'DUPLICATE_WAREHOUSE');
  const revoke = await put(tokens.hung, scopesPath(tempId), { scopes: [{ warehouse_id: HCM, access_level: 'READ' }] });
  assert.equal(revoke.status, 409, JSON.stringify(revoke.body));
  assert.equal(revoke.body.code, 'PRIMARY_WAREHOUSE_REVOKED');
  const unchanged = (await call(tokens.hung, scopesPath(tempId))).body.data;
  assert.deepEqual(unchanged.scopes.map((s) => s.warehouse_id), [HN], 'a refused PUT changes nothing');
});

await check('4. admin adds HCM as READ; the response lists the change and the audit-friendly diff', async () => {
  const res = await put(tokens.hung, scopesPath(tempId), {
    scopes: [{ warehouse_id: HN, access_level: 'OPERATOR' }, { warehouse_id: HCM, access_level: 'READ' }], primary_warehouse_id: HN,
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.data.added, [{ warehouse_id: HCM, access_level: 'READ' }]);
});

await check('5. nobody edits their own scope (403); staff and librarians cannot assign at all (403)', async () => {
  const self = await put(tokens.hung, scopesPath(idOf('hung')), { scopes: [] });
  assert.equal(self.status, 403, JSON.stringify(self.body));
  assert.equal(self.body.code, 'SELF_ASSIGNMENT_FORBIDDEN');
  assert.equal((await put(tokens.staff01, scopesPath(tempId), { scopes: [] })).status, 403);
  assert.equal((await call(tokens.staff01, `/iam/warehouses/${HN}/staff`)).status, 403);
});

await check('6. a manager assigns only in warehouses they manage, only staff accounts', async () => {
  // manager01 holds FULL on HCM, HN, BR-HCM-01 - not on WH-DN-01
  const outside = await put(tokens.manager01, scopesPath(tempId), {
    scopes: [{ warehouse_id: HN, access_level: 'OPERATOR' }, { warehouse_id: HCM, access_level: 'READ' }, { warehouse_id: DN, access_level: 'READ' }], primary_warehouse_id: HN,
  });
  assert.equal(outside.status, 403, JSON.stringify(outside.body));
  assert.equal(outside.body.code, 'WAREHOUSE_OUT_OF_MANAGER_SCOPE');
  const manager = await put(tokens.manager01, scopesPath(idOf('curator01')), { scopes: [] });
  assert.equal(manager.status, 403, JSON.stringify(manager.body));
  assert.equal(manager.body.code, 'TARGET_NOT_STAFF');
  const listOk = await call(tokens.manager01, `/iam/warehouses/${HN}/staff?assignable=1`);
  assert.equal(listOk.status, 200);
  assert.ok(listOk.body.data.some((u) => u.id === tempId));
  assert.ok(listOk.body.data.every((u) => ['WRITE', 'OPERATOR', 'FULL'].includes(u.access_level) && u.status === 'ACTIVE'));
  assert.equal((await call(tokens.manager01, `/iam/warehouses/${DN}/staff`)).status, 403);
});

await check('7. available tasks: no warehouse_id lists only HN + HCM (read scope); claimable only where WRITE', async () => {
  tempToken = await login(username, 'Password123!');
  const res = await call(tempToken, '/api/my-warehouse-tasks/available');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  for (const task of res.body.data) {
    assert.ok([HN, HCM].includes(task.warehouse_id), `leaked ${task.warehouse_id}`);
    assert.equal(task.claimable, task.warehouse_id === HN, `${task.title} claimable must follow WRITE scope`);
  }
  const other = await call(tempToken, `/api/my-warehouse-tasks/available?warehouse_id=${DN}`);
  assert.equal(other.status, 403, JSON.stringify(other.body));
});

await check('8. claiming an order in a READ-only warehouse is 403 (READ never claims)', async () => {
  const orders = (await call(tokens.hung, `/api/picking/tasks?warehouse_id=${HCM}&limit=5`)).body;
  const list = Array.isArray(orders?.data) ? orders.data : Array.isArray(orders) ? orders : [];
  const order = list.find((o) => o.task_type === 'outbound' || o.outbound_number) || null;
  if (!order) throw new Error('not runnable: no HCM outbound order in this database');
  const res = await call(tempToken, `/api/picking/tasks/outbound/${order.task_id || order.id}/claim-self`, { method: 'POST' });
  assert.equal(res.status, 403, JSON.stringify(res.body));
});

await check('9. staff task: warehouse required; assignee must have WRITE in that warehouse', async () => {
  const base = { title: 'WSA kiểm kệ', task_type: 'CHECK_SHELF', assignee_user_id: tempId };
  assert.equal((await post(tokens.manager01, '/api/staff-tasks', base)).body.code, 'WAREHOUSE_REQUIRED');
  const readOnly = await post(tokens.manager01, '/api/staff-tasks', { ...base, warehouse_id: HCM });
  assert.equal(readOnly.status, 400, JSON.stringify(readOnly.body));
  assert.equal(readOnly.body.code, 'ASSIGNEE_OUT_OF_SCOPE');
  const librarian = await post(tokens.manager01, '/api/staff-tasks', { ...base, warehouse_id: HN, assignee_user_id: idOf('librarian01') });
  assert.equal(librarian.status, 400, JSON.stringify(librarian.body));
  const ok = await post(tokens.manager01, '/api/staff-tasks', { ...base, warehouse_id: HN });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  createdTasks.push(ok.body.data.id);
  assert.equal((await patch(tempToken, `/api/staff-tasks/${ok.body.data.id}/status`, { status: 'IN_PROGRESS' })).status, 200);
});

await check('10. revoking HN (primary moved to HCM): the open task cannot be progressed and is flagged for reassignment', async () => {
  const taskId = createdTasks[0];
  const summary = await call(tokens.manager01, `/api/staff-tasks/open-summary?assignee_user_id=${tempId}`);
  assert.equal(summary.status, 200);
  assert.ok(summary.body.data.some((row) => row.warehouse_id === HN && row.in_progress === 1));
  const res = await put(tokens.hung, scopesPath(tempId), { scopes: [{ warehouse_id: HCM, access_level: 'OPERATOR' }], primary_warehouse_id: HCM });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  // inventory's cached scope was dropped by the invalidation call: effective at once
  const done = await patch(tempToken, `/api/staff-tasks/${taskId}/status`, { status: 'DONE' });
  assert.equal(done.status, 403, JSON.stringify(done.body));
  const list = await call(tokens.manager01, `/api/staff-tasks?warehouse_id=${HN}`);
  const row = list.body.data.find((t) => t.id === taskId);
  assert.equal(row.assignee_can_work, false);
});

await check('11. reassignment re-validates; the new assignee in HN can work it; closed tasks cannot be reassigned', async () => {
  const taskId = createdTasks[0];
  const wrong = await patch(tokens.manager01, `/api/staff-tasks/${taskId}`, { assignee_user_id: idOf('staff01') }); // staff01 is HCM only
  assert.equal(wrong.status, 400, JSON.stringify(wrong.body));
  const ok = await patch(tokens.manager01, `/api/staff-tasks/${taskId}`, { assignee_user_id: idOf('warehouse01') });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.data.status, 'OPEN', 'a reassigned in-progress task starts over');
  assert.equal((await patch(tokens.manager01, `/api/staff-tasks/${taskId}/status`, { status: 'CANCELLED' })).status, 200);
  // manager01 (FULL on HN) would be a valid assignee - the task being closed is what refuses it
  const closed = await patch(tokens.manager01, `/api/staff-tasks/${taskId}`, { assignee_user_id: idOf('manager01') });
  assert.equal(closed.status, 409, JSON.stringify(closed.body));
});

await check('12. workload counts come from staff_tasks of the manager\'s scope only', async () => {
  const res = await call(tokens.manager01, `/api/staff-tasks/workload?warehouse_id=${HN}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  for (const row of res.body.data) assert.ok(row.overdue <= row.open + row.in_progress);
  assert.equal((await call(tokens.manager01, `/api/staff-tasks/workload?warehouse_id=${DN}`)).status, 403);
});

await check('13. locking the account ends its token and its warehouse access', async () => {
  const lock = await patch(tokens.hung, `/iam/users/${tempId}`, { status: 'LOCKED' });
  assert.equal(lock.status, 200, JSON.stringify(lock.body));
  const after = await call(tempToken, '/api/my-warehouse-tasks/available');
  assert.ok([401, 403].includes(after.status), `expected 401/403, got ${after.status}`);
  const assign = await post(tokens.manager01, '/api/staff-tasks', { title: 'WSA locked', warehouse_id: HCM, assignee_user_id: tempId });
  assert.equal(assign.status, 400, JSON.stringify(assign.body));
  assert.equal(assign.body.code, 'ASSIGNEE_INACTIVE');
});

// cleanup: the account stays (no hard delete), without scope and inactive
if (tempId) {
  await put(tokens.hung, scopesPath(tempId), { scopes: [], primary_warehouse_id: null });
  await patch(tokens.hung, `/iam/users/${tempId}`, { status: 'INACTIVE' });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exitCode = failed.length ? 1 : 0;
