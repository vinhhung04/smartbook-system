// GET /analytics/rebalancing-plan - AI inventory rebalancing & procurement decision.
//
// Every figure is computed here, per (warehouse, variant), on the warehouses
// the caller may read (auth-service scope, fail-closed); nothing library-wide
// is used as one warehouse's figure. Demand is the warehouse's OWN loans and
// reservations. The model per line is the reorder model (calculateSuggestion:
// EWMA + trend, seasonal index, learned lead time, safety stock), the
// arithmetic of shortage / surplus / safe transfers / options is
// utils/rebalancing.js, permissions are utils/warehouse-access.js.

const { inventoryPool, borrowPool, query } = require('../lib/db');
const { resolveWarehouseScope } = require('../middlewares/warehouse-scope.middleware');
const { createHttpError, parseLimit, round } = require('../utils/date-range');
const { findSeasonalEvent } = require('../config/seasonal-events');
const { calculateSuggestion } = require('../utils/reorder-suggestion');
const { loanSurvival, expectedReturns } = require('../utils/expected-returns');
const {
  accessibleWarehouses, actionCapabilities, checkRequestedWarehouses,
} = require('../utils/warehouse-access');
const { applyWhatIf, buildRebalancingPlan, medianTransferDays } = require('../utils/rebalancing');
const {
  parseReorderDateRanges, parseOptionalBudget, getLeadTimeHistory, getSeasonalIndexByVariant, resolveItemLeadTime,
} = require('./analytics.controller');

// Transfers not yet picked still hold the source's shelf copies (picking is
// where available_qty is decremented and shipped_qty incremented); every open
// transfer is incoming at its destination until received. REQUESTED ones are
// counted too, so a plan never proposes a second transfer for the same need.
const OUTGOING_STATUSES = ['REQUESTED', 'APPROVED', 'PICKING'];
const INCOMING_TRANSFER_STATUSES = ['REQUESTED', 'APPROVED', 'PICKING', 'IN_TRANSIT'];
const INCOMING_PO_STATUSES = ['APPROVED', 'SENT_TO_SUPPLIER', 'SUPPLIER_CONFIRMED', 'PARTIALLY_RECEIVED', 'SHORTAGE_REPORTED'];

const ASSUMPTIONS = [
  'Nhu cầu của mỗi kho chỉ tính từ phiếu mượn và đặt chỗ phát sinh tại chính kho đó.',
  'Mức cần giữ của một dòng = nhu cầu dự kiến trong thời gian chờ nhập hàng + tồn an toàn (thống kê, không thấp hơn reorder point / safety_stock_qty).',
  'Vị thế tồn = tồn khả dụng + hàng mua đang về + hàng điều chuyển đang về - hàng đã hứa điều chuyển đi chưa lấy + bản dự kiến được trả trong thời gian chờ.',
  'Chỉ bản đang nằm trên kệ và chưa hứa cho điều chuyển khác mới được điều chuyển; kho nguồn không bị đưa xuống dưới mức cần giữ.',
  'Yêu cầu điều chuyển đang mở (kể cả REQUESTED chưa duyệt) được tính là hàng đang về / đã hứa đi.',
  'Chi phí điều chuyển không có trong dữ liệu SmartBook nên không được tính vào so sánh.',
  'Ngân sách chỉ áp dụng cho mua mới; dòng chưa có đơn giá không được mua và được liệt kê riêng.',
];

function number(value) {
  return Number(value || 0);
}

function parseIds(value) {
  if (value === undefined || value === null || value === '') return [];
  return String(value).split(',').map((s) => s.trim()).filter(Boolean);
}

function parseNumber(value, name, min, max) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw createHttpError(400, `${name} phải là số từ ${min} đến ${max}`);
  return n;
}

function keyed(rows, valueField) {
  const map = new Map();
  for (const row of rows) map.set(`${row.warehouse_id}:${row.variant_id}`, number(row[valueField]));
  return map;
}

async function getWarehouses() {
  return query(inventoryPool, 'SELECT id::text AS id, code, name, is_active FROM warehouses');
}

