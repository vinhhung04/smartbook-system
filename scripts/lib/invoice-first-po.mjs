// Shared steps of the invoice-first purchasing flow (every PO created since 2026-11-25):
// supplier proposes qty + price on its account -> SmartBook approves -> supplier issues an
// invoice at the approved price -> SmartBook approves it -> delivery notes ship against it.
// The one-click confirm, /supplier-confirm and the emailed token portal no longer move these POs.
import crypto from 'node:crypto';

const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

async function call(method, path, token, body) {
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
  return { status: response.status, data };
}

async function ok(method, path, token, body) {
  const result = await call(method, path, token, body);
  if (result.status >= 300) throw new Error(`${method} ${path} failed (${result.status}): ${JSON.stringify(result.data)}`);
  return result.data;
}

const today = () => new Date().toISOString().slice(0, 10);
const uniq = (prefix) => `${prefix}-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;

/** The supplier that a supplier account (default supplier-sv) represents. */
export async function supplierIdOf(supplierToken) {
  return (await ok('GET', '/api/supplier-account/orders', supplierToken)).data.supplier.id;
}

/**
 * Supplier accepts every line of a sent PO at `unitCost` (a number, or item => number) and
 * SmartBook approves the proposal. The PO ends SUPPLIER_CONFIRMED with that price on each line.
 */
export async function acceptAtPrice(staffToken, supplierToken, poId, unitCost) {
  const po = await ok('GET', `/api/purchase-orders/${poId}`, staffToken);
  const priceOf = typeof unitCost === 'function' ? unitCost : () => unitCost;
  const proposal = await ok('POST', `/api/supplier-account/orders/${poId}/respond`, supplierToken, {
    decision: 'ACCEPTED',
    lines: po.items.map((item) => ({ purchase_order_item_id: item.id, confirmed_qty: item.ordered_qty, confirmed_unit_cost: priceOf(item) })),
  });
  await ok('POST', `/api/purchase-orders/${poId}/supplier-responses/${proposal.data.id}/review`, staffToken, { decision: 'APPROVE' });
  return ok('GET', `/api/purchase-orders/${poId}`, staffToken);
}

/** Supplier issues an invoice (all accepted qty unless `qtyByItem` says otherwise); SmartBook approves it. */
export async function approvedInvoice(staffToken, supplierToken, poId, qtyByItem = null) {
  const po = await ok('GET', `/api/purchase-orders/${poId}`, staffToken);
  const lines = po.items
    .map((item) => ({ purchase_order_item_id: item.id, quantity: qtyByItem ? qtyByItem[item.id] || 0 : item.ordered_qty }))
    .filter((line) => line.quantity > 0);
  const invoice = (await ok('POST', `/api/supplier-account/orders/${poId}/documents`, supplierToken, {
    document_type: 'SALES_INVOICE', external_number: uniq('HD'), issue_date: today(), issue: true, lines: JSON.stringify(lines),
  })).data;
  await ok('POST', `/api/procurement-documents/${invoice.id}/approval`, staffToken, { decision: 'APPROVE' });
  return invoice;
}

/** A delivery note against an approved invoice. Returns the raw { status, data } so races can be asserted. */
export function shipAgainstInvoice(supplierToken, poId, invoiceId, items, extra = {}) {
  return call('POST', `/api/supplier-account/orders/${poId}/invoices`, supplierToken, {
    delivery_number: uniq('PG'), invoice_document_id: invoiceId, expected_delivery_date: today(), ...extra,
    items: items.map(({ purchase_order_item_id, invoiced_qty }) => ({ purchase_order_item_id, invoiced_qty })),
  });
}

/**
 * The whole supplier side for a sent PO: accept at `unitCost`, approved invoice for everything,
 * one delivery note for everything. Returns { po, invoice, deliveryId }.
 */
export async function acceptInvoiceAndShip(staffToken, supplierToken, poId, unitCost) {
  const po = await acceptAtPrice(staffToken, supplierToken, poId, unitCost);
  const invoice = await approvedInvoice(staffToken, supplierToken, poId);
  const shipped = await shipAgainstInvoice(supplierToken, poId, invoice.id, po.items.map((item) => ({ purchase_order_item_id: item.id, invoiced_qty: item.ordered_qty })));
  if (shipped.status !== 201) throw new Error(`delivery note failed (${shipped.status}): ${JSON.stringify(shipped.data)}`);
  return { po, invoice, deliveryId: shipped.data.data.id };
}
