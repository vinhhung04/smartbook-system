/**
 * Storage Suggestion Controller
 *
 * Handles API endpoints for storage location suggestions.
 */

const storageSuggestionService = require('../services/storage-suggestion.service');
const { requireWarehouseReadAccess, requireWarehouseWriteAccess } = require('../utils/warehouse-scope.utils');
const { parseId, toInt } = require('../utils/validation');

const { VALID_SUGGESTION_MODES } = storageSuggestionService;

/**
 * POST /api/storage-suggestions
 *
 * Get storage location suggestions for a book/variant in a warehouse.
 *
 * Request body:
 * {
 *   "warehouse_id": "uuid",
 *   "variant_id": "uuid",      // required — putaway needs a concrete variant
 *   "book_id": "uuid",         // optional; if given, must belong to variant_id
 *   "quantity": 10,            // default 1
 *   "mode": "RECEIVING",      // RECEIVING, PUTAWAY, RELOCATION, AI_IMPORT
 *   "explain": true           // optional; false skips the AI paraphrase (ranking only)
 * }
 */
async function getSuggestions(req, res) {
  const warehouseId = parseId(req.body?.warehouse_id);
  const variantId = parseId(req.body?.variant_id);
  const bookId = parseId(req.body?.book_id);
  const user = req.user;

  if (!warehouseId) {
    return res.status(400).json({
      success: false,
      error: 'warehouse_id là bắt buộc',
    });
  }

  if (!variantId) {
    return res.status(400).json({
      success: false,
      error: 'variant_id là bắt buộc',
    });
  }

  const quantity = toInt(req.body?.quantity ?? 1);
  if (!quantity || quantity <= 0) {
    return res.status(400).json({
      success: false,
      error: 'quantity phải là số nguyên dương',
    });
  }

  const mode = req.body?.mode || 'RECEIVING';
  if (!VALID_SUGGESTION_MODES.includes(mode)) {
    return res.status(400).json({
      success: false,
      error: `mode phải là một trong: ${VALID_SUGGESTION_MODES.join(', ')}`,
    });
  }

  const hasReadPermission = user.is_superuser ||
    (Array.isArray(user.permissions) && (
      user.permissions.includes('inventory.stock.read') ||
      user.permissions.includes('inventory.operation.decide') ||
      user.permissions.includes('inventory.task.progress')
    ));

  if (!hasReadPermission) {
    return res.status(403).json({
      success: false,
      error: 'Bạn không có quyền xem gợi ý vị trí. Cần permission: inventory.stock.read, inventory.operation.decide hoặc inventory.task.progress',
    });
  }

  const canAccess = await requireWarehouseReadAccess(req, res, warehouseId);
  if (!canAccess) return;

  try {
    if (bookId) {
      const bookInfo = await storageSuggestionService.getBookInfo(variantId);
      if (!bookInfo) {
        return res.status(400).json({
          success: false,
          error: 'Không tìm thấy thông tin sách/variant',
        });
      }
      if (bookInfo.bookId !== bookId) {
        return res.status(400).json({
          success: false,
          error: 'variant_id không thuộc book_id đã cho',
        });
      }
    }

    const result = await storageSuggestionService.generateSuggestions(
      warehouseId,
      variantId,
      quantity,
      mode,
      req.requestId,
      { explain: req.body?.explain !== false },
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
 * - variant_id: "uuid" (required)
 */
async function getContext(req, res) {
  const warehouseId = parseId(req.query.warehouse_id);
  const variantId = parseId(req.query.variant_id);
  const user = req.user;

  if (!warehouseId) {
    return res.status(400).json({
      success: false,
      error: 'warehouse_id là bắt buộc',
    });
  }

  if (!variantId) {
    return res.status(400).json({
      success: false,
      error: 'variant_id là bắt buộc',
    });
  }

  const hasReadPermission = user.is_superuser ||
    (Array.isArray(user.permissions) && (
      user.permissions.includes('inventory.stock.read') ||
      user.permissions.includes('inventory.operation.decide')
    ));

  if (!hasReadPermission) {
    return res.status(403).json({
      success: false,
      error: 'Bạn không có quyền xem thông tin vị trí. Cần permission: inventory.stock.read hoặc inventory.operation.decide',
    });
  }

  const canAccess = await requireWarehouseReadAccess(req, res, warehouseId);
  if (!canAccess) return;

  try {
    const result = await storageSuggestionService.getContext(warehouseId, variantId);

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
 *   "quantity": 10,
 *   "mode": "RECEIVING"        // optional, default RECEIVING
 * }
 */
async function applySuggestion(req, res) {
  const warehouseId = parseId(req.body?.warehouse_id);
  const variantId = parseId(req.body?.variant_id);
  const locationId = parseId(req.body?.location_id);
  const user = req.user;

  if (!warehouseId || !variantId || !locationId || !req.body?.quantity) {
    return res.status(400).json({
      success: false,
      error: 'warehouse_id, variant_id, location_id và quantity là bắt buộc',
    });
  }

  const quantity = toInt(req.body.quantity);
  if (!quantity || quantity <= 0) {
    return res.status(400).json({
      success: false,
      error: 'quantity phải là số nguyên dương',
    });
  }

  const mode = req.body?.mode || 'RECEIVING';
  if (!VALID_SUGGESTION_MODES.includes(mode)) {
    return res.status(400).json({
      success: false,
      error: `mode phải là một trong: ${VALID_SUGGESTION_MODES.join(', ')}`,
    });
  }

  const hasWritePermission = user.is_superuser ||
    (Array.isArray(user.permissions) && user.permissions.includes('inventory.operation.decide'));

  if (!hasWritePermission) {
    return res.status(403).json({
      success: false,
      error: 'Forbidden. Required permission: inventory.operation.decide',
    });
  }

  const canAccess = await requireWarehouseWriteAccess(req, res, warehouseId);
  if (!canAccess) return;

  try {
    const result = await storageSuggestionService.applySuggestion(
      warehouseId,
      variantId,
      locationId,
      quantity,
      mode
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
