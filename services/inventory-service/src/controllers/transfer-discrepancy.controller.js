const { prisma } = require('../lib/prisma');
const { parseId } = require('../utils/validation');
const { scopedWarehouseWhere, canWriteWarehouse, scopeErrorStatus } = require('../utils/warehouse-scope.utils');
const { caseDetail, resolveTransferDiscrepancy, isUuid } = require('../services/transfer-discrepancy.service');
const { toSerializableError } = require('../utils/inventory');

function failure(res, error) {
  if (String(error.message).includes('STOCK_AUDIT_LOCATION_FROZEN') || JSON.stringify(error.meta || {}).includes('STOCK_AUDIT_LOCATION_FROZEN')) {
    return res.status(409).json({ message: 'Vị trí đang được kiểm kê; vui lòng thử lại sau khi kiểm đếm hoàn tất', code: 'STOCK_AUDIT_LOCATION_FROZEN' });
  }
  const code = scopeErrorStatus(error) === 503 ? 503 : error.statusCode || (toSerializableError(error) ? 409 : 500);
  if (code === 500) console.error('Transfer discrepancy operation failed:', error);
  return res.status(code).json({ message: code === 500 ? 'Internal server error' : error.message });
}
async function listDiscrepancies(req, res) {
  try {
    const scope = await scopedWarehouseWhere(req.user, 'to_warehouse_id', parseId(req.query.warehouse_id));
    const cases = await prisma.transfer_discrepancies.findMany({ where: { ...scope, status: req.query.status === 'RESOLVED' ? 'RESOLVED' : 'OPEN' }, orderBy: { created_at: 'desc' }, take: 100 });
    const orders = cases.length ? await prisma.transfer_orders.findMany({ where: { id: { in: cases.map(row => row.transfer_order_id) } }, select: { id: true, transfer_number: true } }) : [];
    const names = new Map(orders.map(row => [row.id, row.transfer_number]));
    const items = cases.length ? await prisma.transfer_discrepancy_items.findMany({ where: { discrepancy_id: { in: cases.map(row => row.id) } } }) : [];
    const variants = items.length ? await prisma.book_variants.findMany({ where: { id: { in: items.map(item => item.variant_id) } }, select: { id: true, sku: true, books: { select: { title: true } } } }) : [];
    const titles = new Map(variants.map(row => [row.id, row]));
    return res.json({ data: cases.map(row => ({ ...row, transfer_number: names.get(row.transfer_order_id), items: items.filter(item => item.discrepancy_id === row.id).map(item => ({ ...item, title: titles.get(item.variant_id)?.books?.title, sku: titles.get(item.variant_id)?.sku })) })) });
  } catch (error) { return failure(res, error); }
}
async function getDiscrepancy(req, res) {
  try { return res.json({ data: await caseDetail(prisma, req.params.id) }); }
  catch (error) { return failure(res, error); }
}
async function resolveDiscrepancy(req, res) {
  const key = String(req.get?.('Idempotency-Key') || req.headers?.['idempotency-key'] || '').trim();
  if (!key || key.length > 100 || !isUuid(req.body?.discrepancy_item_id)) return res.status(400).json({ message: 'Cần Idempotency-Key và mã dòng chênh lệch hợp lệ' });
  try {
    const order = await prisma.transfer_orders.findUnique({ where: { id: req.params.id }, select: { from_warehouse_id: true } });
    if (!order) return res.status(404).json({ message: 'Không tìm thấy phiếu chuyển kho' });
    const sourcePermission = String(req.body.action).toUpperCase() === 'RETURN_TO_SOURCE' ? await canWriteWarehouse(req.user, order.from_warehouse_id, { fresh: true }) : false;
    const result = await prisma.$transaction(tx => resolveTransferDiscrepancy(tx, { transferId: req.params.id, body: req.body,
      key, actorId: req.user.id, canWriteSource: sourcePermission }), { timeout: 15000 });
    return res.json(result);
  } catch (error) { return failure(res, error); }
}
module.exports = { listDiscrepancies, getDiscrepancy, resolveDiscrepancy };
