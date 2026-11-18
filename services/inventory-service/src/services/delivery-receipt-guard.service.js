const { ProcurementError } = require('./procurement-receipt.service');

// A PO may have many deliveries. Only the physical delivery is serialized here;
// cancelled receipts remain historical and do not consume its active receipt slot.
async function findActiveDeliveryReceipt(tx, deliveryId, excludeReceiptId) {
  await tx.$queryRawUnsafe('SELECT id FROM supplier_delivery_invoices WHERE id = $1::uuid FOR UPDATE', deliveryId);
  return tx.goods_receipts.findFirst({
    where: {
      supplier_delivery_invoice_id: deliveryId,
      status: { not: 'CANCELLED' },
      ...(excludeReceiptId ? { id: { not: excludeReceiptId } } : {}),
    },
    select: { id: true, receipt_number: true, status: true, idempotency_key: true, purchase_order_id: true },
  });
}

async function assertDeliveryReceiptAvailable(tx, deliveryId, excludeReceiptId) {
  const existing = await findActiveDeliveryReceipt(tx, deliveryId, excludeReceiptId);
  if (existing) {
    const error = new ProcurementError('DELIVERY_RECEIPT_EXISTS', 'Phiếu giao đã có phiếu nhập đang hoạt động; cần xử lý phiếu trùng trước khi ghi sổ', 409);
    error.existingReceiptId = existing.id;
    throw error;
  }
}

module.exports = { findActiveDeliveryReceipt, assertDeliveryReceiptAvailable };
