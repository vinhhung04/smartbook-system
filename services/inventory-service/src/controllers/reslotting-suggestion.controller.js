/**
 * Re-slotting Suggestion Controller
 */

const reslottingSuggestionService = require('../services/reslotting-suggestion.service');
const { requireWarehouseReadAccess } = require('../utils/warehouse-scope.utils');

/**
 * GET /api/reslotting-suggestions?warehouse_id=...&limit=20
 */
async function getSuggestions(req, res) {
  const { warehouse_id, limit } = req.query;
  const user = req.user;

  if (!warehouse_id) {
    return res.status(400).json({ success: false, error: 'warehouse_id là bắt buộc' });
  }

  const hasReadPermission = user.is_superuser ||
    (Array.isArray(user.permissions) && (
      user.permissions.includes('inventory.stock.read') ||
      user.permissions.includes('inventory.operation.decide')
    ));

  if (!hasReadPermission) {
    return res.status(403).json({
      success: false,
      error: 'Bạn không có quyền xem gợi ý tối ưu vị trí. Cần permission: inventory.stock.read hoặc inventory.operation.decide',
    });
  }

  const canAccess = await requireWarehouseReadAccess(req, res, warehouse_id);
  if (!canAccess) return;

  try {
    const parsedLimit = Math.min(100, Math.max(1, Number(limit) || 20));
    const result = await reslottingSuggestionService.generateReslottingSuggestions(warehouse_id, parsedLimit);
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error generating re-slotting suggestions:', error);
    return res.status(500).json({ success: false, error: 'Lỗi khi tạo gợi ý tối ưu vị trí' });
  }
}

module.exports = { getSuggestions };
