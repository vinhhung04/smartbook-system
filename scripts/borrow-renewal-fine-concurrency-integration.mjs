import { availableStockFixture } from './testing/stock-fixture.mjs';
// P1.4 + P1.5 concurrency checks (borrow-service):
//   P1.4a - two managers approving the SAME pending renewal request at the same instant
//           must not both succeed (would create two loan_renewals rows and risk exceeding
//           max_renewal_count).
//   P1.4b - two concurrent "request renewal" taps on the same loan must not both create a
//           PENDING request.
//   P1.5  - a payment and a waiver racing on the SAME fine must never together exceed the
//           fine's total amount (recordFinePayment already locks the fine row; waiveFine
//           didn't, before this fix).
//
// The P1.5 fixture (a `fines` row) is inserted directly via SQL rather than driving a full
// borrow -> overdue -> damaged-return pipeline, since that pipeline isn't what's under test.
//
// Usage: node scripts/borrow-renewal-fine-concurrency-integration.mjs
import crypto from 'node:crypto';
import { shelfPicks } from './lib/borrow-shelves.mjs';
import { execFileSync } from 'node:child_process';

const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
const jwtSecret = process.env.JWT_SECRET || 'smartbook_shared_jwt_secret';

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function signJwt(payload, secret) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;
  const signature = crypto.createHmac('sha256', secret).update(signingInput).digest('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${signingInput}.${signature}`;
}
function makeToken(email, fullName) {
  return signJwt({
    id: crypto.randomUUID(),
    email,
    full_name: fullName,
    is_superuser: true,
    permissions: ['borrow.read', 'borrow.write'],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 4 * 60 * 60,
  }, jwtSecret);
}
const managerToken = makeToken(`manager.itest.${Date.now()}@smartbook.local`, 'Renewal Fine Test Manager');
const customerToken = makeToken(`customer.itest.${Date.now()}@smartbook.local`, 'Renewal Fine Test Customer');

