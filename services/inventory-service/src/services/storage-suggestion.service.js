/**
 * Storage Suggestion Service
 *
 * Deterministic, rule-based scoring + AI (Qwen) explanation + Redis cache to
 * suggest optimal storage locations for books. Capacity and location-type
 * eligibility are delegated to location-capacity.service.js, the single
 * source of truth shared with receiving-putaway.controller.js — this file
 * must never compute those independently.
 *
 * `confidence` (HIGH/MEDIUM/LOW, from `score`) is a heuristic recommendation
 * strength derived from the weighted feature sum below. It is NOT a
 * calibrated ML probability and must not be presented to users as one.
 */

const { PrismaClient } = require('@prisma/client');
const { toInt } = require('../utils/validation');
const {
  VALID_SUGGESTION_MODES,
  getEligibleLocationTypes,
  isLocationEligibleForMode,
  getLocationCapacityContext,
  getLocationCapacityContextBatch,
} = require('./location-capacity.service');

const prisma = new PrismaClient();

const CONFIDENCE_THRESHOLDS = {
  HIGH: 80,
  MEDIUM: 50,
};

const RECENT_MOVEMENT_DAYS = 90;

const REDIS_CACHE_TTL = 120;

// Reward "fits comfortably" up to ~85% full after adding the incoming quantity;
// flat beyond that point (overflow can't happen — capacity is a hard constraint
// before scoring runs at all). Tunable, not a fixed-forever business constant.
const IDEAL_FILL_RATIO = 0.85;

// Distinct-variant count at which skuMixPenalty reaches its per-mode maximum.
const SKU_MIX_SOFT_CAP = 5;

// Number of OTHER locations already holding this variant/book before placing
// it at yet another empty/unrelated location counts as "spreading it further".
const FRAGMENTATION_THRESHOLD = 3;

// Relative feature weights per mode. Not required to sum to 100 — the score is
// normalized against each mode's own weight sum, so only the relative balance
// between features matters.
const MODE_WEIGHTS = {
  RECEIVING: {
    sameVariant: 35,
    sameBook: 20,
    categoryAffinity: 15,
    capacityFit: 15,
    emptyLocation: 8,
    movement: 7,
    skuMixPenaltyMax: 10,
    fragmentationPenaltyMax: 8,
  },
  PUTAWAY: {
    sameVariant: 35,
    sameBook: 20,
    categoryAffinity: 15,
    capacityFit: 15,
    emptyLocation: 8,
    movement: 7,
    skuMixPenaltyMax: 10,
    fragmentationPenaltyMax: 8,
  },
  // Relocation is about tidying up existing placement, not fast intake:
  // prioritize consolidation (sameVariant/sameBook) and capacity utilization,
  // penalize fragmentation/SKU-mixing harder, de-emphasize "empty"/"recent
  // movement" (those matter for receiving, not for cleanup).
  RELOCATION: {
    sameVariant: 20,
    sameBook: 12,
    categoryAffinity: 8,
    capacityFit: 25,
    emptyLocation: 2,
    movement: 3,
    skuMixPenaltyMax: 20,
    fragmentationPenaltyMax: 20,
  },
  // No confirmed real caller uses mode=AI_IMPORT anywhere in the codebase today
  // (grepped services + apps/web). Falls back to the RECEIVING policy rather
  // than inventing business rules for an undefined flow.
  // TODO: define a dedicated policy once a real AI_IMPORT destination flow exists.
  AI_IMPORT: {
    sameVariant: 35,
    sameBook: 20,
    categoryAffinity: 15,
    capacityFit: 15,
    emptyLocation: 8,
    movement: 7,
    skuMixPenaltyMax: 10,
    fragmentationPenaltyMax: 8,
  },
};

function getModeWeights(mode) {
  return MODE_WEIGHTS[mode] || MODE_WEIGHTS.RECEIVING;
}

let redisClient = null;
let redisInitialized = false;

async function initRedis() {
  if (redisClient && redisInitialized) return redisClient;

  try {
    redisClient = require('../lib/redis');
    if (redisClient && typeof redisClient.connect === 'function' && !redisInitialized) {
      await redisClient.connect();
      redisInitialized = true;
    }
  } catch (err) {
    console.warn('[StorageSuggestion] Redis not available:', err.message);
  }
  return redisClient;
}