async function getStockByWarehouseVariant(ids) {
  return query(
    inventoryPool,
    `
    SELECT sb.warehouse_id::text AS warehouse_id, sb.variant_id::text AS variant_id,
           SUM(sb.available_qty) AS available_qty, SUM(sb.on_hand_qty) AS on_hand_qty,
           SUM(sb.reserved_qty) AS reserved_qty, SUM(sb.borrowed_qty) AS borrowed_qty,
           MAX(sb.reorder_point) AS reorder_point, MAX(sb.safety_stock_qty) AS safety_stock_qty
    FROM stock_balances sb
    JOIN book_variants bv ON bv.id = sb.variant_id AND bv.is_active = true
    JOIN books b ON b.id = bv.book_id AND b.is_active = true
    WHERE sb.warehouse_id = ANY($1::uuid[])
    GROUP BY sb.warehouse_id, sb.variant_id
    `,
    [ids],
  );
}

async function getVariants(variantIds) {
  if (!variantIds.length) return new Map();
  const rows = await query(
    inventoryPool,
    `
    SELECT bv.id::text AS variant_id, b.id::text AS book_id, b.title, bv.unit_cost
    FROM book_variants bv
    JOIN books b ON b.id = bv.book_id
    WHERE bv.id = ANY($1::uuid[]) AND bv.is_active = true AND b.is_active = true
    `,
    [variantIds],
  );
  return new Map(rows.map((row) => [row.variant_id, row]));
}

async function getIncomingPurchases(ids) {
  return query(
    inventoryPool,
    `
    SELECT po.warehouse_id::text AS warehouse_id, poi.variant_id::text AS variant_id,
           SUM(GREATEST(poi.ordered_qty - poi.received_qty, 0)) AS qty
    FROM purchase_order_items poi
    JOIN purchase_orders po ON po.id = poi.purchase_order_id
    WHERE po.status = ANY($2::text[])
      AND poi.closure_status != 'CLOSED_WITH_REMAINING'
      AND po.warehouse_id = ANY($1::uuid[])
    GROUP BY 1, 2
    `,
    [ids, INCOMING_PO_STATUSES],
  );
}

async function getOpenTransfers(ids) {
  const [incoming, outgoing] = await Promise.all([
    query(
      inventoryPool,
      `
      SELECT t.to_warehouse_id::text AS warehouse_id, i.variant_id::text AS variant_id,
             SUM(GREATEST(i.quantity - i.received_qty, 0)) AS qty
      FROM transfer_order_items i
      JOIN transfer_orders t ON t.id = i.transfer_order_id
      WHERE t.status = ANY($2::text[]) AND t.to_warehouse_id = ANY($1::uuid[])
      GROUP BY 1, 2
      `,
      [ids, INCOMING_TRANSFER_STATUSES],
    ),
    query(
      inventoryPool,
      `
      SELECT t.from_warehouse_id::text AS warehouse_id, i.variant_id::text AS variant_id,
             SUM(GREATEST(i.quantity - i.shipped_qty, 0)) AS qty
      FROM transfer_order_items i
      JOIN transfer_orders t ON t.id = i.transfer_order_id
      WHERE t.status = ANY($2::text[]) AND t.from_warehouse_id = ANY($1::uuid[])
      GROUP BY 1, 2
      `,
      [ids, OUTGOING_STATUSES],
    ),
  ]);
  return { incoming: keyed(incoming, 'qty'), outgoing: keyed(outgoing, 'qty') };
}

async function getTransferDurations(ids) {
  const rows = await query(
    inventoryPool,
    `
    SELECT EXTRACT(EPOCH FROM (received_at - requested_at)) / 86400 AS days
    FROM transfer_orders
    WHERE status IN ('RECEIVED', 'COMPLETED') AND received_at IS NOT NULL AND received_at >= requested_at
      AND to_warehouse_id = ANY($1::uuid[])
    `,
    [ids],
  );
  return rows.map((row) => number(row.days));
}

async function getBorrowCounts(ids, from, to) {
  const rows = await query(
    borrowPool,
    `
    SELECT lt.warehouse_id::text AS warehouse_id, li.variant_id::text AS variant_id, COUNT(*) AS qty
    FROM loan_items li
    JOIN loan_transactions lt ON lt.id = li.loan_id
    WHERE lt.borrow_date >= $2::timestamptz AND lt.borrow_date <= $3::timestamptz
      AND lt.warehouse_id = ANY($1::uuid[])
    GROUP BY 1, 2
    `,
    [ids, from, to],
  );
  return keyed(rows, 'qty');
}

