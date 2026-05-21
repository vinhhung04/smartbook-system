/**
 * Storage Suggestion Controller
 *
 * Handles API endpoints for storage location suggestions.
 */

const storageSuggestionService = require('../services/storage-suggestion.service');
const { requireWarehouseReadAccess, requireWarehouseWriteAccess } = require('../utils/warehouse-scope.utils');
const { authorizeAnyPermission } = require('../middlewares/auth.middleware');

/**
 * POST /api/storage-suggestions
 *
 * Get storage location suggestions for a book/variant in a warehouse.
 *
 * Request body:
 * {
 *   "warehouse_id": "uuid",
 *   "book_id": "uuid",        // optional if variant_id provided
 *   "variant_id": "uuid",      // optional if book_id provided
 *   "quantity": 10,            // default 1
 *   "mode": "RECEIVING"       // RECEIVING, PUTAWAY, RELOCATION, AI_IMPORT
 * }
 */
async function getSuggestions(req, res) {
  const { warehouse_id, book_id, variant_id, quantity, mode } = req.body;
  const user = req.user;

  if (!warehouse_id) {
    return res.status(400).json({
      success: false,
      error: 'warehouse_id là bắt buộc',
    });
  }

  if (!book_id && !variant_id) {
    return res.status(400).json({
      success: false,
      error: 'book_id hoặc variant_id là bắt buộc',
    });
  }

  const hasReadPermission = user.is_superuser ||
    (Array.isArray(user.permissions) && user.permissions.includes('inventory.stock.read'));

  if (!hasReadPermission) {
    return res.status(403).json({
      success: false,
      error: 'Bạn không có quyền xem gợi ý vị trí. Cần permission: inventory.stock.read',
    });
  }

  const canAccess = await requireWarehouseReadAccess(req, res, warehouse_id);
  if (!canAccess) return;

  try {
    const result = await storageSuggestionService.generateSuggestions(
      warehouse_id,
      book_id || null,
      variant_id || null,
      quantity || 1,
      mode || 'RECEIVING'
    );

    return res.json(result);
  } catch (error) {
    console.error('Error generating storage suggestions:', error);
    return res.status(500).json({
      success: false,
      error: 'Lỗi khi tạo gợi ý vị trí',
    });
  }
}

/**
 * GET /api/storage-suggestions/context
 *
 * Get context data for frontend display.
 *
 * Query params:
 * - warehouse_id: "uuid" (required)
 * - variant_id: "uuid" (optional)
 * - book_id: "uuid" (optional)
 */
async function getContext(req, res) {
  const { warehouse_id, variant_id, book_id } = req.query;
  const user = req.user;

  if (!warehouse_id) {
    return res.status(400).json({
      success: false,
      error: 'warehouse_id là bắt buộc',
    });
  }

  if (!book_id && !variant_id) {
    return res.status(400).json({
      success: false,
      error: 'book_id hoặc variant_id là bắt buộc',
    });
  }

  const hasReadPermission = user.is_superuser ||
    (Array.isArray(user.permissions) && user.permissions.includes('inventory.stock.read'));

  if (!hasReadPermission) {
    return res.status(403).json({
      success: false,
      error: 'Bạn không có quyền xem thông tin vị trí. Cần permission: inventory.stock.read',
    });
  }

  const canAccess = await requireWarehouseReadAccess(req, res, warehouse_id);
  if (!canAccess) return;

  try {
    const result = await storageSuggestionService.getContext(
      warehouse_id,
      variant_id || null,
      book_id || null
    );

    return res.json(result);
  } catch (error) {
    console.error('Error getting storage context:', error);
    return res.status(500).json({
      success: false,
      error: 'Lỗi khi lấy thông tin vị trí',
    });
  }
}

/**
 * POST /api/storage-suggestions/apply
 *
 * Validate and prepare a suggestion for goods receipt.
 * This does NOT create stock movements - it only validates.
 * The actual stock update should be done through the goods receipt flow.
 *
 * Request body:
 * {
 *   "warehouse_id": "uuid",
 *   "variant_id": "uuid",
 *   "location_id": "uuid",
 *   "quantity": 10
 * }
 */
async function applySuggestion(req, res) {
  const { warehouse_id, variant_id, location_id, quantity } = req.body;
  const user = req.user;

  if (!warehouse_id || !variant_id || !location_id || !quantity) {
    return res.status(400).json({
      success: false,
      error: 'warehouse_id, variant_id, location_id và quantity là bắt buộc',
    });
  }

  const hasWritePermission = user.is_superuser ||
    (Array.isArray(user.permissions) && user.permissions.includes('inventory.stock.write'));

  if (!hasWritePermission) {
    return res.status(403).json({
      success: false,
      error: 'Bạn không có quyền xác nhận vị trí. Cần permission: inventory.stock.write',
    });
  }

  const canAccess = await requireWarehouseWriteAccess(req, res, warehouse_id);
  if (!canAccess) return;

  try {
    const result = await storageSuggestionService.applySuggestion(
      warehouse_id,
      variant_id,
      location_id,
      quantity
    );

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.json(result);
  } catch (error) {
    console.error('Error applying storage suggestion:', error);
    return res.status(500).json({
      success: false,
      error: 'Lỗi khi xác nhận vị trí',
    });
  }
}

module.exports = {
  getSuggestions,
  getContext,
  applySuggestion,
};
