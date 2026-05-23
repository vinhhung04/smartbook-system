import crypto from 'node:crypto';

const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
const jwtSecret = process.env.JWT_SECRET || 'smartbook_shared_jwt_secret';
const variantId = process.env.TEST_VARIANT_ID || '00000000-0000-0000-0000-000000000902';
const warehouseId = process.env.TEST_WAREHOUSE_ID || '00000000-0000-0000-0000-000000000562';

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
const testActorEmail = `borrow.itest.${Date.now()}@smartbook.local`;

const token = signJwt({
  id: testActorId,
  email: testActorEmail,
  full_name: 'Khoa Admin',
  is_superuser: true,
  permissions: ['borrow.read', 'borrow.write'],
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 4 * 60 * 60,
}, jwtSecret);

function makeHeaders(extra = {}, tokenOverride = token) {
  return {
    Authorization: `Bearer ${tokenOverride}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function request(method, path, body, extraHeaders = {}, tokenOverride = token) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: makeHeaders(extraHeaders, tokenOverride),
    body: body == null ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

const results = [];
function add(name, ok, detail) {
  results.push({ name, ok, detail });
}

let customerId = '00000000-0000-0000-0000-000000000809';
let directLoanId = null;
let reservationLoanId = null;
let firstFine = null;
let secondFine = null;

async function run() {
  const profile = await request('GET', '/borrow/my/profile');
  if (profile.ok && profile.data?.data?.id) {
    customerId = profile.data.data.id;
    add('1.self customer ensure', true, customerId);
  } else {
    add('1.self customer ensure', false, JSON.stringify(profile.data));
  }

  const direct = await request(
    'POST',
    '/borrow/loans/direct',
    {
      customer_id: customerId,
      variant_id: variantId,
      warehouse_id: warehouseId,
      quantity: 1,
      source_channel: 'COUNTER',
      notes: 'direct loan integration test',
    },
    { 'Idempotency-Key': crypto.randomUUID() }
  );
  if (direct.ok) {
    directLoanId = direct.data?.data?.id;
    add('2.direct loan create', true, directLoanId);
  } else {
    add('2.direct loan create', false, JSON.stringify(direct.data));
  }

  const reservation = await request(
    'POST',
    '/borrow/reservations',
    {
      customer_id: customerId,
      variant_id: variantId,
      warehouse_id: warehouseId,
      quantity: 1,
      source_channel: 'WEB',
      notes: 'reservation convert integration test',
    },
    { 'Idempotency-Key': crypto.randomUUID() }
  );
  if (!reservation.ok) {
    add('3.reservation->loan convert', false, `reservation fail: ${JSON.stringify(reservation.data)}`);
  } else {
    const reservationId = reservation.data?.data?.id;
    const converted = await request(
      'POST',
      `/borrow/reservations/${reservationId}/convert-to-loan`,
      {},
      { 'Idempotency-Key': crypto.randomUUID() }
    );
    if (converted.ok) {
      reservationLoanId = converted.data?.data?.id;
      add('3.reservation->loan convert', true, reservationLoanId);
    } else {
      add('3.reservation->loan convert', false, JSON.stringify(converted.data));
    }
  }

  if (directLoanId) {
    const renewReq = await request('POST', `/borrow/my/loans/${directLoanId}/renew-request`, {});
    add('4.renew request', renewReq.ok, JSON.stringify(renewReq.data));

    const renewApprove = await request('POST', `/borrow/loans/${directLoanId}/renewals/review`, {
      decision: 'APPROVE',
      reason: 'integration approve',
    });
    add('5.renew approval', renewApprove.ok, JSON.stringify(renewApprove.data));
  } else {
    add('4.renew request', false, 'Skipped: no direct loan id');
    add('5.renew approval', false, 'Skipped: no direct loan id');
  }

  if (reservationLoanId) {
    const returnNormal = await request('POST', `/borrow/loans/${reservationLoanId}/return`, {}, { 'Idempotency-Key': crypto.randomUUID() });
    add('6.return normal', returnNormal.ok, JSON.stringify(returnNormal.data));
  } else {
    add('6.return normal', false, 'Skipped: no reservation loan id');
  }

  const lostSeedLoan = await request(
    'POST',
    '/borrow/loans/direct',
    {
      customer_id: customerId,
      variant_id: variantId,
      warehouse_id: warehouseId,
      quantity: 1,
      source_channel: 'COUNTER',
      notes: 'lost flow integration test',
    },
    { 'Idempotency-Key': crypto.randomUUID() }
  );
  if (lostSeedLoan.ok) {
    const lostLoanId = lostSeedLoan.data?.data?.id;
    const detail = await request('GET', `/borrow/loans/${lostLoanId}`);
    const itemId = detail.data?.data?.loan_items?.[0]?.id;
    const markLost = itemId
      ? await request('POST', `/borrow/loans/${lostLoanId}/return`, { loan_item_id: itemId, mark_lost: true, item_condition_on_return: 'LOST' }, { 'Idempotency-Key': crypto.randomUUID() })
      : { ok: false, data: { message: 'No loan item found' } };
    add('7.return mark lost', markLost.ok, JSON.stringify(markLost.data));
  } else {
    add('7.return mark lost', false, JSON.stringify(lostSeedLoan.data));
  }

  const damagedActorToken = signJwt({
    id: crypto.randomUUID(),
    email: `borrow.itest.damaged.${Date.now()}@smartbook.local`,
    full_name: 'Damaged Flow Admin',
    is_superuser: true,
    permissions: ['borrow.read', 'borrow.write'],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 4 * 60 * 60,
  }, jwtSecret);

  const damagedProfile = await request('GET', '/borrow/my/profile', undefined, {}, damagedActorToken);
  const damagedCustomerId = damagedProfile.data?.data?.id;

  const damagedSeedLoan = await request(
    'POST',
    '/borrow/loans/direct',
    {
      customer_id: damagedCustomerId,
      variant_id: variantId,
      warehouse_id: warehouseId,
      quantity: 1,
      source_channel: 'COUNTER',
      notes: 'damaged flow integration test',
    },
    { 'Idempotency-Key': crypto.randomUUID() },
    damagedActorToken
  );
  if (damagedSeedLoan.ok) {
    const damagedLoanId = damagedSeedLoan.data?.data?.id;
    const damaged = await request(
      'POST',
      `/borrow/loans/${damagedLoanId}/return`,
      { item_condition_on_return: 'DAMAGED' },
      { 'Idempotency-Key': crypto.randomUUID() },
      damagedActorToken
    );
    add('8.return damaged', damaged.ok, JSON.stringify(damaged.data));
  } else {
    add('8.return damaged', false, JSON.stringify(damagedSeedLoan.data));
  }

  const fines = await request('GET', '/borrow/fines?pageSize=100');
  if (fines.ok) {
    const unpaid = (fines.data?.data || []).filter((item) => Number(item?.summary?.remaining_balance || 0) > 0);
    firstFine = unpaid[0] || null;
    secondFine = unpaid[1] || null;
    add('9.fines list/detail', Boolean(firstFine), firstFine ? firstFine.id : 'No unpaid fine found');
  } else {
    add('9.fines list/detail', false, JSON.stringify(fines.data));
  }

  if (firstFine) {
    const payAmount = Math.min(Number(firstFine.summary.remaining_balance), 1000);
    const pay = await request('POST', `/borrow/fines/${firstFine.id}/payments`, {
      amount: payAmount,
      payment_method: 'CASH',
      note: 'integration payment',
    });
    add('10.fine payment', pay.ok, JSON.stringify(pay.data));
  } else {
    add('10.fine payment', false, 'Skipped: no unpaid fine');
  }

  if (secondFine) {
    const waiveAmount = Math.min(Number(secondFine.summary.remaining_balance), 500);
    const waive = await request('PATCH', `/borrow/fines/${secondFine.id}/waive`, {
      amount: waiveAmount,
      note: 'integration waive',
    });
    add('11.fine waive/reduce', waive.ok, JSON.stringify(waive.data));
  } else {
    add('11.fine waive/reduce', false, 'Skipped: no second unpaid fine');
  }

  const e1 = await request('POST', '/borrow/loans/direct', { customer_id: customerId }, { 'Idempotency-Key': crypto.randomUUID() });
  add('E1.missing required data', e1.status === 400, `status=${e1.status}`);

  const e2 = await request('POST', '/borrow/loans/not-a-uuid/return', {}, { 'Idempotency-Key': crypto.randomUUID() });
  add('E2.invalid loan return', e2.status === 400, `status=${e2.status}`);

  if (reservationLoanId) {
    const e3 = await request('POST', `/borrow/loans/${reservationLoanId}/renewals/review`, {
      decision: 'APPROVE',
      reason: 'expected failure for closed/no pending',
    });
    add('E3.approve renewal closed/no pending', e3.status >= 400, `status=${e3.status}`);
  } else {
    add('E3.approve renewal closed/no pending', false, 'Skipped: no returned reservation loan');
  }

  if (firstFine) {
    const e4 = await request('POST', `/borrow/fines/${firstFine.id}/payments`, {
      amount: Number(firstFine.summary.remaining_balance) + 999,
      payment_method: 'CASH',
    });
    add('E4.overpay fine', e4.status >= 400, `status=${e4.status}`);
  } else {
    add('E4.overpay fine', false, 'Skipped: no unpaid fine');
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
