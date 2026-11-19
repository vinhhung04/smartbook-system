// Live check: stock is taken off the shelves the librarian actually picked from.
//
// Reservation: the system holds 2 copies on the fullest shelf (H). The librarian takes
// 1 copy from H and 1 from another shelf (O), and reports that when marking the
// reservation ready. The hold moves to those shelves and the pickup-code loan takes
// one copy off each. Direct loan: the copy comes off the shelf entered on the form.
// Wrong picks are refused and leave every shelf as it was.
//
// Needs a variant held on >= 2 shelves of one warehouse with >= 2 free copies in total
// and >= 2 on the fullest shelf. Pass TEST_VARIANT_ID / TEST_WAREHOUSE_ID, or the script
// probes /api/books for one. When no book is spread over two shelves (the CI demo seed
// keeps each book on one shelf per branch), it spreads one itself the way a librarian
// would: lends a copy from a shelf holding >= 3 and returns it to another shelf of the
// same type in that branch. Run with the gateway rate limit raised, as the other
// borrow scripts do.
import crypto from 'node:crypto';

const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
const jwtSecret = process.env.JWT_SECRET || 'smartbook_shared_jwt_secret';
let variantId = process.env.TEST_VARIANT_ID || '';
let warehouseId = process.env.TEST_WAREHOUSE_ID || '';

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signJwt(payload, secret) {
  const signingInput = `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify(payload))}`;
  const signature = crypto.createHmac('sha256', secret).update(signingInput).digest('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${signingInput}.${signature}`;
}

const token = signJwt({
  id: crypto.randomUUID(),
  email: `pick.itest.${Date.now()}@smartbook.local`,
  full_name: 'Khoa Admin',
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

const idem = () => ({ 'Idempotency-Key': crypto.randomUUID() });
const results = [];
const add = (name, ok, detail) => results.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 160) });

// location_id -> { code, available, held }
async function shelves(reservationId) {
  const query = new URLSearchParams({ variant_id: variantId, warehouse_id: warehouseId, ...(reservationId ? { reservation_id: reservationId } : {}) });
  const res = await request('GET', `/api/borrow-integration/pick-options?${query}`);
  if (!res.ok) throw new Error(`pick-options failed: ${res.status} ${JSON.stringify(res.data)}`);
  return new Map(res.data.data.map((row) => [row.location_id, { code: row.location_code, available: row.available_qty, held: row.held_qty }]));
}

const spreadEnough = (map) => {
  const rows = [...map.values()].filter((row) => row.available > 0).sort((a, b) => b.available - a.available);
  return rows.length >= 2 && rows[0].available >= 2;
};

// No book on two shelves: lend one copy off a shelf holding >= 3 and return it to another
// shelf of the same type in that branch (never a receiving area), through the real loan flow.
async function spreadOntoSecondShelf(candidates, customerId) {
  for (const book of candidates) {
    variantId = book.variant_id;
    warehouseId = book.default_warehouse_id;
    const [sourceId] = [...(await shelves())].filter(([, row]) => row.available >= 3).sort((a, b) => b[1].available - a[1].available)[0] || [];
    if (!sourceId) continue;
    const locations = (await request('GET', `/api/warehouses/${warehouseId}/locations`)).data?.locations || [];
    const source = locations.find((location) => location.id === sourceId);
    const target = locations.find((location) => location.is_active && location.id !== sourceId && source && location.location_type === source.location_type);
    if (!target) continue;
    const lent = await request('POST', '/borrow/loans/direct', {
      customer_id: customerId, variant_id: variantId, warehouse_id: warehouseId, quantity: 1, picks: [{ location_id: sourceId, quantity: 1 }],
    }, idem());
    if (lent.status !== 201) continue;
    const back = await request('POST', `/borrow/loans/${lent.data.data.id}/return`, { returned_to_location_id: target.id }, idem());
    if (!back.ok) throw new Error(`setup return to ${target.location_code} failed: ${back.status} ${JSON.stringify(back.data)}`);
    if (spreadEnough(await shelves())) {
      add(`S0 setup: one copy moved ${source.location_code} -> ${target.location_code} (lend + return)`, true, variantId);
      return;
    }
  }
  throw new Error('No variant with free copies on 2+ shelves of one warehouse, and none could be spread; set TEST_VARIANT_ID/TEST_WAREHOUSE_ID');
}

