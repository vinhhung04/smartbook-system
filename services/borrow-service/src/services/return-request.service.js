const CONDITIONS = new Set(['NEW', 'GOOD', 'FAIR', 'WORN', 'DAMAGED', 'POOR', 'LOST']);
const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
class ReturnRequestError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
function normalizeRow(raw, requiredId) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ReturnRequestError('Dòng trả sách không hợp lệ');
  const id = raw.loan_item_id || null;
  if ((requiredId || id) && !uuid(id)) throw new ReturnRequestError('loan_item_id phải là UUID hợp lệ');
  if (raw.mark_lost !== undefined && typeof raw.mark_lost !== 'boolean') throw new ReturnRequestError('mark_lost phải là boolean');
  const condition = raw.mark_lost ? 'LOST' : String(raw.item_condition_on_return || 'GOOD').trim().toUpperCase();
  if (!CONDITIONS.has(condition)) throw new ReturnRequestError('Tình trạng trả sách không hợp lệ');
  const location = raw.returned_to_location_id || null;
  if (location && !uuid(location)) throw new ReturnRequestError('returned_to_location_id phải là UUID hợp lệ');
  for (const field of ['notes', 'settlement_reason']) {
    if (raw[field] != null && (typeof raw[field] !== 'string' || raw[field].length > 2000)) throw new ReturnRequestError(`${field} phải là chuỗi tối đa 2000 ký tự`);
  }
  const notes = String(raw.notes || '').trim() || null;
  return { loan_item_id: id?.toLowerCase() || null, condition, markLost: condition === 'LOST',
    locationId: location?.toLowerCase() || null, notes, reason: String(raw.settlement_reason || notes || '').trim() || null };
}
function normalizeReturnRequest(body = {}) {
  const batch = Object.hasOwn(body, 'items');
  if (batch) {
    if (!Array.isArray(body.items) || !body.items.length || body.items.length > 100) throw new ReturnRequestError('items phải có từ 1 đến 100 cuốn');
    if (['loan_item_id', 'item_condition_on_return', 'mark_lost', 'notes', 'settlement_reason', 'returned_to_location_id'].some(field => body[field] !== undefined)) throw new ReturnRequestError('Không kết hợp items với dữ liệu trả chung');
    const rows = body.items.map(row => normalizeRow(row, true));
    if (new Set(rows.map(row => row.loan_item_id)).size !== rows.length) throw new ReturnRequestError('Mỗi cuốn chỉ được xuất hiện một lần');
    return { batch, rows };
  }
  const row = normalizeRow(body, false);
  if (row.markLost && !row.loan_item_id) throw new ReturnRequestError('Sách mất cần loan_item_id để xử lý từng cuốn');
  return { batch, rows: [row] };
}
function selectReturnItems(request, loanItems) {
  const rows = !request.batch && !request.rows[0].loan_item_id
    ? loanItems.filter(item => ['BORROWED', 'OVERDUE'].includes(item.status)).map(item => ({ ...request.rows[0], loan_item_id: item.id }))
    : request.rows;
  if (!rows.length) throw new ReturnRequestError('Không có sách đang mượn để trả', 409);
  return rows.map(row => {
    const item = loanItems.find(item => item.id.toLowerCase() === row.loan_item_id);
    if (!item || !['BORROWED', 'OVERDUE'].includes(item.status)) throw new ReturnRequestError('Sách không thuộc phiếu hoặc không còn đang mượn', 409);
    return { ...row, item };
  });
}
function returnFingerprint(request) {
  return JSON.stringify({ ...request, rows: [...request.rows].sort((a, b) => String(a.loan_item_id).localeCompare(String(b.loan_item_id))) });
}
module.exports = { ReturnRequestError, normalizeReturnRequest, selectReturnItems, returnFingerprint };
