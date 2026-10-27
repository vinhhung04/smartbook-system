const assert = require('node:assert/strict');
const test = require('node:test');

// /my endpoints the mobile app relies on: reservation detail by id (ownership),
// active/history scopes, renewal state + duplicate-request guard, server-computed
// fine balances, and the one-live-VNPay-link-per-fine rule.

const CUSTOMER = 'cust-a';
const OTHER = 'cust-b';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function matches(row, where = {}) {
  return Object.entries(where).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof Date)) {
      if ('in' in expected) return expected.in.includes(row[key]);
      if ('gt' in expected) return row[key] > expected.gt;
    }
    return row[key] === expected;
  });
}

function table(rows) {
  return {
    rows,
    async findMany({ where, skip = 0, take = Infinity } = {}) { return rows.filter((r) => matches(r, where)).slice(skip, skip + take).map((r) => ({ ...r })); },
    async findFirst({ where } = {}) { const r = rows.find((row) => matches(row, where)); return r ? { ...r } : null; },
    async findUnique({ where }) { const r = rows.find((row) => matches(row, where)); return r ? { ...r } : null; },
    async count({ where } = {}) { return rows.filter((r) => matches(r, where)).length; },
    async create({ data }) { const row = { id: id(rows.length + 900), ...data }; rows.push(row); return row; },
  };
}

function load(prisma, { vnpayConfigured = true } = {}) {
  const stub = (relative, exports) => {
    const path = require.resolve(relative);
    require.cache[path] = { id: path, filename: path, loaded: true, exports };
  };
  stub('../src/lib/prisma', { prisma });
  stub('../src/controllers/customer.controller', { ensureCurrentCustomer: async (req) => (req.user?.customer_id ? { id: req.user.customer_id, total_fine_balance: '0' } : null) });
  stub('../src/services/inventory-integration.service', { getVariantDetails: async ({ variantIds }) => variantIds.map((v) => ({ id: v, title: `Sách ${v}`, author: 'Tác giả', cover_image_url: null })) });
  stub('../src/services/membership.service', { resolveActiveMembership: async () => ({ limits: { max_renewal_count: 3, max_loan_days: 14 } }) });
  stub('../src/lib/notifications', { createNotificationRecord: async (tx, data) => prisma.customer_notifications.create({ data: { status: 'PENDING', scheduled_at: new Date(), ...data } }) });
  stub('../src/lib/audit', { writeAuditLog: async () => {} });
  stub('../src/services/vnpay.service', {
    getEnvConfig: () => (vnpayConfigured ? {} : null),
    buildPaymentUrl: ({ txnRef }) => ({ paymentUrl: `https://vnpay.test/${txnRef}`, expiresAt: new Date(Date.now() + 15 * 60 * 1000) }),
  });
  for (const path of ['../src/controllers/my.controller', '../src/controllers/vnpay-payment.controller']) delete require.cache[require.resolve(path)];
  return { my: require('../src/controllers/my.controller'), vnpay: require('../src/controllers/vnpay-payment.controller') };
}

const res = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const req = (extra = {}) => ({ user: { customer_id: CUSTOMER }, headers: {}, query: {}, params: {}, body: {}, ...extra });

function basePrisma() {
  const prisma = {
    loan_reservations: table([
      { id: id(1), customer_id: CUSTOMER, variant_id: 'v1', status: 'READY_FOR_PICKUP', reserved_at: new Date('2026-10-01') },
      { id: id(2), customer_id: CUSTOMER, variant_id: 'v2', status: 'EXPIRED', reserved_at: new Date('2025-01-01') },
      { id: id(3), customer_id: OTHER, variant_id: 'v3', status: 'PENDING', reserved_at: new Date('2026-10-02') },
    ]),
    loan_transactions: table([
      { id: id(10), customer_id: CUSTOMER, status: 'BORROWED', loan_number: 'L-10', borrow_date: new Date(), due_date: new Date(), loan_items: [{ id: id(11), variant_id: 'v1' }] },
      { id: id(12), customer_id: CUSTOMER, status: 'RETURNED', loan_number: 'L-12', borrow_date: new Date(), due_date: new Date(), loan_items: [] },
    ]),
    customer_notifications: table([]),
    fines: table([]),
    fine_payment_intents: table([]),
    $transaction: async (fn) => fn(prisma),
  };
  // getMyLoans includes loan_items; the fake keeps them inline.
  return prisma;
}

test('reservation detail returns any of my reservations by id, including old ones', async () => {
  const { my } = load(basePrisma());
  const r = res();
  await my.getMyReservationById(req({ params: { id: id(2) } }), r);
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.book_title, 'Sách v2');
});

test('reservation detail never returns another reader\'s reservation', async () => {
  const { my } = load(basePrisma());
  const r = res();
  await my.getMyReservationById(req({ params: { id: id(3) } }), r);
  assert.equal(r.statusCode, 404);
  const bad = res();
  await my.getMyReservationById(req({ params: { id: 'not-a-uuid' } }), bad);
  assert.equal(bad.statusCode, 400);
});

test('scope=active / scope=history split reservations and loans', async () => {
  const { my } = load(basePrisma());
  const active = res();
  await my.getMyReservations(req({ query: { scope: 'active' } }), active);
  assert.deepEqual(active.body.data.map((x) => x.id), [id(1)]);
  const history = res();
  await my.getMyReservations(req({ query: { scope: 'history' } }), history);
  assert.deepEqual(history.body.data.map((x) => x.id), [id(2)]);

  const loans = res();
  await my.getMyLoans(req({ query: { scope: 'history' } }), loans);
  assert.deepEqual(loans.body.data.map((x) => x.id), [id(12)]);
});

