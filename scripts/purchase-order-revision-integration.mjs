// P1.1 Purchase Order Revision: end-to-end check through the real gateway.
//
// Covers: requesting a revision only from a revisable PO status; the immediate-apply path
// (requires_supplier_reconfirmation: false); the pending-reconfirmation path where the live PO
// stays untouched until the supplier reconfirms (so a new invoice/GRN posted while a revision is
// pending still checks against the still-current ordered_qty, never the not-yet-effective
// proposed one); reject/cancel; refusing a second revision while one is already pending; and a
// genuine concurrent race — a new supplier invoice vs. the revision's apply, both contending for
// the same purchase_order_items row lock — fired together with Promise.all, same pattern as
// scripts/concurrent-invoice-over-po-integration.mjs.
//
// Usage: node scripts/purchase-order-revision-integration.mjs
const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
const password = process.env.PURCHASE_TEST_PASSWORD || '123456';
const managerName = process.env.PURCHASE_TEST_USERNAME || 'hung';
const supplierName = process.env.SUPPLIER_TEST_USERNAME || 'supplier-sv';

async function request(method, path, token, body) {
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  let payload;
  if (body != null) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: payload });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function ok(method, path, token, body) {
  const result = await request(method, path, token, body);
  if (!result.response.ok) throw new Error(`${method} ${path} -> ${result.response.status} ${JSON.stringify(result.data)}`);
  return result.data;
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

async function getSetup(token) {
  const suppliers = await ok('GET', '/api/suppliers', token);
  const supplier = suppliers.find((row) => row.status === 'ACTIVE') || suppliers[0];
  const warehouses = await ok('GET', '/api/warehouses', token);
  const warehouse = warehouses.find((row) => row.is_active !== false);
  const books = (await ok('GET', '/api/books', token)).filter((row) => row.variant_id);
  let receivingLocation = null;
  const locationsPayload = await ok('GET', `/api/warehouses/${warehouse.id}/locations`, token);
  const locations = locationsPayload.locations || locationsPayload.data || locationsPayload;
  receivingLocation = (Array.isArray(locations) ? locations : []).find((row) => row.location_type === 'RECEIVING')
    || (Array.isArray(locations) ? locations : []).find((row) => row.is_active);
  return { supplier, warehouse, receivingLocation, book: books[0], unitCost: 50000 };
}

async function createPo(M, setup, orderedQty, note) {
  const created = await ok('POST', '/api/purchase-orders', M, {
    supplier_id: setup.supplier.id,
    warehouse_id: setup.warehouse.id,
    expected_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    note,
    items: [{ variant_id: setup.book.variant_id, ordered_qty: orderedQty, unit_cost: setup.unitCost }],
  });
  return created.data.id;
}

/** DRAFT -> PENDING_APPROVAL -> APPROVED. */
async function approvePo(M, poId) {
  await ok('POST', `/api/purchase-orders/${poId}/submit`, M);
  await ok('POST', `/api/purchase-orders/${poId}/approve`, M, { note: 'e2e' });
}

/** APPROVED -> SENT_TO_SUPPLIER -> SUPPLIER_CONFIRMED, one-click accept-all with NO invoice, so
 * invoiced_qty stays 0 and a later revision is free to change ordered_qty either way. */
async function sendAndConfirm(M, poId) {
  await ok('POST', `/api/purchase-orders/${poId}/send-to-supplier`, M);
  await ok('POST', `/api/purchase-orders/${poId}/supplier-confirm`, M, {});
  return (await ok('GET', `/api/purchase-orders/${poId}`, M)).items[0];
}

async function setupSupplierConfirmedPo(M, setup, orderedQty, note) {
  const poId = await createPo(M, setup, orderedQty, note);
  await approvePo(M, poId);
  const item = await sendAndConfirm(M, poId);
  return { poId, item };
}

async function main() {
  const manager = await login(managerName);
  const M = manager.token;
  const setup = await getSetup(M);

  // ── A: a DRAFT PO cannot be revised (revision is for already-dispatched POs) ──
  const draftPoId = await createPo(M, setup, 10, 'E2E revision - draft gate');
  const draftAttempt = await request('POST', `/api/purchase-orders/${draftPoId}/revisions`, M, { reason: 'x', lines: [] });
  check('revision request on a DRAFT PO is rejected', draftAttempt.response.status === 400, `status=${draftAttempt.response.status}`);

  // ── B: immediate-apply path (requires_supplier_reconfirmation: false) ──
  const poB = await setupSupplierConfirmedPo(M, setup, 10, 'E2E revision - immediate apply');
  const revB = await ok('POST', `/api/purchase-orders/${poB.poId}/revisions`, M, {
    reason: 'Khách hàng thỏa thuận giảm số lượng, không cần NCC xác nhận lại',
    requires_supplier_reconfirmation: false,
    lines: [{ purchase_order_item_id: poB.item.id, ordered_qty: 8 }],
  });
  check('revision request created as PENDING_APPROVAL', revB.data.status === 'PENDING_APPROVAL');
  const approvedB = await ok('POST', `/api/purchase-orders/${poB.poId}/revisions/${revB.data.id}/approve`, M, {});
  check('revision without reconfirmation becomes EFFECTIVE on approval', approvedB.data.status === 'EFFECTIVE');
  const poBAfter = await ok('GET', `/api/purchase-orders/${poB.poId}`, M);
  check('live ordered_qty updated to the approved value', poBAfter.items[0].ordered_qty === 8, `got ${poBAfter.items[0].ordered_qty}`);

  // ── C: pending-reconfirmation path — live PO stays untouched until the supplier confirms ──
  const poC = await setupSupplierConfirmedPo(M, setup, 10, 'E2E revision - pending reconfirmation');
  const revC = await ok('POST', `/api/purchase-orders/${poC.poId}/revisions`, M, {
    reason: 'Thương lượng giảm số lượng, cần NCC xác nhận lại',
    lines: [{ purchase_order_item_id: poC.item.id, ordered_qty: 6 }],
  });
  check('revision defaults to requiring supplier reconfirmation', revC.data.requires_supplier_reconfirmation === true);
  const approvedC = await ok('POST', `/api/purchase-orders/${poC.poId}/revisions/${revC.data.id}/approve`, M, {});
  check('approval with reconfirmation moves to PENDING_SUPPLIER_RECONFIRMATION, not EFFECTIVE', approvedC.data.status === 'PENDING_SUPPLIER_RECONFIRMATION');
  const poCPending = await ok('GET', `/api/purchase-orders/${poC.poId}`, M);
  check(
    'cannot receive against a non-effective revision: live ordered_qty is still the old value',
    poCPending.items[0].ordered_qty === 10,
    `got ${poCPending.items[0].ordered_qty}`,
  );
  const confirmedC = await ok('POST', `/api/purchase-orders/${poC.poId}/revisions/${revC.data.id}/supplier-confirm`, M, {});
  check('supplier reconfirmation applies the revision (EFFECTIVE)', confirmedC.data.status === 'EFFECTIVE');
  const poCAfter = await ok('GET', `/api/purchase-orders/${poC.poId}`, M);
  check('live ordered_qty updated only after supplier reconfirmation', poCAfter.items[0].ordered_qty === 6, `got ${poCAfter.items[0].ordered_qty}`);

  // ── D: reject and cancel ──
  const poD = await setupSupplierConfirmedPo(M, setup, 10, 'E2E revision - reject');
  const revD = await ok('POST', `/api/purchase-orders/${poD.poId}/revisions`, M, { reason: 'x', lines: [{ purchase_order_item_id: poD.item.id, ordered_qty: 4 }] });
  const rejectedD = await ok('POST', `/api/purchase-orders/${poD.poId}/revisions/${revD.data.id}/reject`, M, { reason: 'Không đồng ý thay đổi' });
  check('reject sets status REJECTED', rejectedD.data.status === 'REJECTED');
  const poDAfter = await ok('GET', `/api/purchase-orders/${poD.poId}`, M);
  check('rejected revision never touches live ordered_qty', poDAfter.items[0].ordered_qty === 10);

  const poE = await setupSupplierConfirmedPo(M, setup, 10, 'E2E revision - cancel + conflict');
  const revE1 = await ok('POST', `/api/purchase-orders/${poE.poId}/revisions`, M, { reason: 'x', lines: [{ purchase_order_item_id: poE.item.id, ordered_qty: 4 }] });
  const conflictAttempt = await request('POST', `/api/purchase-orders/${poE.poId}/revisions`, M, { reason: 'y', lines: [{ purchase_order_item_id: poE.item.id, ordered_qty: 3 }] });
  check('a second revision cannot be requested while one is already pending', conflictAttempt.response.status === 409, `status=${conflictAttempt.response.status}`);
  const cancelledE = await ok('POST', `/api/purchase-orders/${poE.poId}/revisions/${revE1.data.id}/cancel`, M, {});
  check('cancel sets status CANCELLED', cancelledE.data.status === 'CANCELLED');
  const revE2 = await ok('POST', `/api/purchase-orders/${poE.poId}/revisions`, M, { reason: 'z', lines: [{ purchase_order_item_id: poE.item.id, ordered_qty: 3 }] });
  check('a new revision can be requested once the prior one is cancelled', revE2.data.revision_number === 2, `got ${revE2.data.revision_number}`);

  const historyE = await ok('GET', `/api/purchase-orders/${poE.poId}/revisions`, M);
  check('revision history lists both revisions in order', historyE.data.history.length === 2 && historyE.data.history[0].revision_number === 1);
  check('original snapshot captures the pre-revision ordered_qty', historyE.data.original.lines[0].ordered_qty === 10);

  // ── F: concurrency — a new supplier invoice racing a pending revision's apply ──
  // Both assertInvoiceQtyWithinRemaining (invoice creation) and applyRevision lock the same
  // purchase_order_items row FOR UPDATE, so this is a genuine contested-lock race, not just two
  // independent writes: PO starts at ordered_qty=10, invoiced_qty=0. A revision proposing
  // ordered_qty=8 is approved (PENDING_SUPPLIER_RECONFIRMATION — live ordered_qty still 10, so
  // invoicing up to 10 would otherwise be allowed). At the same instant: the supplier submits a
  // delivery note for 9 units, and SmartBook records the supplier's reconfirmation (applying the
  // revision to 8). Exactly one must win — never both, which would leave invoiced_qty (9) above
  // ordered_qty (8).
  const supplierAccount = await login(supplierName);
  const suppliersForF = await ok('GET', '/api/suppliers', M);
  const supplierF = suppliersForF.find((row) => String(row.email || '').toLowerCase() === String(supplierAccount.user.email || '').toLowerCase());
  const poFId = await createPo(M, { ...setup, supplier: supplierF }, 10, 'E2E revision - concurrency race');
  await approvePo(M, poFId);
  const itemF = await sendAndConfirm(M, poFId);

  const revF = await ok('POST', `/api/purchase-orders/${poFId}/revisions`, M, { reason: 'Giảm vì tồn kho dư', lines: [{ purchase_order_item_id: itemF.id, ordered_qty: 8 }] });
  const approvedF = await ok('POST', `/api/purchase-orders/${poFId}/revisions/${revF.data.id}/approve`, M, {});
  check('F setup: revision pending supplier reconfirmation before the race', approvedF.data.status === 'PENDING_SUPPLIER_RECONFIRMATION');

  const [invoiceResult, confirmResult] = await Promise.all([
    request('POST', `/api/supplier-account/orders/${poFId}/invoices`, supplierAccount.token, {
      delivery_number: `DN-REV-RACE-${Date.now()}`,
      items: [{ purchase_order_item_id: itemF.id, invoiced_qty: 9, unit_cost: setup.unitCost }],
    }),
    request('POST', `/api/purchase-orders/${poFId}/revisions/${revF.data.id}/supplier-confirm`, M, {}),
  ]);
  const succeeded = [invoiceResult, confirmResult].filter((r) => r.response.ok);
  check(
    'concurrent invoice-creation vs revision-apply on the same PO line: exactly one wins, never both',
    succeeded.length === 1,
    `invoiceCreate=${invoiceResult.response.status} revisionConfirm=${confirmResult.response.status}`,
  );

  const poFAfter = await ok('GET', `/api/purchase-orders/${poFId}`, M);
  const docsFAfter = await ok('GET', `/api/purchase-orders/${poFId}/supplier-documents`, M);
  const finalOrdered = poFAfter.items[0].ordered_qty;
  const finalInvoiced = docsFAfter.data.invoices.reduce((sum, inv) => sum + inv.items.reduce((s, line) => s + Number(line.invoiced_qty || 0), 0), 0);
  check(
    'final state is consistent: total invoiced_qty never exceeds ordered_qty',
    finalInvoiced <= finalOrdered,
    `ordered=${finalOrdered} invoiced=${finalInvoiced}`,
  );
  const consistentPairing = (finalOrdered === 10 && finalInvoiced === 9) || (finalOrdered === 8 && finalInvoiced === 0);
  check(
    'final state matches one of the two valid outcomes (invoice won, or revision won) — not a mix of both',
    consistentPairing,
    `ordered=${finalOrdered} invoiced=${finalInvoiced}`,
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