async function getCached(key) {
  const redis = await initRedis();
  if (!redis || !redis.isConnected) return null;
  try {
    const cached = await redis.get(key);
    return cached ? JSON.parse(cached) : null;
  } catch (err) {
    console.warn('[StorageSuggestion] Cache get error:', err.message);
    return null;
  }
}

async function setCached(key, data, ttl = REDIS_CACHE_TTL) {
  const redis = await initRedis();
  if (!redis || !redis.isConnected) return;
  try {
    await redis.set(key, JSON.stringify(data), ttl);
  } catch (err) {
    console.warn('[StorageSuggestion] Cache set error:', err.message);
  }
}

async function invalidateCache(warehouseId) {
  const redis = await initRedis();
  if (!redis || !redis.isConnected) return;
  try {
    await redis.delPattern(`storage_suggestion:${warehouseId}:*`);
    console.log(`[StorageSuggestion] Cache invalidated for warehouse ${warehouseId}`);
  } catch (err) {
    console.warn('[StorageSuggestion] Cache invalidate error:', err.message);
  }
}

// mode is part of the key because different modes now use different scoring
// policies (MODE_WEIGHTS) — two modes must never share a cached result.
function getCacheKey(warehouseId, variantId, quantity, mode) {
  return `storage_suggestion:${warehouseId}:${variantId}:${quantity}:${mode}`;
}

function getConfidence(score) {
  if (score >= CONFIDENCE_THRESHOLDS.HIGH) return 'HIGH';
  if (score >= CONFIDENCE_THRESHOLDS.MEDIUM) return 'MEDIUM';
  return 'LOW';
}

async function getBookInfo(variantId) {
  const variant = await prisma.book_variants.findUnique({
    where: { id: variantId },
    include: {
      books: {
        include: {
          book_categories: {
            include: {
              categories: true,
            },
          },
          book_authors: {
            include: {
              authors: true,
            },
          },
        },
      },
    },
  });

  if (!variant) return null;

  const categories = variant.books.book_categories.map((bc) => bc.categories.id);
  const categoryNames = variant.books.book_categories.map((bc) => bc.categories.name);
  const authors = variant.books.book_authors.map((ba) => ba.authors.full_name);

  return {
    bookId: variant.book_id,
    variantId: variant.id,
    title: variant.books.title,
    categories,
    categoryNames,
    authors,
    variantInfo: {
      isbn13: variant.isbn13,
      isbn10: variant.isbn10,
      coverType: variant.cover_type,
      languageCode: variant.language_code,
      publishYear: variant.publish_year,
    },
  };
}

async function getVariantStockInWarehouse(warehouseId, variantId) {
  return prisma.stock_balances.findMany({
    where: {
      warehouse_id: warehouseId,
      variant_id: variantId,
      on_hand_qty: { gt: 0 },
    },
    include: {
      locations: {
        select: {
          id: true,
          location_code: true,
          zone: true,
          shelf: true,
          bin: true,
        },
      },
    },
  });
}

async function getBookStockInWarehouse(warehouseId, bookId) {
  const variants = await prisma.book_variants.findMany({
    where: { book_id: bookId },
    select: { id: true },
  });

  const variantIds = variants.map((v) => v.id);

  return prisma.stock_balances.findMany({
    where: {
      warehouse_id: warehouseId,
      variant_id: { in: variantIds },
      on_hand_qty: { gt: 0 },
    },
    include: {
      locations: {
        select: {
          id: true,
          location_code: true,
          zone: true,
          shelf: true,
          bin: true,
        },
      },
    },
  });
}

// Per-location on_hand_qty of stock whose book shares at least one category
// with the incoming book. Used as the numerator of a ratio (against total
// occupancy at that location), not a flat "has ≥1 match" boolean.
async function getCategoryStockByLocation(warehouseId, categoryIds) {
  const map = new Map();
  if (!categoryIds || categoryIds.length === 0) return map;

  const categoryBooks = await prisma.book_categories.findMany({
    where: { category_id: { in: categoryIds } },
    select: { book_id: true },
  });

  const uniqueBookIds = [...new Set(categoryBooks.map((v) => v.book_id))];
  if (uniqueBookIds.length === 0) return map;

  const variants = await prisma.book_variants.findMany({
    where: { book_id: { in: uniqueBookIds } },
    select: { id: true },
  });

  const variantIds = variants.map((v) => v.id);
  if (variantIds.length === 0) return map;

  const balances = await prisma.stock_balances.findMany({
    where: {
      warehouse_id: warehouseId,
      variant_id: { in: variantIds },
      on_hand_qty: { gt: 0 },
    },
    select: { location_id: true, on_hand_qty: true },
  });

  balances.forEach((b) => {
    map.set(b.location_id, (map.get(b.location_id) || 0) + b.on_hand_qty);
  });

  return map;
}