async function request(method, path, body, token = managerToken, extraHeaders = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extraHeaders },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}
async function ok(method, path, body, token, extraHeaders) {
  const r = await request(method, path, body, token, extraHeaders);
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

function sql(query) {
  const out = execFileSync('docker', [
    'compose', 'exec', '-T', 'db',
    'psql', '-U', process.env.DB_USER || 'user', '-d', 'borrow_db', '-t', '-A', '-F,', '-c', query,
  ], { cwd: process.cwd(), encoding: 'utf8' });
  return out.trim().split('\n').filter(Boolean).map((line) => line.split(','));
}

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, pass: Boolean(condition) });
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${condition || !detail ? '' : ` -- ${detail}`}`);
}

async function findStockTarget() {
  return availableStockFixture(10);
}

async function main() {
  // ---------- Fixtures shared by P1.4 ----------
  const customerProfile = await ok('GET', '/borrow/my/profile', null, customerToken);
  const customerId = customerProfile.data.id;
  for (let i = 0; i < 4; i += 1) {
    await ok('POST', `/borrow/customers/${customerId}/account/topups`,
      { amount: 200000, method: 'CASH', note: 'renewal-fine-concurrency fixture' }, managerToken,
      { 'Idempotency-Key': crypto.randomUUID() });
  }
  const stock = await findStockTarget();

  // ---------- P1.4a: two managers approving the same PENDING request at once ----------
  const loan1 = await ok('POST', '/borrow/loans/direct', {
    customer_id: customerId, variant_id: stock.variant_id, warehouse_id: stock.default_warehouse_id, quantity: 1,
    picks: await shelfPicks((path) => ok('GET', path, undefined, managerToken), { variantId: stock.variant_id, warehouseId: stock.default_warehouse_id, quantity: 1 }),
  }, managerToken, { 'Idempotency-Key': crypto.randomUUID() });
  await ok('POST', `/borrow/my/loans/${loan1.data.id}/renew-request`, {}, customerToken);

  const [approveA, approveB] = await Promise.all([
    request('POST', `/borrow/loans/${loan1.data.id}/renewals/review`, { decision: 'APPROVE' }, managerToken),
    request('POST', `/borrow/loans/${loan1.data.id}/renewals/review`, { decision: 'APPROVE' }, managerToken),
  ]);
  const approveSucceeded = [approveA, approveB].filter((r) => r.status === 200);
  check(
    'P1.4a: not both concurrent APPROVE reviews of the same request succeed',
    approveSucceeded.length === 1,
    `A=${approveA.status} B=${approveB.status}`,
  );
  const otherResp = approveA.status === 200 ? approveB : approveA;
  check(
    'P1.4a: the losing review gets a clean conflict, not a 500 or a second renewal record',
    otherResp.status === 409,
    `status=${otherResp.status} body=${JSON.stringify(otherResp.data)}`,
  );
  const [[renewalCount]] = sql(`
    SELECT count(*) FROM loan_renewals lr
    JOIN loan_items li ON li.id = lr.loan_item_id
    WHERE li.loan_id = '${loan1.data.id}'`);
  check('P1.4a: exactly one loan_renewals row was created for this loan, not two', Number(renewalCount) === 1, `count=${renewalCount}`);

  // ---------- P1.4b: two concurrent renewal REQUESTS for the same loan ----------
  const loan2 = await ok('POST', '/borrow/loans/direct', {
    customer_id: customerId, variant_id: stock.variant_id, warehouse_id: stock.default_warehouse_id, quantity: 1,
    picks: await shelfPicks((path) => ok('GET', path, undefined, managerToken), { variantId: stock.variant_id, warehouseId: stock.default_warehouse_id, quantity: 1 }),
  }, managerToken, { 'Idempotency-Key': crypto.randomUUID() });
  const [reqA, reqB] = await Promise.all([
    request('POST', `/borrow/my/loans/${loan2.data.id}/renew-request`, {}, customerToken),
    request('POST', `/borrow/my/loans/${loan2.data.id}/renew-request`, {}, customerToken),
  ]);
  const requestSucceeded = [reqA, reqB].filter((r) => r.status === 201);
  check(
    'P1.4b: not both concurrent renewal requests for the same loan succeed',
    requestSucceeded.length === 1,
    `A=${reqA.status} B=${reqB.status}`,
  );
  const [[pendingCount]] = sql(`
    SELECT count(*) FROM customer_notifications
    WHERE template_code = 'LOAN_RENEWAL_REQUEST' AND reference_id = '${loan2.data.id}' AND status = 'PENDING'`);
  check('P1.4b: exactly one PENDING renewal request row exists for this loan', Number(pendingCount) === 1, `count=${pendingCount}`);

  // ---------- P1.5: concurrent payment + waiver on the same fine ----------
  const fineId = crypto.randomUUID();
  sql(`INSERT INTO fines (id, customer_id, fine_type, amount, status) VALUES ('${fineId}', '${customerId}', 'LATE_RETURN', 100000, 'UNPAID')`);

  const [payResp, waiveResp] = await Promise.all([
    request('POST', `/borrow/fines/${fineId}/payments`, { amount: 80000, payment_method: 'CASH' }, managerToken),
    request('PATCH', `/borrow/fines/${fineId}/waive`, { amount: 50000 }, managerToken),
  ]);
  const financialSucceeded = [payResp, waiveResp].filter((r) => r.ok);
  check(
    'P1.5: not both an 80k payment and a 50k waiver succeed on a 100k fine (80k+50k > 100k)',
    financialSucceeded.length === 1,
    `payment=${payResp.status} waiver=${waiveResp.status}`,
  );
  const [[finePaid], [fineWaived], [fineAmount]] = [
    sql(`SELECT COALESCE(SUM(amount),0) FROM fine_payments WHERE fine_id = '${fineId}'`)[0],
    sql(`SELECT waived_amount FROM fines WHERE id = '${fineId}'`)[0],
    sql(`SELECT amount FROM fines WHERE id = '${fineId}'`)[0],
  ].map((r) => [r]);
  const totalProcessed = Number(finePaid) + Number(fineWaived);
  check(
    'P1.5: paid + waived never exceeds the fine amount, even with the race',
    totalProcessed <= Number(fineAmount) + 0.0001,
    `paid=${finePaid} waived=${fineWaived} amount=${fineAmount} total=${totalProcessed}`,
  );

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log('FAILED:', failed.map((r) => r.name).join('; '));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('Script error:', error);
  process.exitCode = 1;
});
