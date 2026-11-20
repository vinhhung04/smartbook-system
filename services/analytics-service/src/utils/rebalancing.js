// AI inventory rebalancing & procurement decision (Phase 2).
// Pure functions, no DB access (same convention as reorder-suggestion.js).
//
// Input: one line per (warehouse, variant) the user may read, already sized
// with the reorder model (calculateSuggestion) on THAT warehouse's own demand:
//   position        available + incoming PO + incoming transfers
//                   - outgoing transfers not yet picked + expected returns
//   lead_time_demand  demand expected over the supplier lead time
//   safety_stock    statistical safety stock (>= reorder point / safety_stock_qty)
// A line is short when its position is under lead_time_demand + safety_stock
// (its protected level) and has a surplus when it is above it. Only copies on
// the shelf now and not promised to an open transfer can move, so a source is
// never taken under its own protected level and a copy is never counted twice.
//
// Options compared (none is assumed best):
//   TRANSFER_ONLY       move surplus, buy nothing
//   PROCUREMENT_ONLY    buy every short line, move nothing
//   HYBRID              move surplus first, buy what is still short
//   HYBRID_EXECUTABLE   as HYBRID with only the actions the user can take now:
//                       transfers they can create, purchases in warehouses they
//                       can write (present only when HYBRID has another action)
// Purchases go through allocateMarginal (same allocation as the reorder
// budget mode). Transfer cost is not stored anywhere in SmartBook, so it is
// reported as unknown, never assumed.

const { allocateMarginal } = require('./budget-allocation');
const { transferPermission, purchasePermission } = require('./warehouse-access');

const PRIORITY_RANK = { HIGH: 0, MEDIUM: 1, LOW: 2 };
const OPTION_ORDER = ['TRANSFER_ONLY', 'PROCUREMENT_ONLY', 'HYBRID', 'HYBRID_EXECUTABLE'];
const EPS = 1e-9;

function round(value, digits = 2) {
  const f = 10 ** digits;
  return Math.round(Number(value || 0) * f) / f;
}

function key(line) {
  return `${line.warehouse_id}:${line.variant_id}`;
}

function protectedLevel(line) {
  return Number(line.lead_time_demand || 0) + Number(line.safety_stock || 0);
}

/** Copies the line needs to reach its protected level (0 when data is unreliable). */
function shortageQty(line) {
  if (line.data_issue) return 0;
  return Math.max(0, Math.ceil(protectedLevel(line) - Number(line.position || 0) - EPS));
}

/** Copies that can leave the line now without taking it under its protected level. */
function surplusQty(line) {
  if (line.data_issue || line.no_transfer_out) return 0;
  const onShelfFree = Number(line.available_qty || 0) - Number(line.outgoing_qty || 0);
  const aboveProtected = Math.floor(Number(line.position || 0) - protectedLevel(line) + EPS);
  return Math.max(0, Math.min(onShelfFree, aboveProtected));
}

function byPriorityThenNeed(a, b) {
  return (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3)
    || b.need - a.need
    || String(a.line.warehouse_id).localeCompare(String(b.line.warehouse_id));
}

/**
 * Safe transfers into the destination lines. A source serves destinations
 * from its surplus only; ties prefer the larger surplus, then a source the user
 * can act on. Sources outside the readable scope never appear (they are not in
 * `lines`); `onlyExecutable` keeps only transfers the user can create.
 */
function isDestination(line, destinationIds, priorities) {
  return (!destinationIds || destinationIds.has(line.warehouse_id)) && (!priorities || priorities.has(line.priority));
}

/**
 * What-if scenario on top of the computed lines (Phase 4). Only the given
 * parameters change; everything else stays as computed:
 *   demandChangePct      demand (and its Poisson rate) x (1 + pct/100) on
 *                        `demandWarehouseIds` (null = every line)
 *   safetyStockMultiplier safety stock x m (rounded up)
 *   blockedSourceIds     warehouses that cannot send stock
 *   allowedSourceIds     the only warehouses that may send stock
 *   closedWarehouseIds   warehouses simulated as stopped: no stock, no need
 */
