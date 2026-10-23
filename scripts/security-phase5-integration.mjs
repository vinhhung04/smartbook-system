// Phase 5 security integration checks against a running stack (pnpm demo:seed).
// Calls the gateway like a client would and checks the DATA that comes back,
// not only status codes.
//
//   node scripts/security-phase5-integration.mjs            (DEMO_PASSWORD, GATEWAY_URL optional)
//   node scripts/security-phase5-integration.mjs --redis    also stops Redis for ~70 s (docker) to check
//                                                          the revocation fallback, then starts it again
//
// Users (demo seed): hung = superuser; manager01 = WAREHOUSE_MANAGER with FULL scope on
// WH-HCM-01, BR-HCM-01, WH-HN-01 but NOT BR-HCM-02; curator01 = WAREHOUSE_MANAGER with READ
// on WH-HCM-01 only. Fixtures are created by hung in BR-HCM-02, tagged PHASE5-TEST, and
// closed again at the end. Every refused write is shaped so that, had the guard failed, it
// would hit a validation error instead of changing data.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';

const GATEWAY = (process.env.GATEWAY_URL || 'http://localhost:3000').replace(/\/$/, '');
const PASSWORD = process.env.DEMO_PASSWORD || '123456';
const WITH_REDIS = process.argv.includes('--redis');
const REDIS_CONTAINER = process.env.REDIS_CONTAINER || 'smartbook-system-redis-1';
const TAG = 'PHASE5-TEST';
const results = [];
const cleanup = [];

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
  return { status: res.status, body, headers: res.headers };
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

const rows = (body) => {
  const d = body?.data ?? body;
  if (Array.isArray(d)) return d;
  return d?.drafts || d?.items || body?.drafts || [];
};
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

const tokens = Object.fromEntries(await Promise.all(['hung', 'manager01', 'curator01'].map(async (u) => [u, await login(u)])));
const me = Object.fromEntries(await Promise.all(Object.entries(tokens).map(async ([u, t]) => {
  const r = await call(t, '/auth/me');
  return [u, (r.body?.user || r.body)?.id];
})));
const warehouses = rows((await call(tokens.hung, '/api/warehouses')).body);
const W = Object.fromEntries(warehouses.map((w) => [w.code, w.id]));
const D3 = W['BR-HCM-02'];
const HCM = W['WH-HCM-01'];
assert.ok(D3 && HCM, 'demo warehouses BR-HCM-02 and WH-HCM-01 exist');
const notD3 = (list, field = 'warehouse_id') => list.filter((r) => (r[field] ?? r.warehouse?.id ?? r.warehouses?.id) === D3);

console.log(`users: ${Object.keys(me).join(', ')}; outside manager01's scope: BR-HCM-02`);

// ── 1. forged token ─────────────────────────────────────────────────────────
await check('1. a forged token (superuser claim, wrong secret) gets nothing from any service', async () => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64({ sub: me.hung, id: me.hung, is_superuser: true, roles: ['ADMIN'], iat: Math.floor(Date.now() / 1000) });
  const forged = `${head}.${payload}.${createHmac('sha256', 'not-the-secret').update(`${head}.${payload}`).digest('base64url')}`;
  for (const path of ['/auth/me', '/api/stock-audits', '/borrow/loans?limit=1', '/analytics/warehouse-stock-risk', '/ai/assistant/conversations']) {
    const r = await call(forged, path);
    assert.ok([401, 403].includes(r.status), `${path} -> ${r.status}`);
    assert.equal(rows(r.body).length, 0, `${path} returned rows`);
  }
});

// ── 2. stock audits ─────────────────────────────────────────────────────────
const allAudits = rows((await call(tokens.hung, '/api/stock-audits')).body);
const d3Audit = allAudits.find((a) => a.warehouse_id === D3);
const hcmDraftAudit = allAudits.find((a) => a.warehouse_id === HCM && ['DRAFT', 'IN_PROGRESS'].includes(a.status));

await check('2. stock audits: manager01 lists none of BR-HCM-02, cannot open / approve / cancel one', async () => {
  assert.ok(d3Audit, 'fixture: an audit in BR-HCM-02 (demo seed)');
  const list = rows((await call(tokens.manager01, '/api/stock-audits')).body);
  assert.equal(notD3(list).length, 0, 'BR-HCM-02 audits listed');
  const one = await call(tokens.manager01, `/api/stock-audits/${d3Audit.id}`);
  assert.equal(one.status, 403);
  assert.equal(one.body?.data, undefined, 'audit content returned');
  assert.equal((await call(tokens.manager01, `/api/stock-audits/${d3Audit.id}/approve`, { method: 'PATCH' })).status, 403);
  assert.equal((await call(tokens.manager01, `/api/stock-audits/${d3Audit.id}/cancel`, { method: 'PATCH' })).status, 403);
  assert.equal((await call(tokens.hung, `/api/stock-audits/${d3Audit.id}`)).status, 200, 'superuser control');
});

