// Greedy budget allocation over an already priority-sorted list of reorder
// candidates. Pure function, no DB access, same convention as forecast.js /
// lead-time.js.
//
// Walks the list in the given order (priority, then demand score - whatever
// the caller already sorted by) and funds every item whose estimated_cost
// still fits the remaining budget. A miss is skipped, not a stop: one
// expensive HIGH-priority book must not block a cheap MEDIUM one ranked
// right behind it from being funded too.

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

/**
 * @param {Array<{ estimated_cost: number }>} items - already sorted by priority
 * @param {number} budgetVnd - total budget available, VND
 * @returns {{ items: Array, funded_cost: number, remaining_vnd: number }}
 */
function allocateBudget(items, budgetVnd) {
  let remaining = Number(budgetVnd || 0);
  let fundedCost = 0;

  const allocated = items.map((item) => {
    const cost = Number(item.estimated_cost || 0);
    const withinBudget = cost <= remaining;
    if (withinBudget) {
      remaining -= cost;
      fundedCost += cost;
    }
    return { ...item, within_budget: withinBudget };
  });

  return {
    items: allocated,
    funded_cost: round2(fundedCost),
    remaining_vnd: round2(remaining),
  };
}

/**
 * Funds lines in `fundingOrder` (best value first) but returns them in their
 * original (display) order, each flagged within_budget. Lets the endpoint keep
 * showing suggestions by priority while the money goes where it covers the most
 * expected shortfall - see compareByShortfallPerCost and
 * docs/ANALYSIS/REORDER_CANDIDATES.md for why the two orders differ.
 */
function allocateBudgetInOrder(items, budgetVnd, fundingOrder) {
  const ranked = items.map((item, index) => ({ item, index })).sort((a, b) => fundingOrder(a.item, b.item) || a.index - b.index);
  const allocation = allocateBudget(ranked.map((entry) => entry.item), budgetVnd);
  const withinBudget = new Array(items.length);
  allocation.items.forEach((allocated, position) => {
    withinBudget[ranked[position].index] = allocated.within_budget;
  });
  return {
    items: items.map((item, index) => ({ ...item, within_budget: withinBudget[index] })),
    funded_cost: allocation.funded_cost,
    remaining_vnd: allocation.remaining_vnd,
  };
}

// P(D > k) for D ~ Poisson(lambda).
function poissonTail(lambda, k) {
  if (!(lambda > 0)) return 0;
  let term = Math.exp(-lambda);
  let cdf = term;
  for (let i = 1; i <= k; i += 1) {
    term *= lambda / i;
    cdf += term;
  }
  return Math.max(0, 1 - cdf);
}

/**
 * Budget allocation by marginal expected service per VND (Copilot 3.3 /
 * docs/ANALYSIS/REORDER_OPTIMIZATION_EVALUATION.md): copies are funded one at
 * a time, each to the line where the next copy most raises the chance that
 * lead-time demand is covered - P(D > position + k), D ~ Poisson(lambda) -
 * divided by the copy's cost. A line never gets more than its `cap`. Copies
 * with no modelled gain (safety stock above the expected demand) are funded
 * afterwards, cheapest first, with the same "a miss is skipped" rule as
 * allocateBudget. Pure; the backtest (eval/reorder-policies.js) calls this
 * same function.
 *
 * @param {Array<{ cap: number, unitCost: number, lambda: number, position: number }>} lines
 * @param {number} budgetVnd
 * @param {{ trace?: boolean }} [options] - trace: also return every funded copy in
 *   funding order as { cost, gain } (gain = P(D > position + k), the expected
 *   lead-time demand the copy serves) - the cost / service curve (Phase 6)
 * @returns {{ qty: number[], spent: number, remaining: number, trace?: Array }} qty per line, same order
 */
function allocateMarginal(lines, budgetVnd, { trace = false } = {}) {
  const state = lines.map((line) => ({
    cap: Math.max(0, Math.floor(Number(line.cap) || 0)),
    cost: Math.max(0, Number(line.unitCost) || 0),
    lambda: Math.max(0, Number(line.lambda) || 0),
    position: Number(line.position) || 0,
    given: 0,
  }));
  const value = (s) => {
    if (s.given >= s.cap) return -1;
    const gain = poissonTail(s.lambda, s.position + s.given);
    return s.cost > 0 ? gain / s.cost : (gain > 0 ? Number.POSITIVE_INFINITY : 0);
  };
  const values = state.map(value);
  const steps = trace ? [] : null;
  let remaining = Number(budgetVnd) || 0;
  let spent = 0;
  for (;;) {
    let best = -1;
    let bestValue = 0;
    for (let i = 0; i < state.length; i += 1) {
      if (state[i].cost > remaining) continue;
      if (values[i] > bestValue) { best = i; bestValue = values[i]; }
    }
    if (best < 0) break;
    const s = state[best];
    if (steps) steps.push({ line: best, cost: s.cost, gain: poissonTail(s.lambda, s.position + s.given) });
    s.given += 1;
    remaining -= s.cost;
    spent += s.cost;
    values[best] = value(s);
  }
  const byCost = state.map((s, i) => i).sort((a, b) => state[a].cost - state[b].cost);
  for (const i of byCost) {
    const s = state[i];
    while (s.given < s.cap && s.cost <= remaining) {
      if (steps) steps.push({ line: i, cost: s.cost, gain: 0 });
      s.given += 1;
      remaining -= s.cost;
      spent += s.cost;
    }
  }
  const result = { qty: state.map((s) => s.given), spent: round2(spent), remaining: round2(remaining) };
  if (steps) result.trace = steps;
  return result;
}

/**
 * Cost / expected-service curve from an allocation trace: cumulative cost and
 * the share of the modelled lead-time demand served (0-100 %), plus the least
 * cost that reaches 90 / 95 / 99 / 100 % of what the full plan serves.
 * Copies with no modelled gain (safety stock) add cost, not service.
 */
function serviceCurve(trace, points = 10) {
  const total = trace.reduce((sum, step) => sum + step.gain, 0);
  let cost = 0;
  let gain = 0;
  const cumulative = trace.map((step) => {
    cost += step.cost;
    gain += step.gain;
    return { cost: round2(cost), service_pct: total > 0 ? Math.round((gain / total) * 1000) / 10 : 100 };
  });
  const costFor = (pct) => {
    const hit = cumulative.find((c) => c.service_pct >= pct);
    return hit ? hit.cost : (cumulative.length ? cumulative[cumulative.length - 1].cost : 0);
  };
  const curve = [];
  for (let k = 1; k <= points; k += 1) {
    const pct = (100 * k) / points;
    curve.push({ service_pct: pct, cost: costFor(pct) });
  }
  return {
    expected_demand_served: Math.round(total * 10) / 10,
    full_plan_cost: cumulative.length ? cumulative[cumulative.length - 1].cost : 0,
    cost_for_service_pct: { 90: costFor(90), 95: costFor(95), 99: costFor(99), 100: costFor(100) },
    curve,
  };
}

module.exports = {
  allocateBudget,
  allocateBudgetInOrder,
  allocateMarginal,
  poissonTail,
  serviceCurve,
};
