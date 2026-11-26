// Invoice-first flow: quantities are tracked per approved supplier invoice line.
//   invoiced  - quantity on the approved invoice line
//   shipped   - quantity the supplier put on delivery notes for it (redelivery notes excluded)
//   in_transit- shipped on notes SmartBook has not posted a goods receipt for yet
//   received  - quantity SmartBook accepted into stock (posted receipts only)
//   discrepancy - shipped on posted notes but not accepted (missing / damaged / rejected)
//   missing   - invoiced - received: still owed
// Shipping is never "delivered": only a posted goods receipt counts as received.

const { assertInvoiceQtyWithinRemaining } = require("./procurement-receipt.service");

const INVOICE_TYPES = ["VAT_INVOICE", "SALES_INVOICE"];
// Invoices that hold quantity: everything alive except those SmartBook rejected.
const LIVE_INVOICE_STATUSES = ["DRAFT", "ISSUED", "PENDING_SIGNED_DOCUMENT", "SCAN_UPLOADED"];

class FulfillmentError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function isRedelivery(delivery) {
  return delivery?.raw_payload?.redelivery === true;
}

function isPosted(delivery) {
  return (delivery.goods_receipts || []).some((receipt) => receipt.status === "POSTED");
}

/** Pure: per-line and overall progress of one invoice from its delivery notes. */
function computeInvoiceFulfillment(invoice, deliveries) {
  const lines = (invoice.procurement_document_lines || []).map((line) => {
    const key = String(line.purchase_order_item_id);
    let shipped = 0;
    let inTransit = 0;
    let received = 0;
    let discrepancy = 0;
    for (const delivery of deliveries) {
      if (delivery.status === "CANCELLED") continue;
      const posted = isPosted(delivery);
      for (const item of delivery.supplier_delivery_invoice_items || []) {
        if (String(item.purchase_order_item_id) !== key) continue;
        const qty = Number(item.invoiced_qty || 0);
        if (!isRedelivery(delivery)) shipped += qty;
        if (posted) {
          received += Number(item.accepted_qty || 0);
          discrepancy += Math.max(0, qty - Number(item.accepted_qty || 0));
        } else {
          inTransit += qty;
        }
      }
    }
    const invoiced = Number(line.quantity || 0);
    return {
      purchase_order_item_id: line.purchase_order_item_id,
      invoiced_qty: invoiced,
      shipped_qty: shipped,
      remaining_to_ship_qty: Math.max(0, invoiced - shipped),
      in_transit_qty: inTransit,
      received_qty: received,
      discrepancy_qty: discrepancy,
      missing_qty: Math.max(0, invoiced - received),
    };
  });

  const sum = (field) => lines.reduce((total, line) => total + line[field], 0);
  const invoiced = sum("invoiced_qty");
  const received = sum("received_qty");
  const shipped = sum("shipped_qty");
  let status = "AWAITING_SHIPMENT";
  if (lines.length > 0 && lines.every((line) => line.missing_qty === 0)) status = "RECEIVED";
  else if (received > 0) status = "PARTIALLY_RECEIVED";
  else if (shipped > 0) status = "IN_TRANSIT";

  return {
    status,
    invoiced_qty: invoiced,
    shipped_qty: shipped,
    in_transit_qty: sum("in_transit_qty"),
    received_qty: received,
    missing_qty: sum("missing_qty"),
    discrepancy_qty: sum("discrepancy_qty"),
    lines,
  };
}

/** Pure: status of one delivery note, derived from its receipt (never from the supplier's word). */
function deliveryNoteStatus(delivery) {
  if (delivery.status === "CANCELLED") return "CANCELLED";
  if (!isPosted(delivery)) return "IN_TRANSIT";
  const items = delivery.supplier_delivery_invoice_items || [];
  const full = items.every((item) => Number(item.accepted_qty || 0) >= Number(item.invoiced_qty || 0));
  return full ? "RECEIVED" : "PARTIALLY_RECEIVED";
}

function invoiceDeliveryInclude() {
  return {
    supplier_delivery_invoice_items: true,
    goods_receipts: { select: { id: true, receipt_number: true, status: true } },
  };
}

/**
 * Lock the PO lines, then check that new invoice quantities fit what the supplier was approved
 * for (ordered_qty after SmartBook approved the proposal) minus other live invoices.
 * Unit prices are forced to the approved price. Returns normalized lines.
 */
