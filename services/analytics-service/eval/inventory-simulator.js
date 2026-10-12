// Virtual-inventory simulator for the reorder-policy backtest. Pure: no DB,
// no filesystem, no randomness (lead times come from the caller).
//
// A library copy circulates: a fulfilled borrow takes one copy off the shelf
// and it comes back on the loan's return day; buying copies raises the owned
// stock permanently. Each policy gets its own independent virtual inventory,
// and all policies replay the same request timeline, the same starting
// collection, the same lead-time scenario and the same unit costs - only the
// reorder decisions differ.
//
// Day loop, for every variant, in this order:
//   1. purchase orders due today arrive        (available += qty, owned += qty)
//   2. copies due back from loans return      (available += n)
//   3. review day? -> the policy decides       (sees only state + borrows of EARLIER days)
//      an order is NOT added to stock now; it arrives after its lead time
//   4. today's borrow requests, in time order: served from the shelf if a copy
//      is available, otherwise recorded as unmet (lost) demand
//   5. end-of-day state is recorded (only for days inside the scoring window)
//
// Metrics are kept for two windows: the full scoring window, and a
// "steady-state" window starting at steadyStartDay. In the first lead time of
// the scoring window no order can have arrived yet, so every policy is still
// running on the identical warm-up stock; the steady-state window excludes
// that transient.
//
// No future leakage by construction: the policy receives the log of borrows
// this inventory actually served, and step 3 runs before step 4, so at the
// moment of a decision the log only holds borrows from days before today.
// The policy never receives the request timeline itself.

const { allocateBudget } = require('../src/utils/budget-allocation');

const DAY_MS = 24 * 60 * 60 * 1000;

function toDay(ms) {
  return Math.floor(ms / DAY_MS);
}

function prepareVariant(variant, firstDay, endDay) {
  // Requests grouped by day; return day at least the next day (a copy borrowed
  // and returned on the same day is back on the shelf tomorrow morning).
  const requestsByDay = new Map();
  for (const request of variant.requests) {
    const day = toDay(request.at);
    if (day < firstDay || day >= endDay) continue;
    const returnDay = request.returnAt === null ? null : Math.max(day + 1, toDay(request.returnAt));
    if (!requestsByDay.has(day)) requestsByDay.set(day, []);
    requestsByDay.get(day).push({ at: request.at, returnDay });
  }
  return {
    info: { variantId: variant.variantId, bookId: variant.bookId, title: variant.title, unitCost: variant.unitCost },
    requestsByDay,
    available: variant.initialCopies,
    owned: variant.initialCopies,
    onOrder: 0,
    pending: [], // { qty, orderDay, arrivalDay }
    returns: new Map(), // day -> copies coming back
    served: [], // timestamps of fulfilled borrows, ascending
    leadTimes: [], // observed lead times of this variant's received orders
    metrics: emptyAccumulator(),
    steady: emptyAccumulator(),
  };
}

function emptyAccumulator() {
  return {
    total_demand: 0, fulfilled_demand: 0, unmet_demand: 0, stockout_days: 0,
    inventory_day_sum: 0, available_day_sum: 0, max_inventory: 0,
    ordered_units: 0, order_count: 0, procurement_cost: 0,
  };
}

/**
 * @param {object} p
 * @param {Array} p.variants        [{ variantId, bookId, title, unitCost, initialCopies, requests: [{ at, returnAt }] }]
 * @param {number} p.firstDay       first simulated day (UTC day index); state warms up from here
 * @param {number} p.evalStartDay   first scored day and first review day
 * @param {number} p.endDay         exclusive
 * @param {number} [p.steadyStartDay] first day of the secondary (steady-state) window; default evalStartDay
 * @param {number} p.reviewPeriodDays
 * @param {{ name: string, decide: Function }} p.policy  decide(ctx) -> { qty, candidate? }
 * @param {Function} p.leadTimeDays (variantId, orderDay) -> whole days >= 1
 * @param {number|null} [p.budgetPerReview]  VND available at each review; null = unconstrained
 * @param {Function} [p.rankCandidates]      comparator on decision candidates (budget order)
 * @param {Array<string>} [p.timelineVariantIds]  variants whose daily state is returned
 */
