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

module.exports = {
  allocateBudget,
};