async function normalizeInvoiceFirstLines(tx, po, rawLines, { excludeDocumentId = null } = {}) {
  const items = po.purchase_order_items || [];
  const byId = new Map(items.map((item) => [String(item.id), item]));
  const lines = [];
  const seen = new Set();
  for (const raw of Array.isArray(rawLines) ? rawLines : []) {
    const item = byId.get(String(raw?.purchase_order_item_id || ""));
    if (!item) throw new FulfillmentError("Dòng hóa đơn phải thuộc đơn đặt hàng này");
    if (seen.has(item.id)) throw new FulfillmentError("Hóa đơn có dòng sách bị lặp");
    seen.add(item.id);
    const quantity = Number(raw?.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) throw new FulfillmentError("Số lượng trên hóa đơn phải là số nguyên > 0");
    if (item.closure_status === "CLOSED_WITH_REMAINING") throw new FulfillmentError("Dòng đơn đặt hàng đã đóng phần còn lại");
    lines.push({ item, quantity });
  }
  if (lines.length === 0) throw new FulfillmentError("Hóa đơn cần ít nhất một dòng");

  const ids = lines.map((line) => line.item.id);
  await tx.$queryRawUnsafe("SELECT id FROM purchase_order_items WHERE id = ANY($1::uuid[]) FOR UPDATE", ids);
  const used = await tx.procurement_document_lines.findMany({
    where: {
      purchase_order_item_id: { in: ids },
      procurement_documents: {
        document_type: { in: INVOICE_TYPES },
        status: { in: LIVE_INVOICE_STATUSES },
        OR: [{ approval_status: null }, { approval_status: { not: "REJECTED" } }],
        ...(excludeDocumentId ? { id: { not: excludeDocumentId } } : {}),
      },
    },
    select: { purchase_order_item_id: true, quantity: true },
  });
  const usedById = new Map();
  for (const row of used) usedById.set(String(row.purchase_order_item_id), (usedById.get(String(row.purchase_order_item_id)) || 0) + row.quantity);

  return lines.map(({ item, quantity }) => {
    const accepted = Number(item.ordered_qty || 0);
    const available = accepted - (usedById.get(String(item.id)) || 0);
    if (quantity > available) {
      const title = item.item_title || "sách";
      throw new FulfillmentError(`Số lượng hóa đơn của "${title}" vượt số lượng nhà cung cấp đã chấp nhận (còn được lập ${Math.max(0, available)})`, 409);
    }
    const unitPrice = Number(item.unit_cost || 0);
    return {
      purchase_order_item_id: item.id,
      variant_id: item.variant_id || null,
      quantity,
      unit_price: unitPrice,
      line_amount: Math.round(quantity * unitPrice * 100) / 100,
    };
  });
}

/**
 * Lock the approved invoice, then check a new delivery note: every line must be on the invoice
 * and no line may ship more than the invoice still has unshipped (per invoice line).
 * Returns delivery items priced from the invoice.
 */
