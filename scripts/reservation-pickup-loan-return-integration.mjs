import crypto from 'node:crypto';

const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
const jwtSecret = process.env.JWT_SECRET || 'smartbook_shared_jwt_secret';
let variantId = process.env.TEST_VARIANT_ID || '';
let warehouseId = process.env.TEST_WAREHOUSE_ID || '';

function b64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signJwt(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = b64url(JSON.stringify(header));
  const encodedPayload = b64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${signingInput}.${signature}`;
}

const testActorId = crypto.randomUUID();
const testActorEmail = `reservation.itest.${Date.now()}@smartbook.local`;

const token = signJwt({
  id: testActorId,
  email: testActorEmail,
  full_name: 'Khoa Admin',
  is_superuser: true,
  permissions: ['borrow.read', 'borrow.write'],
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 4 * 60 * 60,
}, jwtSecret);

function makeHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function request(method, path, body, extraHeaders = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: makeHeaders(extraHeaders),
    body: body == null ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

function idemHeader() {
  return { 'Idempotency-Key': crypto.randomUUID() };
}

async function findStockTarget(minimumQuantity = 1) {
  const response = await fetch(`${baseUrl}/api/books`, { headers: makeHeaders() });
  const books = await response.json().catch(() => []);
  return (Array.isArray(books) ? books : []).find((book) =>
    book?.variant_id &&
    book?.default_warehouse_id &&
    Number(book?.quantity || 0) >= minimumQuantity
  );
}

async function resolveStockTarget() {
  if (variantId && warehouseId) return;
  const candidate = await findStockTarget(2) || await findStockTarget(1);
  if (!candidate) {
    throw new Error('No borrowable variant with available stock found via /api/books');
  }
  variantId = candidate.variant_id;
  warehouseId = candidate.default_warehouse_id;
}

const results = [];
function add(name, ok, detail) {
  results.push({ name, ok, detail });
}

// Seeded demo customer with an active membership and no unpaid fine balance
// (same customer used by scripts/borrow-phase2-integration.mjs).
let customerId = '00000000-0000-0000-0000-000000000809';
let reservationId = null;
let pickupCode = null;
let loanId = null;

const PICKUP_CODE_RE = /^PU-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

async function run() {
  await resolveStockTarget();

  const profile = await request('GET', '/borrow/my/profile');
  if (profile.ok && profile.data?.data?.id) {
    customerId = profile.data.data.id;
  }

  // 1. Create reservation — holds real stock (available_qty -> reserved_qty)
  const reservation = await request(
    'POST',
    '/borrow/reservations',
    {
      customer_id: customerId,
      variant_id: variantId,
      warehouse_id: warehouseId,
      quantity: 1,
      source_channel: 'COUNTER',
      notes: 'reservation pickup/loan/return integration test',
    },
    idemHeader(),
  );
  if (reservation.ok && reservation.data?.data?.id && reservation.data.data.status === 'PENDING') {
    reservationId = reservation.data.data.id;
    add('1.create reservation (PENDING)', true, reservationId);
  } else {
    add('1.create reservation (PENDING)', false, JSON.stringify(reservation.data));
    console.table(results);
    console.log(`PASS=${results.filter((r) => r.ok).length} TOTAL=${results.length}`);
    process.exitCode = 1;
    return;
  }

  // 2. Staff confirms reservation -> CONFIRMED
  const confirmed = await request('PATCH', `/borrow/reservations/${reservationId}/confirm`, { status: 'CONFIRMED' }, idemHeader());
  add('2.confirm -> CONFIRMED', confirmed.ok && confirmed.data?.data?.status === 'CONFIRMED', JSON.stringify(confirmed.data));

  // 3. Staff marks READY_FOR_PICKUP -> pickup code issued
  const ready = await request('PATCH', `/borrow/reservations/${reservationId}/confirm`, { status: 'READY_FOR_PICKUP' }, idemHeader());
  const issuedCode = ready.data?.data?.pickup_code;
  if (ready.ok && ready.data?.data?.status === 'READY_FOR_PICKUP' && PICKUP_CODE_RE.test(issuedCode || '')) {
    pickupCode = issuedCode;
    add('3.mark READY_FOR_PICKUP (pickup code issued)', true, pickupCode);
  } else {
    add('3.mark READY_FOR_PICKUP (pickup code issued)', false, JSON.stringify(ready.data));
  }

  // 4. Direct convert-to-loan by id must be BLOCKED once READY_FOR_PICKUP (pickup code required)
  const directBlocked = await request('POST', `/borrow/reservations/${reservationId}/convert-to-loan`, {}, idemHeader());
  add(
    '4.direct convert-to-loan blocked at READY_FOR_PICKUP',
    directBlocked.status === 409,
    `status=${directBlocked.status} ${JSON.stringify(directBlocked.data)}`,
  );

  // 5. Convert via pickup code using the QR payload format from README ("SMARTBOOK:PICKUP:PU-XXXX-XXXX")
  if (pickupCode) {
    const qrPayload = `SMARTBOOK:PICKUP:${pickupCode}`;
    const converted = await request('POST', '/borrow/reservations/pickup/convert-to-loan', { pickup_code: qrPayload }, idemHeader());
    if (converted.ok && converted.data?.data?.id && converted.data.data.status === 'BORROWED') {
      loanId = converted.data.data.id;
      add('5.convert via pickup QR -> loan BORROWED', true, loanId);
    } else {
      add('5.convert via pickup QR -> loan BORROWED', false, JSON.stringify(converted.data));
    }
  } else {
    add('5.convert via pickup QR -> loan BORROWED', false, 'Skipped: no pickup code issued');
  }

  // 6. Reservation record now reflects usage
  if (reservationId) {
    const afterConvert = await request('GET', `/borrow/reservations/${reservationId}`);
    const flagged = Boolean(afterConvert.data?.data?.pickup_code_used_at);
    const converted = afterConvert.data?.data?.status === 'CONVERTED_TO_LOAN';
    add('6.reservation marked CONVERTED_TO_LOAN + pickup_code_used_at set', flagged && converted, JSON.stringify(afterConvert.data?.data));
  }

  // 7. Re-submitting the same pickup code is idempotent (returns the same loan, no duplicate)
  if (pickupCode && loanId) {
    const replay = await request('POST', '/borrow/reservations/pickup/convert-to-loan', { pickup_code: pickupCode }, idemHeader());
    add('7.reuse pickup code is idempotent (same loan id)', replay.ok && replay.data?.data?.id === loanId, JSON.stringify(replay.data));
  } else {
    add('7.reuse pickup code is idempotent (same loan id)', false, 'Skipped: no loan id from step 5');
  }

  // 8. Unknown pickup code is rejected
  const unknown = await request('POST', '/borrow/reservations/pickup/convert-to-loan', { pickup_code: 'PU-ZZZZ-9999' }, idemHeader());
  add('8.unknown pickup code -> 404', unknown.status === 404, `status=${unknown.status}`);

  // 9. Return the loan -> stock restored, loan RETURNED
  if (loanId) {
    const returned = await request('POST', `/borrow/loans/${loanId}/return`, {}, idemHeader());
    add('9.return loan', returned.ok, JSON.stringify(returned.data));

    const afterReturn = await request('GET', `/borrow/loans/${loanId}`);
    const status = afterReturn.data?.data?.status || afterReturn.data?.status;
    add('10.loan status RETURNED after return', status === 'RETURNED', `status=${status}`);
  } else {
    add('9.return loan', false, 'Skipped: no loan id from step 5');
    add('10.loan status RETURNED after return', false, 'Skipped: no loan id from step 5');
  }

  console.table(results);
  const pass = results.filter((item) => item.ok).length;
  console.log(`PASS=${pass} TOTAL=${results.length}`);
  if (pass !== results.length) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error('Integration script failed:', error);
  process.exit(1);
});
