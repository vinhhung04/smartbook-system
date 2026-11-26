// Realistic budget baselines: how a library spends a limited acquisitions budget
// WITHOUT SmartBook. Each baseline = an order-quantity rule (what to reorder and
// how many) + a funding rule (which lines get the money first when it runs out).
// Used by eval/budget-realistic.js; defined there before any test seed was run.
//
// Quantity rules (existing policies, reused): REORDER_POINT (min/max 5/10) and
// MA30_FIXED_LT (30-day moving average + safety stock).
//
// Funding rules - all buy as many copies of a line as still fit (partial lines),
// never more than the quantity rule proposed:
//   POPULAR_FIRST   most borrows in the last 30 days first (a librarian's intuition)
//   HOLDS_FIRST     most active holds first, ties by recent borrows (buy what readers wait for)
//   CATEGORY_SHARE  split the budget across categories by their share of recent borrows,
//                   popular-first inside a category; money a category cannot use goes to
//                   the remaining lines popular-first (a classic acquisitions formula)
//   ONE_EACH        one copy per line per round, popular order, until money or lines run out

const { countInRange, activeReservationCount, DAY_MS } = require('./point-in-time');

const WINDOW_DAYS = 30;
const FUNDING_RULES = ['POPULAR_FIRST', 'HOLDS_FIRST', 'CATEGORY_SHARE', 'ONE_EACH'];

// Wraps a quantity policy so each decision carries what the funding rules rank by.
function withFundingSignals(policy, { reservationsByVariant = new Map(), categoryOf = () => 'all' } = {}) {
  return {
    ...policy,
    decide(ctx) {
      const decision = policy.decide(ctx);
      const to = ctx.dayStartMs;
      const from = to - WINDOW_DAYS * DAY_MS;
      return {
        ...decision,
        candidate: {
          borrows: countInRange(ctx.history, from, to),
          holds: activeReservationCount(reservationsByVariant.get(ctx.variant.variantId) || [], from, to),
          category: categoryOf(ctx.variant),
        },
      };
    },
  };
}

const byPopular = (a, b) => b.candidate.borrows - a.candidate.borrows;
const byHolds = (a, b) => b.candidate.holds - a.candidate.holds || byPopular(a, b);

// Greedy partial fill in the given order; returns copies given per line index.
function fillInOrder(lines, order, budget, given) {
  let remaining = budget;
  for (const i of order) {
    const { cost, cap } = lines[i];
    if (cost <= 0) continue;
    const take = Math.min(cap - given[i], Math.floor(remaining / cost));
    if (take > 0) {
      given[i] += take;
      remaining -= take * cost;
    }
  }
  return remaining;
}

function fundingAllocation(rule) {
  if (!FUNDING_RULES.includes(rule)) throw new Error(`unknown funding rule ${rule}`);
  return function allocate(decisions, budget) {
    const lines = decisions.map((d) => ({ cap: d.qty, cost: Number(d.unitCost || 0), c: d.candidate }));
    const given = lines.map(() => 0);
    const indexed = decisions.map((d, i) => ({ i, candidate: d.candidate }));
    const popular = [...indexed].sort(byPopular).map((x) => x.i);
    let remaining = budget;
    if (rule === 'POPULAR_FIRST') remaining = fillInOrder(lines, popular, remaining, given);
    else if (rule === 'HOLDS_FIRST') remaining = fillInOrder(lines, [...indexed].sort(byHolds).map((x) => x.i), remaining, given);
    else if (rule === 'CATEGORY_SHARE') {
      const groups = new Map();
      for (const i of popular) {
        const cat = lines[i].c.category;
        if (!groups.has(cat)) groups.set(cat, []);
        groups.get(cat).push(i);
      }
      const weight = (idx) => idx.reduce((a, i) => a + lines[i].c.borrows, 0);
      const totalWeight = [...groups.values()].reduce((a, idx) => a + weight(idx), 0);
      let leftover = 0;
      for (const idx of groups.values()) {
        const share = totalWeight > 0 ? weight(idx) / totalWeight : idx.length / decisions.length;
        leftover += fillInOrder(lines, idx, budget * share, given);
      }
      remaining = fillInOrder(lines, popular, leftover, given);
    } else {
      for (let round = true; round;) {
        round = false;
        for (const i of popular) {
          const { cost, cap } = lines[i];
          if (given[i] < cap && cost > 0 && cost <= remaining) {
            given[i] += 1;
            remaining -= cost;
            round = true;
          }
        }
      }
    }
    return {
      funded: decisions.map((d, i) => ({ ...d, qty: given[i] })).filter((d) => d.qty > 0),
      spent: budget - remaining,
    };
  };
}

module.exports = { FUNDING_RULES, WINDOW_DAYS, withFundingSignals, fundingAllocation };