await check('3. stock audits: a READ-scope manager (curator01) can open an HCM audit but not approve it', async () => {
  assert.ok(hcmDraftAudit, 'fixture: an open audit in WH-HCM-01 (demo seed)');
  assert.equal((await call(tokens.curator01, `/api/stock-audits/${hcmDraftAudit.id}`)).status, 200);
  const r = await call(tokens.curator01, `/api/stock-audits/${hcmDraftAudit.id}/approve`, { method: 'PATCH' });
  assert.equal(r.status, 403, `approve -> ${r.status} ${JSON.stringify(r.body)}`);
  const after = await call(tokens.hung, `/api/stock-audits/${hcmDraftAudit.id}`);
  assert.equal(after.body.data.status, hcmDraftAudit.status, 'status changed');
});

// ── 3. staff tasks ──────────────────────────────────────────────────────────
await check('4. staff tasks: manager01 lists none of BR-HCM-02 and cannot change one', async () => {
  const all = rows((await call(tokens.hung, '/api/staff-tasks?limit=200')).body);
  const d3Task = all.find((t) => t.warehouse_id === D3);
  assert.ok(d3Task, 'fixture: a task in BR-HCM-02 (demo seed)');
  const list = rows((await call(tokens.manager01, '/api/staff-tasks?limit=200')).body);
  assert.equal(notD3(list).length, 0, 'BR-HCM-02 tasks listed');
  const r = await call(tokens.manager01, `/api/staff-tasks/${d3Task.id}`, { method: 'PATCH', body: JSON.stringify({}) });
  assert.equal(r.status, 403);
  const opts = rows((await call(tokens.manager01, '/api/staff-tasks/entity-options?type=PURCHASE_REQUEST')).body);
  assert.ok(Array.isArray(opts));
});

// ── 4. exception reports (fixture) ──────────────────────────────────────────
// a POSTED goods receipt of BR-HCM-02 (also used for the putaway checks and the outbound fixture)
const d3Receipts = rows((await call(tokens.hung, '/api/goods-receipts?status=POSTED&limit=200')).body)
  .filter((r) => r.warehouse_id === D3 && r.status === 'POSTED');
const d3Detail = d3Receipts[0] ? (await call(tokens.hung, `/api/goods-receipts/${d3Receipts[0].id}`)).body : null;
const d3Line = (d3Detail?.data ?? d3Detail)?.items?.find((i) => i.variant_id && i.location_id) || null;
let excId = null;
if (d3Receipts[0]) {
  const created = await call(tokens.hung, '/api/exception-reports', {
    method: 'POST',
    body: JSON.stringify({ warehouse_id: D3, task_type: 'RECEIVING', task_id: d3Receipts[0].id, exception_type: 'OTHER', note: `${TAG} scope check` }),
  });
  excId = created.body?.data?.id || null;
  if (excId) cleanup.push(() => call(tokens.hung, `/api/exception-reports/${excId}/resolve`, { method: 'POST', body: JSON.stringify({ resolution_notes: `${TAG} cleanup` }) }));
}

await check('5. exception reports: manager01 cannot list, open, assign or resolve a BR-HCM-02 report', async () => {
  assert.ok(excId, 'fixture: exception report created in BR-HCM-02');
  const list = rows((await call(tokens.manager01, '/api/exception-reports?limit=200')).body);
  assert.equal(list.filter((r) => r.id === excId).length, 0, 'report listed');
  assert.equal((await call(tokens.manager01, `/api/exception-reports/${excId}`)).status, 403);
  assert.equal((await call(tokens.manager01, `/api/exception-reports/${excId}/assign`, { method: 'PATCH', body: JSON.stringify({ assignee_user_id: me.manager01 }) })).status, 403);
  assert.equal((await call(tokens.manager01, `/api/exception-reports/${excId}/resolve`, { method: 'POST', body: JSON.stringify({}) })).status, 403);
  const after = await call(tokens.hung, `/api/exception-reports/${excId}`);
  assert.equal(after.body.data.status, 'OPEN', 'report changed');
  assert.equal(after.body.data.assigned_to_user_id ?? null, null, 'report assigned');
});