function applyWhatIf(lines, {
  demandChangePct = 0, demandWarehouseIds = null, safetyStockMultiplier = 1,
  blockedSourceIds = null, allowedSourceIds = null, closedWarehouseIds = null,
} = {}) {
  const factor = 1 + Number(demandChangePct || 0) / 100;
  return lines
    .filter((l) => !closedWarehouseIds || !closedWarehouseIds.has(l.warehouse_id))
    .map((l) => {
      const k = !demandWarehouseIds || demandWarehouseIds.has(l.warehouse_id) ? factor : 1;
      return {
        ...l,
        lead_time_demand: Number(l.lead_time_demand || 0) * k,
        lambda: Number(l.lambda || 0) * k,
        safety_stock: Math.ceil(Number(l.safety_stock || 0) * safetyStockMultiplier - EPS),
        no_transfer_out: Boolean(blockedSourceIds?.has(l.warehouse_id))
          || Boolean(allowedSourceIds && !allowedSourceIds.has(l.warehouse_id)),
      };
    });
}

function planTransfers(lines, { accessible, capabilities, destinationIds = null, priorities = null, onlyExecutable = false }) {
  const groups = new Map();
  for (const line of lines) {
    if (!groups.has(line.variant_id)) groups.set(line.variant_id, []);
    groups.get(line.variant_id).push(line);
  }
  const transfers = [];
  for (const group of groups.values()) {
    const destinations = group
      .filter((l) => isDestination(l, destinationIds, priorities) && shortageQty(l) > 0)
      .map((l) => ({ line: l, need: shortageQty(l), priority: l.priority }))
      .sort(byPriorityThenNeed);
    if (!destinations.length) continue;
    const sources = group
      .filter((l) => surplusQty(l) > 0)
      .map((l) => ({ line: l, left: surplusQty(l), used: 0 }));
    for (const dest of destinations) {
      const candidates = sources
        .filter((s) => s.left > 0 && s.line.warehouse_id !== dest.line.warehouse_id)
        .map((s) => ({ s, perm: transferPermission(s.line.warehouse_id, dest.line.warehouse_id, accessible, capabilities) }))
        .filter(({ perm }) => perm && (!onlyExecutable || perm.status === 'EXECUTABLE'))
        .sort((a, b) => b.s.left - a.s.left
          || (a.perm.status === 'EXECUTABLE' ? 0 : 1) - (b.perm.status === 'EXECUTABLE' ? 0 : 1)
          || String(a.s.line.warehouse_id).localeCompare(String(b.s.line.warehouse_id)));
      let need = dest.need;
      for (const { s, perm } of candidates) {
        if (need <= 0) break;
        const quantity = Math.min(need, s.left);
        s.left -= quantity;
        s.used += quantity;
        need -= quantity;
        transfers.push({
          variant_id: dest.line.variant_id,
          title: dest.line.title,
          from_warehouse_id: s.line.warehouse_id,
          to_warehouse_id: dest.line.warehouse_id,
          quantity,
          unit_cost: Number(dest.line.unit_cost || 0),
          source_available_qty: Number(s.line.available_qty || 0),
          source_outgoing_qty: Number(s.line.outgoing_qty || 0),
          source_protected_qty: Math.ceil(protectedLevel(s.line) - EPS),
          source_available_after: Number(s.line.available_qty || 0) - Number(s.line.outgoing_qty || 0) - s.used,
          destination_position_before: round(dest.line.position),
          destination_shortage_before: dest.need,
          priority: dest.line.priority,
          permission: perm.status,
          permission_reason: perm.reason,
        });
      }
    }
  }
  return transfers;
}

/** Purchases for what is still short after `transfers`, within `budgetVnd` (null = no limit).
 * `onlyExecutable` buys only where the user may create a purchase request. */