function runInventoryBacktest({
  variants, firstDay, evalStartDay, endDay, reviewPeriodDays, policy, leadTimeDays,
  budgetPerReview = null, rankCandidates = null, timelineVariantIds = [], steadyStartDay = evalStartDay,
}) {
  if (!(evalStartDay >= firstDay && endDay > evalStartDay)) throw new Error('need firstDay <= evalStartDay < endDay');
  if (!(steadyStartDay >= evalStartDay && steadyStartDay < endDay)) throw new Error('need evalStartDay <= steadyStartDay < endDay');
  const states = variants.map((v) => prepareVariant(v, firstDay, endDay));
  const supplierLeadTimes = []; // every received order: one virtual supplier
  const timelines = new Map(timelineVariantIds.map((id) => [id, []]));
  const decisionStats = { reviews: 0, candidates: 0, funded: 0, unfunded_reorder_count: 0, budget_total: 0, budget_spent: 0, by_priority: {}, by_lead_time_source: {} };
  const catalog = { all: { inventorySum: 0, availableSum: 0, maxInventory: 0 }, steady: { inventorySum: 0, availableSum: 0, maxInventory: 0 } };

  for (let day = firstDay; day < endDay; day += 1) {
    const scored = day >= evalStartDay;
    const today = new Map(); // variantId -> { ordered, received }

    // 1-2. arrivals and returns
    for (const s of states) {
      let received = 0;
      s.pending = s.pending.filter((order) => {
        if (order.arrivalDay !== day) return true;
        received += order.qty;
        const leadTime = order.arrivalDay - order.orderDay;
        s.leadTimes.push(leadTime);
        supplierLeadTimes.push(leadTime);
        return false;
      });
      s.available += received + (s.returns.get(day) || 0);
      s.owned += received;
      s.onOrder -= received;
      s.returns.delete(day);
      today.set(s.info.variantId, { ordered: 0, received });
    }

    // 3. review
    if (scored && (day - evalStartDay) % reviewPeriodDays === 0) {
      decisionStats.reviews += 1;
      const dayStartMs = day * DAY_MS;
      const decisions = [];
      for (const s of states) {
        const decision = policy.decide({
          variant: s.info,
          day,
          dayStartMs,
          available: s.available,
          onOrder: s.onOrder,
          owned: s.owned,
          onLoan: s.owned - s.available,
          history: s.served,
          variantLeadTimes: s.leadTimes,
          supplierLeadTimes,
        });
        const qty = Math.max(0, Math.floor(decision?.qty || 0));
        if (qty > 0) decisions.push({ state: s, qty, candidate: decision.candidate || null });
      }
      decisionStats.candidates += decisions.length;

      let funded = decisions;
      if (budgetPerReview !== null) {
        const ordered = rankCandidates ? [...decisions].sort((a, b) => rankCandidates(a.candidate, b.candidate)) : decisions;
        const allocation = allocateBudget(ordered.map((d) => ({ ...d, estimated_cost: d.qty * d.state.info.unitCost })), budgetPerReview);
        funded = allocation.items.filter((item) => item.within_budget);
        decisionStats.unfunded_reorder_count += ordered.length - funded.length;
        decisionStats.budget_total += budgetPerReview;
        decisionStats.budget_spent += allocation.funded_cost;
      }

      for (const { state: s, qty, candidate } of funded) {
        const leadTime = leadTimeDays(s.info.variantId, day);
        if (!(Number.isInteger(leadTime) && leadTime >= 1)) throw new Error(`lead time must be a whole number of days >= 1, got ${leadTime}`);
        s.pending.push({ qty, orderDay: day, arrivalDay: day + leadTime });
        s.onOrder += qty;
        for (const acc of day >= steadyStartDay ? [s.metrics, s.steady] : [s.metrics]) {
          acc.ordered_units += qty;
          acc.order_count += 1;
          acc.procurement_cost += qty * s.info.unitCost;
        }
        today.get(s.info.variantId).ordered = qty;
        decisionStats.funded += 1;
        if (candidate?.priority) decisionStats.by_priority[candidate.priority] = (decisionStats.by_priority[candidate.priority] || 0) + 1;
        if (candidate?.lead_time_source) decisionStats.by_lead_time_source[candidate.lead_time_source] = (decisionStats.by_lead_time_source[candidate.lead_time_source] || 0) + 1;
      }
    }

    // 4-5. demand and end-of-day state
    let catalogInventory = 0;
    let catalogAvailable = 0;
    for (const s of states) {
      const requests = s.requestsByDay.get(day) || [];
      let fulfilled = 0;
      for (const request of requests) {
        if (s.available > 0) {
          s.available -= 1;
          fulfilled += 1;
          s.served.push(request.at);
          if (request.returnDay !== null && request.returnDay < endDay) {
            s.returns.set(request.returnDay, (s.returns.get(request.returnDay) || 0) + 1);
          }
        }
      }
      const unmet = requests.length - fulfilled;
      catalogInventory += s.owned;
      catalogAvailable += s.available;
      if (scored) {
        for (const m of day >= steadyStartDay ? [s.metrics, s.steady] : [s.metrics]) {
          m.total_demand += requests.length;
          m.fulfilled_demand += fulfilled;
          m.unmet_demand += unmet;
          if (unmet > 0) m.stockout_days += 1;
          m.inventory_day_sum += s.owned;
          m.available_day_sum += s.available;
          m.max_inventory = Math.max(m.max_inventory, s.owned);
        }
      }
      if (timelines.has(s.info.variantId) && scored) {
        const t = today.get(s.info.variantId);
        timelines.get(s.info.variantId).push({
          date: new Date(day * DAY_MS).toISOString().slice(0, 10),
          demand: requests.length, fulfilled, unmet,
          available_end: s.available, owned_end: s.owned, on_order_end: s.onOrder,
          ordered_qty: t.ordered, received_qty: t.received,
        });
      }
    }
    if (scored) {
      for (const c of day >= steadyStartDay ? [catalog.all, catalog.steady] : [catalog.all]) {
        c.inventorySum += catalogInventory;
        c.availableSum += catalogAvailable;
        c.maxInventory = Math.max(c.maxInventory, catalogInventory);
      }
    }
  }

  const evaluatedDays = endDay - evalStartDay;
  const steadyDays = endDay - steadyStartDay;
  const budgeted = budgetPerReview !== null;
  return {
    metrics: summarize(states.map((s) => s.metrics), evaluatedDays, catalog.all, decisionStats, budgeted),
    steadyStateMetrics: summarize(states.map((s) => s.steady), steadyDays, catalog.steady, null, false),
    perVariant: states.map((s) => ({ variant_id: s.info.variantId, title: s.info.title, ...variantMetrics(s.metrics, evaluatedDays) })),
    timelines: Object.fromEntries(timelines),
    decisionStats,
  };
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

function variantMetrics(m, evaluatedDays) {
  return {
    total_demand: m.total_demand,
    fulfilled_demand: m.fulfilled_demand,
    unmet_demand: m.unmet_demand,
    fill_rate: ratio(m.fulfilled_demand, m.total_demand),
    stockout_days: m.stockout_days,
    stockout_rate: ratio(m.stockout_days, evaluatedDays),
    average_inventory: m.inventory_day_sum / evaluatedDays,
    max_inventory: m.max_inventory,
    ordered_units: m.ordered_units,
    order_count: m.order_count,
    procurement_cost: m.procurement_cost,
  };
}

// Catalog-level metrics. Inventory figures are catalog totals (sum over all
// variants of the copies owned at the end of each scored day).
function summarize(accumulators, evaluatedDays, catalog, decisionStats, budgeted) {
  const sum = (field) => accumulators.reduce((acc, m) => acc + m[field], 0);
  const totalDemand = sum('total_demand');
  const fulfilled = sum('fulfilled_demand');
  const orderCount = sum('order_count');
  const orderedUnits = sum('ordered_units');
  const stockoutDays = sum('stockout_days');
  const metrics = {
    variants: accumulators.length,
    evaluated_days: evaluatedDays,
    total_demand: totalDemand,
    fulfilled_demand: fulfilled,
    unmet_demand: sum('unmet_demand'),
    fill_rate: ratio(fulfilled, totalDemand),
    stockout_days: stockoutDays,
    stockout_rate: ratio(stockoutDays, accumulators.length * evaluatedDays),
    variants_with_stockout: accumulators.filter((m) => m.stockout_days > 0).length,
    average_inventory: catalog.inventorySum / evaluatedDays,
    max_inventory: catalog.maxInventory,
    average_available_inventory: catalog.availableSum / evaluatedDays,
    ordered_units: orderedUnits,
    order_count: orderCount,
    procurement_cost: sum('procurement_cost'),
    average_order_size: ratio(orderedUnits, orderCount),
  };
  if (budgeted) {
    metrics.budget_total = decisionStats.budget_total;
    metrics.budget_utilization = ratio(decisionStats.budget_spent, decisionStats.budget_total);
    metrics.unfunded_reorder_count = decisionStats.unfunded_reorder_count;
  }
  return metrics;
}

module.exports = { DAY_MS, runInventoryBacktest };
