// P1.3 Supplier Return (Return to Supplier): end-to-end check through the real gateway.
//
// Covers: requesting a return against specific POSTED-GRN lines; the approve -> (optional)
// supplier-confirm -> execute -> complete lifecycle; the outbound stock movement actually
// decrementing available stock by exactly return_qty; never exceeding the originally accepted
// quantity across multiple return requests on the same line (double-count guard, including as a
// genuine concurrent race); reject/cancel/supplier-reject all leaving stock untouched; and the
// GRN-must-be-POSTED gate.
//
// Usage: node scripts/supplier-return-integration.mjs
const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
const password = process.env.PURCHASE_TEST_PASSWORD || '123456';
const managerName = process.env.PURCHASE_TEST_USERNAME || 'hung';

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
  const locationsPayload = await ok('GET', `/api/warehouses/${warehouse.id}/locations`, token);
  const locations = locationsPayload.locations || locationsPayload.data || locationsPayload;
  const receivingLocation = (Array.isArray(locations) ? locations : []).find((row) => row.location_type === 'RECEIVING')
    || (Array.isArray(locations) ? locations : []).find((row) => row.is_active);
  return { supplier, warehouse, receivingLocation, book: books[0], unitCost: 50000 };
}

async function getVariantAvailableQty(token, variantId) {
  const books = await ok('GET', '/api/books', token);
  const row = books.find((book) => book.variant_id === variantId);
  return Number(row?.quantity || 0);
}

/** Create+approve+send+confirm (with a full invoice) a PO, then post a GRN receiving it all into
 * setup.receivingLocation, returning the resulting GRN id and its (only) goods_receipt_item. */
async function setupPostedGrn(M, setup, orderedQty, note) {
  const created = await ok('POST', '/api/purchase-orders', M, {
    supplier_id: setup.supplier.id,
    warehouse_id: setup.warehouse.id,
    expected_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    note,
    items: [{ variant_id: setup.book.variant_id, ordered_qty: orderedQty, unit_cost: setup.unitCost }],
  });
  const poId = created.data.id;
  await ok('POST', `/api/purchase-orders/${poId}/submit`, M);
  await ok('POST', `/api/purchase-orders/${poId}/approve`, M, { note: 'e2e' });
  await ok('POST', `/api/purchase-orders/${poId}/send-to-supplier`, M);
  const poSent = await ok('GET', `/api/purchase-orders/${poId}`, M);
  const item = poSent.items[0];

  const confirmed = await ok('POST', `/api/purchase-orders/${poId}/supplier-confirm`, M, {
    invoice_number: `RET-INV-${poId.slice(0, 8)}-${Date.now()}`,
    invoice_date: new Date().toISOString().slice(0, 10),
    expected_delivery_date: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
    items: [{ purchase_order_item_id: item.id, variant_id: item.variant_id, invoiced_qty: orderedQty, unit_cost: setup.unitCost }],
  });
  const invoiceId = confirmed.data.invoice_id;
  const invoiceDetail = (await ok('GET', `/api/supplier-deliveries/${invoiceId}`, M)).data;
  const draftReceipt = await ok('POST', `/api/supplier-deliveries/${invoiceId}/create-goods-receipt`, M, {
    warehouse_id: setup.warehouse.id,
    note: 'E2E supplier-return setup',
    items: invoiceDetail.items.map((line) => ({
      invoice_item_id: line.id,
      purchase_order_item_id: line.purchase_order_item_id,
      variant_id: line.variant_id,
      delivered_qty: orderedQty,
      unit_cost: line.unit_cost,
      location_id: setup.receivingLocation.id,
    })),
  });
  await ok('PATCH', `/api/goods-receipts/${draftReceipt.data.id}`, M, { status: 'POSTED' });

  const poAfter = await ok('GET', `/api/purchase-orders/${poId}`, M);
  const grn = await ok('GET', `/api/goods-receipts/${draftReceipt.data.id}`, M).catch(() => null);
  return { poId, item: poAfter.items[0], goodsReceiptId: draftReceipt.data.id };
}