function planPurchases(destLines, transfers, { budgetVnd = null, accessible, capabilities, onlyExecutable = false }) {
  const inbound = new Map();
  for (const t of transfers) {
    const k = `${t.to_warehouse_id}:${t.variant_id}`;
    inbound.set(k, (inbound.get(k) || 0) + t.quantity);
  }
  const rows = destLines.map((line) => {
    const residual = Math.max(0, shortageQty(line) - (inbound.get(key(line)) || 0));
    const priced = Number(line.unit_cost) > 0;
    const perm = purchasePermission(line.warehouse_id, accessible, capabilities);
    const allowed = !onlyExecutable || perm?.status === 'EXECUTABLE';
    return { line, residual: allowed ? residual : 0, priced, perm, transferredIn: inbound.get(key(line)) || 0 };
  });
  let qty;
  let spent;
  let remaining = null;
  if (budgetVnd === null) {
    qty = rows.map((r) => (r.priced ? r.residual : 0));
    spent = rows.reduce((sum, r, i) => sum + qty[i] * Number(r.line.unit_cost || 0), 0);
  } else {
    const allocation = allocateMarginal(rows.map((r) => ({
      cap: r.priced ? r.residual : 0,
      unitCost: Number(r.line.unit_cost || 0),
      lambda: Number(r.line.lambda || 0),
      position: Number(r.line.position || 0) + r.transferredIn,
    })), budgetVnd);
    qty = allocation.qty;
    spent = allocation.spent;
    remaining = allocation.remaining;
  }
  const purchases = [];
  const unpriced = [];
  rows.forEach((r, i) => {
    if (r.residual > 0 && !r.priced) unpriced.push({ warehouse_id: r.line.warehouse_id, variant_id: r.line.variant_id, title: r.line.title, quantity: r.residual });
    if (!qty[i]) return;
    const { perm } = r;
    purchases.push({
      warehouse_id: r.line.warehouse_id,
      variant_id: r.line.variant_id,
      title: r.line.title,
      quantity: qty[i],
      unit_cost: Number(r.line.unit_cost),
      cost: round(qty[i] * Number(r.line.unit_cost)),
      lead_time_days: r.line.lead_time_days ?? null,
      lead_time_source: r.line.lead_time_source ?? null,
      priority: r.line.priority,
      permission: perm ? perm.status : 'PROPOSAL_ONLY',
      permission_reason: perm ? perm.reason : 'NO_WRITE_ON_WAREHOUSE',
    });
  });
  return { purchases, unpriced, spent: round(spent), remaining: remaining === null ? null : round(remaining) };
}

function summarizeOption(code, destLines, transfers, plan, { budgetVnd, transferLeadTimeDays }) {
  const covered = new Map();
  for (const t of transfers) covered.set(`${t.to_warehouse_id}:${t.variant_id}`, (covered.get(`${t.to_warehouse_id}:${t.variant_id}`) || 0) + t.quantity);
  for (const p of plan.purchases) covered.set(`${p.warehouse_id}:${p.variant_id}`, (covered.get(`${p.warehouse_id}:${p.variant_id}`) || 0) + p.quantity);
  let total = 0;
  let remaining = 0;
  let remainingHigh = 0;
  for (const line of destLines) {
    const need = shortageQty(line);
    const left = Math.max(0, need - (covered.get(key(line)) || 0));
    total += need;
    remaining += left;
    if (line.priority === 'HIGH') remainingHigh += left;
  }
  const transferQty = transfers.reduce((sum, t) => sum + t.quantity, 0);
  const purchaseQty = plan.purchases.reduce((sum, p) => sum + p.quantity, 0);
  const collaborative = transfers.filter((t) => t.permission !== 'EXECUTABLE');
  const unpricedQty = plan.unpriced.reduce((sum, u) => sum + u.quantity, 0);
  const purchaseLeadTimes = plan.purchases.map((p) => p.lead_time_days).filter((d) => d !== null && d !== undefined);
  const purchaseLeadTime = plan.purchases.length ? Math.max(...purchaseLeadTimes, 0) : null;
  const legs = [];
  if (transfers.length) legs.push(transferLeadTimeDays);
  if (plan.purchases.length) legs.push(purchaseLeadTime);
  const risks = [];
  if (remainingHigh > 0) risks.push('HIGH_PRIORITY_SHORTAGE_LEFT');
  if (remaining > 0) risks.push('SHORTAGE_LEFT');
  if (collaborative.length) risks.push('NEEDS_OTHER_MANAGER');
  if (unpricedQty > 0) risks.push('UNPRICED_LINES');
  if (transfers.length && transferLeadTimeDays === null) risks.push('TRANSFER_TIME_UNKNOWN');
  return {
    code,
    total_shortage_qty: total,
    transfer_qty: transferQty,
    purchase_qty: purchaseQty,
    covered_qty: total - remaining,
    remaining_shortage_qty: remaining,
    remaining_high_priority_qty: remainingHigh,
    shortage_covered_pct: total > 0 ? round(((total - remaining) / total) * 100, 1) : 100,
    purchase_cost_vnd: plan.spent,
    transfer_cost_vnd: null, // no transfer cost data in SmartBook
    budget_vnd: budgetVnd,
    remaining_budget_vnd: plan.remaining,
    transfer_lines: transfers.length,
    collaborative_transfer_lines: collaborative.length,
    collaborative_transfer_qty: collaborative.reduce((sum, t) => sum + t.quantity, 0),
    purchase_lines: plan.purchases.length,
    unpriced_qty: unpricedQty,
    transfer_lead_time_days: transfers.length ? transferLeadTimeDays : null,
    purchase_lead_time_days: purchaseLeadTime,
    // the slowest leg used; unknown when any leg used has no data
    response_days: legs.length && legs.every((d) => d !== null && d !== undefined) ? Math.max(...legs) : null,
    risk_level: remainingHigh > 0 ? 'HIGH' : (risks.length ? 'MEDIUM' : 'LOW'),
    risks,
    transfers,
    purchases: plan.purchases,
    unpriced_lines: plan.unpriced,
  };
}

