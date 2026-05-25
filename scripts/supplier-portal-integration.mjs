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

async function okRequest(method, path, token, body) {
  const result = await request(method, path, token, body);
  if (!result.response.ok) {
    throw new Error(`${method} ${path} failed (${result.response.status}): ${JSON.stringify(result.data)}`);
  }
  return result.data;
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function login(identifier = username, loginPassword = password) {
  const { response, data } = await request('POST', '/auth/login', null, {
    identifier,
    password: loginPassword,
  });
  if (!response.ok || !data?.token) {
    throw new Error(`login failed (${response.status}): ${JSON.stringify(data)}`);
  }
  return data.token;
}

async function loginSupplier(identifier) {
  return login(identifier || process.env.SUPPLIER_TEST_USERNAME || 'supplier-sv', process.env.SUPPLIER_TEST_PASSWORD || '123456');
}

async function getSetup(token) {
  const [suppliers, warehouses, books] = await Promise.all([
    okRequest('GET', '/api/suppliers', token),
    okRequest('GET', '/api/warehouses', token),
    okRequest('GET', '/api/books', token),
  ]);
  const demoSupplierEmails = new Set(['minh@nppsv.com.vn', 'hong@ppnps.com.vn', 'john@ibd.com']);
  const supplier =
    suppliers.find((item) => item.status === 'ACTIVE' && demoSupplierEmails.has(String(item.email || '').toLowerCase())) ||
    suppliers.find((item) => item.status === 'ACTIVE') ||
    suppliers[0];
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

async function createPo(token, setup, lines) {
  const created = await okRequest('POST', '/api/purchase-orders', token, {
    supplier_id: setup.supplier.id,
    warehouse_id: setup.warehouse.id,
    expected_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    note: 'supplier portal integration',
    items: lines.map((line) => ({
      variant_id: line.variant_id,
      ordered_qty: line.qty,
      unit_cost: line.unit_cost,
    })),
  });
  return created.data.id;
}

async function approvePo(token, poId) {
  await okRequest('POST', `/api/purchase-orders/${poId}/submit`, token);
  await okRequest('POST', `/api/purchase-orders/${poId}/approve`, token, { note: 'integration approve' });
}

async function getPurchaseOrder(token, poId) {
  return okRequest('GET', `/api/purchase-orders/${poId}`, token);
}

async function getVariantAvailableQty(token, variantId) {
  const books = await okRequest('GET', '/api/books', token);
  const row = books.find((book) => book.variant_id === variantId);
  return Number(row?.quantity || 0);
}

async function sendToSupplier(token, poId) {
  const sent = await okRequest('POST', `/api/purchase-orders/${poId}/send-to-supplier`, token);
  expect(sent.data?.portal_token, 'send-to-supplier should return portal token');
  return sent.data.portal_token;
}

async function supplierInvoice(token, portalToken, invoicePrefix, qtyByPoItem = null, extra = {}) {
  const portal = (await okRequest('GET', `/api/supplier-portal/orders/${portalToken}`, null)).data;
  const payload = {
    invoice_number: `${invoicePrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    delivery_number: `DLV-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    invoice_date: new Date().toISOString().slice(0, 10),
    expected_delivery_date: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
    ...extra,
    items: portal.purchase_order.items
      .filter((item) => item.remaining_qty > 0)
      .map((item) => ({
        purchase_order_item_id: item.id,
        invoiced_qty: qtyByPoItem?.[item.id] ?? item.remaining_qty,
        unit_cost: item.unit_cost,
      })),
  };
  const created = await okRequest('POST', `/api/supplier-portal/orders/${portalToken}/invoices`, null, payload);
  return { invoiceId: created.data.id, portal, payload };
}

async function getSupplierAccountOrder(supplierToken, poId) {
  const account = await okRequest('GET', '/api/supplier-account/orders', supplierToken);
  const order = account.data.orders.find((item) => item.purchase_order.id === poId);
  expect(order, `Supplier account should include PO ${poId}`);
  return order;
}

async function supplierAccountInvoice(supplierToken, poId, invoicePrefix, qtyByPoItem = null, extra = {}) {
  const order = await getSupplierAccountOrder(supplierToken, poId);
  const payload = {
    invoice_number: `${invoicePrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    delivery_number: `DLV-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    invoice_date: new Date().toISOString().slice(0, 10),
    expected_delivery_date: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
    ...extra,
    items: order.purchase_order.items
      .filter((item) => item.remaining_qty > 0)
      .map((item) => ({
        purchase_order_item_id: item.id,
        invoiced_qty: qtyByPoItem?.[item.id] ?? item.remaining_qty,
        unit_cost: item.unit_cost,
      })),
  };
  const created = await okRequest('POST', `/api/supplier-account/orders/${poId}/invoices`, supplierToken, payload);
  return { invoiceId: created.data.id, order, payload };
}

async function createReceiptFromInvoice(token, invoiceId, setup, qtyByVariant = {}) {
  const invoice = (await okRequest('GET', `/api/supplier-deliveries/${invoiceId}`, token)).data;
  const items = invoice.items.map((item) => ({
    invoice_item_id: item.id,
    purchase_order_item_id: item.purchase_order_item_id,
    variant_id: item.variant_id,
    delivered_qty: qtyByVariant[item.variant_id] ?? Math.min(item.remaining_qty, item.invoiced_qty),
    unit_cost: item.unit_cost,
    location_id: setup.receivingLocation.id,
  }));
  return okRequest('POST', `/api/supplier-deliveries/${invoiceId}/create-goods-receipt`, token, {
    warehouse_id: setup.warehouse.id,
    note: `Receive invoice ${invoice.invoice_number}`,
    items,
  });
}

const passes = [];
function pass(name) {
  passes.push(name);
  console.log(`PASS ${name}`);
}

async function run() {
  const token = await login();
  const setup = await getSetup(token);
  const supplierToken = await loginSupplier(setup.supplier.email);

  const fullPoId = await createPo(token, setup, [
    { ...setup.variants[0], qty: 2 },
    { ...setup.variants[1], qty: 1 },
  ]);
  pass('create PO');
  await okRequest('POST', `/api/purchase-orders/${fullPoId}/submit`, token);
  pass('submit PO');
  await okRequest('POST', `/api/purchase-orders/${fullPoId}/approve`, token, { note: 'integration approve' });
  pass('approve PO');

  const approvedPo = await getPurchaseOrder(token, fullPoId);
  expect(approvedPo.status === 'APPROVED', `Expected APPROVED, got ${approvedPo.status}`);
  expect((approvedPo.goods_receipts || []).length === 0, 'Approve must not auto-create goods receipt');
  pass('no auto GR after approve');

  const beforeFullStock = await getVariantAvailableQty(token, setup.variants[0].variant_id);
  const fullPortalToken = await sendToSupplier(token, fullPoId);
  pass('send to supplier');

  const portalOrder = await okRequest('GET', `/api/supplier-portal/orders/${fullPortalToken}`, null);
  expect(portalOrder.data.purchase_order.id === fullPoId, 'Supplier portal should load token-scoped PO');
  pass('supplier portal loads');

  const supplierAccountOrder = await getSupplierAccountOrder(supplierToken, fullPoId);
  expect(supplierAccountOrder.purchase_order.id === fullPoId, 'Supplier account should load own PO');
  pass('supplier account loads');

  await okRequest('POST', `/api/supplier-account/orders/${fullPoId}/confirm`, supplierToken);
  pass('supplier account confirm');

  const fullInvoice = await supplierAccountInvoice(supplierToken, fullPoId, 'SA-FULL');
  pass('supplier account creates invoice');

  const deliveries = await okRequest('GET', '/api/supplier-deliveries', token);
  expect(deliveries.data.some((delivery) => delivery.id === fullInvoice.invoiceId), 'Supplier invoice should appear in staff deliveries');

  const fullReceipt = await createReceiptFromInvoice(token, fullInvoice.invoiceId, setup);
  expect(fullReceipt.data.status === 'DRAFT', 'GR should be DRAFT');
  pass('staff creates GR draft');

  const afterDraftStock = await getVariantAvailableQty(token, setup.variants[0].variant_id);
  expect(afterDraftStock === beforeFullStock, 'DRAFT receipt must not increase stock');
  pass('draft does not increase stock');

  await okRequest('PATCH', `/api/goods-receipts/${fullReceipt.data.id}`, token, { status: 'POSTED' });
  const afterPostStock = await getVariantAvailableQty(token, setup.variants[0].variant_id);
  expect(afterPostStock === beforeFullStock + 2, `POSTED receipt should increase stock by 2, got ${beforeFullStock}->${afterPostStock}`);
  pass('post GR increases stock');

  const fullReceivedPo = await getPurchaseOrder(token, fullPoId);
  expect(fullReceivedPo.status === 'RECEIVED', `Expected RECEIVED, got ${fullReceivedPo.status}`);
  pass('PO received');

  const shortageVariant = setup.variants[2] || setup.variants[0];
  const shortagePoId = await createPo(token, setup, [{ ...shortageVariant, qty: 5 }]);
  await approvePo(token, shortagePoId);
  const shortagePortalToken = await sendToSupplier(token, shortagePoId);
  await okRequest('POST', `/api/supplier-account/orders/${shortagePoId}/confirm`, supplierToken);
  const shortageInvoice = await supplierAccountInvoice(supplierToken, shortagePoId, 'SA-SHORT');
  const shortageReceipt = await createReceiptFromInvoice(token, shortageInvoice.invoiceId, setup, {
    [shortageVariant.variant_id]: 3,
  });
  await okRequest('PATCH', `/api/goods-receipts/${shortageReceipt.data.id}`, token, { status: 'POSTED' });
  const shortageReports = await okRequest('GET', `/api/purchase-orders/${shortagePoId}/shortage-reports`, token);
  const shortageReport = shortageReports.data?.[0];
  const shortageQty = shortageReport?.items?.reduce((sum, item) => sum + Number(item.shortage_qty || 0), 0);
  expect(shortageReport?.id, 'Shortage report should exist');
  expect(shortageQty === 2, `Expected shortage_qty=2, got ${shortageQty}`);
  pass('shortage report created');

  await okRequest('POST', `/api/purchase-orders/${shortagePoId}/shortage-reports/${shortageReport.id}/send`, token);
  pass('shortage sent to supplier');

  const shortagePortal = await okRequest('GET', `/api/supplier-portal/orders/${shortagePortalToken}`, null);
  const portalShortage = shortagePortal.data.shortage_reports.find((report) => report.id === shortageReport.id);
  expect(portalShortage?.status === 'SENT_TO_SUPPLIER', 'Supplier portal should show sent shortage report');
  await okRequest('POST', `/api/supplier-account/orders/${shortagePoId}/shortage-reports/${shortageReport.id}/acknowledge`, supplierToken);
  pass('supplier account acknowledges shortage');

  const overInvoice = await request('POST', `/api/supplier-portal/orders/${shortagePortalToken}/invoices`, null, {
    invoice_number: `SP-OVER-${Date.now()}`,
    invoice_date: new Date().toISOString().slice(0, 10),
    items: shortagePortal.data.purchase_order.items.map((item) => ({
      purchase_order_item_id: item.id,
      invoiced_qty: item.remaining_qty + 1,
      unit_cost: item.unit_cost,
    })),
  });
  expect(overInvoice.response.status === 400, `Over invoice should be 400, got ${overInvoice.response.status}`);

  const overRedelivery = await request('POST', `/api/supplier-account/orders/${shortagePoId}/shortage-reports/${shortageReport.id}/redelivery-invoice`, supplierToken, {
    invoice_number: `SP-RED-OVER-${Date.now()}`,
    invoice_date: new Date().toISOString().slice(0, 10),
    items: portalShortage.items.map((item) => ({
      purchase_order_item_id: item.purchase_order_item_id,
      invoiced_qty: item.shortage_qty + 1,
      unit_cost: shortageVariant.unit_cost,
    })),
  });
  expect(overRedelivery.response.status === 400, `Over redelivery should be 400, got ${overRedelivery.response.status}`);

  const redelivery = await okRequest('POST', `/api/supplier-account/orders/${shortagePoId}/shortage-reports/${shortageReport.id}/redelivery-invoice`, supplierToken, {
    invoice_number: `SA-RED-${Date.now()}`,
    delivery_number: `DLV-RED-${Date.now()}`,
    invoice_date: new Date().toISOString().slice(0, 10),
    expected_delivery_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    supplier_note: 'Redelivery for shortage report',
    items: portalShortage.items.map((item) => ({
      purchase_order_item_id: item.purchase_order_item_id,
      invoiced_qty: item.shortage_qty,
      unit_cost: shortageVariant.unit_cost,
    })),
  });
  pass('supplier account creates redelivery invoice');

  const redeliveryReceipt = await createReceiptFromInvoice(token, redelivery.data.id, setup);
  await okRequest('PATCH', `/api/goods-receipts/${redeliveryReceipt.data.id}`, token, { status: 'POSTED' });
  const redeliveryPo = await getPurchaseOrder(token, shortagePoId);
  expect(redeliveryPo.status === 'RECEIVED', `Expected redelivery PO RECEIVED, got ${redeliveryPo.status}`);
  pass('redelivery GR posted');

  await okRequest('POST', `/api/purchase-orders/${shortagePoId}/shortage-reports/${shortageReport.id}/resolve`, token);
  const resolvedReports = await okRequest('GET', `/api/purchase-orders/${shortagePoId}/shortage-reports`, token);
  expect(resolvedReports.data.find((report) => report.id === shortageReport.id)?.status === 'RESOLVED', 'Shortage report should be RESOLVED');
  pass('shortage resolved');

  const portalForbidden = await request('POST', `/api/supplier-portal/orders/${fullPortalToken}/post-goods-receipt`, null, {});
  expect(portalForbidden.response.status === 403, 'Supplier portal must not post stock');
  const accountForbidden = await request('POST', `/api/supplier-account/orders/${fullPoId}/post-goods-receipt`, supplierToken, {});
  expect(accountForbidden.response.status === 403, 'Supplier account must not post stock');
  pass('supplier cannot post stock');

  pass('over invoice blocked');

  const invalidToken = await request('GET', '/api/supplier-portal/orders/not-a-real-token', null);
  expect(invalidToken.response.status === 404, `Invalid token should be 404, got ${invalidToken.response.status}`);
  pass('invalid token rejected');

  console.log(`PASS=${passes.length} TOTAL=22`);
  if (passes.length !== 22) process.exitCode = 1;
}

run().catch((error) => {
  console.error(`FAIL ${error.message}`);
  process.exit(1);
});
