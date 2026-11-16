// P1.1 check: membership borrow limits (max_active_loans) must be enforced by counting BOOKS
// (loan_items), not loan/receipt rows (loan_transactions) or reservation rows. One receipt can
// hold several books, so counting receipts undercounts and lets a customer exceed their plan's
// limit. See countActiveBorrowedItems/countActiveReservedItems in membership.service.js.
//
// Usage: node scripts/borrow-limit-item-count-integration.mjs
import crypto from 'node:crypto';

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

const actorId = crypto.randomUUID();
const token = signJwt({
  id: actorId,
  email: `borrow.limit.itest.${Date.now()}@smartbook.local`,
  full_name: 'Borrow Limit Test Admin',
  is_superuser: true,
  permissions: ['borrow.read', 'borrow.write'],
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 4 * 60 * 60,
}, jwtSecret);

async function request(method, path, body, extraHeaders = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extraHeaders },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}
async function ok(method, path, body, extraHeaders) {
  const result = await request(method, path, body, extraHeaders);
  if (!result.ok) throw new Error(`${method} ${path} -> ${result.status} ${JSON.stringify(result.data)}`);
  return result.data;
}

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, pass: Boolean(condition) });
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${condition || !detail ? '' : ` -- ${detail}`}`);
}

async function findStockTarget(minimumQuantity) {
  const books = await ok('GET', '/api/books');
  const candidates = (Array.isArray(books) ? books : [])
    .filter((b) => b?.variant_id && b?.default_warehouse_id && Number(b?.quantity || 0) >= minimumQuantity)
    .sort((a, b) => Number(b.quantity || 0) - Number(a.quantity || 0));
  if (candidates.length === 0) throw new Error(`No book with >= ${minimumQuantity} in stock`);
  return candidates[0];
}

async function main() {
  // Fresh customer -> default membership plan, so active_loan_count starts at 0 with a known limit.
  const created = await ok('POST', '/borrow/customers', { full_name: `Borrow Limit Test ${Date.now()}` });
  const customerId = created.data.id;
  // Cover any per-item deposit the default plan charges, so deposit funds (not the limit
  // logic under test) are never the reason a borrow request is refused. Only fixed amounts
  // are allowed per top-up, so do it a few times.
  for (let i = 0; i < 4; i += 1) {
    await ok('POST', `/borrow/customers/${customerId}/account/topups`,
      { amount: 200000, method: 'CASH', note: 'borrow-limit-item-count-integration fixture' },
      { 'Idempotency-Key': crypto.randomUUID() });
  }
  const membership = await ok('GET', `/borrow/customers/${customerId}/membership/active`);
  const limit = membership.data.limits.max_active_loans;
  check('fixture: fresh customer has an active membership with a known limit', Number.isInteger(limit) && limit >= 2, `limit=${limit}`);
  check('fixture: fresh customer starts at 0 active loans', membership.data.active_loan_count === 0, String(membership.data.active_loan_count));

  const stock = await findStockTarget(limit + 8);

  // One receipt, 2 books in it.
  const firstLoan = await ok('POST', '/borrow/loans/direct', {
    customer_id: customerId,
    variant_id: stock.variant_id,
    warehouse_id: stock.default_warehouse_id,
    quantity: 2,
  }, { 'Idempotency-Key': crypto.randomUUID() });
  check('first loan: 2 books in a single receipt accepted', Boolean(firstLoan.data?.id));

  const afterFirst = await ok('GET', `/borrow/customers/${customerId}/membership/active`);
  check(
    'membership view counts 2 BOOKS after a single 2-item receipt, not 1 receipt',
    afterFirst.data.active_loan_count === 2,
    `active_loan_count=${afterFirst.data.active_loan_count} (bug would show 1)`,
  );

  // Try to borrow enough more books that 2 (already out) + this request would exceed the limit.
  const overQty = limit - 1; // 2 + (limit-1) = limit+1 > limit
  const overAttempt = await request('POST', '/borrow/loans/direct', {
    customer_id: customerId,
    variant_id: stock.variant_id,
    warehouse_id: stock.default_warehouse_id,
    quantity: overQty,
  }, { 'Idempotency-Key': crypto.randomUUID() });
  check(
    `borrowing ${overQty} more (2 + ${overQty} = ${2 + overQty} > limit ${limit}) is rejected for the membership limit, not allowed or rejected for an unrelated reason`,
    overAttempt.status === 409 && /mượn tối đa/i.test(overAttempt.data?.message || ''),
    `status=${overAttempt.status} body=${JSON.stringify(overAttempt.data)}`,
  );

  // Exactly at the limit (2 + (limit-2) = limit) must still be allowed.
  const exactQty = limit - 2;
  if (exactQty > 0) {
    const exactAttempt = await ok('POST', '/borrow/loans/direct', {
      customer_id: customerId,
      variant_id: stock.variant_id,
      warehouse_id: stock.default_warehouse_id,
      quantity: exactQty,
    }, { 'Idempotency-Key': crypto.randomUUID() });
    check(`borrowing exactly up to the limit (2 + ${exactQty} = ${limit}) is accepted`, Boolean(exactAttempt.data?.id));

    const afterExact = await ok('GET', `/borrow/customers/${customerId}/membership/active`);
    check('membership view now shows active_loan_count == limit', afterExact.data.active_loan_count === limit, String(afterExact.data.active_loan_count));

    const oneMore = await request('POST', '/borrow/loans/direct', {
      customer_id: customerId,
      variant_id: stock.variant_id,
      warehouse_id: stock.default_warehouse_id,
      quantity: 1,
    }, { 'Idempotency-Key': crypto.randomUUID() });
    check('one more book past the exact limit is rejected', oneMore.status === 409, `status=${oneMore.status}`);
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
