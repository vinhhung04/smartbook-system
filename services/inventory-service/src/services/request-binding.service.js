const crypto = require('node:crypto');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BORROW_SERVICE_ID = '00000000-0000-0000-0000-000000000001';
class RequestBindingError extends Error {
  constructor(message = 'Idempotency-Key đã được dùng cho người thực hiện hoặc nội dung khác', statusCode = 409,
    code = 'IDEMPOTENCY_PAYLOAD_CONFLICT') {
    super(message); this.statusCode = statusCode; this.code = code;
  }
}
const identifier = value => value == null || value === '' ? null : String(value).trim().toLowerCase();
const text = value => String(value || '').trim() || null;
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex'); }
function number(value, fallback) {
  const raw = value ?? fallback;
  if (!['number', 'string'].includes(typeof raw)) throw new RequestBindingError('Số lượng/đơn giá không hợp lệ', 400, 'INVALID_REQUEST_PAYLOAD');
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new RequestBindingError('Số lượng/đơn giá không hợp lệ', 400, 'INVALID_REQUEST_PAYLOAD');
  return n;
}
function borrowServicePrincipal(user = {}) {
  // These are verified JWT claims supplied by authenticateToken, never body or
  // client headers. Only Borrow's reserved service principal may preserve an
  // approved original creator when its saga worker resumes without the user JWT.
  return identifier(user.id) === BORROW_SERVICE_ID && identifier(user.sub) === BORROW_SERVICE_ID
    && user.service === 'borrow-service' && user.iss === 'borrow-service' && user.aud === 'inventory-service'
    && user.email === 'borrow-service@smartbook.local' && user.is_superuser === true
    && user.permissions?.includes('borrow.write') && user.permissions?.includes('inventory.stock.write');
}
function reserveIdentity(req) {
  const body = req.body, user = req.user || {};
  const caller = identifier(user.id || user.sub);
  if (!caller || !UUID.test(caller)) throw new RequestBindingError('Thiếu người thực hiện đã xác thực', 401, 'UNAUTHORIZED');
  const creator = identifier(body.created_by_user_id), customer = identifier(body.customer_id);
  if ([creator, customer].some(id => id && !UUID.test(id))) throw new RequestBindingError('customer_id/created_by_user_id phải là UUID', 400, 'INVALID_REQUEST_PAYLOAD');
  const quantity = number(body.quantity, 1), expiry = new Date(body.expires_at);
  if (!Number.isInteger(quantity) || quantity <= 0 || !Number.isFinite(expiry.getTime())) throw new RequestBindingError('quantity/expires_at không hợp lệ', 400, 'INVALID_REQUEST_PAYLOAD');
  const service = borrowServicePrincipal(user);
  return { identity: { version: 1, operation: 'reserve', actor_id: service ? creator || caller : caller,
    reservation_id: identifier(body.reservation_id), reservation_number: text(body.reservation_number), customer_id: customer,
    variant_id: identifier(body.variant_id), warehouse_id: identifier(body.warehouse_id), quantity, expires_at: expiry.toISOString(),
    created_by_user_id: creator, reservation_channel: String(body.reservation_channel || '').trim().toUpperCase() === 'CUSTOMER' ? 'CUSTOMER' : 'STAFF' },
    invalidDelegation: !service && creator && creator !== caller };
}
function assertReserveReplay(movement, identity) {
  const saved = movement?.metadata?.borrow_request;
  if (!saved || saved.version !== 1 || saved.operation !== 'reserve') {
    // Older movements do not persist the channel or verified caller. Do not
    // infer these from a caller-supplied creator and silently approve a replay.
    throw new RequestBindingError('Yêu cầu cũ chưa lưu đủ danh tính ban đầu; cần đối soát phiếu giữ hàng', 409, 'LEGACY_RESERVE_RECONCILIATION_REQUIRED');
  }
  if (movement.source_service !== 'BORROW_SERVICE' || movement.movement_type !== 'RESERVE' ||
      movement.reference_type !== 'LOAN_RESERVATION' || identifier(movement.reference_id) !== identity.reservation_id || digest(saved) !== digest(identity)) {
    throw new RequestBindingError();
  }
}
function receiptIdentity(req, invoice) {
  const lines = new Map((invoice.supplier_delivery_invoice_items || []).map(line => [identifier(line.id), line]));
  // unassigned only appears when requested, so fingerprints saved before the option existed still match
  return { version: 1, operation: 'delivery-receipt', actor_id: identifier(req.user?.id), invoice_id: identifier(invoice.id),
    ...(req.body.unassigned === true ? { unassigned: true } : {}),
    warehouse_id: identifier(req.body.warehouse_id), note: text(req.body.note) || `Created from supplier invoice ${invoice.invoice_number}`,
    items: (Array.isArray(req.body.items) ? req.body.items : []).map(item => {
      const invoiceItemId = identifier(item.invoice_item_id), line = lines.get(invoiceItemId);
      return { invoice_item_id: invoiceItemId, delivered_qty: number(item.delivered_qty ?? item.quantity),
        damaged_qty: number(item.damaged_qty, 0), rejected_qty: number(item.rejected_qty, 0),
        unit_cost: Number(number(item.unit_cost ?? Number(line?.unit_cost ?? 0), 0).toFixed(2)), location_id: identifier(item.location_id), note: text(item.note) };
    }).sort((a, b) => String(a.invoice_item_id).localeCompare(String(b.invoice_item_id))) };
}
async function assertReceiptReplay(db, req, receipt, invoice) {
  const creation = await db.inventory_audit_logs.findFirst({ where: { entity_type: 'GOODS_RECEIPT', entity_id: receipt.id,
    action_name: 'GOODS_RECEIPT_CREATED_FROM_SUPPLIER_INVOICE' }, orderBy: { created_at: 'asc' } });
  const saved = creation?.after_data?.request_identity;
  if (!saved || saved.version !== 1 || saved.operation !== 'delivery-receipt') {
    // Counts, cost, assignment and notes can all change after creation. Current
    // GRN rows cannot prove an old request's original fingerprint.
    throw new RequestBindingError('Phiếu nhập cũ chưa lưu nội dung tạo ban đầu; cần đối soát trước khi gửi lại', 409, 'LEGACY_RECEIPT_RECONCILIATION_REQUIRED');
  }
  if (digest(saved) !== digest(receiptIdentity(req, invoice))) throw new RequestBindingError();
}

module.exports = { RequestBindingError, reserveIdentity, assertReserveReplay, receiptIdentity, assertReceiptReplay, borrowServicePrincipal };