// ── 5. putaway ──────────────────────────────────────────────────────────────
await check('6. putaway: manager01 sees no BR-HCM-02 receipt and cannot open or confirm one', async () => {
  assert.ok(d3Receipts[0], 'fixture: a POSTED receipt in BR-HCM-02 (demo seed)');
  const list = rows((await call(tokens.manager01, '/api/putaway/receipts')).body);
  assert.equal(list.filter((r) => (r.warehouse_id || r.warehouse?.id) === D3).length, 0, 'BR-HCM-02 receipts listed');
  assert.equal((await call(tokens.manager01, `/api/putaway/receipts/${d3Receipts[0].id}`)).status, 403);
  assert.equal((await call(tokens.manager01, `/api/putaway/receipts/${d3Receipts[0].id}/locations`)).status, 403);
  const r = await call(tokens.manager01, `/api/putaway/receipts/${d3Receipts[0].id}/confirm`, {
    method: 'POST', body: JSON.stringify({ allocations: [{ item_id: randomUUID(), putaway_quantity: 0 }] }),
  });
  assert.equal(r.status, 403, `confirm -> ${r.status}`);
});

// ── 6. smart receiving (fixture) ────────────────────────────────────────────
const draft = await call(tokens.hung, '/api/receiving-smart/drafts', {
  method: 'POST',
  body: JSON.stringify({ warehouse_id: D3, supplier_name: TAG, user_id: me.manager01, items: [{ title: `${TAG} item`, quantity: 1 }] }),
});
const draftId = draft.body?.draft_id || null;
if (draftId) cleanup.push(() => call(tokens.hung, `/api/receiving-smart/drafts/${draftId}`, { method: 'DELETE' }));

await check('7. smart receiving: the creator is the caller (a body user_id is ignored)', async () => {
  assert.ok(draftId, 'fixture: draft created');
  assert.equal(draft.body.draft.created_by_user_id, me.hung);
});

await check('8. smart receiving: manager01 cannot list, open, edit, convert or cancel a BR-HCM-02 draft', async () => {
  const list = (await call(tokens.manager01, '/api/receiving-smart/drafts?limit=100')).body?.drafts || [];
  assert.equal(list.filter((d) => d.id === draftId).length, 0, 'draft listed');
  assert.equal((await call(tokens.manager01, `/api/receiving-smart/drafts/${draftId}`)).status, 403);
  assert.equal((await call(tokens.manager01, `/api/receiving-smart/drafts/${draftId}`, { method: 'PUT', body: JSON.stringify({ items: [] }) })).status, 403);
  assert.equal((await call(tokens.manager01, `/api/receiving-smart/drafts/${draftId}/convert`, { method: 'POST', body: JSON.stringify({}) })).status, 403);
  assert.equal((await call(tokens.manager01, `/api/receiving-smart/drafts/${draftId}`, { method: 'DELETE' })).status, 403);
  const after = await call(tokens.hung, `/api/receiving-smart/drafts/${draftId}`);
  assert.equal(after.body.draft.status, 'DRAFT', 'draft changed');
});

// ── 7. order requests (fixture) ─────────────────────────────────────────────
const stock = d3Line;
let outboundId = null;
if (stock) {
  const created = await call(tokens.hung, '/api/order-requests/outbound', {
    method: 'POST',
    body: JSON.stringify({ warehouse_id: D3, outbound_type: 'MANUAL', note: TAG, lines: [{ variant_id: stock.variant_id, quantity: 1, source_location_id: stock.location_id }] }),
  });
  outboundId = created.body?.data?.task_id || created.body?.data?.id || null;
  if (!outboundId) console.log(`       (outbound fixture not created: ${created.status} ${JSON.stringify(created.body).slice(0, 160)})`);
  if (outboundId) cleanup.push(() => call(tokens.hung, `/api/order-requests/outbound/${outboundId}/reject`, { method: 'POST', body: JSON.stringify({ note: `${TAG} cleanup` }) }));
}

