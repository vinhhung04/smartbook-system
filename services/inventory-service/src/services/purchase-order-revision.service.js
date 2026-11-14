// Purchase Order Revision (P1.1): a change to ordered_qty/unit_cost/expected_date/note on a
// PO that has already been dispatched, kept as its own before/after history instead of
// overwriting purchase_order_items in place. The live purchase_order_items row is only written
// when a revision reaches EFFECTIVE, so a GRN or invoice posted while a revision is pending still
// reads today's values unchanged — this is also what makes "cannot receive against a revision
// that isn't yet effective" true without touching goods-receipt posting code at all.

// Revisable: the PO has been sent and isn't finished/dead. DRAFT/PENDING_APPROVAL/APPROVED go
// through the existing updatePurchaseOrder path instead; RECEIVED/CANCELLED/REJECTED have
// nothing left to revise.
const REVISABLE_PO_STATUSES = new Set([
  "SENT_TO_SUPPLIER",
  "SUPPLIER_CONFIRMED",
  "PARTIALLY_RECEIVED",
  "SHORTAGE_REPORTED",
]);

const ACTIVE_REVISION_STATUSES = ["PENDING_APPROVAL", "PENDING_SUPPLIER_RECONFIRMATION"];

class RevisionError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function snapshotPurchaseOrder(po) {
  return {
    header: {
      expected_date: po.expected_date ? new Date(po.expected_date).toISOString() : null,
      note: po.note || null,
    },
    lines: (po.purchase_order_items || []).map((item) => ({
      purchase_order_item_id: item.id,
      variant_id: item.variant_id,
      ordered_qty: Number(item.ordered_qty),
      unit_cost: money(item.unit_cost),
    })),
  };
}

/**
 * Pure: validate a revision request against the PO's current (still-effective) state and
 * build its before/after snapshots.
 * @param {object} po   purchase order with purchase_order_items, as currently effective
 * @param {object} body { reason, expected_date?, note?, requires_supplier_reconfirmation?,
 *                         lines?: [{ purchase_order_item_id, ordered_qty?, unit_cost? }] }
 */
function buildRevisionProposal(po, body = {}) {
  if (!REVISABLE_PO_STATUSES.has(po.status)) {
    throw new RevisionError(`Không thể tạo yêu cầu thay đổi khi đơn đặt hàng ở trạng thái ${po.status}`);
  }
  const reason = String(body.reason || "").trim().slice(0, 2000);
  if (!reason) throw new RevisionError("Cần ghi rõ lý do thay đổi đơn đặt hàng");

  const items = po.purchase_order_items || [];
  const itemsById = new Map(items.map((item) => [String(item.id), item]));
  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  const changesByLine = new Map();
  for (const rawLine of rawLines) {
    const itemId = String(rawLine?.purchase_order_item_id || "");
    const item = itemsById.get(itemId);
    if (!item) throw new RevisionError("Dòng thay đổi không thuộc đơn đặt hàng này");
    if (changesByLine.has(itemId)) throw new RevisionError("Mỗi dòng chỉ được xuất hiện một lần trong yêu cầu thay đổi");

    const hasQty = rawLine.ordered_qty !== undefined && rawLine.ordered_qty !== "" && rawLine.ordered_qty !== null;
    const hasCost = rawLine.unit_cost !== undefined && rawLine.unit_cost !== "" && rawLine.unit_cost !== null;
    const nextQty = hasQty ? Number(rawLine.ordered_qty) : Number(item.ordered_qty);
    const nextCost = hasCost ? Number(rawLine.unit_cost) : Number(item.unit_cost);
    if (!Number.isInteger(nextQty) || nextQty <= 0) throw new RevisionError("ordered_qty mới phải là số nguyên dương");
    if (!Number.isFinite(nextCost) || nextCost < 0) throw new RevisionError("unit_cost mới phải là số không âm");
    const receivedQty = Number(item.received_qty || 0);
    if (nextQty < receivedQty) {
      throw new RevisionError(`ordered_qty mới (${nextQty}) không được nhỏ hơn số lượng đã nhận (${receivedQty})`);
    }
    changesByLine.set(itemId, { ordered_qty: nextQty, unit_cost: money(nextCost) });
  }

  const hasExpectedDate = body.expected_date !== undefined;
  if (hasExpectedDate && body.expected_date && Number.isNaN(new Date(body.expected_date).getTime())) {
    throw new RevisionError("expected_date không hợp lệ");
  }
  const nextExpectedDate = hasExpectedDate ? (body.expected_date ? new Date(body.expected_date) : null) : po.expected_date;
  const hasNote = body.note !== undefined;
  const nextNote = hasNote ? (String(body.note || "").trim() || null) : po.note;

  const before = snapshotPurchaseOrder(po);
  const after = {
    header: {
      expected_date: nextExpectedDate ? new Date(nextExpectedDate).toISOString() : null,
      note: nextNote,
    },
    lines: before.lines.map((line) => {
      const change = changesByLine.get(String(line.purchase_order_item_id));
      return change ? { ...line, ...change } : line;
    }),
  };

  const lineChanged = after.lines.some((line, idx) => (
    line.ordered_qty !== before.lines[idx].ordered_qty || line.unit_cost !== before.lines[idx].unit_cost
  ));
  const headerChanged = after.header.note !== before.header.note || after.header.expected_date !== before.header.expected_date;
  if (!lineChanged && !headerChanged) {
    throw new RevisionError("Không có thay đổi nào trong yêu cầu — không cần tạo revision");
  }

  const requiresSupplierReconfirmation = body.requires_supplier_reconfirmation === undefined
    ? true
    : Boolean(body.requires_supplier_reconfirmation);

  return {
    reason,
    before_snapshot: before,
    after_snapshot: after,
    requires_supplier_reconfirmation: requiresSupplierReconfirmation,
  };
}