async function getRecentMovements(warehouseId, bookId, categoryIds, days = RECENT_MOVEMENT_DAYS) {
  const recentDate = new Date();
  recentDate.setDate(recentDate.getDate() - days);

  let variantIds = [];
  if (bookId) {
    const variants = await prisma.book_variants.findMany({
      where: { book_id: bookId },
      select: { id: true },
    });
    variantIds = variants.map((v) => v.id);
  } else if (categoryIds && categoryIds.length > 0) {
    const categoryVariants = await prisma.book_categories.findMany({
      where: { category_id: { in: categoryIds } },
      select: { book_id: true },
    });
    const uniqueBookIds = [...new Set(categoryVariants.map((v) => v.book_id))];
    const allVariants = await prisma.book_variants.findMany({
      where: { book_id: { in: uniqueBookIds } },
      select: { id: true },
    });
    variantIds = allVariants.map((v) => v.id);
  }

  if (variantIds.length === 0) return [];

  const movements = await prisma.stock_movements.findMany({
    where: {
      warehouse_id: warehouseId,
      variant_id: { in: variantIds },
      created_at: { gte: recentDate },
      reverted: false,
    },
    select: { to_location_id: true, from_location_id: true },
  });

  const locationIds = new Set();
  movements.forEach((m) => {
    if (m.to_location_id) locationIds.add(m.to_location_id);
    if (m.from_location_id) locationIds.add(m.from_location_id);
  });

  return [...locationIds];
}

async function getCandidateLocations(warehouseId, mode) {
  return prisma.locations.findMany({
    where: {
      warehouse_id: warehouseId,
      is_active: true,
      location_type: { in: getEligibleLocationTypes(mode) },
    },
    include: {
      stock_balances: {
        select: {
          on_hand_qty: true,
          variant_id: true,
        },
      },
    },
  });
}

/**
 * Pure scoring function — no DB access. `location` must already carry
 * pre-computed capacity fields (effectiveCapacity/occupiedQty/remainingCapacity)
 * and `distinctSkuCount`; `context` carries the request + pre-fetched
 * same-variant/same-book/category/movement location data.
 */
