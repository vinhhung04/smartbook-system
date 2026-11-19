const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PICK_LINES = 20;

/**
 * The shelves a librarian took the copies from: [{ location_id, quantity }].
 * Returns { picks } when the lines are well formed and add up to `expectedQuantity`,
 * otherwise { error } with a message for the librarian.
 */
function parsePicks(raw, expectedQuantity) {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: 'Cần nhập vị trí (kệ) đã lấy sách' };
  }
  if (raw.length > MAX_PICK_LINES) {
    return { error: `Tối đa ${MAX_PICK_LINES} vị trí cho một lần lấy sách` };
  }

  const picks = [];
  for (const line of raw) {
    const locationId = String(line?.location_id || '').trim();
    const quantity = Number(line?.quantity);
    if (!UUID_PATTERN.test(locationId)) return { error: 'location_id của vị trí đã lấy sách không hợp lệ' };
    if (!Number.isInteger(quantity) || quantity <= 0) return { error: 'Số lượng lấy ở mỗi vị trí phải là số nguyên dương' };
    picks.push({ location_id: locationId, quantity });
  }

  const total = picks.reduce((sum, pick) => sum + pick.quantity, 0);
  if (total !== expectedQuantity) {
    return { error: `Tổng số sách đã lấy (${total}) phải bằng số lượng mượn (${expectedQuantity})` };
  }

  return { picks };
}

module.exports = { parsePicks };