/** Only one revision may be in flight per PO at a time — resolve it before requesting another. */
async function assertNoActivePendingRevision(tx, poId) {
  const pending = await tx.purchase_order_revisions.count({
    where: { purchase_order_id: poId, status: { in: ACTIVE_REVISION_STATUSES } },
  });
  if (pending > 0) {
    throw new RevisionError(
      "Đơn đặt hàng đang có yêu cầu thay đổi khác chờ xử lý — hãy duyệt, từ chối hoặc hủy yêu cầu đó trước",
      409,
    );
  }
}

async function nextRevisionNumber(tx, poId) {
  const last = await tx.purchase_order_revisions.findFirst({
    where: { purchase_order_id: poId },
    orderBy: { revision_number: "desc" },
    select: { revision_number: true },
  });
  return (last?.revision_number || 0) + 1;
}

/** Sum of this PO line's already-invoiced qty, excluding redelivery notes (mirrors
 * assertInvoiceQtyWithinRemaining in procurement-receipt.service.js, minus its own row lock —
 * the caller here already holds that lock via applyRevision's FOR UPDATE). */
async function sumNonRedeliveryInvoiced(tx, poItemId) {
  const rows = await tx.supplier_delivery_invoice_items.findMany({
    where: { purchase_order_item_id: poItemId },
    select: { invoiced_qty: true, supplier_delivery_invoices: { select: { raw_payload: true } } },
  });
  return rows
    .filter((row) => row.supplier_delivery_invoices?.raw_payload?.redelivery !== true)
    .reduce((sum, row) => sum + Number(row.invoiced_qty || 0), 0);
}

/**
 * Write a revision's after_snapshot to the live PO (header + lines) and mark it effective.
 * Re-checks received/invoiced quantities against a fresh, row-locked read rather than trusting
 * the snapshot captured at request time, so a GRN or invoice posted while the revision was
 * pending can't be silently invalidated by applying a smaller ordered_qty underneath it.
 */
async function applyRevision(tx, revision) {
  const lines = revision.after_snapshot?.lines || [];
  const lineIds = lines.map((line) => line.purchase_order_item_id).filter(Boolean);

  if (lineIds.length > 0) {
    await tx.$queryRawUnsafe(
      "SELECT id FROM purchase_order_items WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      lineIds,
    );
  }

  const currentItems = await tx.purchase_order_items.findMany({
    where: { id: { in: lineIds } },
    select: { id: true, ordered_qty: true, received_qty: true },
  });
  const currentById = new Map(currentItems.map((item) => [String(item.id), item]));

  for (const line of lines) {
    const current = currentById.get(String(line.purchase_order_item_id));
    if (!current) throw new RevisionError("Dòng đơn đặt hàng không còn tồn tại", 409);

    const receivedQty = Number(current.received_qty || 0);
    if (Number(line.ordered_qty) < receivedQty) {
      throw new RevisionError(
        `Không thể áp dụng thay đổi: số lượng đã nhận (${receivedQty}) đã vượt số lượng mới (${line.ordered_qty})`,
        409,
      );
    }
    const invoicedQty = await sumNonRedeliveryInvoiced(tx, current.id);
    if (Number(line.ordered_qty) < invoicedQty) {
      throw new RevisionError(
        `Không thể áp dụng thay đổi: số lượng đã lập hóa đơn (${invoicedQty}) đã vượt số lượng mới (${line.ordered_qty})`,
        409,
      );
    }

    await tx.purchase_order_items.update({
      where: { id: current.id },
      data: { ordered_qty: Number(line.ordered_qty), unit_cost: Number(line.unit_cost) },
    });
  }

  const header = revision.after_snapshot?.header || {};
  await tx.purchase_orders.update({
    where: { id: revision.purchase_order_id },
    data: {
      expected_date: header.expected_date ? new Date(header.expected_date) : null,
      note: header.note ?? null,
      updated_at: new Date(),
    },
  });
}

module.exports = {
  RevisionError,
  REVISABLE_PO_STATUSES,
  ACTIVE_REVISION_STATUSES,
  snapshotPurchaseOrder,
  buildRevisionProposal,
  assertNoActivePendingRevision,
  nextRevisionNumber,
  applyRevision,
};
