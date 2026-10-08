// Reorder-suggestion arithmetic: demand forecast over the lead time, safety
// stock, suggested quantity, demand score and priority for one variant.
// Pure functions, no DB access (same convention as forecast.js / lead-time.js),
// moved out of analytics.controller.js so the production endpoint and the
// offline reorder-policy backtest (eval/) run the exact same code.

const { round } = require('./date-range');
const { ewma, linearTrendSlope, stdDev, projectedDemand } = require('./forecast');

const EWMA_ALPHA = 0.35;
// Z-score for a ~95% service level, used to size safety stock from demand volatility.
const SAFETY_STOCK_Z_SCORE = 1.645;
const SEASONAL_INDEX_MIN = 0.5;
const SEASONAL_INDEX_MAX = 2.0;
const SEASONAL_MIN_SAMPLE_SIZE = 5;

function number(value) {
  return Number(value || 0);
}

// Seasonal index = (borrow count in the same calendar window last year) /
// (expected count for a window this size, based on the trailing-year
// average). Clamped to avoid wild swings on thin history; null (= neutral, no
// entry) when the trailing year has too few samples.
function seasonalIndexFromCounts({ samePeriodLastYear, yearlyTotal, days }) {
  if (yearlyTotal < SEASONAL_MIN_SAMPLE_SIZE) return null;
  const expectedForWindow = (yearlyTotal / 365) * days;
  if (expectedForWindow <= 0) return null;
  const raw = (samePeriodLastYear || 0) / expectedForWindow;
  return Math.min(SEASONAL_INDEX_MAX, Math.max(SEASONAL_INDEX_MIN, raw));
}

function lowStockBonus(availableQty) {
  if (availableQty <= 0) return 30;
  if (availableQty <= 3) return 20;
  if (availableQty <= 5) return 12;
  if (availableQty <= 10) return 6;
  return 0;
}

function resolvePriority({ availableQty, borrowCount, reservationCount, forecast30d, estimatedDaysUntilStockout, leadTimeDays }) {
  if (
    (availableQty <= 0 && (borrowCount > 0 || reservationCount > 0))
    || (availableQty <= 5 && borrowCount >= 5)
    || (estimatedDaysUntilStockout !== null && estimatedDaysUntilStockout <= leadTimeDays)
  ) {
    return 'HIGH';
  }
  if (
    (availableQty <= 10 && borrowCount >= 3)
    || reservationCount >= 2
    || forecast30d > availableQty
  ) {
    return 'MEDIUM';
  }
  if (borrowCount > 0 || reservationCount > 0) {
    return 'LOW';
  }
  return 'LOW';
}

function buildReason(item, days, leadTimeDays) {
  const parts = [
    `Tồn kho hiện còn ${item.available_qty} bản, trong ${days} ngày gần đây có ${item.borrow_count} lượt mượn và ${item.reservation_count} lượt đặt chỗ.`,
  ];

  if (item.estimated_days_until_stockout !== null) {
    parts.push(`Với tốc độ mượn hiện tại, sách có nguy cơ thiếu trong khoảng ${item.estimated_days_until_stockout} ngày.`);
  }
  if (item.demand_trend_pct > 0) {
    parts.push(`Nhu cầu tăng ${item.demand_trend_pct}% so với kỳ trước.`);
  } else if (item.demand_trend_pct < 0) {
    parts.push(`Nhu cầu giảm ${Math.abs(item.demand_trend_pct)}% so với kỳ trước.`);
  }
  if (item.available_qty <= item.reorder_point && item.reorder_point > 0) {
    parts.push(`Tồn kho thấp hơn hoặc bằng reorder point ${item.reorder_point}.`);
  }
  if (item.wishlist_count > 0 || item.availability_alert_count > 0) {
    parts.push(`Có thêm ${item.wishlist_count} wishlist và ${item.availability_alert_count} cảnh báo chờ hàng.`);
  }
  if (item.daily_trend > 0.03) {
    parts.push(`Xu hướng mượn đang tăng khoảng ${item.daily_trend} bản/ngày (hồi quy tuyến tính trên chuỗi mượn ${days} ngày gần nhất).`);
  } else if (item.daily_trend < -0.03) {
    parts.push(`Xu hướng mượn đang giảm khoảng ${Math.abs(item.daily_trend)} bản/ngày.`);
  }
  if (item.suggested_reorder_qty > 0) {
    parts.push(`Đề xuất nhập thêm ${item.suggested_reorder_qty} bản để đáp ứng nhu cầu trong thời gian chờ nhập hàng ${leadTimeDays} ngày.`);
  } else {
    parts.push('Chưa cần nhập thêm ngay, nhưng nên tiếp tục theo dõi nhu cầu.');
  }
  if (item.lead_time_source === 'LEARNED') {
    parts.push(`Thời gian chờ hàng ${leadTimeDays} ngày là trung vị thực tế của ${item.lead_time_samples} lần giao gần đây, không phải giá trị mặc định.`);
  } else if (item.lead_time_source === 'SUPPLIER_DECLARED') {
    parts.push(`Thời gian chờ hàng ${leadTimeDays} ngày lấy theo cam kết của nhà cung cấp vì chưa đủ lịch sử giao hàng thực tế.`);
  }
  if (item.demand_volatility > 0) {
    parts.push(`Mức dự phòng an toàn được tính theo độ biến động nhu cầu thực tế (độ lệch chuẩn ${item.demand_volatility} bản/ngày, mức phục vụ ~95%).`);
  }
  if (item.seasonal_event && item.seasonal_index !== 1) {
    parts.push(`Dự báo đã điều chỉnh theo mùa vụ "${item.seasonal_event}" (hệ số ${item.seasonal_index}x dựa trên cùng kỳ năm trước).`);
  }

  return parts.join(' ');
}