// Deterministic ranking: least shortage left, then least HIGH-priority
// shortage left, then lowest purchase cost, then fewest transfers needing
// another manager, then fewest actions, then the fixed option order.
function compareOptions(a, b) {
  return a.remaining_shortage_qty - b.remaining_shortage_qty
    || a.remaining_high_priority_qty - b.remaining_high_priority_qty
    || a.purchase_cost_vnd - b.purchase_cost_vnd
    || a.collaborative_transfer_lines - b.collaborative_transfer_lines
    || (a.transfer_lines + a.purchase_lines) - (b.transfer_lines + b.purchase_lines)
    || OPTION_ORDER.indexOf(a.code) - OPTION_ORDER.indexOf(b.code);
}

const RANKING_RULE = 'Thứ tự cố định: (1) ít thiếu hụt còn lại nhất, (2) ít thiếu hụt ưu tiên HIGH còn lại nhất, '
  + '(3) chi phí mua mới thấp nhất, (4) ít dòng điều chuyển cần Manager khác phối hợp nhất, (5) ít thao tác nhất. '
  + 'Chi phí điều chuyển không có dữ liệu nên không được tính.';

/**
 * The whole plan. `destinationIds` (Set) limits which warehouses are served;
 * null = every readable warehouse with a shortage. Lines must already be
 * limited to the user's readable, active warehouses.
 */
function buildRebalancingPlan(lines, {
  accessible, capabilities, destinationIds = null, priorities = null, budgetVnd = null, transferLeadTimeDays = null,
}) {
  const destLines = lines.filter((l) => isDestination(l, destinationIds, priorities) && shortageQty(l) > 0);
  const allTransfers = planTransfers(lines, { accessible, capabilities, destinationIds, priorities });
  const ctx = { budgetVnd, transferLeadTimeDays };
  const purchaseCtx = { budgetVnd, accessible, capabilities };
  const hybridPlan = planPurchases(destLines, allTransfers, purchaseCtx);
  const options = [
    summarizeOption('TRANSFER_ONLY', destLines, allTransfers, { purchases: [], unpriced: [], spent: 0, remaining: budgetVnd }, ctx),
    summarizeOption('PROCUREMENT_ONLY', destLines, [], planPurchases(destLines, [], purchaseCtx), ctx),
    summarizeOption('HYBRID', destLines, allTransfers, hybridPlan, ctx),
  ];
  if (!allExecutable(options[2])) {
    const executable = planTransfers(lines, { accessible, capabilities, destinationIds, priorities, onlyExecutable: true });
    const option = summarizeOption('HYBRID_EXECUTABLE', destLines, executable,
      planPurchases(destLines, executable, { ...purchaseCtx, onlyExecutable: true }), ctx);
    if (option.transfer_lines + option.purchase_lines > 0) options.push(option);
  }
  const ranked = [...options].sort(compareOptions);
  const best = ranked[0];
  const executableBest = ranked.find(executableNow) || null;
  return {
    diagnosis: diagnose(lines, accessible),
    shortages: destLines.map((l) => lineView(l, shortageQty(l), 'shortage_qty')).sort(viewOrder('shortage_qty')),
    surpluses: lines.filter((l) => surplusQty(l) > 0).map((l) => lineView(l, surplusQty(l), 'surplus_qty')).sort(viewOrder('surplus_qty')),
    options: Object.fromEntries(options.map((o) => [o.code, o])),
    recommendation: {
      best_business_option: best.code,
      executable_option: executableBest ? executableBest.code : null,
      ranking: ranked.map((o) => o.code),
      rule: RANKING_RULE,
    },
  };
}

