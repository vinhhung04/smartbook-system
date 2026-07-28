/**
 * Re-slotting Suggestion Service
 *
 * Suggests swapping high-turnover books into more accessible shelf locations.
 * Unlike storage-suggestion.service.js (picks a location for NEW incoming stock),
 * this evaluates ALL existing placements in a warehouse and flags mismatches.
 *
 * Accessibility is not tracked as an explicit field on `locations` — it's derived
 * from the aisle/shelf/bin ordinal (lower number = closer to the entrance / easier
 * to reach). This heuristic was confirmed with the user as acceptable in place of
 * adding a new schema column.
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const ANALYTICS_SERVICE_URL = String(process.env.ANALYTICS_SERVICE_URL || 'http://analytics-service:3006').replace(/\/$/, '');
const INTERNAL_SERVICE_KEY = String(process.env.INTERNAL_SERVICE_KEY || 'smartbook_internal_key').trim();
const TURNOVER_LOOKBACK_DAYS = 90;

function extractOrdinal(value) {
  if (!value) return 0;
  const numMatch = String(value).match(/\d+/);
  if (numMatch) return parseInt(numMatch[0], 10);
  const letterMatch = String(value).trim().toUpperCase().match(/^[A-Z]$/);
  if (letterMatch) return letterMatch[0].charCodeAt(0) - 64;
  return 0;
}

// Lower score = more accessible. Aisle (distance from entrance) dominates,
// then shelf (height), then bin (position within the shelf).
function computeAccessibilityScore(location) {
  return extractOrdinal(location.aisle) * 10000 + extractOrdinal(location.shelf) * 100 + extractOrdinal(location.bin);
}

async function fetchBookTurnover(days = TURNOVER_LOOKBACK_DAYS) {
  const response = await fetch(`${ANALYTICS_SERVICE_URL}/analytics/book-turnover?days=${days}`, {
    signal: AbortSignal.timeout(15000),
    headers: { 'x-internal-service-key': INTERNAL_SERVICE_KEY },
  });
  if (!response.ok) {
    throw new Error(`analytics-service responded ${response.status}`);
  }
  const body = await response.json();
  const items = body?.data?.items || [];
  return new Map(items.map((item) => [item.variant_id, item.borrow_count]));
}

async function generateReslottingSuggestions(warehouseId, limit = 20) {
  const balances = await prisma.stock_balances.findMany({
    where: {
      warehouse_id: warehouseId,
      on_hand_qty: { gt: 0 },
      locations: { location_type: 'SHELF_COMPARTMENT', is_active: true, is_pickable: true },
    },
    include: {
      locations: { select: { id: true, location_code: true, aisle: true, shelf: true, bin: true } },
      book_variants: { select: { id: true, books: { select: { title: true } } } },
    },
  });

  if (balances.length < 2) {
    return { warehouse_id: warehouseId, generated_at: new Date().toISOString(), items: [] };
  }

  const turnoverByVariant = await fetchBookTurnover();

  const placements = balances
    .filter((b) => b.locations)
    .map((b) => ({
      location_id: b.locations.id,
      location_code: b.locations.location_code,
      variant_id: b.variant_id,
      title: b.book_variants?.books?.title || 'Không rõ',
      on_hand_qty: b.on_hand_qty,
      accessibility_score: computeAccessibilityScore(b.locations),
      turnover_count: turnoverByVariant.get(b.variant_id) || 0,
    }));

  const byAccessibility = [...placements].sort((a, b) => a.accessibility_score - b.accessibility_score);
  byAccessibility.forEach((item, idx) => {
    item.accessibility_rank = idx + 1;
  });

  const byTurnover = [...placements].sort((a, b) => b.turnover_count - a.turnover_count);
  byTurnover.forEach((item, idx) => {
    item.turnover_rank = idx + 1;
  });

  const total = placements.length;
  const minImprovementGap = Math.max(2, Math.floor(total / 4));

  const suggestions = [];
  for (const item of placements) {
    const mismatch = item.accessibility_rank - item.turnover_rank;
    if (mismatch < minImprovementGap) continue;

    // Ideal slot for this popularity rank: the location currently ranked at this
    // variant's turnover rank for accessibility — only worth suggesting if that
    // location is actually held by a less popular book right now.
    const target = byAccessibility.find(
      (loc) => loc.accessibility_rank === item.turnover_rank && loc.variant_id !== item.variant_id,
    );
    if (!target || target.turnover_rank <= item.turnover_rank) continue;

    suggestions.push({
      variant_id: item.variant_id,
      title: item.title,
      current_location_id: item.location_id,
      current_location_code: item.location_code,
      suggested_location_id: target.location_id,
      suggested_location_code: target.location_code,
      turnover_count: item.turnover_count,
      accessibility_rank: item.accessibility_rank,
      turnover_rank: item.turnover_rank,
      reason: `Sách này có ${item.turnover_count} lượt mượn trong ${TURNOVER_LOOKBACK_DAYS} ngày (hạng ${item.turnover_rank}/${total} theo độ phổ biến) nhưng đang ở vị trí xếp hạng ${item.accessibility_rank}/${total} về độ dễ tiếp cận. Vị trí ${target.location_code} dễ tiếp cận hơn và hiện chỉ giữ sách ít được mượn hơn.`,
    });
  }

  suggestions.sort((a, b) => b.turnover_count - a.turnover_count);

  return {
    warehouse_id: warehouseId,
    generated_at: new Date().toISOString(),
    total_placements_evaluated: total,
    items: suggestions.slice(0, limit),
  };
}

module.exports = { generateReslottingSuggestions };