async function getReservationCounts(ids, from, to) {
  const rows = await query(
    borrowPool,
    `
    SELECT warehouse_id::text AS warehouse_id, variant_id::text AS variant_id, COUNT(*) AS qty
    FROM loan_reservations
    WHERE reserved_at >= $2::timestamptz AND reserved_at <= $3::timestamptz
      AND status IN ('PENDING', 'CONFIRMED', 'READY_FOR_PICKUP')
      AND warehouse_id = ANY($1::uuid[])
    GROUP BY 1, 2
    `,
    [ids, from, to],
  );
  return keyed(rows, 'qty');
}

// Daily borrow series per (warehouse, variant) - same buckets as
// getDailyBorrowSeriesByVariant, only split by the loan's warehouse.
async function getDailySeries(ids, from, to) {
  const rows = await query(
    borrowPool,
    `
    WITH buckets AS (
      SELECT generate_series(date_trunc('day', $2::timestamptz), date_trunc('day', $3::timestamptz) - '1 day'::interval,
                             '1 day'::interval) AS bucket
    ),
    days AS (
      SELECT lt.warehouse_id::text AS warehouse_id, li.variant_id::text AS variant_id,
             date_trunc('day', lt.borrow_date) AS bucket, COUNT(*) AS count
      FROM loan_items li
      JOIN loan_transactions lt ON lt.id = li.loan_id
      WHERE lt.borrow_date >= date_trunc('day', $2::timestamptz) AND lt.borrow_date < date_trunc('day', $3::timestamptz)
        AND lt.warehouse_id = ANY($1::uuid[])
      GROUP BY 1, 2, 3
    ),
    pairs AS (SELECT DISTINCT warehouse_id, variant_id FROM days)
    SELECT pairs.warehouse_id, pairs.variant_id, buckets.bucket, COALESCE(days.count, 0) AS count
    FROM pairs CROSS JOIN buckets
    LEFT JOIN days ON days.warehouse_id = pairs.warehouse_id AND days.variant_id = pairs.variant_id AND days.bucket = buckets.bucket
    ORDER BY pairs.warehouse_id, pairs.variant_id, buckets.bucket
    `,
    [ids, from, to],
  );
  const series = new Map();
  for (const row of rows) {
    const k = `${row.warehouse_id}:${row.variant_id}`;
    if (!series.has(k)) series.set(k, []);
    series.get(k).push(number(row.count));
  }
  return series;
}

// Open loans per (loan warehouse, variant) for the expected-returns estimate;
// the return-time curve is pooled over every loan, as in the reorder budget mode.
async function getLoanReturns(ids, to) {
  const rows = await query(
    borrowPool,
    `
    SELECT lt.warehouse_id::text AS warehouse_id, li.variant_id::text AS variant_id,
           EXTRACT(EPOCH FROM ($2::timestamptz - lt.borrow_date)) / 86400 AS age_days,
           CASE WHEN li.return_date IS NULL THEN NULL
                ELSE EXTRACT(EPOCH FROM (li.return_date - lt.borrow_date)) / 86400 END AS duration_days
    FROM loan_items li
    JOIN loan_transactions lt ON lt.id = li.loan_id
    WHERE lt.borrow_date <= $2::timestamptz
      AND ((li.return_date IS NULL AND li.status IN ('BORROWED', 'OVERDUE') AND lt.warehouse_id = ANY($1::uuid[]))
           OR li.return_date >= $2::timestamptz - INTERVAL '365 days')
    `,
    [ids, to],
  );
  const open = new Map();
  const openAges = [];
  const durations = [];
  for (const row of rows) {
    if (row.duration_days === null || row.duration_days === undefined) {
      const age = Math.max(0, number(row.age_days));
      openAges.push(age);
      const k = `${row.warehouse_id}:${row.variant_id}`;
      if (!open.has(k)) open.set(k, []);
      open.get(k).push(age);
    } else {
      durations.push(Math.max(0, number(row.duration_days)));
    }
  }
  return { open, survival: loanSurvival(durations, openAges) };
}

function emptyPlan() {
  return {
    diagnosis: [], shortages: [], surpluses: [], options: {},
    recommendation: { best_business_option: null, executable_option: null, ranking: [], rule: null },
  };
}

