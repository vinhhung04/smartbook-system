// P1.1 check: a LIBRARIAN scoped to one branch (user_warehouse_scopes) must only
// read/write loans at that branch, never another one, even by naming it directly.
// Real accounts via a real /auth/login (librarian01 is scoped to BR-HCM-01 in the
// auth seed; manager01/hung are scoped to WH-HCM-01 too, used here only to create
// fixtures). Customer self-service must stay unaffected (no warehouse scope at all).
import crypto from 'node:crypto';
import { createCustomerFixture } from './testing/customer-fixture.mjs';

const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
const password = process.env.PURCHASE_TEST_PASSWORD || '123456';

async function request(method, path, token, body, extraHeaders = {}) {
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extraHeaders };
  let payload;
  if (body != null) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: payload });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}
async function ok(method, path, token, body, extraHeaders) {
  const r = await request(method, path, token, body, extraHeaders);
  if (!r.response.ok) throw new Error(`${method} ${path} -> ${r.response.status} ${JSON.stringify(r.data)}`);
  return r.data;
}
async function login(identifier) {
  const { response, data } = await request('POST', '/auth/login', null, { identifier, password });
  if (!response.ok || !data?.token) throw new Error(`login ${identifier} failed (${response.status}): ${JSON.stringify(data)}`);
  return { token: data.token, user: data.user };
}

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, pass: Boolean(condition) });
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${condition || !detail ? '' : ` -- ${detail}`}`);
}

async function depositPerItem(token, customerId) {
  const r = await request('GET', `/borrow/customers/${customerId}/membership/active`, token);
  return Number(r.data?.data?.limits?.deposit_per_item || 0);
}
async function topUpWallet(token, customerId, needed) {
  let r = await request('GET', `/borrow/customers/${customerId}/account`, token);
  let available = Number(r.data?.data?.available_balance || 0);
  while (available < needed) {
    const topup = await ok('POST', `/borrow/customers/${customerId}/account/topups`, token,
      { amount: 100000, method: 'CASH', note: 'warehouse-scope test top-up' },
      { 'Idempotency-Key': crypto.randomUUID() });
    available = Number(topup.data?.available_balance || 0);
  }
}

async function createLoanAt(hungToken, customerId, variantId, warehouseId) {
  const deposit = await depositPerItem(hungToken, customerId);
  if (deposit > 0) await topUpWallet(hungToken, customerId, deposit);
  const created = await ok('POST', '/borrow/loans/direct', hungToken, {
    customer_id: customerId,
    variant_id: variantId,
    warehouse_id: warehouseId,
    quantity: 1,
    source_channel: 'COUNTER',
    notes: 'warehouse-scope test fixture',
  }, { 'Idempotency-Key': crypto.randomUUID() });
  return created.data.id;
}

async function main() {
  const hung = await login('hung');
  const librarian = await login('librarian01');
  const H = hung.token;
  const L = librarian.token;

  const warehouses = await ok('GET', '/api/warehouses', H);
  const brHcm = warehouses.find((w) => w.code === 'BR-HCM-01');
  const whHcm = warehouses.find((w) => w.code === 'WH-HCM-01');
  check('fixture: BR-HCM-01 and WH-HCM-01 both exist', Boolean(brHcm && whHcm));

  const books = await ok('GET', '/api/books', H);
  const bookAt = async (warehouseId) => {
    for (const book of books) {
      if (!book.variant_id || book.default_warehouse_id !== warehouseId || Number(book.quantity || 0) < 1) continue;
      const available = await request('GET', `/api/borrow-integration/availability?variant_id=${encodeURIComponent(book.variant_id)}&warehouse_id=${encodeURIComponent(warehouseId)}&quantity=1`, H);
      if (available.response.ok) return book;
    }
    return null;
  };
  const bookBr = await bookAt(brHcm.id);
  const bookWh = await bookAt(whHcm.id);
  check('fixture: a borrowable book exists at BR-HCM-01', Boolean(bookBr));
  check('fixture: a borrowable book exists at WH-HCM-01', Boolean(bookWh));

  const customer01 = process.env.SMARTBOOK_TEST_ISOLATED === '1'
    ? await createCustomerFixture({ baseUrl, password, adminToken: H })
    : await login('customer01');
  const profile = await ok('GET', '/borrow/my/profile', customer01.token);
  const customerId = profile.data.id;
  check('fixture: resolved a real, active customer id', Boolean(customerId));

  const loanAtBr = await createLoanAt(H, customerId, bookBr.variant_id, brHcm.id);
  const loanAtWh = await createLoanAt(H, customerId, bookWh.variant_id, whHcm.id);
  check('fixture: loan created at BR-HCM-01 (librarian01 own branch)', Boolean(loanAtBr));
  check('fixture: loan created at WH-HCM-01 (NOT librarian01 branch)', Boolean(loanAtWh));

  // READ: list
  const list = await ok('GET', '/borrow/loans?pageSize=100', L);
  const ids = list.data.map((row) => row.id);
  check('librarian01 sees its own branch loan in the list', ids.includes(loanAtBr));
  check('librarian01 does NOT see the other branch loan in the list', !ids.includes(loanAtWh));

  // READ: detail
  const detailOwn = await request('GET', `/borrow/loans/${loanAtBr}`, L);
  check('librarian01 can GET its own branch loan detail', detailOwn.response.ok, String(detailOwn.response.status));
  const detailOther = await request('GET', `/borrow/loans/${loanAtWh}`, L);
  check('librarian01 is denied GET on the other branch loan detail (403, not 404)', detailOther.response.status === 403 && detailOther.data?.code === 'WAREHOUSE_ACCESS_DENIED', `status=${detailOther.response.status} ${JSON.stringify(detailOther.data)}`);

  // WRITE: create a loan directly in the other branch (even with a valid customer/book)
  const deniedCreate = await request('POST', '/borrow/loans/direct', L, {
    customer_id: customerId,
    variant_id: bookWh.variant_id,
    warehouse_id: whHcm.id,
    quantity: 1,
    source_channel: 'COUNTER',
  }, { 'Idempotency-Key': crypto.randomUUID() });
  check('librarian01 is denied creating a loan in the other branch', deniedCreate.response.status === 403 && deniedCreate.data?.code === 'WAREHOUSE_ACCESS_DENIED', `status=${deniedCreate.response.status}`);

  // WRITE: return in the other branch vs. own branch
  const deniedReturn = await request('POST', `/borrow/loans/${loanAtWh}/return`, L, {}, { 'Idempotency-Key': crypto.randomUUID() });
  check('librarian01 is denied returning a loan in the other branch', deniedReturn.response.status === 403 && deniedReturn.data?.code === 'WAREHOUSE_ACCESS_DENIED', `status=${deniedReturn.response.status}`);
  const allowedReturn = await request('POST', `/borrow/loans/${loanAtBr}/return`, L, {}, { 'Idempotency-Key': crypto.randomUUID() });
  check('librarian01 CAN return a loan in its own branch', allowedReturn.response.ok, `status=${allowedReturn.response.status} ${JSON.stringify(allowedReturn.data)}`);

  // Superuser is never scope-restricted.
  const hungSeesOther = await request('GET', `/borrow/loans/${loanAtWh}`, H);
  check('superuser (hung) can still read the other-branch loan directly', hungSeesOther.response.ok);

  // Customer self-service must be completely unaffected (no warehouse scope at all):
  // customers are never granted user_warehouse_scopes rows, so this must not 403.
  const idemKey = crypto.randomUUID();
  const myReservation = await request('POST', '/borrow/my/reservations', customer01.token, {
    variant_id: bookBr.variant_id,
    warehouse_id: brHcm.id,
    quantity: 1,
  }, { 'Idempotency-Key': idemKey });
  check(
    'customer self-service reservation is unaffected by warehouse scope',
    myReservation.response.ok,
    `status=${myReservation.response.status} ${JSON.stringify(myReservation.data)}`,
  );
  if (myReservation.response.ok) {
    const cancelled = await request('PATCH', `/borrow/my/reservations/${myReservation.data.data.id}/cancel`, customer01.token, {}, { 'Idempotency-Key': crypto.randomUUID() });
    check('customer self-service cancel is unaffected by warehouse scope', cancelled.response.ok, `status=${cancelled.response.status}`);
  }

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
