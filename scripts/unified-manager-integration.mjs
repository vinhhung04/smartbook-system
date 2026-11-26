// Unified manager - integration checks against a running stack (docker compose up; demo seed).
// A manager of warehouse AND library work is one account holding MANAGER + LIBRARIAN;
// the warehouse/branch scope (user_warehouse_scopes) decides where. Calls the gateway like a client.
//
//   node scripts/unified-manager-integration.mjs     (DEMO_PASSWORD, GATEWAY_URL optional)
//
// Creates five temporary accounts (um-<timestamp>-a|b|v|l|w) and leaves them INACTIVE without
// scope at the end. Writes are only attempted where they must be refused (read-only scope, fake
// ids), so nothing else is written.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const GATEWAY = (process.env.GATEWAY_URL || 'http://localhost:3000').replace(/\/$/, '');
const PASSWORD = process.env.DEMO_PASSWORD || '123456';
const TEMP_PASSWORD = 'Password123!';
const results = [];

async function call(token, path, init = {}) {
  const res = await fetch(`${GATEWAY}${path}`, {
    ...init, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  let body = null;
  try { body = await res.json(); } catch { /* empty */ }
  return { status: res.status, body };
}
const post = (token, path, body, headers) => call(token, path, { method: 'POST', body: JSON.stringify(body), headers });
const put = (token, path, body) => call(token, path, { method: 'PUT', body: JSON.stringify(body) });
const patch = (token, path, body) => call(token, path, { method: 'PATCH', body: JSON.stringify(body) });

async function login(identifier, password) {
  const res = await post(null, '/auth/login', { identifier, password });
  assert.equal(res.status, 200, `login ${identifier}: ${JSON.stringify(res.body)}`);
  return res.body.token;
}

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

/** Every open loan item the caller can see (borrow-service applies the caller's branch scope). */
async function visibleOpenLoans(token) {
  const loans = [];
  for (const status of ['BORROWED', 'OVERDUE']) {
    for (let page = 1; page <= 40; page += 1) {
      const res = await call(token, `/borrow/loans?status=${status}&page=${page}&pageSize=100`);
      assert.equal(res.status, 200, `loans ${status} p${page}: ${res.status}`);
      loans.push(...res.body.data);
      if (res.body.data.length < 100) break;
    }
  }
  return loans;
}

const hung = await login('hung', PASSWORD);
const warehouses = (await call(hung, '/api/warehouses')).body;
const id = Object.fromEntries(warehouses.map((w) => [w.code, w.id]));
const [WH_HCM, BR_HCM, WH_HN, BR_B] = [id['WH-HCM-01'], id['BR-HCM-01'], id['WH-HN-01'], id['BR-HCM-02']];
assert.ok(WH_HCM && BR_HCM && WH_HN && BR_B, 'seeded warehouses WH-HCM-01, BR-HCM-01, WH-HN-01, BR-HCM-02 are required');

const stamp = `um-${Date.now()}`;
const accounts = {
  a: { roles: ['MANAGER', 'LIBRARIAN'], scopes: [[WH_HCM, 'FULL'], [BR_HCM, 'FULL']] },
  b: { roles: ['MANAGER', 'LIBRARIAN'], scopes: [[WH_HN, 'FULL'], [BR_B, 'FULL']] },
  v: { roles: ['MANAGER', 'LIBRARIAN'], scopes: [[WH_HCM, 'READ'], [BR_HCM, 'READ']] },
  l: { roles: ['LIBRARIAN'], scopes: [[BR_HCM, 'OPERATOR']] },
  w: { roles: ['MANAGER'], scopes: [[WH_HCM, 'FULL']] },
};
const userId = {};
const token = {};

try {
  await check('0. admin creates the five accounts (roles + warehouse/branch scope)', async () => {
    for (const [key, spec] of Object.entries(accounts)) {
      const username = `${stamp}-${key}`;
      const res = await post(hung, '/iam/users', {
        username, full_name: `Unified QA ${key}`, email: `${username}@smartbook.local`, password: TEMP_PASSWORD,
        role_codes: spec.roles, warehouse_scopes: spec.scopes.map(([warehouse_id, access_level]) => ({ warehouse_id, access_level })),
      });
      assert.equal(res.status, 201, `${key}: ${JSON.stringify(res.body)}`);
      userId[key] = res.body.data.id;
      token[key] = await login(username, TEMP_PASSWORD);
    }
  });

  await check('1. one account holds both roles: its permissions are the union, borrow analytics included', async () => {
    const me = (await call(token.a, '/auth/me')).body;
    const user = me.user || me.data || me;
    assert.deepEqual([...user.roles].sort(), ['LIBRARIAN', 'MANAGER']);
    for (const p of ['inventory.stock.read', 'inventory.operation.decide', 'borrow.loans.read', 'borrow.loans.write',
      'analytics.reports.view', 'analytics.borrow.read']) assert.ok(user.permissions.includes(p), p);
  });

  await check('2. unified manager reads warehouse AND library data, only inside its scope', async () => {
    for (const path of ['/api/inventory', '/borrow/loans?pageSize=5', '/analytics/overdue-summary', '/analytics/fine-summary',
      '/analytics/reservation-funnel', `/analytics/borrow-trends?from=2026-10-01&to=2026-10-31&granularity=day`,
      '/analytics/warehouse-stock-risk', '/analytics/late-return-risk?limit=5', '/analytics/reservation-no-show-risk?limit=5']) {
      const res = await call(token.a, path);
      assert.equal(res.status, 200, `${path}: ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
    }
    const loans = await visibleOpenLoans(token.a);
    assert.ok(loans.every((l) => [WH_HCM, BR_HCM].includes(l.warehouse_id)), 'a loan outside HCM/BR-HCM was listed');
    const risk = (await call(token.a, '/analytics/warehouse-stock-risk')).body.data;
    const rows = risk.warehouses || risk.items || risk;
    assert.ok(Array.isArray(rows) && rows.every((r) => [WH_HCM, BR_HCM].includes(r.warehouse_id)), JSON.stringify(rows).slice(0, 200));
  });

  await check('3. naming a branch outside the scope never returns its rows', async () => {
    // the list ignores a client warehouse filter it may not apply: the caller's own scope stays the limit
    const res = await call(token.a, `/borrow/loans?warehouse_id=${BR_B}&pageSize=100`);
    assert.ok(res.status === 403 || (res.status === 200 && res.body.data.every((l) => [WH_HCM, BR_HCM].includes(l.warehouse_id))),
      `${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
  });

  await check('4. reader names in late-return risk belong to loans the caller can see (no other branch)', async () => {
    const visibleItems = new Set((await visibleOpenLoans(token.a)).flatMap((l) => (l.loan_items || []).map((i) => i.id)));
    const items = (await call(token.a, '/analytics/late-return-risk?limit=200')).body.data.items || [];
    const outside = items.filter((i) => !visibleItems.has(i.loan_item_id));
    assert.equal(outside.length, 0, `${outside.length}/${items.length} items outside the scope`);
    const mine = new Set(items.map((i) => i.loan_item_id));
    const other = (await call(token.b, '/analytics/late-return-risk?limit=200')).body.data.items || [];
    assert.ok(other.every((i) => !mine.has(i.loan_item_id)), 'two managers with disjoint scopes share a row');
    console.log(`       (${items.length} rows for HCM, ${other.length} rows for HN)`);
  });

  await check('5. two unified managers asking the same question get their own warehouses only', async () => {
    const ids = async (t) => {
      const data = (await call(t, '/analytics/warehouse-stock-risk')).body.data;
      return new Set((data.warehouses || data.items || data).map((r) => r.warehouse_id));
    };
    const [a, b] = [await ids(token.a), await ids(token.b)];
    assert.ok([...a].every((x) => !b.has(x)), `shared warehouse rows: ${[...a].filter((x) => b.has(x))}`);
  });

  await check('6. manager with one role: inventory and library analytics yes (own scope), circulation desk no', async () => {
    assert.equal((await call(token.w, '/api/inventory')).status, 200);
    for (const path of ['/analytics/overdue-summary', '/analytics/late-return-risk?limit=5',
      `/analytics/borrow-trends?from=2026-10-01&to=2026-10-31&granularity=day`]) {
      const res = await call(token.w, path);
      assert.equal(res.status, 200, path);
      assert.equal(res.body?.meta?.data_scope, 'WAREHOUSE_SCOPED', path);
    }
    assert.equal((await call(token.w, '/borrow/loans?pageSize=5')).status, 403);
  });

  await check('7. librarian only: own branch borrow analytics yes, warehouse inventory and borrow trends no', async () => {
    for (const path of ['/borrow/loans?pageSize=5', '/analytics/overdue-summary', '/analytics/late-return-risk?limit=5']) {
      assert.equal((await call(token.l, path)).status, 200, path);
    }
    assert.equal((await call(token.l, '/api/inventory')).status, 403);
    assert.equal((await call(token.l, `/analytics/borrow-trends?from=2026-10-01&to=2026-10-31&granularity=day`)).status, 403);
  });

  await check('8. read-only scope: reads pass, writes in both domains are refused by the backend', async () => {
    assert.equal((await call(token.v, '/borrow/loans?pageSize=5')).status, 200);
    assert.equal((await call(token.v, '/api/inventory')).status, 200);
    const loan = await post(token.v, '/borrow/loans/direct', {
      customer_id: crypto.randomUUID(), variant_id: crypto.randomUUID(), warehouse_id: BR_HCM, quantity: 1,
      picks: [{ location_id: crypto.randomUUID(), quantity: 1 }], source_channel: 'COUNTER',
    }, { 'Idempotency-Key': crypto.randomUUID() });
    assert.equal(loan.status, 403, JSON.stringify(loan.body));
    assert.equal(loan.body.code, 'WAREHOUSE_ACCESS_DENIED');
    const task = await post(token.v, '/api/staff-tasks', { title: 'UM read-only', warehouse_id: WH_HCM, assignee_user_id: userId.v });
    assert.equal(task.status, 403, JSON.stringify(task.body));
  });

  await check('9. removing the LIBRARIAN role ends the old token; the new one keeps analytics, loses the desk', async () => {
    const res = await patch(hung, `/iam/users/${userId.a}`, { role_codes: ['MANAGER'] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal((await call(token.a, '/analytics/overdue-summary')).status, 401);
    await new Promise((r) => setTimeout(r, 1100)); // tokens-valid-after has 1 s resolution
    token.a = await login(`${stamp}-a`, TEMP_PASSWORD);
    assert.equal((await call(token.a, '/analytics/overdue-summary')).status, 200);
    assert.equal((await call(token.a, '/borrow/loans?pageSize=5')).status, 403);
    assert.equal((await call(token.a, '/api/inventory')).status, 200);
  });

  await check('10. removing a branch from the scope stops its rows (scope cache <= 30 s)', async () => {
    const res = await put(hung, `/iam/users/${userId.l}/warehouse-scopes`, { scopes: [], primary_warehouse_id: null });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    await new Promise((r) => setTimeout(r, 31_000));
    const loans = await call(token.l, '/borrow/loans?pageSize=5');
    assert.ok(loans.status === 401 || (loans.status === 200 && loans.body.data.length === 0), `${loans.status} ${loans.body?.data?.length}`);
    const risk = await call(token.l, '/analytics/late-return-risk?limit=5');
    assert.ok(risk.status === 401 || (risk.status === 200 && (risk.body.data.items || []).length === 0), `${risk.status}`);
  });
} finally {
  // cleanup: the accounts stay (no hard delete), without scope and inactive
  for (const uid of Object.values(userId)) {
    await put(hung, `/iam/users/${uid}/warehouse-scopes`, { scopes: [], primary_warehouse_id: null });
    await patch(hung, `/iam/users/${uid}`, { status: 'INACTIVE' });
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exitCode = failed.length ? 1 : 0;
