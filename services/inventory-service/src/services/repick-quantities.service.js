// A repick total belongs to a variant once, even when several original lines
// contain that variant. Fill each original line's shortfall in stable ID order.
function addRepickQuantities(lines, repickByVariant, field) {
  const result = lines.map((line) => ({ ...line, [field]: Number(line[field] || 0) }));
  const groups = new Map();
  for (const line of result) {
    const key = String(line.variant_id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(line);
  }
  for (const [variant, group] of groups) {
    let remaining = Number(repickByVariant.get(variant) || 0);
    group.sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')));
    for (const line of group) {
      const assigned = Math.min(remaining, Math.max(0, Number(line.quantity || 0) - line[field]));
      line[field] += assigned;
      remaining -= assigned;
    }
    // Preserve every physically picked copy even for a legacy over-picked batch.
    if (remaining > 0) group[group.length - 1][field] += remaining;
  }
  return result;
}

async function getTransferShippedLines(db, order) {
  const children = await db.transfer_orders.findMany({
    where: { note: { contains: `root_task_id=${encodeURIComponent(order.id)}` }, status: { not: 'CANCELLED' } },
    select: { transfer_order_items: { select: { variant_id: true, shipped_qty: true } } },
  });
  const repick = new Map();
  for (const child of children) for (const line of child.transfer_order_items || []) {
    const key = String(line.variant_id);
    repick.set(key, (repick.get(key) || 0) + Number(line.shipped_qty || 0));
  }
  return addRepickQuantities(order.transfer_order_items, repick, 'shipped_qty');
}

module.exports = { addRepickQuantities, getTransferShippedLines };