function calculateLocationScore(location, context) {
  const reasons = [];
  const warnings = [];

  if (!location.is_active || !location.is_pickable) {
    return { score: 0, reasons, warnings, isValid: false };
  }

  // Defense in depth: getCandidateLocations already filters by eligible type,
  // but scoring must never silently accept a location sourced another way.
  if (!isLocationEligibleForMode(location, context.mode)) {
    return { score: 0, reasons, warnings, isValid: false };
  }

  if (context.quantity > location.remainingCapacity) {
    warnings.push(`Số lượng nhập (${context.quantity}) vượt sức chứa khả dụng (${location.remainingCapacity})`);
    return { score: 0, reasons, warnings, isValid: false };
  }

  const weights = getModeWeights(context.mode);
  const isSameVariant = context.sameVariantLocations.includes(location.id);
  const isSameBook = !isSameVariant && context.sameBookLocations.includes(location.id);

  const features = {
    sameVariant: isSameVariant ? 1 : 0,
    sameBook: isSameBook ? 1 : 0,
    categoryAffinity: 0,
    capacityFit: 0,
    emptyLocation: location.occupiedQty === 0 ? 1 : 0,
    movement: context.recentMovementLocations.includes(location.id) ? 1 : 0,
  };

  if (isSameVariant) {
    reasons.push('Vị trí này đã có cùng variant (cùng ISBN/edition), dễ gom và quản lý tồn kho');
  } else if (isSameBook) {
    reasons.push('Vị trí có cùng tác phẩm/book record nhưng khác variant (khác bìa/năm xuất bản)');
  }

  const categoryQty = context.categoryStockByLocation.get(location.id) || 0;
  if (location.occupiedQty > 0 && categoryQty > 0) {
    features.categoryAffinity = categoryQty / location.occupiedQty;
    const catText = context.categoryNames.slice(0, 2).join(', ');
    reasons.push(`${Math.round(features.categoryAffinity * 100)}% tồn kho tại vị trí này cùng thể loại (${catText})`);
  }

  const postFillRatio = location.effectiveCapacity > 0
    ? (location.occupiedQty + context.quantity) / location.effectiveCapacity
    : 0;
  features.capacityFit = Math.min(postFillRatio / IDEAL_FILL_RATIO, 1);
  reasons.push(`Còn đủ sức chứa cho số lượng nhập (còn lại ${location.remainingCapacity})`);

  if (features.emptyLocation) {
    reasons.push('Vị trí trống, sẵn sàng nhận hàng mới');
  }

  if (features.movement) {
    reasons.push('Có lịch sử xuất/nhập gần đây cho cùng loại sách');
  }

  const positiveWeightSum = weights.sameVariant
    + weights.sameBook
    + weights.categoryAffinity
    + weights.capacityFit
    + weights.emptyLocation
    + weights.movement;

  const weightedSum = weights.sameVariant * features.sameVariant
    + weights.sameBook * features.sameBook
    + weights.categoryAffinity * features.categoryAffinity
    + weights.capacityFit * features.capacityFit
    + weights.emptyLocation * features.emptyLocation
    + weights.movement * features.movement;

  let score = positiveWeightSum > 0 ? (100 * weightedSum) / positiveWeightSum : 0;

  const skuMixRatio = Math.min(location.distinctSkuCount / SKU_MIX_SOFT_CAP, 1);
  const skuMixPenalty = skuMixRatio * weights.skuMixPenaltyMax;
  if (skuMixPenalty > 0) {
    warnings.push('Vị trí đang chứa nhiều đầu sách khác nhau (SKU mix cao)');
  }

  const existingLocationsForItem = new Set([...context.sameVariantLocations, ...context.sameBookLocations]);
  const isNewSpreadPoint = !isSameVariant && !isSameBook;
  const fragmentationPenalty = (isNewSpreadPoint && existingLocationsForItem.size >= FRAGMENTATION_THRESHOLD)
    ? weights.fragmentationPenaltyMax
    : 0;
  if (fragmentationPenalty > 0) {
    warnings.push('Sách này đã có mặt ở nhiều vị trí khác; chọn vị trí này sẽ làm phân tán tồn kho hơn nữa');
  }

  score = Math.max(0, Math.min(100, score - skuMixPenalty - fragmentationPenalty));

  return {
    score: Math.round(score),
    reasons,
    warnings,
    isValid: true,
    occupiedQty: location.occupiedQty,
  };
}

