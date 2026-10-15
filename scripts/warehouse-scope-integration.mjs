// Warehouse-scope integration checks against a running stack (pnpm demo:seed,
// then `pnpm demo:upgrade` (scripts/reconcile-warehouse-scopes.mjs) on a database seeded before the
// fixed warehouse ids). Calls the gateway like a client would, including
// requests a user tampers with to reach another warehouse.
//
//   node scripts/warehouse-scope-integration.mjs            (DEMO_PASSWORD, GATEWAY_URL optional)
//   node scripts/warehouse-scope-integration.mjs --ai       also asks the AI copilot (uses the LLM)
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
  // /ai/assistant answers carry their own `data` field (tool results): never unwrap those.
  return { status: res.status, body: path.startsWith('/ai/') ? body : body?.data ?? body };
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

const tokens = Object.fromEntries(await Promise.all(
  ['hung', 'manager01', 'curator01', 'warehouse01'].map(async (u) => [u, await login(u)]),
));
const all = await call(tokens.hung, '/api/warehouses');
const byCode = Object.fromEntries(all.body.map((w) => [w.code, w.id]));
const HCM = byCode['WH-HCM-01'];
const HN = byCode['WH-HN-01'];
console.log(`warehouses: ${Object.keys(byCode).join(', ')}`);

await check('1. superuser lists every warehouse', async () => {
  assert.equal(all.status, 200);
  assert.ok(all.body.length >= 4);
});

await check('2. HN operator (warehouse01) lists only Ha Noi and is refused HCM', async () => {
  const list = await call(tokens.warehouse01, '/api/warehouses');
  if (list.status === 403) return; // role without warehouse.read: refused outright, also no leak
  assert.deepEqual(list.body.map((w) => w.code), ['WH-HN-01']);
  assert.equal((await call(tokens.warehouse01, `/api/warehouses/${HCM}/locations`)).status, 403);
});

await check('3. HCM read-only manager (curator01) lists only HCM, detail of HN is 403', async () => {
  const list = await call(tokens.curator01, '/api/warehouses');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.map((w) => w.code), ['WH-HCM-01']);
  assert.equal((await call(tokens.curator01, `/api/warehouses/${HN}`)).status, 403);
  assert.equal((await call(tokens.curator01, `/api/warehouses/${HCM}`)).status, 200);
});

await check('4. READ scope cannot write: curator01 purchase request into HCM is 403 before any validation', async () => {
  const res = await call(tokens.curator01, '/api/purchase-requests', { method: 'POST', body: JSON.stringify({ warehouse_id: HCM }) });
  assert.equal(res.status, 403, JSON.stringify(res.body));
});

await check('5. a write-scoped manager passes the scope guard (reaches validation, nothing created)', async () => {
  const res = await call(tokens.manager01, '/api/purchase-requests', { method: 'POST', body: JSON.stringify({ warehouse_id: HCM }) });
  assert.notEqual(res.status, 403, JSON.stringify(res.body));
  assert.ok(res.status >= 400 && res.status < 500, `expected a validation error, got ${res.status}`);
});

await check('7. tampered request: curator01 names Ha Noi in the query', async () => {
  assert.equal((await call(tokens.curator01, `/api/stock-balances/low-stock?warehouse_id=${HN}`)).status, 403);
  const own = await call(tokens.curator01, '/api/stock-balances/low-stock');
  assert.equal(own.status, 200);
  const rows = Array.isArray(own.body) ? own.body : own.body?.items || [];
  assert.ok(rows.every((r) => r.warehouse_id === HCM), 'low-stock without filter only lists HCM');
});

await check('9. analytics aggregates only cover the caller\'s warehouses', async () => {
  const risk = await call(tokens.curator01, '/analytics/warehouse-stock-risk');
  assert.equal(risk.status, 200);
  assert.deepEqual(risk.body.map((r) => r.warehouse_id), [HCM]);
  assert.equal((await call(tokens.curator01, `/analytics/warehouse-stock-items?warehouseId=${HN}`)).status, 403);
  const suRisk = await call(tokens.hung, '/analytics/warehouse-stock-risk');
  assert.ok(suRisk.body.length >= 4);
});

if (WITH_AI) {
  await check('8. AI copilot answers a question about a warehouse outside the scope without its data', async () => {
    const res = await call(tokens.curator01, '/ai/assistant', {
      method: 'POST', body: JSON.stringify({ message: 'So sánh tình hình tồn kho Hà Nội và HCM bằng biểu đồ.', conversation_id: crypto.randomUUID() }),
    });
    assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 300));
    const data = JSON.stringify(res.body.data);
    assert.ok(!data.includes(HN), 'no Ha Noi warehouse id in the tool data');
    // A name the user (or the model) typed may come back as "unresolved"; what
    // must not come back is any Ha Noi row, figure or chart.
    assert.ok(!JSON.stringify(res.body.visualizations).includes('Kho Ha Noi'), 'no Ha Noi in the charts');
    const rows = Object.values(res.body.data).flatMap((r) => (Array.isArray(r) ? r : r?.ranking || r?.items || []));
    assert.ok(rows.every((r) => !r.warehouse_id || r.warehouse_id === HCM), 'every warehouse row is HCM');
    console.log(`       answer: ${String(res.body.answer).slice(0, 220).replace(/\n/g, ' ')}`);
  });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