async function resolveTarget(customerId) {
  if (variantId && warehouseId) return;
  const books = await (await fetch(`${baseUrl}/api/books`, { headers: { Authorization: `Bearer ${token}` } })).json().catch(() => []);
  const candidates = (Array.isArray(books) ? books : []).slice(0, 80).filter((book) => book?.variant_id && book?.default_warehouse_id);
  for (const book of candidates) {
    variantId = book.variant_id;
    warehouseId = book.default_warehouse_id;
    if (spreadEnough(await shelves())) return;
  }
  await spreadOntoSecondShelf(candidates, customerId);
}

async function topUpForDeposit(customerId, copies) {
  const membership = await request('GET', `/borrow/customers/${customerId}/membership/active`);
  const deposit = Number(membership.data?.data?.limits?.deposit_per_item || 0);
  const account = await request('GET', `/borrow/customers/${customerId}/account`);
  let available = Number(account.data?.data?.available_balance || 0);
  while (available < deposit * copies + 50000) {
    const topup = await request('POST', `/borrow/customers/${customerId}/account/topups`, { amount: 100000, method: 'CASH', note: 'pick-location integration top-up' }, idem());
    if (!topup.ok) throw new Error(`top-up failed: ${JSON.stringify(topup.data)}`);
    available = Number(topup.data?.data?.available_balance || 0);
  }
}

