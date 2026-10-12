// Reorder policies compared by the backtest. Each is { name, decide(ctx) }
// where ctx is what inventory-simulator.js hands over at a review: the
// variant's current stock and the borrows this inventory served on EARLIER
// days (ctx.history) - never the future request timeline.
//
// All policies compare against the same inventory position:
//   position = copies on the shelf + copies already on order
// Production's available_qty is shelf stock only; a librarian approving
// suggestions would not re-buy copies already on order, so on-order copies are
// added for every policy alike. Copies out on loan are NOT counted, exactly as
// in production.

const { stdDev, predict } = require('../src/utils/forecast');
const { resolveLeadTime, DEFAULT_LEAD_TIME_DAYS } = require('../src/utils/lead-time');
const { calculateSuggestion, compareReorderCandidates, compareByShortfallPerCost, seasonalIndexFromCounts, SAFETY_STOCK_Z_SCORE } = require('../src/utils/reorder-suggestion');
const { findSeasonalEvent } = require('../src/config/seasonal-events');
const { DAY_MS, countInRange, dailySeries, activeReservationCount, wishlistCountAt, dayCounts } = require('./point-in-time');

const YEAR_MS = 365 * DAY_MS;
// Production defaults of GET /analytics/reorder-suggestions.
const PRODUCTION_WINDOW_DAYS = 30;
// Production's LOW_STOCK_THRESHOLD default (analytics.controller.js).
const LOW_STOCK_THRESHOLD = 5;

function position(ctx) {
  return ctx.available + ctx.onOrder;
}

// Reference only: never buys. Shows what the starting collection alone delivers.
function noReorderPolicy() {
  return { name: 'NO_REORDER', decide: () => ({ qty: 0 }) };
}

// Policy A - static min/max on shelf stock, demand-agnostic. When the
// position falls to the reorder point s, order up to S. s is production's own
// low-stock threshold (5); S = 2s. Neither number was tuned on the backtest.
function reorderPointPolicy({ reorderPoint = LOW_STOCK_THRESHOLD, orderUpTo = 2 * LOW_STOCK_THRESHOLD } = {}) {
  return {
    name: 'REORDER_POINT',
    params: { reorder_point: reorderPoint, order_up_to: orderUpTo },
    decide(ctx) {
      const pos = position(ctx);
      return { qty: pos <= reorderPoint ? orderUpTo - pos : 0 };
    },
  };
}

// Policy B - 30-day moving average, fixed 14-day lead time, and the same
// safety-stock formula as production (SS = ceil(z * sigma * sqrt(L)), z = 1.645)
// on the last 30 complete days of served borrows. No trend, no seasonality,
// no demand signals, no priority minimums.
function ma30FixedLeadTimePolicy({ leadTimeDays = DEFAULT_LEAD_TIME_DAYS, windowDays = 30, z = SAFETY_STOCK_Z_SCORE } = {}) {
  return {
    name: 'MA30_FIXED_LT',
    params: { lead_time_days: leadTimeDays, window_days: windowDays, z },
    decide(ctx) {
      const series = dayCounts(ctx.history, ctx.day - windowDays, ctx.day);
      const dailyRate = predict('MOVING_AVERAGE_30', series, 1)[0];
      const safetyStock = Math.ceil(z * stdDev(series) * Math.sqrt(leadTimeDays));
      const target = Math.ceil(dailyRate * leadTimeDays) + safetyStock;
      return { qty: Math.max(0, target - position(ctx)) };
    },
  };
}

/**
 * Policy C - production reorder logic (calculateSuggestion, reused verbatim)
 * fed with point-in-time inputs. Order quantity = suggested_reorder_qty.
 *
 * The production call is simulated at the start of the review day
 * (to = dayStart). The daily series is the 30 complete days before it; since
 * getDailyBorrowSeriesByVariant only uses complete days, production returns
 * the same series whatever the time of day it is called (before that fix a
 * partial "today" bucket dragged the EWMA level down in the morning).
 *
 * Feature switches (ablation):
 *   seasonality      false -> seasonal index fixed at 1
 *   learnedLeadTime  false -> lead time fixed at the 14-day default
 *   safetyStock      false -> safety stock 0 (calculateSuggestion option)
 *   demandSignals    false -> reservation and wishlist counts set to 0
 *   forecastModel    'MOVING_AVERAGE' -> 30-day mean instead of EWMA(0.35) +
 *                    trend (candidate from eval/forecast-diagnostics.js)
 *   priorityFloors   false -> no HIGH >= 5 / MEDIUM >= 3 minimum quantity
 *   rankBy           budget order: 'SHORTFALL_PER_COST' (production) or
 *                    'PRIORITY' (pre-2026-10-08 production, priority + score)
 * Availability alerts are 0 in EVERY variant: they are created when a copy is
 * unavailable, i.e. they depend on the policy's own stock-outs, and the
 * pilot demand world (unlimited stock) has none. Using the observed dataset's
 * final alert table instead would leak another world's stock-outs.
 */