async function normalizeDeliveryAgainstInvoice(tx, po, invoiceDocumentId, rawItems) {
  if (!invoiceDocumentId) throw new FulfillmentError("Chọn hóa đơn đã được SmartBook duyệt cho phiếu giao này");
  // PO lines before the invoice, the order the staff path uses, so the two never deadlock
  await tx.$queryRawUnsafe("SELECT id FROM purchase_order_items WHERE purchase_order_id = $1::uuid ORDER BY id FOR UPDATE", po.id);
  await tx.$queryRawUnsafe("SELECT id FROM procurement_documents WHERE id = $1::uuid FOR UPDATE", invoiceDocumentId);
  const invoice = await tx.procurement_documents.findFirst({
    where: { id: invoiceDocumentId, purchase_order_id: po.id, document_type: { in: INVOICE_TYPES } },
    include: { procurement_document_lines: true },
  });
  if (!invoice) throw new FulfillmentError("Không tìm thấy hóa đơn thuộc đơn đặt hàng này", 404);
  if (invoice.approval_status !== "APPROVED" || !["ISSUED", "SCAN_UPLOADED"].includes(invoice.status)) {
    throw new FulfillmentError("Chỉ được lập phiếu giao từ hóa đơn đã được SmartBook duyệt", 409);
  }
  const deliveries = await tx.supplier_delivery_invoices.findMany({
    where: { invoice_document_id: invoice.id },
    include: invoiceDeliveryInclude(),
  });
  const progress = computeInvoiceFulfillment(invoice, deliveries);
  const remainingById = new Map(progress.lines.map((line) => [String(line.purchase_order_item_id), line.remaining_to_ship_qty]));
  const priceById = new Map(invoice.procurement_document_lines.map((line) => [String(line.purchase_order_item_id), Number(line.unit_price || 0)]));
  const poItemsById = new Map((po.purchase_order_items || []).map((item) => [String(item.id), item]));

  const items = [];
  const seen = new Set();
  for (const raw of Array.isArray(rawItems) ? rawItems : []) {
    const key = String(raw?.purchase_order_item_id || "");
    if (!remainingById.has(key)) throw new FulfillmentError("Dòng phiếu giao phải có trên hóa đơn đã chọn");
    if (seen.has(key)) throw new FulfillmentError("Phiếu giao có dòng sách bị lặp");
    seen.add(key);
    if (poItemsById.get(key)?.closure_status === "CLOSED_WITH_REMAINING") {
      throw new FulfillmentError("Dòng đơn đặt hàng đã đóng phần còn lại, không thể lập phiếu giao thêm", 409);
    }
    const qty = Number(raw?.invoiced_qty ?? raw?.quantity);
    if (!Number.isInteger(qty) || qty <= 0) throw new FulfillmentError("Số lượng giao của mỗi dòng phải là số nguyên > 0");
    const remaining = remainingById.get(key);
    if (qty > remaining) {
      const title = poItemsById.get(key)?.item_title || "sách";
      throw new FulfillmentError(`Số lượng giao của "${title}" vượt số lượng còn phải giao theo hóa đơn (còn ${remaining})`, 409);
    }
    // the invoice may predate a revision that lowered ordered_qty: never ship past the live order
    const leftOnPo = await assertInvoiceQtyWithinRemaining(tx, { id: key, ordered_qty: poItemsById.get(key)?.ordered_qty }, qty);
    if (leftOnPo !== null) {
      throw new FulfillmentError(`Số lượng giao vượt số lượng đặt còn lại của đơn (còn ${Math.max(0, leftOnPo)})`, 409);
    }
    items.push({
      purchase_order_item_id: key,
      variant_id: poItemsById.get(key)?.variant_id || null,
      invoiced_qty: qty,
      unit_cost: priceById.get(key) || 0,
      note: typeof raw?.note === "string" && raw.note.trim() ? raw.note.trim().slice(0, 500) : null,
    });
  }
  if (items.length === 0) throw new FulfillmentError("Phiếu giao cần ít nhất một dòng sách");
  return { invoice, items };
}

/** All invoices of a PO with their delivery notes and progress (both portals use this). */
async function loadInvoiceFulfillment(db, poId) {
  const [invoices, deliveries] = await Promise.all([
    db.procurement_documents.findMany({
      where: { purchase_order_id: poId, document_type: { in: INVOICE_TYPES }, status: { not: "DRAFT" } },
      include: { procurement_document_lines: true },
      orderBy: { created_at: "asc" },
    }),
    db.supplier_delivery_invoices.findMany({
      where: { purchase_order_id: poId, invoice_document_id: { not: null } },
      include: invoiceDeliveryInclude(),
      orderBy: { created_at: "asc" },
    }),
  ]);
  return invoices.map((invoice) => {
    const own = deliveries.filter((delivery) => delivery.invoice_document_id === invoice.id);
    return {
      invoice_id: invoice.id,
      document_number: invoice.document_number,
      external_number: invoice.external_number,
      approval_status: invoice.approval_status,
      ...computeInvoiceFulfillment(invoice, own),
      deliveries: own.map((delivery) => ({
        id: delivery.id,
        delivery_number: delivery.delivery_number || delivery.invoice_number,
        expected_delivery_date: delivery.expected_delivery_date,
        carrier_name: delivery.carrier_name,
        tracking_number: delivery.tracking_number,
        created_at: delivery.created_at,
        status: deliveryNoteStatus(delivery),
        redelivery: isRedelivery(delivery),
        items: (delivery.supplier_delivery_invoice_items || []).map((item) => ({
          purchase_order_item_id: item.purchase_order_item_id,
          shipped_qty: Number(item.invoiced_qty || 0),
          received_qty: isPosted(delivery) ? Number(item.accepted_qty || 0) : null,
        })),
      })),
    };
  });
}

module.exports = {
  FulfillmentError,
  INVOICE_TYPES,
  computeInvoiceFulfillment,
  deliveryNoteStatus,
  normalizeInvoiceFirstLines,
  normalizeDeliveryAgainstInvoice,
  loadInvoiceFulfillment,
};
