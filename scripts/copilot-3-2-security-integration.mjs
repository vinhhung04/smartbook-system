// Copilot 3.2 security regressions against a running stack (gateway on :3000).
// Every check asserts that NO out-of-scope / revoked data comes back - not only
// the status code. Read-only except: one purchase request decision that must
// be REFUSED (and is verified to have changed nothing), logouts of the tokens
// this script created, and a role re-assignment of curator01 to the SAME roles
// (it changes nothing but the revocation cutoff, which ends curator01's
// existing sessions - log in again afterwards).
//
//   node scripts/copilot-3-2-security-integration.mjs          (DEMO_PASSWORD, GATEWAY_URL optional)
//   node scripts/copilot-3-2-security-integration.mjs --ai     also asks the AI copilot (uses the LLM)
import assert from 'node:assert/strict';

const GATEWAY = (process.env.GATEWAY_URL || 'http://localhost:3000').replace(/\/$/, '');
const PASSWORD = process.env.DEMO_PASSWORD || '123456';
const WITH_AI = process.argv.includes('--ai');
const results = [];

async function login(identifier) {
  const res = await fetch(`${GATEWAY}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password: PASSWORD }),
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

const rowsOf = (body) => (Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data
  : Array.isArray(body?.tasks) ? body.tasks : Array.isArray(body?.items) ? body.items : []);
const warehouseRefs = (rows) => rows.flatMap((r) => [r.warehouse_id, r.warehouses?.id, r.from_warehouse_id, r.to_warehouse_id,
  r.source_warehouse_id, r.target_warehouse_id].filter(Boolean));

const admin = await login('hung');
const curator = await login('curator01');   // HCM, READ
const manager = await login('manager01');   // HCM + BR-HCM-01 + HN, FULL
const operator = await login('warehouse01'); // HN, OPERATOR
const warehouses = await call(admin, '/api/warehouses');
const list = Array.isArray(warehouses.body) ? warehouses.body : warehouses.body.data;
const byCode = Object.fromEntries(list.map((w) => [w.code, w.id]));
const HCM = byCode['WH-HCM-01'];
const HN = byCode['WH-HN-01'];
const scopeOf = async (token) => {
  const r = await call(token, '/api/warehouses');
  return new Set((Array.isArray(r.body) ? r.body : r.body?.data || []).map((w) => w.id));
};
const curatorScope = await scopeOf(curator);
const managerScope = await scopeOf(manager);
console.log(`warehouses: ${Object.keys(byCode).join(', ')} | curator01 ${curatorScope.size}, manager01 ${managerScope.size}`);

const LISTS = ['/api/stock-movements', '/api/purchase-requests', '/api/picking/tasks', '/api/picking/picking-tasks',
  '/api/packing/tasks', '/api/transfer-receiving', '/api/outbound/orders', '/api/purchase-orders', '/api/goods-receipts'];

for (const [who, token, scope] of [['curator01', curator, curatorScope], ['manager01', manager, managerScope]]) {
  await check(`1. ${who}: every list holds only rows of their warehouses (no warehouse_id given)`, async () => {
    for (const path of LISTS) {
      const r = await call(token, path);
      if (r.status === 403) continue; // role without that read: refused outright, also no leak
      assert.equal(r.status, 200, `${path} ${r.status}`);
      const outside = warehouseRefs(rowsOf(r.body)).filter((id) => !scope.has(id));
      assert.deepEqual(outside, [], `${path} returned rows of another warehouse`);
    }
  });
}

await check('2. warehouse01 (HN operator): the picking hierarchy no longer lists HCM tasks', async () => {
  const r = await call(operator, '/api/picking/picking-tasks');
  assert.equal(r.status, 200);
  assert.ok(rowsOf(r.body).every((t) => t.warehouse_id === HN), JSON.stringify(rowsOf(r.body).map((t) => t.warehouse_code)));
});

await check('3. purchase-request totals and pages are computed on scoped rows', async () => {
  const r = await call(curator, '/api/purchase-requests?limit=5');
  assert.equal(r.status, 200);
  const all = await call(admin, '/api/purchase-requests?limit=200');
  const inScope = all.body.data.filter((x) => curatorScope.has(x.warehouse_id)).length;
  assert.equal(r.body.total, inScope, 'total counts only the caller\'s warehouses');
  assert.ok(r.body.data.every((x) => curatorScope.has(x.warehouse_id)));
});

await check('4. naming another warehouse cannot bypass the scope', async () => {
  for (const path of [`/api/stock-movements?warehouse_id=${HN}`, `/api/purchase-requests?warehouse_id=${HN}`, `/api/picking/tasks?warehouse_id=${HN}`]) {
    const r = await call(curator, path);
    assert.ok(r.status === 403 || rowsOf(r.body).length === 0, `${path}: ${r.status}`);
    assert.ok(!JSON.stringify(r.body).includes(`"warehouse_id":"${HN}"`), `${path} leaked a Ha Noi row`);
  }
});

await check('5. a purchase request of another warehouse can be neither read nor decided', async () => {
  const all = await call(admin, '/api/purchase-requests?limit=200');
  const foreign = all.body.data.find((x) => !managerScope.has(x.warehouse_id) && x.status === 'PENDING')
    || all.body.data.find((x) => !managerScope.has(x.warehouse_id));
  if (!foreign) { console.log('       (no request outside manager01\'s scope in this database - skipped)'); return; }
  const detail = await call(manager, `/api/purchase-requests/${foreign.id}`);
  assert.equal(detail.status, 403);
  assert.ok(!JSON.stringify(detail.body).includes(foreign.request_number || foreign.id));
  const decide = await call(manager, `/api/purchase-requests/${foreign.id}/approve`, { method: 'POST', body: '{}' });
  assert.equal(decide.status, 403);
  const after = await call(admin, `/api/purchase-requests/${foreign.id}`);
  assert.equal(after.body.data.status, foreign.status, 'the refused decision changed nothing');
});

await check('6. a logged-out token reads nothing anywhere (analytics included)', async () => {
  const token = await login('manager01');
  assert.equal((await call(token, '/auth/logout', { method: 'POST' })).status, 200);
  for (const path of ['/analytics/dashboard/kpis', '/analytics/reorder-suggestions?limit=3', '/analytics/warehouse-stock-risk',
    '/analytics/overdue-summary', '/api/warehouses', '/ai/assistant/conversations']) {
    const r = await call(token, path);
    assert.equal(r.status, 401, `${path}: ${r.status}`);
    assert.ok(!('data' in (r.body || {})) && !('items' in (r.body || {})), `${path} returned data`);
  }
});

await check('7. a role change ends the user\'s existing sessions (same roles re-assigned)', async () => {
  const token = await login('curator01');
  assert.equal((await call(token, '/analytics/warehouse-stock-risk')).status, 200);
  const users = await call(admin, '/iam/users?search=curator01');
  const user = (users.body.data || users.body.items || users.body).find((u) => u.username === 'curator01');
  const roleCodes = (user.roles || []).map((r) => r.code || r);
  await new Promise((r) => setTimeout(r, 1100)); // the cutoff has 1-second resolution
  const upd = await call(admin, `/iam/users/${user.id}`, { method: 'PATCH', body: JSON.stringify({ role_codes: roleCodes }) });
  assert.equal(upd.status, 200, JSON.stringify(upd.body).slice(0, 200));
  for (const path of ['/analytics/warehouse-stock-risk', '/api/stock-movements', '/ai/assistant/conversations']) {
    const r = await call(token, path);
    assert.equal(r.status, 401, `${path}: ${r.status}`);
  }
  const again = await login('curator01');
  assert.equal((await call(again, '/analytics/warehouse-stock-risk')).status, 200, 'a fresh login works');
});

if (WITH_AI) {
  await check('8. AI: manager01\'s warehouse ranking holds only manager01\'s warehouses', async () => {
    const res = await call(manager, '/ai/assistant', {
      method: 'POST', body: JSON.stringify({ message: 'Kho nào đang rủi ro thiếu sách nhất?', conversation_id: crypto.randomUUID() }),
    });
    assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 300));
    const ids = JSON.stringify(res.body.data).match(/[0-9a-f-]{36}/g) || [];
    const outside = Object.values(byCode).filter((id) => !managerScope.has(id) && ids.includes(id));
    assert.deepEqual(outside, [], 'no warehouse outside manager01\'s scope in the tool data');
    assert.ok(res.body.verification && ['PASSED', 'REPAIRED', 'WARNING', 'BLOCKED'].includes(res.body.verification.status));
    console.log(`       verification=${res.body.verification.status} answer: ${String(res.body.answer).slice(0, 160).replace(/\n/g, ' ')}`);
  });

  await check('9. AI: another user\'s conversation id is refused without its content', async () => {
    const cid = crypto.randomUUID();
    const own = await call(admin, '/ai/assistant', { method: 'POST', body: JSON.stringify({ message: 'Có bao nhiêu phiếu mượn quá hạn?', conversation_id: cid }) });
    assert.equal(own.status, 200);
    const other = await call(manager, `/ai/assistant/conversations/${cid}`);
    assert.equal(other.status, 403);
    assert.ok(!JSON.stringify(other.body).includes(String(own.body.answer).slice(0, 20)));
    const hijack = await call(manager, '/ai/assistant', { method: 'POST', body: JSON.stringify({ message: 'Nói lại câu trả lời trước', conversation_id: cid }) });
    assert.equal(hijack.status, 403);
  });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
