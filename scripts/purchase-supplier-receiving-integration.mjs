import crypto from 'node:crypto';

const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
const username = process.env.PURCHASE_TEST_USERNAME || 'hung';
const password = process.env.PURCHASE_TEST_PASSWORD || '123456';

async function request(method, path, token, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function login() {
  const { response, data } = await request('POST', '/auth/login', null, {
    identifier: username,
    password,
  });
  if (!response.ok || !data?.token) {
    throw new Error(`login failed (${response.status}): ${JSON.stringify(data)}`);
  }
  return data.token;
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function okRequest(method, path, token, body) {
  const result = await request(method, path, token, body);
  if (!result.response.ok) {
    throw new Error(`${method} ${path} failed (${result.response.status}): ${JSON.stringify(result.data)}`);
  }
  return result.data;
}

async function getSetup(token) {
  const [suppliers, warehouses, books] = await Promise.all([
    okRequest('GET', '/api/suppliers', token),
    okRequest('GET', '/api/warehouses', token),
    okRequest('GET', '/api/books', token),
  ]);
  const supplier = suppliers.find((item) => item.status === 'ACTIVE') || suppliers[0];
  expect(supplier?.id, 'No supplier available');

  let warehouse = null;
  let receivingLocation = null;
  for (const candidate of warehouses.filter((item) => item.is_active !== false)) {
    const warehouseLocations = await okRequest('GET', `/api/warehouses/${candidate.id}/locations`, token);
    const locations = warehouseLocations.locations || warehouseLocations.data || warehouseLocations;
    receivingLocation =
      (Array.isArray(locations) ? locations : []).find((item) => item.location_type === 'RECEIVING') ||
      (Array.isArray(locations) ? locations : []).find((item) => item.is_active);
    if (receivingLocation) {
      warehouse = candidate;
      break;
    }
  }
  expect(warehouse?.id, 'No warehouse with receiving location available');
  expect(receivingLocation?.id, 'No receiving location available');

  const variants = books
    .filter((book) => book.variant_id)
    .slice(0, 4)
    .map((book) => ({
      variant_id: book.variant_id,
      title: book.title,
      unit_cost: Number(book.unit_cost || 1000),
    }));
  expect(variants.length >= 2, 'Need at least two variants in seed data');
  return { supplier, warehouse, receivingLocation, variants };
}

async function createApprovedPo(token, setup, lines) {
  const created = await okRequest('POST', '/api/purchase-orders', token, {
    supplier_id: setup.supplier.id,
    warehouse_id: setup.warehouse.id,
    expected_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    note: 'purchase supplier receiving integration',
    items: lines.map((line) => ({
      variant_id: line.variant_id,
      ordered_qty: line.qty,
      unit_cost: line.unit_cost,
    })),
  });
  const poId = created.data.id;
  await okRequest('POST', `/api/purchase-orders/${poId}/submit`, token);
  await okRequest('POST', `/api/purchase-orders/${poId}/approve`, token, { note: 'integration approve' });
  return poId;
}

async function sendAndConfirmWithInvoice(token, poId, invoicePrefix) {
  const sent = await okRequest('POST', `/api/purchase-orders/${poId}/send-to-supplier`, token);
  const po = await okRequest('GET', `/api/purchase-orders/${poId}`, token);
  const invoicePayload = {
    invoice_number: `${invoicePrefix}-${Date.now()}`,
    invoice_date: new Date().toISOString().slice(0, 10),
    expected_delivery_date: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
    items: po.items
      .filter((item) => item.remaining_qty > 0)
      .map((item) => ({
        purchase_order_item_id: item.id,
        variant_id: item.variant_id,
        invoiced_qty: item.remaining_qty,
        unit_cost: item.unit_cost,
      })),
  };
  const confirmed = await okRequest('POST', `/api/purchase-orders/${poId}/supplier-confirm`, token, invoicePayload);
  return { sent: sent.data, invoiceId: confirmed.data.invoice_id };
}

async function createReceiptFromInvoice(token, invoiceId, setup, qtyByVariant) {
  const invoice = (await okRequest('GET', `/api/supplier-deliveries/${invoiceId}`, token)).data;
  const items = invoice.items.map((item) => ({
    invoice_item_id: item.id,
    purchase_order_item_id: item.purchase_order_item_id,
    variant_id: item.variant_id,
    delivered_qty: qtyByVariant[item.variant_id] ?? item.remaining_qty,
    unit_cost: item.unit_cost,
    location_id: setup.receivingLocation.id,
  }));
  return okRequest('POST', `/api/supplier-deliveries/${invoiceId}/create-goods-receipt`, token, {
    warehouse_id: setup.warehouse.id,
    note: `Receive invoice ${invoice.invoice_number}`,
    items,
  });
}

async function getPurchaseOrder(token, poId) {
  return okRequest('GET', `/api/purchase-orders/${poId}`, token);
}

async function getVariantAvailableQty(token, variantId) {
  const books = await okRequest('GET', '/api/books', token);
  const row = books.find((book) => book.variant_id === variantId);
  return Number(row?.quantity || 0);
}

const passes = [];
function pass(name) {
  passes.push(name);
  console.log(`PASS ${name}`);
}

async function run() {
  const token = await login();
  const setup = await getSetup(token);

  const fullLines = [
    { ...setup.variants[0], qty: 2 },
    { ...setup.variants[1], qty: 1 },
  ];
  const fullPoId = await createApprovedPo(token, setup, fullLines);
  pass('create purchase order');
  pass('submit purchase order');
  pass('approve purchase order');

  const approvedPo = await getPurchaseOrder(token, fullPoId);
  expect(approvedPo.status === 'APPROVED', 'PO should be APPROVED after approve');
  expect((approvedPo.goods_receipts || []).length === 0, 'Approve must not auto-create goods receipt');
  pass('no auto goods receipt after approve');

  const beforeFullStock = await getVariantAvailableQty(token, setup.variants[0].variant_id);
  const fullDoc = await sendAndConfirmWithInvoice(token, fullPoId, 'INV-FULL');
  const sentPo = await getPurchaseOrder(token, fullPoId);
  expect(['SUPPLIER_CONFIRMED'].includes(sentPo.status), `PO should be SUPPLIER_CONFIRMED, got ${sentPo.status}`);
  pass('send to supplier');
  pass('supplier confirm invoice');

  const fullReceipt = await createReceiptFromInvoice(token, fullDoc.invoiceId, setup, {});
  expect(fullReceipt.data.status === 'DRAFT', 'GR should be DRAFT');
  pass('create goods receipt draft from invoice');

  const afterDraftStock = await getVariantAvailableQty(token, setup.variants[0].variant_id);
  expect(afterDraftStock === beforeFullStock, 'DRAFT receipt must not increase stock');
  pass('draft does not increase stock');

  await okRequest('PATCH', `/api/goods-receipts/${fullReceipt.data.id}`, token, { status: 'POSTED' });
  const afterPostStock = await getVariantAvailableQty(token, setup.variants[0].variant_id);
  expect(afterPostStock === beforeFullStock + 2, `POSTED receipt should increase stock by 2, got ${beforeFullStock}->${afterPostStock}`);
  pass('post receipt increases stock');

  const receivedPo = await getPurchaseOrder(token, fullPoId);
  expect(receivedPo.status === 'RECEIVED', `Full receipt should set PO RECEIVED, got ${receivedPo.status}`);
  pass('full receipt updates PO RECEIVED');

  const overPoId = await createApprovedPo(token, setup, [{ ...setup.variants[2], qty: 1 }]);
  const overDoc = await sendAndConfirmWithInvoice(token, overPoId, 'INV-OVER');
  const overInvoice = (await okRequest('GET', `/api/supplier-deliveries/${overDoc.invoiceId}`, token)).data;
  const overAttempt = await request('POST', `/api/supplier-deliveries/${overDoc.invoiceId}/create-goods-receipt`, token, {
    warehouse_id: setup.warehouse.id,
    items: overInvoice.items.map((item) => ({
      invoice_item_id: item.id,
      purchase_order_item_id: item.purchase_order_item_id,
      variant_id: item.variant_id,
      delivered_qty: item.remaining_qty + 1,
      unit_cost: item.unit_cost,
      location_id: setup.receivingLocation.id,
    })),
  });
  expect(overAttempt.response.status === 400, `Over receive should be 400, got ${overAttempt.response.status}`);
  pass('over receive blocked');

  const shortageVariant = setup.variants[3] || setup.variants[0];
  const shortagePoId = await createApprovedPo(token, setup, [{ ...shortageVariant, qty: 5 }]);
  const shortageDoc = await sendAndConfirmWithInvoice(token, shortagePoId, 'INV-SHORT');
  const beforeShortStock = await getVariantAvailableQty(token, shortageVariant.variant_id);
  const shortageReceipt = await createReceiptFromInvoice(token, shortageDoc.invoiceId, setup, {
    [shortageVariant.variant_id]: 3,
  });
  await okRequest('PATCH', `/api/goods-receipts/${shortageReceipt.data.id}`, token, { status: 'POSTED' });
  const shortagePo = await getPurchaseOrder(token, shortagePoId);
  const shortages = await okRequest('GET', `/api/purchase-orders/${shortagePoId}/shortage-reports`, token);
  const shortageQty = shortages.data?.[0]?.items?.reduce((sum, item) => sum + Number(item.shortage_qty || 0), 0);
  const afterShortStock = await getVariantAvailableQty(token, shortageVariant.variant_id);
  expect(['PARTIALLY_RECEIVED', 'SHORTAGE_REPORTED'].includes(shortagePo.status), `Shortage PO status invalid: ${shortagePo.status}`);
  expect(shortageQty === 2, `Expected shortage_qty=2, got ${shortageQty}`);
  expect(afterShortStock === beforeShortStock + 3, 'Shortage receipt should only add received quantity');
  pass('shortage creates report');

  const portalPoId = await createApprovedPo(token, setup, [{ ...setup.variants[0], qty: 1 }]);
  const portalSent = await okRequest('POST', `/api/purchase-orders/${portalPoId}/send-to-supplier`, token);
  const portalToken = portalSent.data.portal_token;
  expect(portalToken, 'send-to-supplier should return portal token');
  const portalOrder = await okRequest('GET', `/api/supplier-portal/orders/${portalToken}`, null);
  await okRequest('POST', `/api/supplier-portal/orders/${portalToken}/confirm`, null);
  await okRequest('POST', `/api/supplier-portal/orders/${portalToken}/invoices`, null, {
    invoice_number: `PORTAL-${Date.now()}`,
    invoice_date: new Date().toISOString().slice(0, 10),
    expected_delivery_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    items: portalOrder.data.purchase_order.items.map((item) => ({
      purchase_order_item_id: item.id,
      invoiced_qty: item.remaining_qty,
      unit_cost: item.unit_cost,
    })),
  });
  const portalForbidden = await request('POST', `/api/supplier-portal/orders/${portalToken}/create-goods-receipt`, null, {});
  expect(portalForbidden.response.status === 403, 'Supplier portal must not create/post stock');
  pass('supplier portal cannot post stock');

  console.log(`PASS=${passes.length} TOTAL=13`);
  if (passes.length !== 13) process.exitCode = 1;
}

run().catch((error) => {
  console.error(`FAIL ${error.message}`);
  process.exit(1);
});