await check('9. order requests: manager01\'s approval queue omits BR-HCM-02; approving one is refused', async () => {
  assert.ok(outboundId, 'fixture: outbound request in BR-HCM-02');
  const queue = rows((await call(tokens.manager01, '/api/order-requests?view=approval')).body);
  const rowId = (r) => r.task_id || r.id;
  assert.equal(queue.filter((r) => rowId(r) === outboundId).length, 0, 'request listed');
  const r = await call(tokens.manager01, `/api/order-requests/outbound/${outboundId}/approve`, { method: 'POST', body: JSON.stringify({}) });
  assert.equal(r.status, 403, `approve -> ${r.status}`);
  const hungQueue = rows((await call(tokens.hung, '/api/order-requests?view=approval')).body);
  assert.equal(hungQueue.find((x) => rowId(x) === outboundId)?.status, 'PENDING_APPROVAL', 'request changed (superuser control sees it pending)');
});

// ── 8. legacy /chat and analytics data scope ────────────────────────────────
await check('9b. legacy /ai/chat: a logged-out token is 401 (not answered as anonymous or from cache)', async () => {
  const t = await login('curator01');
  const ask = () => call(t, '/ai/chat', { method: 'POST', body: JSON.stringify({ message: 'Có bao nhiêu đầu sách trong thư viện?' }) });
  const before = await ask();
  assert.equal(before.status, 200);
  await call(t, '/auth/logout', { method: 'POST' });
  const after = await ask(); // same token, same question: the cached answer must not come back
  assert.equal(after.status, 401);
  assert.equal(after.body?.reply, undefined);
});

await check('9c. analytics answers declare whether they are library-wide or warehouse-scoped', async () => {
  const t = tokens.curator01;
  const sys = await call(t, '/analytics/reorder-suggestions?limit=1');
  assert.equal(sys.body?.meta?.data_scope, 'SYSTEM');
  const scoped = await call(t, '/analytics/warehouse-stock-risk');
  assert.equal(scoped.body?.meta?.data_scope, 'WAREHOUSE_SCOPED');
  assert.deepEqual(rows(scoped.body).map((r) => r.warehouse_name), ['Kho HCM Chinh']);
});

// ── 9. Redis unavailable (opt-in) ───────────────────────────────────────────
if (WITH_REDIS) {
  const loggedOut = await login('manager01');
  await call(loggedOut, '/auth/logout', { method: 'POST' });
  assert.equal((await call(loggedOut, '/api/warehouses')).status, 401); // inventory sees the revocation once
  const fresh = await login('manager01');
  await call(fresh, '/api/warehouses');
  execFileSync('docker', ['stop', REDIS_CONTAINER]);
  try {
    await sleep(65000); // past the 60 s window for VALID answers
    await check('10. Redis down: a token logged out before the outage stays refused by auth (and the AI copilot) and by '
      + 'every service that saw it revoked; elsewhere reads are flagged unverified and writes refused', async () => {
      for (const path of ['/auth/me', '/ai/assistant/conversations', '/api/warehouses']) {
        assert.equal((await call(loggedOut, path)).status, 401, path);
      }
      const read = await call(loggedOut, '/analytics/warehouse-stock-risk'); // never saw this token revoked
      assert.ok(read.status === 401 || (read.status === 200 && read.headers.get('x-token-revocation-check') === 'unverified'),
        `analytics read -> ${read.status}`);
      console.log(`       (residual, documented: a service that never saw the revocation answers reads with ${read.status})`);
      assert.equal((await call(loggedOut, '/api/purchase-requests', { method: 'POST', body: JSON.stringify({ warehouse_id: HCM }) })).status, 401);
    });
    await check('11. Redis down: a valid token keeps reads (flagged unverified) but every write is refused', async () => {
      const read = await call(fresh, '/api/warehouses');
      assert.equal(read.status, 200);
      assert.equal(read.headers.get('x-token-revocation-check'), 'unverified');
      const write = await call(fresh, '/api/purchase-requests', { method: 'POST', body: JSON.stringify({ warehouse_id: HCM }) });
      assert.equal(write.status, 503, `write -> ${write.status}`);
      assert.equal(write.body?.code, 'REVOCATION_UNVERIFIED');
    });
    await check('12. Redis down: logout still works and reports the revocation as pending', async () => {
      const t = await call(fresh, '/auth/logout', { method: 'POST' });
      assert.equal(t.status, 200);
      assert.equal(t.body.token_revocation, 'PENDING');
    });
  } finally {
    execFileSync('docker', ['start', REDIS_CONTAINER]);
  }
  await sleep(15000);
  await check('13. Redis back: the logout made during the outage is applied (token refused)', async () => {
    assert.equal((await call(fresh, '/api/warehouses')).status, 401);
    assert.equal((await call(fresh, '/auth/me')).status, 401);
  });
}

for (const fn of cleanup.reverse()) {
  try { await fn(); } catch { /* best effort */ }
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