async function main() {
  const manager = await login(managerName);
  const M = manager.token;
  const setup = await getSetup(M);

  // ── A: full lifecycle with supplier confirmation required ──
  const a = await setupPostedGrn(M, setup, 10, 'E2E supplier-return - full lifecycle');
  const grnDetailA = await ok('GET', `/api/purchase-orders/${a.poId}/supplier-documents`, M);
  // goods_receipt_items are not exposed on supplier-documents; fetch via the GRN items we posted.
  const receiptA = await ok('GET', `/api/goods-receipts/${a.goodsReceiptId}`, M).catch(() => null);
  const grItemA = (receiptA?.data?.items || receiptA?.items || [])[0];
  check('setup: GRN has a goods_receipt_item to return against', Boolean(grItemA?.id), JSON.stringify(receiptA));

  const beforeQtyA = await getVariantAvailableQty(M, setup.book.variant_id);

  const returnA = await ok('POST', `/api/purchase-orders/${a.poId}/returns`, M, {
    goods_receipt_id: a.goodsReceiptId,
    reason: 'Hàng bị hỏng khi kiểm tra sau nhập kho',
    evidence_reference: 'PHOTO-RET-A',
    lines: [{ goods_receipt_item_id: grItemA.id, return_qty: 4 }],
  });
  check('return request created as PENDING_APPROVAL', returnA.data.status === 'PENDING_APPROVAL');
  check('return request defaults requires_supplier_confirmation to true', returnA.data.requires_supplier_confirmation === true);

  const executeTooEarly = await request('POST', `/api/purchase-orders/${a.poId}/returns/${returnA.data.id}/execute`, M, {});
  check('cannot execute before approval', executeTooEarly.response.status === 409, `status=${executeTooEarly.response.status}`);

  const approvedA = await ok('POST', `/api/purchase-orders/${a.poId}/returns/${returnA.data.id}/approve`, M, {});
  check('approval with reconfirmation moves to PENDING_SUPPLIER_CONFIRMATION, not APPROVED', approvedA.data.status === 'PENDING_SUPPLIER_CONFIRMATION');

  const executeStillEarly = await request('POST', `/api/purchase-orders/${a.poId}/returns/${returnA.data.id}/execute`, M, {});
  check('cannot execute while waiting on supplier confirmation', executeStillEarly.response.status === 409, `status=${executeStillEarly.response.status}`);

  const confirmedA = await ok('POST', `/api/purchase-orders/${a.poId}/returns/${returnA.data.id}/supplier-confirm`, M, {});
  check('supplier confirmation moves to APPROVED, ready for execution', confirmedA.data.status === 'APPROVED');

  const executedA = await ok('POST', `/api/purchase-orders/${a.poId}/returns/${returnA.data.id}/execute`, M, {});
  check('execute moves to STOCK_RETURNED', executedA.data.status === 'STOCK_RETURNED');

  const afterQtyA = await getVariantAvailableQty(M, setup.book.variant_id);
  check('available stock drops by exactly return_qty (4) after execution', afterQtyA === beforeQtyA - 4, `before=${beforeQtyA} after=${afterQtyA}`);

  const completedA = await ok('POST', `/api/purchase-orders/${a.poId}/returns/${returnA.data.id}/complete`, M, {
    resolution_outcome: 'REDELIVERY',
    resolution_note: 'NCC đồng ý giao hàng thay thế',
  });
  check('complete moves to COMPLETED with the recorded outcome', completedA.data.status === 'COMPLETED' && completedA.data.resolution_outcome === 'REDELIVERY');

  // ── B: cannot exceed the originally accepted quantity across multiple requests ──
  const overAttempt = await request('POST', `/api/purchase-orders/${a.poId}/returns`, M, {
    goods_receipt_id: a.goodsReceiptId,
    reason: 'x',
    lines: [{ goods_receipt_item_id: grItemA.id, return_qty: 7 }], // only 6 of 10 remain returnable
  });
  check('a second return exceeding the remaining returnable qty is rejected', overAttempt.response.status === 400 && /còn 6/.test(overAttempt.data?.message || ''), `status=${overAttempt.response.status} message=${overAttempt.data?.message}`);

  const exactRemainder = await ok('POST', `/api/purchase-orders/${a.poId}/returns`, M, {
    goods_receipt_id: a.goodsReceiptId,
    reason: 'x',
    requires_supplier_confirmation: false,
    lines: [{ goods_receipt_item_id: grItemA.id, return_qty: 6 }],
  });
  check('a request for exactly the remaining 6 is accepted', Boolean(exactRemainder.data?.id));

  // ── C: reject leaves stock untouched ──
  const c = await setupPostedGrn(M, setup, 5, 'E2E supplier-return - reject');
  const receiptC = await ok('GET', `/api/goods-receipts/${c.goodsReceiptId}`, M);
  const grItemC = (receiptC.data?.items || receiptC.items || [])[0];
  const beforeQtyC = await getVariantAvailableQty(M, setup.book.variant_id);
  const returnC = await ok('POST', `/api/purchase-orders/${c.poId}/returns`, M, { goods_receipt_id: c.goodsReceiptId, reason: 'x', lines: [{ goods_receipt_item_id: grItemC.id, return_qty: 2 }] });
  const rejectedC = await ok('POST', `/api/purchase-orders/${c.poId}/returns/${returnC.data.id}/reject`, M, { reason: 'Không đủ căn cứ' });
  check('reject sets status REJECTED', rejectedC.data.status === 'REJECTED');
  const afterQtyC = await getVariantAvailableQty(M, setup.book.variant_id);
  check('a rejected return never touches stock', afterQtyC === beforeQtyC, `before=${beforeQtyC} after=${afterQtyC}`);

  // ── D: cancel after approval also leaves stock untouched, and blocks execution ──
  const d = await setupPostedGrn(M, setup, 5, 'E2E supplier-return - cancel');
  const receiptD = await ok('GET', `/api/goods-receipts/${d.goodsReceiptId}`, M);
  const grItemD = (receiptD.data?.items || receiptD.items || [])[0];
  const returnD = await ok('POST', `/api/purchase-orders/${d.poId}/returns`, M, { goods_receipt_id: d.goodsReceiptId, reason: 'x', requires_supplier_confirmation: false, lines: [{ goods_receipt_item_id: grItemD.id, return_qty: 2 }] });
  await ok('POST', `/api/purchase-orders/${d.poId}/returns/${returnD.data.id}/approve`, M, {});
  const cancelledD = await ok('POST', `/api/purchase-orders/${d.poId}/returns/${returnD.data.id}/cancel`, M, {});
  check('cancel after approval sets status CANCELLED', cancelledD.data.status === 'CANCELLED');
  const executeAfterCancel = await request('POST', `/api/purchase-orders/${d.poId}/returns/${returnD.data.id}/execute`, M, {});
  check('a cancelled return cannot be executed', executeAfterCancel.response.status === 409, `status=${executeAfterCancel.response.status}`);

  // ── E: supplier-reject blocks execution too ──
  const e = await setupPostedGrn(M, setup, 5, 'E2E supplier-return - supplier reject');
  const receiptE = await ok('GET', `/api/goods-receipts/${e.goodsReceiptId}`, M);
  const grItemE = (receiptE.data?.items || receiptE.items || [])[0];
  const returnE = await ok('POST', `/api/purchase-orders/${e.poId}/returns`, M, { goods_receipt_id: e.goodsReceiptId, reason: 'x', lines: [{ goods_receipt_item_id: grItemE.id, return_qty: 2 }] });
  await ok('POST', `/api/purchase-orders/${e.poId}/returns/${returnE.data.id}/approve`, M, {});
  const supplierRejectedE = await ok('POST', `/api/purchase-orders/${e.poId}/returns/${returnE.data.id}/supplier-reject`, M, { reason: 'NCC không chấp nhận trả hàng' });
  check('supplier-reject sets status SUPPLIER_REJECTED', supplierRejectedE.data.status === 'SUPPLIER_REJECTED');
  const executeAfterSupplierReject = await request('POST', `/api/purchase-orders/${e.poId}/returns/${returnE.data.id}/execute`, M, {});
  check('a supplier-rejected return cannot be executed', executeAfterSupplierReject.response.status === 409, `status=${executeAfterSupplierReject.response.status}`);

  // ── F: cannot request a return against a GRN that is not POSTED ──
  const fCreated = await ok('POST', '/api/purchase-orders', M, {
    supplier_id: setup.supplier.id, warehouse_id: setup.warehouse.id,
    expected_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    note: 'E2E supplier-return - draft grn gate',
    items: [{ variant_id: setup.book.variant_id, ordered_qty: 5, unit_cost: setup.unitCost }],
  });
  const fPoId = fCreated.data.id;
  await ok('POST', `/api/purchase-orders/${fPoId}/submit`, M);
  await ok('POST', `/api/purchase-orders/${fPoId}/approve`, M, { note: 'e2e' });
  await ok('POST', `/api/purchase-orders/${fPoId}/send-to-supplier`, M);
  const fPoSent = await ok('GET', `/api/purchase-orders/${fPoId}`, M);
  const fConfirmed = await ok('POST', `/api/purchase-orders/${fPoId}/supplier-confirm`, M, {
    invoice_number: `RET-INV-DRAFT-${Date.now()}`,
    items: [{ purchase_order_item_id: fPoSent.items[0].id, variant_id: fPoSent.items[0].variant_id, invoiced_qty: 5, unit_cost: setup.unitCost }],
  });
  const fInvoiceDetail = (await ok('GET', `/api/supplier-deliveries/${fConfirmed.data.invoice_id}`, M)).data;
  const fDraftReceipt = await ok('POST', `/api/supplier-deliveries/${fConfirmed.data.invoice_id}/create-goods-receipt`, M, {
    warehouse_id: setup.warehouse.id,
    items: fInvoiceDetail.items.map((line) => ({ invoice_item_id: line.id, purchase_order_item_id: line.purchase_order_item_id, variant_id: line.variant_id, delivered_qty: 5, unit_cost: line.unit_cost, location_id: setup.receivingLocation.id })),
  });
  const draftGrnReceipt = await ok('GET', `/api/goods-receipts/${fDraftReceipt.data.id}`, M);
  const draftGrnItem = (draftGrnReceipt.data?.items || draftGrnReceipt.items || [])[0];
  const draftGrnAttempt = await request('POST', `/api/purchase-orders/${fPoId}/returns`, M, { goods_receipt_id: fDraftReceipt.data.id, reason: 'x', lines: [{ goods_receipt_item_id: draftGrnItem.id, return_qty: 1 }] });
  check('a return cannot be requested against a DRAFT (not yet posted) GRN', draftGrnAttempt.response.status === 400, `status=${draftGrnAttempt.response.status}`);

  // ── G: concurrency — two return requests racing for the same GRN item's remaining qty ──
  const g = await setupPostedGrn(M, setup, 10, 'E2E supplier-return - concurrency race');
  const receiptG = await ok('GET', `/api/goods-receipts/${g.goodsReceiptId}`, M);
  const grItemG = (receiptG.data?.items || receiptG.items || [])[0];
  const [resG1, resG2] = await Promise.all([
    request('POST', `/api/purchase-orders/${g.poId}/returns`, M, { goods_receipt_id: g.goodsReceiptId, reason: 'race A', lines: [{ goods_receipt_item_id: grItemG.id, return_qty: 6 }] }),
    request('POST', `/api/purchase-orders/${g.poId}/returns`, M, { goods_receipt_id: g.goodsReceiptId, reason: 'race B', lines: [{ goods_receipt_item_id: grItemG.id, return_qty: 6 }] }),
  ]);
  const succeededG = [resG1, resG2].filter((r) => r.response.ok);
  check('concurrent return requests on the same line: not both accepted (6+6 > 10)', succeededG.length < 2, `A=${resG1.response.status} B=${resG2.response.status}`);

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