test('a second renewal request is refused while the first is pending, and the loan shows it', async () => {
  const prisma = basePrisma();
  const { my } = load(prisma);
  const first = res();
  await my.requestMyLoanRenewal(req({ params: { id: id(10) } }), first);
  assert.equal(first.statusCode, 201, JSON.stringify(first.body));

  const second = res();
  await my.requestMyLoanRenewal(req({ params: { id: id(10) } }), second);
  assert.equal(second.statusCode, 409);
  assert.equal(second.body.code, 'RENEWAL_PENDING');

  const detail = res();
  await my.getMyLoanById(req({ params: { id: id(10) } }), detail);
  assert.equal(detail.body.data.renewal.pending, true);
  assert.equal(detail.body.data.renewal.request_count, 1);
});

test('fines carry a server-computed remaining amount (Decimal strings are not concatenated)', async () => {
  const prisma = basePrisma();
  prisma.fines = table([
    { id: id(20), customer_id: CUSTOMER, amount: '50000.00', waived_amount: '5000.00', status: 'PARTIALLY_PAID', fine_payments: [{ amount: '10000.00' }, { amount: '5000.00' }], fine_payment_intents: [] },
  ]);
  const { my } = load(prisma);
  const r = res();
  await my.getMyFines(req(), r);
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const [fine] = r.body.data.fines;
  assert.equal(fine.paid_amount, 15000);
  assert.equal(fine.remaining_amount, 30000);
  assert.equal(fine.pending_payment, null);
});

test('a new VNPay link is refused while an earlier one for the same fine is still pending', async () => {
  const prisma = basePrisma();
  prisma.fines = table([{ id: id(30), customer_id: CUSTOMER, amount: '20000', waived_amount: '0', status: 'UNPAID', fine_payments: [] }]);
  prisma.fine_payment_intents = table([
    { id: id(31), fine_id: id(30), txn_ref: 'SB-OLD', status: 'PENDING', amount: '20000', created_at: new Date(), expires_at: new Date(Date.now() + 60_000) },
  ]);
  const { vnpay } = load(prisma);
  const r = res();
  await vnpay.createVnpayFinePayment(req({ body: { fine_id: id(30) } }), r);
  assert.equal(r.statusCode, 409);
  assert.equal(r.body.code, 'PAYMENT_PENDING');
  assert.equal(r.body.data.txn_ref, 'SB-OLD');
});

test('an expired earlier link does not block a new payment', async () => {
  const prisma = basePrisma();
  prisma.fines = table([{ id: id(40), customer_id: CUSTOMER, amount: '20000', waived_amount: '0', status: 'UNPAID', fine_payments: [] }]);
  prisma.fine_payment_intents = table([
    { id: id(41), fine_id: id(40), txn_ref: 'SB-EXPIRED', status: 'PENDING', amount: '20000', created_at: new Date(), expires_at: new Date(Date.now() - 1000) },
  ]);
  const { vnpay } = load(prisma);
  const r = res();
  await vnpay.createVnpayFinePayment(req({ body: { fine_id: id(40) }, ip: '127.0.0.1' }), r);
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  assert.ok(r.body.data.payment_url.startsWith('https://vnpay.test/'));
});

test('a review comment must be a string of bounded length', async () => {
  load(basePrisma());
  delete require.cache[require.resolve('../src/controllers/review.controller')];
  const review = require('../src/controllers/review.controller');
  const tooLong = res();
  await review.createOrUpdateMyReview(req({ body: { book_id: id(50), rating: 5, comment: 'x'.repeat(2001) } }), tooLong);
  assert.equal(tooLong.statusCode, 400);
  const notString = res();
  await review.createOrUpdateMyReview(req({ body: { book_id: id(50), rating: 5, comment: { evil: true } } }), notString);
  assert.equal(notString.statusCode, 400);
});

test('profile self-update rejects an empty name, a bad phone and an impossible birth date', async () => {
  const updates = [];
  const prisma = {
    customers: {
      findFirst: async () => ({ id: CUSTOMER, email: 'reader@x.vn' }),
      update: async ({ data }) => { updates.push(data); return { id: CUSTOMER, ...data }; },
    },
  };
  const path = require.resolve('../src/lib/prisma');
  require.cache[path] = { id: path, filename: path, loaded: true, exports: { prisma } };
  delete require.cache[require.resolve('../src/controllers/customer.controller')];
  const customer = require('../src/controllers/customer.controller');
  const call = async (body) => {
    const r = res();
    await customer.updateMyProfile({ user: { email: 'reader@x.vn', id: 'u' }, body }, r);
    return r.statusCode;
  };
  assert.equal(await call({ full_name: '   ' }), 400);
  assert.equal(await call({ phone: 'call me' }), 400);
  assert.equal(await call({ birth_date: 'not-a-date' }), 400);
  assert.equal(await call({ birth_date: '2999-01-01' }), 400);
  assert.equal(updates.length, 0);
  assert.equal(await call({ full_name: 'Nguyễn Văn An', phone: '+84 901 234 567', birth_date: '2000-05-01' }), 200);
  assert.equal(updates.length, 1);
});