async function generateAIExplanation(bookInfo, suggestions, requestId) {
  const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';

  const payload = {
    book: {
      title: bookInfo.title,
      categories: bookInfo.categoryNames,
      authors: bookInfo.authors,
    },
    suggestions: suggestions.slice(0, 3).map((s) => ({
      location_code: s.locationCode,
      score: s.score,
      reasons: s.reasons,
    })),
  };

  try {
    const response = await fetch(`${aiServiceUrl}/explain-storage-suggestion`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(requestId ? { 'x-request-id': requestId } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.warn(`[StorageSuggestion] AI service returned ${response.status}`);
      return null;
    }

    const data = await response.json();
    if (data && data.explanations) {
      return data.explanations;
    }
  } catch (err) {
    console.warn('[StorageSuggestion] AI explanation failed:', err.message);
  }

  return null;
}

/**
 * @param {object} [options]
 * @param {boolean} [options.explain=true] - call the AI paraphrase layer. Callers
 *   that only need the ranking (e.g. a per-line preview on the putaway receipt)
 *   pass false, so listing N lines does not trigger N LLM calls. Cached
 *   separately so an explained request never receives an unexplained result.
 */
async function generateSuggestions(warehouseId, variantId, quantity = 1, mode = 'RECEIVING', requestId, { explain = true } = {}) {
  const cacheKey = `${getCacheKey(warehouseId, variantId, quantity, mode)}${explain ? '' : ':noexplain'}`;

  const cached = await getCached(cacheKey);
  if (cached) {
    console.log(`[StorageSuggestion] Cache hit: ${cacheKey}`);
    return { ...cached, fromCache: true };
  }

  const context = {
    quantity,
    mode,
    sameVariantLocations: [],
    sameBookLocations: [],
    categoryStockByLocation: new Map(),
    recentMovementLocations: [],
    categoryNames: [],
  };

  const bookInfo = await getBookInfo(variantId);
  if (!bookInfo) {
    return {
      success: false,
      error: 'Không tìm thấy thông tin sách/variant',
      suggestions: [],
    };
  }

  context.categoryNames = bookInfo.categoryNames;

  const [variantStock, bookStock, categoryStockByLocation, recentLocations] = await Promise.all([
    getVariantStockInWarehouse(warehouseId, bookInfo.variantId),
    getBookStockInWarehouse(warehouseId, bookInfo.bookId),
    getCategoryStockByLocation(warehouseId, bookInfo.categories),
    getRecentMovements(warehouseId, bookInfo.bookId, bookInfo.categories),
  ]);

  context.sameVariantLocations = variantStock.map((s) => s.location_id);
  context.sameBookLocations = bookStock.map((s) => s.location_id);
  context.categoryStockByLocation = categoryStockByLocation;
  context.recentMovementLocations = recentLocations;

  const locations = await getCandidateLocations(warehouseId, mode);
  const capacityContexts = await getLocationCapacityContextBatch(prisma, locations);

  const scoredLocations = [];

  for (const location of locations) {
    const capacityContext = capacityContexts.get(location.id);
    const distinctSkuCount = new Set(
      (location.stock_balances || [])
        .filter((sb) => sb.on_hand_qty > 0)
        .map((sb) => sb.variant_id),
    ).size;

    const locationForScoring = {
      ...location,
      ...capacityContext,
      distinctSkuCount,
    };

    const scoring = calculateLocationScore(locationForScoring, context);

    if (scoring.isValid) {
      scoredLocations.push({
        locationId: location.id,
        locationCode: location.location_code,
        zone: location.zone,
        aisle: location.aisle,
        shelf: location.shelf,
        bin: location.bin,
        score: scoring.score,
        confidence: getConfidence(scoring.score),
        availableCapacity: capacityContext.remainingCapacity,
        currentOnHand: capacityContext.occupiedQty,
        reasons: scoring.reasons,
        warnings: scoring.warnings,
      });
    }
  }

  scoredLocations.sort((a, b) => b.score - a.score);

  let suggestions = scoredLocations.slice(0, 5).map((loc, index) => ({
    rank: index + 1,
    ...loc,
  }));

  const aiExplanations = explain ? await generateAIExplanation(bookInfo, suggestions, requestId) : null;
  if (aiExplanations) {
    suggestions = suggestions.map((s, idx) => ({
      ...s,
      aiExplanation: aiExplanations[idx] || null,
    }));
  }

  const fallback = suggestions.length === 0;

  const result = {
    success: true,
    warehouseId,
    variantId: bookInfo.variantId,
    bookId: bookInfo.bookId,
    bookTitle: bookInfo.title,
    quantity,
    mode,
    suggestions,
    fallback,
    message: fallback
      ? 'Không có vị trí phù hợp. Vui lòng tạo vị trí mới hoặc chọn thủ công.'
      : undefined,
    fromCache: false,
  };

  await setCached(cacheKey, result, REDIS_CACHE_TTL);

  return result;
}

async function getContext(warehouseId, variantId) {
  const bookInfo = await getBookInfo(variantId);
  if (!bookInfo) {
    return { success: false, error: 'Không tìm thấy thông tin sách/variant' };
  }

  const [variantStock, bookStock, emptyLocations, allActiveLocations] = await Promise.all([
    getVariantStockInWarehouse(warehouseId, bookInfo.variantId),
    getBookStockInWarehouse(warehouseId, bookInfo.bookId),
    getEmptyLocations(warehouseId),
    getAllActiveLocations(warehouseId),
  ]);

  return {
    success: true,
    book: {
      id: bookInfo.bookId,
      variantId: bookInfo.variantId,
      title: bookInfo.title,
      categories: bookInfo.categoryNames,
      authors: bookInfo.authors,
      variantInfo: bookInfo.variantInfo,
    },
    existingStock: {
      sameVariant: variantStock.map((s) => ({
        locationId: s.location_id,
        locationCode: s.locations.location_code,
        onHandQty: s.on_hand_qty,
      })),
      sameBook: bookStock.map((s) => ({
        locationId: s.location_id,
        locationCode: s.locations.location_code,
        onHandQty: s.on_hand_qty,
      })),
    },
    availableLocations: emptyLocations.map((l) => ({
      id: l.id,
      code: l.location_code,
      zone: l.zone,
      shelf: l.shelf,
      bin: l.bin,
      capacity: l.capacity_qty,
    })),
    allActiveLocations: allActiveLocations.map((l) => ({
      id: l.id,
      code: l.location_code,
      zone: l.zone,
      shelf: l.shelf,
      bin: l.bin,
      capacity: l.capacity_qty,
    })),
    warehouseId,
  };
}

async function getEmptyLocations(warehouseId) {
  return prisma.locations.findMany({
    where: {
      warehouse_id: warehouseId,
      is_active: true,
      location_type: { in: ['SHELF_COMPARTMENT', 'BIN'] },
    },
    include: {
      stock_balances: {
        select: { on_hand_qty: true },
      },
    },
  });
}

async function getAllActiveLocations(warehouseId) {
  return prisma.locations.findMany({
    where: {
      warehouse_id: warehouseId,
      is_active: true,
      location_type: { in: ['SHELF_COMPARTMENT', 'BIN'] },
      capacity_qty: { not: null },
    },
    select: {
      id: true,
      location_code: true,
      zone: true,
      shelf: true,
      bin: true,
      capacity_qty: true,
    },
    orderBy: { location_code: 'asc' },
  });
}

async function applySuggestion(warehouseId, variantId, locationId, quantity, mode = 'RECEIVING', client) {
  const db = client || prisma;

  const parsedQuantity = toInt(quantity);
  if (!parsedQuantity || parsedQuantity <= 0) {
    return { success: false, error: 'quantity phải là số nguyên dương' };
  }

  const location = await db.locations.findUnique({
    where: { id: locationId },
    select: {
      id: true,
      warehouse_id: true,
      is_active: true,
      is_pickable: true,
      location_type: true,
      capacity_qty: true,
    },
  });

  if (!location) {
    return { success: false, error: 'Không tìm thấy vị trí' };
  }

  if (location.warehouse_id !== warehouseId) {
    return { success: false, error: 'Vị trí không thuộc kho này' };
  }

  if (!location.is_active) {
    return { success: false, error: 'Vị trí không còn hoạt động' };
  }

  if (!isLocationEligibleForMode(location, mode)) {
    return { success: false, error: `Loại vị trí (${location.location_type}) không phù hợp với nghiệp vụ ${mode}` };
  }

  if (!location.is_pickable) {
    return { success: false, error: 'Vị trí không thể chọn (is_pickable = false)' };
  }

  const variant = await db.book_variants.findUnique({
    where: { id: variantId },
    select: { id: true },
  });

  if (!variant) {
    return { success: false, error: 'Không tìm thấy biến thể sách' };
  }

  // Fresh read at apply time — sums ALL variants currently at the location,
  // not just this one, and never reuses a value computed at suggestion time.
  const capacityContext = await getLocationCapacityContext(db, location);

  if (parsedQuantity > capacityContext.remainingCapacity) {
    return {
      success: false,
      error: `Vượt sức chứa. Sức chứa khả dụng: ${capacityContext.effectiveCapacity}, hiện tại: ${capacityContext.occupiedQty}, muốn thêm: ${parsedQuantity}`,
    };
  }

  await invalidateCache(warehouseId);

  return {
    success: true,
    validated: true,
    data: {
      warehouseId,
      variantId,
      locationId,
      quantity: parsedQuantity,
      availableCapacity: capacityContext.remainingCapacity,
    },
  };
}

module.exports = {
  VALID_SUGGESTION_MODES,
  generateSuggestions,
  getContext,
  applySuggestion,
  getConfidence,
  calculateLocationScore,
  invalidateCache,
  getCacheKey,
  getBookInfo,
};