function allExecutable(option) {
  return option.transfers.every((t) => t.permission === 'EXECUTABLE')
    && option.purchases.every((p) => p.permission === 'EXECUTABLE');
}

// An option the user can carry out now: every action is theirs, and it does
// something (an empty option only "executes" when nothing is short).
function executableNow(option) {
  return allExecutable(option) && (option.transfer_lines + option.purchase_lines > 0 || option.total_shortage_qty === 0);
}

function lineView(line, qty, field) {
  return {
    warehouse_id: line.warehouse_id,
    variant_id: line.variant_id,
    title: line.title,
    priority: line.priority,
    available_qty: Number(line.available_qty || 0),
    incoming_qty: Number(line.incoming_qty || 0),
    outgoing_qty: Number(line.outgoing_qty || 0),
    expected_returns: Number(line.expected_returns || 0),
    position: round(line.position),
    lead_time_demand: round(line.lead_time_demand),
    safety_stock: Number(line.safety_stock || 0),
    lead_time_days: line.lead_time_days ?? null,
    unit_cost: Number(line.unit_cost || 0),
    [field]: qty,
  };
}

function viewOrder(field) {
  return (a, b) => (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3) || b[field] - a[field]
    || String(a.title).localeCompare(String(b.title));
}

function diagnose(lines, accessible) {
  const byWarehouse = new Map(accessible.map((w) => [w.warehouse_id, {
    warehouse_id: w.warehouse_id,
    code: w.code,
    name: w.name,
    access: w.access,
    variants_tracked: 0,
    shortage_variants: 0,
    surplus_variants: 0,
    shortage_qty: 0,
    surplus_qty: 0,
    available_qty: 0,
    incoming_qty: 0,
    outgoing_qty: 0,
    forecast_demand_qty: 0,
    unreliable_lines: 0,
  }]));
  for (const line of lines) {
    const row = byWarehouse.get(line.warehouse_id);
    if (!row) continue;
    row.variants_tracked += 1;
    if (line.data_issue) row.unreliable_lines += 1;
    const short = shortageQty(line);
    const extra = surplusQty(line);
    if (short > 0) { row.shortage_variants += 1; row.shortage_qty += short; }
    if (extra > 0) { row.surplus_variants += 1; row.surplus_qty += extra; }
    row.available_qty += Number(line.available_qty || 0);
    row.incoming_qty += Number(line.incoming_qty || 0);
    row.outgoing_qty += Number(line.outgoing_qty || 0);
    row.forecast_demand_qty += Number(line.lead_time_demand || 0);
  }
  return [...byWarehouse.values()].map((row) => ({ ...row, forecast_demand_qty: round(row.forecast_demand_qty, 1) }));
}

/** Median of observed transfer durations (days), or null under `minSamples`. */
function medianTransferDays(durations, minSamples = 3) {
  const clean = durations.map(Number).filter((d) => Number.isFinite(d) && d >= 0).sort((a, b) => a - b);
  if (clean.length < minSamples) return null;
  const mid = Math.floor(clean.length / 2);
  return round(clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2, 1);
}

module.exports = {
  applyWhatIf,
  buildRebalancingPlan,
  planTransfers,
  planPurchases,
  shortageQty,
  surplusQty,
  medianTransferDays,
  RANKING_RULE,
};