async function run() {
  const profile = await request('GET', '/borrow/my/profile');
  const customerId = profile.data?.data?.id;
  if (!customerId) throw new Error(`no customer profile for the test actor: ${JSON.stringify(profile.data)}`);
  await topUpForDeposit(customerId, 3);
  await resolveTarget(customerId);
  const loansToReturn = [];

  const start = await shelves();

  // --- Reservation: picked from two shelves, not where the system held the copies ---
  const created = await request('POST', '/borrow/reservations', {
    customer_id: customerId, variant_id: variantId, warehouse_id: warehouseId, quantity: 2, source_channel: 'COUNTER', notes: 'pick-location integration',
  }, idem());
  const reservationId = created.data?.data?.id;
  add('R1 create reservation of 2 copies', created.ok && reservationId, created.ok ? reservationId : JSON.stringify(created.data));
  if (!reservationId) return;

  const held = await shelves(reservationId);
  const [holdShelfId] = [...held].find(([, row]) => row.held === 2) || [];
  const [otherShelfId] = [...held].find(([locationId, row]) => locationId !== holdShelfId && row.available >= 1) || [];
  add('R2 system holds both copies on one shelf (H)', holdShelfId && otherShelfId, `H=${held.get(holdShelfId)?.code} O=${held.get(otherShelfId)?.code}`);
  if (!holdShelfId || !otherShelfId) return;
  const H = held.get(holdShelfId).code;
  const O = held.get(otherShelfId).code;

  const confirmed = await request('PATCH', `/borrow/reservations/${reservationId}/confirm`, { status: 'CONFIRMED' }, idem());
  add('R3 confirm', confirmed.data?.data?.status === 'CONFIRMED', confirmed.status);

  const noPicks = await request('PATCH', `/borrow/reservations/${reservationId}/confirm`, { status: 'READY_FOR_PICKUP' }, idem());
  add('R4 ready without shelves -> 400', noPicks.status === 400, `${noPicks.status} ${noPicks.data?.message}`);

  const shortPicks = await request('PATCH', `/borrow/reservations/${reservationId}/confirm`, { status: 'READY_FOR_PICKUP', picks: [{ location_id: otherShelfId, quantity: 1 }] }, idem());
  add('R5 ready with 1 of 2 copies -> 400', shortPicks.status === 400, `${shortPicks.status} ${shortPicks.data?.message}`);

  const otherFree = held.get(otherShelfId).available;
  if (otherFree < 2) {
    const tooMany = await request('PATCH', `/borrow/reservations/${reservationId}/confirm`, {
      status: 'READY_FOR_PICKUP', picks: [{ location_id: otherShelfId, quantity: 2 }],
    }, idem());
    const after = await shelves(reservationId);
    add(`R6 ready with 2 copies from ${O} (only ${otherFree} free) -> 409, nothing moved`,
      tooMany.status === 409 && after.get(holdShelfId).held === 2 && after.get(otherShelfId).available === otherFree,
      `${tooMany.status} ${tooMany.data?.message}`);
  }

  const ready = await request('PATCH', `/borrow/reservations/${reservationId}/confirm`, {
    status: 'READY_FOR_PICKUP', picks: [{ location_id: holdShelfId, quantity: 1 }, { location_id: otherShelfId, quantity: 1 }],
  }, idem());
  const pickupCode = ready.data?.data?.pickup_code;
  add(`R7 ready: 1 from ${H} + 1 from ${O}`, ready.ok && ready.data?.data?.status === 'READY_FOR_PICKUP' && pickupCode, ready.ok ? pickupCode : JSON.stringify(ready.data));

  const afterReady = await shelves(reservationId);
  add('R8 hold now 1 on H and 1 on O',
    afterReady.get(holdShelfId).held === 1 && afterReady.get(otherShelfId).held === 1,
    `H held=${afterReady.get(holdShelfId).held} O held=${afterReady.get(otherShelfId).held}`);
  add('R9 free copies: H -1, O -1 versus before the reservation',
    afterReady.get(holdShelfId).available === start.get(holdShelfId).available - 1 && afterReady.get(otherShelfId).available === start.get(otherShelfId).available - 1,
    `H ${start.get(holdShelfId).available}->${afterReady.get(holdShelfId).available}, O ${start.get(otherShelfId).available}->${afterReady.get(otherShelfId).available}`);

  if (pickupCode) {
    const loan = await request('POST', '/borrow/reservations/pickup/convert-to-loan', { pickup_code: pickupCode }, idem());
    add('R10 pickup code -> loan', loan.ok && loan.data?.data?.id, loan.ok ? loan.data.data.loan_number : JSON.stringify(loan.data));
    if (loan.data?.data?.id) loansToReturn.push(loan.data.data.id);
    const afterLoan = await shelves();
    add('R11 after the loan: no hold left, free copies stay H -1, O -1',
      (afterLoan.get(holdShelfId)?.held || 0) === 0 && afterLoan.get(holdShelfId).available === start.get(holdShelfId).available - 1
        && (afterLoan.get(otherShelfId)?.available ?? 0) === start.get(otherShelfId).available - 1,
      `H=${afterLoan.get(holdShelfId)?.available} O=${afterLoan.get(otherShelfId)?.available ?? 0}`);
  }

  // --- Direct loan: the copy comes off the shelf entered on the form ---
  const beforeDirect = await shelves();
  const directShelfId = [...beforeDirect].filter(([, row]) => row.available >= 1).sort((a, b) => a[1].available - b[1].available)[0]?.[0];
  const directShelf = beforeDirect.get(directShelfId);
  const direct = await request('POST', '/borrow/loans/direct', {
    customer_id: customerId, variant_id: variantId, warehouse_id: warehouseId, quantity: 1, picks: [{ location_id: directShelfId, quantity: 1 }],
  }, idem());
  add(`D1 direct loan picked from ${directShelf.code}`, direct.status === 201, direct.status === 201 ? direct.data.data.loan_number : JSON.stringify(direct.data));
  if (direct.data?.data?.id) loansToReturn.push(direct.data.data.id);
  const afterDirect = await shelves();
  const changed = [...beforeDirect].filter(([locationId, row]) => (afterDirect.get(locationId)?.available ?? 0) !== row.available).map(([locationId]) => locationId);
  add('D2 only that shelf lost one free copy', changed.length === 1 && changed[0] === directShelfId
    && (afterDirect.get(directShelfId)?.available ?? 0) === directShelf.available - 1, `changed=${changed.map((locationId) => beforeDirect.get(locationId).code)}`);

  const overPick = await request('POST', '/borrow/loans/direct', {
    customer_id: customerId, variant_id: variantId, warehouse_id: warehouseId, quantity: 1,
    picks: [{ location_id: directShelfId, quantity: 1 }, { location_id: holdShelfId, quantity: 1 }],
  }, idem());
  add('D3 picks totalling 2 for a 1-copy loan -> 400', overPick.status === 400, `${overPick.status} ${overPick.data?.message}`);

  const noShelf = await request('POST', '/borrow/loans/direct', {
    customer_id: customerId, variant_id: variantId, warehouse_id: warehouseId, quantity: 1,
  }, idem());
  add('D5 direct loan without shelves -> 400 (no shelf chosen for the librarian)', noShelf.status === 400, `${noShelf.status} ${noShelf.data?.message}`);

  // --- Return: the librarian says where the copy was put back, any shelf of the branch ---
  const directLoanId = direct.data?.data?.id;
  if (directLoanId) {
    const unplaced = await request('POST', `/borrow/loans/${directLoanId}/return`, {}, idem());
    add('T1 return without a shelf -> 400', unplaced.status === 400 && unplaced.data?.code === 'RETURN_LOCATION_REQUIRED', `${unplaced.status} ${unplaced.data?.message}`);

    const putBackId = directShelfId === holdShelfId ? otherShelfId : holdShelfId;
    const beforeReturn = await shelves();
    const returned = await request('POST', `/borrow/loans/${directLoanId}/return`, { returned_to_location_id: putBackId }, idem());
    const afterReturn = await shelves();
    // A shelf whose last free copy is out on loan has no balance row: count it as 0.
    const freeOn = (map, locationId) => map.get(locationId)?.available ?? 0;
    const putBackCode = putBackId === holdShelfId ? H : O;
    add(`T2 copy lent from ${directShelf.code} put back on ${putBackCode}: only that shelf gains a free copy`,
      returned.ok && freeOn(afterReturn, putBackId) === freeOn(beforeReturn, putBackId) + 1
        && freeOn(afterReturn, directShelfId) === freeOn(beforeReturn, directShelfId),
      `${returned.status} put-back ${freeOn(beforeReturn, putBackId)}->${freeOn(afterReturn, putBackId)}`);
    loansToReturn.splice(loansToReturn.indexOf(directLoanId), 1);
  }

  // Put the other copies back so reruns find the same stock (and the customer is under the loan limit).
  for (const loanId of loansToReturn) {
    const returned = await request('POST', `/borrow/loans/${loanId}/return`, { returned_to_location_id: holdShelfId }, idem());
    add(`C return ${loanId.slice(0, 8)} to ${H}`, returned.ok, returned.status);
  }

  // --- CONFIRMED reservation converted straight to a loan by id: shelves required ---
  const beforeConvert = await shelves();
  const single = await request('POST', '/borrow/reservations', {
    customer_id: customerId, variant_id: variantId, warehouse_id: warehouseId, quantity: 1, source_channel: 'COUNTER', notes: 'pick-location convert',
  }, idem());
  const singleId = single.data?.data?.id;
  await request('PATCH', `/borrow/reservations/${singleId}/confirm`, { status: 'CONFIRMED' }, idem());
  const convertBare = await request('POST', `/borrow/reservations/${singleId}/convert-to-loan`, {}, idem());
  add('V1 convert CONFIRMED by id without shelves -> 400', convertBare.status === 400, `${convertBare.status} ${convertBare.data?.message}`);
  const convert = await request('POST', `/borrow/reservations/${singleId}/convert-to-loan`, { picks: [{ location_id: otherShelfId, quantity: 1 }] }, idem());
  const afterConvert = await shelves();
  const freeAt = (map, locationId) => map.get(locationId)?.available ?? 0;
  add(`V2 convert with the shelf entered (${O}) -> loan, the copy comes off ${O}`,
    convert.status === 201 && freeAt(afterConvert, otherShelfId) === freeAt(beforeConvert, otherShelfId) - 1
      && freeAt(afterConvert, holdShelfId) === freeAt(beforeConvert, holdShelfId),
    `${convert.status} O ${freeAt(beforeConvert, otherShelfId)}->${freeAt(afterConvert, otherShelfId)}`);
  if (convert.data?.data?.id) {
    const back = await request('POST', `/borrow/loans/${convert.data.data.id}/return`, { returned_to_location_id: otherShelfId }, idem());
    add(`C return converted loan to ${O}`, back.ok, back.status);
  }

  // A shelf of this warehouse that holds no free copy of the book (librarian typed the wrong shelf).
  const beforeShort = await shelves();
  const locations = await request('GET', `/api/warehouses/${warehouseId}/locations`);
  const emptyShelf = (locations.data?.locations || []).find((location) => location.is_active && !beforeShort.has(location.id));
  if (emptyShelf) {
    const shortShelf = await request('POST', '/borrow/loans/direct', {
      customer_id: customerId, variant_id: variantId, warehouse_id: warehouseId, quantity: 1, picks: [{ location_id: emptyShelf.id, quantity: 1 }],
    }, idem());
    const afterShort = await shelves();
    const untouched = [...beforeShort].every(([locationId, row]) => (afterShort.get(locationId)?.available ?? 0) === row.available && (afterShort.get(locationId)?.held ?? 0) === 0);
    add(`D4 direct loan picked from ${emptyShelf.location_code} (no copy there) -> 409, hold given back`,
      shortShelf.status === 409 && /không còn đủ/.test(shortShelf.data?.message || '') && untouched, `${shortShelf.status} ${shortShelf.data?.message}`);
  } else {
    add('D4 wrong shelf (skipped: every shelf of the warehouse holds this book)', true, '-');
  }
}

run()
  .catch((error) => add('script error', false, error.message))
  .finally(() => {
    console.table(results);
    const pass = results.filter((row) => row.ok).length;
    console.log(`PASS=${pass} TOTAL=${results.length}`);
    if (pass !== results.length) process.exitCode = 1;
  });