function smartbookPolicy({
  name = 'SMARTBOOK',
  seasonality = true,
  learnedLeadTime = true,
  safetyStock = true,
  demandSignals = true,
  forecastModel = 'EWMA_TREND',
  priorityFloors = true,
  // Production funds budgets by shortfall per VND since 2026-10-08
  // (eval/reorder-candidates.js); 'PRIORITY' is the pre-change order.
  rankBy = 'SHORTFALL_PER_COST',
  reservationsByVariant,
  wishlistsByBook,
  defaultLeadTimeDays = DEFAULT_LEAD_TIME_DAYS,
} = {}) {
  return {
    name,
    params: { seasonality, learned_lead_time: learnedLeadTime, safety_stock: safetyStock, demand_signals: demandSignals, forecast_model: forecastModel, priority_floors: priorityFloors, rank_by: rankBy },
    rankCandidates: rankBy === 'SHORTFALL_PER_COST' ? compareByShortfallPerCost : compareReorderCandidates,
    decide(ctx) {
      const to = ctx.dayStartMs;
      const from = to - PRODUCTION_WINDOW_DAYS * DAY_MS;
      const ranges = { days: PRODUCTION_WINDOW_DAYS, leadTimeDays: defaultLeadTimeDays };
      const history = ctx.history;

      const demand = {
        borrowCount: countInRange(history, from, to),
        previousBorrowCount: countInRange(history, from - PRODUCTION_WINDOW_DAYS * DAY_MS, from),
        reservationCount: demandSignals ? activeReservationCount(reservationsByVariant.get(ctx.variant.variantId) || [], from, to) : 0,
        wishlistCount: demandSignals ? wishlistCountAt(wishlistsByBook.get(ctx.variant.bookId), to) : 0,
        availabilityAlertCount: 0,
      };

      const seasonal = { index: 1, event: findSeasonalEvent(new Date(to)) };
      if (seasonality) {
        seasonal.index = seasonalIndexFromCounts({
          samePeriodLastYear: countInRange(history, from - YEAR_MS, to - YEAR_MS),
          yearlyTotal: countInRange(history, to - YEAR_MS, to),
          days: PRODUCTION_WINDOW_DAYS,
        }) ?? 1;
      }

      // Production resolves per-variant history first, then the supplier's.
      // The synthetic catalog has one (virtual) supplier and no declared lead
      // times, so the chain is variant -> supplier -> 14-day default.
      const leadTime = learnedLeadTime
        ? resolveLeadTime({
          variantObservations: ctx.variantLeadTimes,
          supplierObservations: ctx.supplierLeadTimes,
          declaredLeadTimeDays: null,
          defaultLeadTimeDays,
        })
        : { days: defaultLeadTimeDays, source: 'DEFAULT', samples: 0 };

      const row = {
        variant_id: ctx.variant.variantId,
        book_id: ctx.variant.bookId,
        title: ctx.variant.title,
        available_qty: position(ctx),
        on_hand_qty: ctx.owned,
        reserved_qty: 0,
        borrowed_qty: ctx.onLoan,
        reorder_point: 0, // no stock_balances.reorder_point in the synthetic catalog
        unit_cost: ctx.variant.unitCost,
      };
      const series = dailySeries(history, from, to);
      const candidate = calculateSuggestion(row, demand, ranges, seasonal, series, leadTime, { includeSafetyStock: safetyStock, forecastModel, priorityFloors });
      return { qty: candidate.suggested_reorder_qty, candidate };
    },
  };
}

module.exports = {
  LOW_STOCK_THRESHOLD,
  PRODUCTION_WINDOW_DAYS,
  noReorderPolicy,
  reorderPointPolicy,
  ma30FixedLeadTimePolicy,
  smartbookPolicy,
};