// `options.includeSafetyStock`, `options.forecastModel` and
// `options.priorityFloors` exist only for the offline evaluation
// (eval/reorder-policy-backtest.js, eval/reorder-candidates.js). Production
// never passes them, so the endpoint always includes safety stock, forecasts
// with EWMA + trend and applies the priority minimum quantities.
function calculateSuggestion(row, demand, ranges, seasonal = {}, series = [], leadTime = null, options = {}) {
  const { includeSafetyStock = true, forecastModel = 'EWMA_TREND', priorityFloors = true } = options;
  // Lead time drives both the safety stock and the demand projected over the
  // reorder horizon, so it is resolved per item from real delivery history
  // rather than shared across the whole catalog.
  const resolvedLeadTime = leadTime || { days: ranges.leadTimeDays, source: 'DEFAULT', samples: 0 };
  const leadTimeDays = resolvedLeadTime.days;
  const availableQty = number(row.available_qty);
  const onHandQty = number(row.on_hand_qty);
  const reservedQty = number(row.reserved_qty);
  const borrowedQty = number(row.borrowed_qty);
  const reorderPoint = number(row.reorder_point);
  const borrowCount = demand.borrowCount;
  const previousBorrowCount = demand.previousBorrowCount;
  const reservationCount = demand.reservationCount;
  const wishlistCount = demand.wishlistCount;
  const availabilityAlertCount = demand.availabilityAlertCount;
  const seasonalIndex = seasonal.index ?? 1;
  const seasonalEvent = seasonal.event ?? null;
  const avgDailyDemand = borrowCount / ranges.days;
  // Recency-weighted current pace (EWMA), linear trend (bản/ngày) and demand
  // volatility (std dev) estimated from the daily borrow series, replacing the
  // flat-average heuristic for forecasting and safety stock.
  const demandPace = forecastModel === 'MOVING_AVERAGE'
    ? (series.length ? series.reduce((sum, value) => sum + value, 0) / series.length : 0)
    : ewma(series, EWMA_ALPHA);
  const dailyTrend = linearTrendSlope(series);
  const demandVolatility = stdDev(series);
  const forecast7d = projectedDemand(series, 7, seasonalIndex, forecastModel);
  const forecast30d = projectedDemand(series, 30, seasonalIndex, forecastModel);
  const demandTrendPct = previousBorrowCount > 0
    ? round(((borrowCount - previousBorrowCount) / previousBorrowCount) * 100, 1)
    : (borrowCount > 0 ? 100 : 0);
  const estimatedDaysUntilStockout = demandPace > 0 ? round(availableQty / demandPace, 1) : null;
  const hasDemandSignal = borrowCount > 0 || reservationCount > 0;
  const safetyStock = includeSafetyStock
    ? Math.max(
      reorderPoint,
      Math.ceil(SAFETY_STOCK_Z_SCORE * demandVolatility * Math.sqrt(leadTimeDays)),
      hasDemandSignal ? 2 : 0,
    )
    : 0;
  const expectedDemandDuringLeadTime = projectedDemand(series, leadTimeDays, seasonalIndex, forecastModel);
  let suggestedReorderQty = Math.max(0, expectedDemandDuringLeadTime + safetyStock - availableQty);
  const demandScore = round(
    borrowCount * 2
      + reservationCount * 3
      + wishlistCount * 1.5
      + availabilityAlertCount * 2
      + Math.max(0, demandTrendPct / 10)
      + lowStockBonus(availableQty),
    1,
  );
  const priority = resolvePriority({
    availableQty,
    borrowCount,
    reservationCount,
    forecast30d,
    estimatedDaysUntilStockout,
    leadTimeDays,
  });

  if (priorityFloors && priority === 'HIGH' && suggestedReorderQty < 5) {
    suggestedReorderQty = 5;
  }
  if (priorityFloors && priority === 'MEDIUM' && suggestedReorderQty < 3) {
    suggestedReorderQty = 3;
  }

  const unitCost = number(row.unit_cost);
  const estimatedCost = round(suggestedReorderQty * unitCost, 2);

  const item = {
    book_id: row.book_id,
    variant_id: row.variant_id,
    title: row.title,
    author: row.author,
    category: row.category,
    isbn: row.isbn,
    available_qty: availableQty,
    on_hand_qty: onHandQty,
    reserved_qty: reservedQty,
    borrowed_qty: borrowedQty,
    reorder_point: reorderPoint,
    borrow_count: borrowCount,
    previous_borrow_count: previousBorrowCount,
    reservation_count: reservationCount,
    wishlist_count: wishlistCount,
    availability_alert_count: availabilityAlertCount,
    avg_daily_demand: round(avgDailyDemand, 2),
    demand_pace: round(demandPace, 2),
    daily_trend: round(dailyTrend, 3),
    demand_volatility: round(demandVolatility, 2),
    forecast_7d: forecast7d,
    forecast_30d: forecast30d,
    // Demand expected before an order placed now arrives; with available_qty it
    // gives the shortfall compareByShortfallPerCost ranks on.
    lead_time_demand: expectedDemandDuringLeadTime,
    estimated_days_until_stockout: estimatedDaysUntilStockout,
    demand_trend_pct: demandTrendPct,
    demand_score: demandScore,
    priority,
    suggested_reorder_qty: suggestedReorderQty,
    seasonal_index: round(seasonalIndex, 2),
    seasonal_event: seasonalEvent,
    lead_time_days: leadTimeDays,
    lead_time_source: resolvedLeadTime.source,
    lead_time_samples: resolvedLeadTime.samples,
    unit_cost: unitCost,
    estimated_cost: estimatedCost,
  };

  return {
    ...item,
    reason: buildReason(item, ranges.days, leadTimeDays),
  };
}