const getRebalancingPlan = async (req, res, next) => {
  try {
    if (!req.user) throw createHttpError(401, 'Cần đăng nhập');
    const ranges = parseReorderDateRanges(req.query);
    const budgetVnd = parseOptionalBudget(req.query.budgetVnd);
    const limit = parseLimit(req.query.limit, 50, 200);
    const requested = parseIds(req.query.destinationWarehouseIds ?? req.query.destinationWarehouseId);
    // What-if (Phase 4); absent = the plan as computed
    ranges.leadTimeDelayDays = parseNumber(req.query.leadTimeDelayDays, 'leadTimeDelayDays', 0, 180) || 0;
    const whatIf = {
      demandChangePct: parseNumber(req.query.demandChangePct, 'demandChangePct', -90, 300) || 0,
      safetyStockMultiplier: parseNumber(req.query.safetyStockMultiplier, 'safetyStockMultiplier', 0, 5) ?? 1,
      blocked: parseIds(req.query.excludeSourceIds),
      allowed: parseIds(req.query.onlySourceIds),
      closed: parseIds(req.query.closedWarehouseIds),
    };
    const priority = req.query.priority ? String(req.query.priority).toUpperCase() : null;
    if (priority && !['HIGH', 'MEDIUM', 'LOW'].includes(priority)) throw createHttpError(400, 'priority phải là HIGH, MEDIUM hoặc LOW');

    const [scope, warehouses] = await Promise.all([resolveWarehouseScope(req.user), getWarehouses()]);
    const accessible = accessibleWarehouses(warehouses.filter((w) => w.is_active), scope);
    checkRequestedWarehouses([...requested, ...whatIf.blocked, ...whatIf.allowed, ...whatIf.closed], accessible, scope,
      new Set(warehouses.map((w) => w.id)));
    const capabilities = actionCapabilities(req.user);
    const destinationIds = requested.length ? new Set(requested) : null;
    const base = {
      generated_at: new Date().toISOString(),
      scope: { warehouses: accessible, capabilities },
      parameters: {
        destination_warehouse_ids: requested,
        budget_vnd: budgetVnd,
        demand_window_days: ranges.days,
        what_if: {
          demand_change_pct: whatIf.demandChangePct,
          safety_stock_multiplier: whatIf.safetyStockMultiplier,
          lead_time_delay_days: ranges.leadTimeDelayDays,
          exclude_source_ids: whatIf.blocked,
          only_source_ids: whatIf.allowed,
          closed_warehouse_ids: whatIf.closed,
          priority,
        },
        from: ranges.from.toISOString(),
        to: ranges.to.toISOString(),
      },
      assumptions: ASSUMPTIONS,
    };
    if (!accessible.length) {
      return res.json({ data: { ...base, ...emptyPlan(), notice: 'Tài khoản chưa được phân quyền đọc kho nào đang hoạt động.' } });
    }

    const ids = accessible.map((w) => w.warehouse_id);
    const [stock, incomingPo, transfers, durations, borrow, previousBorrow, reservations, series, returns, seasonal, leadTimes] = await Promise.all([
      getStockByWarehouseVariant(ids),
      getIncomingPurchases(ids).then((rows) => keyed(rows, 'qty')),
      getOpenTransfers(ids),
      getTransferDurations(ids),
      getBorrowCounts(ids, ranges.from, ranges.to),
      getBorrowCounts(ids, ranges.previousFrom, ranges.previousTo),
      getReservationCounts(ids, ranges.from, ranges.to),
      getDailySeries(ids, ranges.from, ranges.to),
      getLoanReturns(ids, ranges.to),
      getSeasonalIndexByVariant(ranges),
      getLeadTimeHistory(),
    ]);

    // every (warehouse, variant) with stock, demand or stock on its way
    const stockByKey = new Map(stock.map((row) => [`${row.warehouse_id}:${row.variant_id}`, row]));
    const keys = new Set([...stockByKey.keys(), ...borrow.keys(), ...reservations.keys(), ...incomingPo.keys(), ...transfers.incoming.keys()]);
    const variants = await getVariants([...new Set([...keys].map((k) => k.split(':')[1]))]);
    const seasonalEvent = findSeasonalEvent(ranges.to);

    const lines = [];
    for (const k of keys) {
      const [warehouseId, variantId] = k.split(':');
      const variant = variants.get(variantId);
      if (!variant) continue; // inactive variant/book
      const row = stockByKey.get(k) || {};
      const available = number(row.available_qty);
      const incoming = (incomingPo.get(k) || 0) + (transfers.incoming.get(k) || 0);
      const outgoing = transfers.outgoing.get(k) || 0;
      const borrowed = number(row.borrowed_qty);
      const leadTime = resolveItemLeadTime(variantId, leadTimes, ranges);
      const openAges = returns.open.get(k) || [];
      const expected = expectedReturns(openAges, leadTime.days, returns.survival) ?? 0;
      const plan = calculateSuggestion({
        variant_id: variantId,
        book_id: variant.book_id,
        title: variant.title,
        available_qty: available + incoming - outgoing,
        on_hand_qty: row.on_hand_qty,
        reserved_qty: row.reserved_qty,
        borrowed_qty: borrowed,
        reorder_point: Math.max(number(row.reorder_point), number(row.safety_stock_qty)),
        unit_cost: variant.unit_cost,
      }, {
        borrowCount: borrow.get(k) || 0,
        previousBorrowCount: previousBorrow.get(k) || 0,
        reservationCount: reservations.get(k) || 0,
        wishlistCount: 0,
        availabilityAlertCount: 0,
      }, ranges, { index: seasonal.get(variantId) ?? 1, event: seasonalEvent }, series.get(k) || [], leadTime, {
        // only copies inventory counts as on loan can come back (see reorder budget mode)
        expectedReturns: Math.min(expected, borrowed),
        priorityFloors: false,
      });
      lines.push({
        warehouse_id: warehouseId,
        variant_id: variantId,
        title: variant.title,
        unit_cost: number(variant.unit_cost),
        available_qty: available,
        incoming_qty: incoming,
        outgoing_qty: outgoing,
        expected_returns: plan.expected_returns,
        position: plan.inventory_position,
        lead_time_demand: plan.lead_time_demand,
        safety_stock: plan.safety_stock,
        lambda: Math.max(plan.lead_time_demand, plan.avg_daily_demand * plan.lead_time_days),
        priority: plan.priority,
        borrow_count: plan.borrow_count,
        lead_time_days: plan.lead_time_days,
        lead_time_source: plan.lead_time_source,
        ...(openAges.length > borrowed ? { data_issue: 'BORROW_INVENTORY_MISMATCH' } : {}),
      });
    }

    const transferLeadTimeDays = medianTransferDays(durations);
    const scenarioLines = applyWhatIf(lines, {
      demandChangePct: whatIf.demandChangePct,
      demandWarehouseIds: destinationIds, // "nhu cầu kho đích tăng 20%"; all warehouses when none is named
      safetyStockMultiplier: whatIf.safetyStockMultiplier,
      blockedSourceIds: whatIf.blocked.length ? new Set(whatIf.blocked) : null,
      allowedSourceIds: whatIf.allowed.length ? new Set(whatIf.allowed) : null,
      closedWarehouseIds: whatIf.closed.length ? new Set(whatIf.closed) : null,
    });
    const plan = buildRebalancingPlan(scenarioLines, {
      accessible, capabilities, destinationIds, budgetVnd, transferLeadTimeDays,
      priorities: priority ? new Set([priority]) : null,
    });
    return res.json({
      data: {
        ...base,
        ...plan,
        shortages: plan.shortages.slice(0, limit),
        surpluses: plan.surpluses.slice(0, limit),
        totals: {
          lines: lines.length,
          shortage_lines: plan.shortages.length,
          surplus_lines: plan.surpluses.length,
          unreliable_lines: lines.filter((l) => l.data_issue).length,
        },
        data_quality: {
          transfer_lead_time_days: transferLeadTimeDays,
          transfer_lead_time_samples: durations.length,
          transfer_cost: 'UNAVAILABLE',
          unpriced_variants: lines.filter((l) => !(l.unit_cost > 0)).length,
          forecast_window_days: ranges.days,
          avg_lead_time_days: lines.length ? round(lines.reduce((s, l) => s + l.lead_time_days, 0) / lines.length, 1) : null,
        },
      },
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = { getRebalancingPlan };
