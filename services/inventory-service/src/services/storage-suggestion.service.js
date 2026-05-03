/**
 * Storage Suggestion Service
 *
 * Rule-based scoring algorithm + AI explanation + Redis cache
 * to suggest optimal storage locations for books.
 *
 * Scoring Rules:
 * 1. Same variant already at location: +40 points
 * 2. Same book, different variant: +30 points
 * 3. Same category: +20 points
 * 4. Sufficient capacity: +20 points
 * 5. Location active and pickable: +10 points
 * 6. Empty location: +8 points
 * 7. Recent movement history for similar books: +10 points
 *
 * Confidence Levels:
 * - score >= 80: HIGH
 * - score >= 50: MEDIUM
 * - score < 50: LOW
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const SCORING = {
  SAME_VARIANT: 40,
  SAME_BOOK: 30,
  SAME_CATEGORY: 20,
  SUFFICIENT_CAPACITY: 20,
  ACTIVE_PICKABLE: 10,
  EMPTY_LOCATION: 8,
  RECENT_MOVEMENT: 10,
};

const CONFIDENCE_THRESHOLDS = {
  HIGH: 80,
  MEDIUM: 50,
};

const RECENT_MOVEMENT_DAYS = 90;

const REDIS_CACHE_TTL = 120;

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

function getCacheKey(warehouseId, variantId, bookId, quantity) {
  return `storage_suggestion:${warehouseId}:${variantId || bookId}:${quantity}`;
}

function getConfidence(score) {
  if (score >= CONFIDENCE_THRESHOLDS.HIGH) return 'HIGH';
  if (score >= CONFIDENCE_THRESHOLDS.MEDIUM) return 'MEDIUM';
  return 'LOW';
}

function calculateAvailableCapacity(location) {
  if (!location.capacity_qty) return Infinity;
  return location.capacity_qty - (location.occupied_qty || 0);
}

async function getBookInfo(bookId, variantId) {
  const variantWhere = variantId ? { id: variantId } : {};
  const bookWhere = bookId ? { id: bookId } : {};

  const variant = await prisma.book_variants.findFirst({
    where: {
      ...variantWhere,
      ...(bookId ? { book_id: bookId } : {}),
    },
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

async function getLocationsWithSameCategory(warehouseId, categoryIds) {
  if (!categoryIds || categoryIds.length === 0) return [];

  const variantIds = await prisma.book_categories.findMany({
    where: { category_id: { in: categoryIds } },
    select: { book_id: true },
  });

  const uniqueBookIds = [...new Set(variantIds.map((v) => v.book_id))];

  const variants = await prisma.book_variants.findMany({
    where: { book_id: { in: uniqueBookIds } },
    select: { id: true },
  });

  const variantIds2 = variants.map((v) => v.id);

  const balances = await prisma.stock_balances.findMany({
    where: {
      warehouse_id: warehouseId,
      variant_id: { in: variantIds2 },
      on_hand_qty: { gt: 0 },
    },
    select: { location_id: true },
  });

  const locationIds = [...new Set(balances.map((b) => b.location_id))];

  if (locationIds.length === 0) return [];

  return prisma.locations.findMany({
    where: {
      id: { in: locationIds },
      is_active: true,
    },
  });
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

async function getCandidateLocations(warehouseId) {
  return prisma.locations.findMany({
    where: {
      warehouse_id: warehouseId,
      is_active: true,
      location_type: { in: ['SHELF_COMPARTMENT', 'BIN'] },
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

function calculateLocationScore(location, context) {
  let score = 0;
  const reasons = [];
  const warnings = [];

  if (!location.is_active || !location.is_pickable) {
    return { score: 0, reasons, warnings, isValid: false };
  }

  if (location.capacity_qty && location.available <= 0) {
    warnings.push('Vị trí đã hết sức chứa');
    return { score: 0, reasons, warnings, isValid: false };
  }

  if (context.quantity > location.available) {
    warnings.push(`Số lượng nhập (${context.quantity}) vượt sức chứa khả dụng (${location.available})`);
  }

  if (context.sameVariantLocations.includes(location.id)) {
    score += SCORING.SAME_VARIANT;
    reasons.push('Vị trí này đã có cùng đầu sách (cùng ISBN/bìa), dễ quản lý tồn kho');
  }

  if (context.sameBookLocations.includes(location.id) && !context.sameVariantLocations.includes(location.id)) {
    score += SCORING.SAME_BOOK;
    reasons.push('Vị trí có cùng sách nhưng khác biến thể (khác bìa/năm xuất bản)');
  }

  if (context.sameCategoryLocations.includes(location.id)) {
    score += SCORING.SAME_CATEGORY;
    const catText = context.categoryNames.slice(0, 2).join(', ');
    reasons.push(`Nằm trong khu vực có nhiều sách cùng thể loại (${catText})`);
  }

  if (location.available >= context.quantity) {
    score += SCORING.SUFFICIENT_CAPACITY;
    reasons.push('Còn đủ sức chứa cho số lượng nhập');
  }

  score += SCORING.ACTIVE_PICKABLE;
  reasons.push('Vị trí đang hoạt động và có thể chọn');

  const totalOccupied = location.stock_balances?.reduce((sum, sb) => sum + sb.on_hand_qty, 0) || 0;
  const isEmpty = totalOccupied === 0;

  if (isEmpty) {
    score += SCORING.EMPTY_LOCATION;
    reasons.push('Vị trí trống, sẵn sàng nhận hàng mới');
  }

  if (context.recentMovementLocations.includes(location.id)) {
    score += SCORING.RECENT_MOVEMENT;
    reasons.push('Có lịch sử xuất/nhập gần đây cho cùng loại sách');
  }

  return {
    score,
    reasons,
    warnings,
    isValid: true,
    occupiedQty: totalOccupied,
  };
}

async function generateAIExplanation(bookInfo, suggestions) {
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

async function generateSuggestions(warehouseId, bookId, variantId, quantity = 1, mode = 'RECEIVING') {
  const cacheKey = getCacheKey(warehouseId, variantId, bookId, quantity);

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
    sameCategoryLocations: [],
    recentMovementLocations: [],
    categoryNames: [],
  };

  const bookInfo = await getBookInfo(bookId, variantId);
  if (!bookInfo) {
    return {
      success: false,
      error: 'Không tìm thấy thông tin sách/variant',
      suggestions: [],
    };
  }

  context.categoryNames = bookInfo.categoryNames;

  const [variantStock, bookStock, categoryLocations, recentLocations] = await Promise.all([
    getVariantStockInWarehouse(warehouseId, bookInfo.variantId),
    bookInfo.bookId !== bookInfo.variantId ? getBookStockInWarehouse(warehouseId, bookInfo.bookId) : Promise.resolve([]),
    getLocationsWithSameCategory(warehouseId, bookInfo.categories),
    getRecentMovements(warehouseId, bookInfo.bookId, bookInfo.categories),
  ]);

  context.sameVariantLocations = variantStock.map((s) => s.location_id);
  context.sameBookLocations = bookStock.map((s) => s.location_id);
  context.sameCategoryLocations = categoryLocations.map((l) => l.id);
  context.recentMovementLocations = recentLocations;

  const locations = await getCandidateLocations(warehouseId);

  const scoredLocations = [];

  for (const location of locations) {
    const availableCapacity = calculateAvailableCapacity(location);
    const locationWithAvailable = {
      ...location,
      available: availableCapacity,
      occupied_qty: location.stock_balances?.reduce((sum, sb) => sum + sb.on_hand_qty, 0) || 0,
    };

    const scoring = calculateLocationScore(locationWithAvailable, context);

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
        availableCapacity: availableCapacity,
        currentOnHand: scoring.occupiedQty,
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

  const aiExplanations = await generateAIExplanation(bookInfo, suggestions);
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

async function getContext(warehouseId, variantId, bookId) {
  const bookInfo = await getBookInfo(bookId, variantId);
  if (!bookInfo) {
    return { success: false, error: 'Không tìm thấy thông tin sách/variant' };
  }

  const [variantStock, bookStock, emptyLocations, allActiveLocations] = await Promise.all([
    getVariantStockInWarehouse(warehouseId, bookInfo.variantId),
    bookInfo.bookId !== bookInfo.variantId ? getBookStockInWarehouse(warehouseId, bookInfo.bookId) : Promise.resolve([]),
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

async function applySuggestion(warehouseId, variantId, locationId, quantity) {
  const location = await prisma.locations.findUnique({
    where: { id: locationId },
    select: {
      id: true,
      warehouse_id: true,
      is_active: true,
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

  const currentStock = await prisma.stock_balances.findUnique({
    where: {
      variant_id_location_id: { variant_id: variantId, location_id: locationId },
    },
    select: { on_hand_qty: true },
  });

  const currentQty = currentStock?.on_hand_qty || 0;

  if (location.capacity_qty && currentQty + quantity > location.capacity_qty) {
    return {
      success: false,
      error: `Vượt sức chứa. Sức chứa: ${location.capacity_qty}, hiện tại: ${currentQty}, muốn thêm: ${quantity}`,
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
      quantity,
      availableCapacity: location.capacity_qty
        ? location.capacity_qty - currentQty
        : null,
    },
  };
}

module.exports = {
  generateSuggestions,
  getContext,
  applySuggestion,
  getConfidence,
  calculateLocationScore,
  invalidateCache,
};