// Display / budget order of reorder candidates: priority, then demand score,
// then quantity, then title.
const PRIORITY_RANK = { HIGH: 0, MEDIUM: 1, LOW: 2 };
function compareReorderCandidates(a, b) {
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    || b.demand_score - a.demand_score
    || b.suggested_reorder_qty - a.suggested_reorder_qty
    || a.title.localeCompare(b.title);
}

// Budget order that spends where it buys the most expected service: requests
// expected during the lead time that the copies on hand cannot cover
// (lead_time_demand - available_qty), per VND of the line. Lines with no
// shortfall (ordered only for safety stock) come after every line with one.
// Ties keep the production order.
function shortfallPerCost(item) {
  const shortfall = Math.max(0, Number(item.lead_time_demand || 0) - Number(item.available_qty || 0));
  const cost = Number(item.estimated_cost || 0);
  return cost > 0 ? shortfall / cost : 0;
}

function compareByShortfallPerCost(a, b) {
  return shortfallPerCost(b) - shortfallPerCost(a) || compareReorderCandidates(a, b);
}

module.exports = {
  compareByShortfallPerCost,
  EWMA_ALPHA,
  SAFETY_STOCK_Z_SCORE,
  seasonalIndexFromCounts,
  lowStockBonus,
  resolvePriority,
  buildReason,
  calculateSuggestion,
  compareReorderCandidates,
};
