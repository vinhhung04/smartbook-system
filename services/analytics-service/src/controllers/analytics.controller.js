const { inventoryPool, borrowPool, query, queryOne } = require('../lib/db');
const {
  createHttpError,
  formatBucketDate,
  parseDateRange,
  parseGranularity,
  parseLimit,
  round,
} = require('../utils/date-range');
const { findSeasonalEvent } = require('../config/seasonal-events');
const { ewma, linearTrendSlope, stdDev, projectedDemand, rollingBacktest } = require('../utils/forecast');
const { resolveLeadTime, DEFAULT_LEAD_TIME_DAYS } = require('../utils/lead-time');
const { allocateBudget } = require('../utils/budget-allocation');
const { classifyWeedingCandidate } = require('../utils/weeding');
const { LATE_RETURN_FEATURES, NO_SHOW_FEATURES, toLateReturnSample, toNoShowSample } = require('../utils/risk-features');
const { trainAndEvaluate, scoreRows } = require('../utils/risk-model');
const { getOrTrain } = require('../lib/model-cache');

const LOW_STOCK_THRESHOLD = Number(process.env.LOW_STOCK_THRESHOLD || 5);
const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_MS = 365 * DAY_MS;
const SEASONAL_INDEX_MIN = 0.5;
const SEASONAL_INDEX_MAX = 2.0;
const SEASONAL_MIN_SAMPLE_SIZE = 5;
const REORDER_PRIORITIES = new Set(['ALL', 'HIGH', 'MEDIUM', 'LOW']);
const EWMA_ALPHA = 0.35;
// Z-score for a ~95% service level, used to size safety stock from demand volatility.
const SAFETY_STOCK_Z_SCORE = 1.645;

function number(value) {
  return Number(value || 0);
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function statusCount(rows, status) {
  const row = rows.find((item) => item.status === status);
  return number(row?.count);
}

function formatDateOnly(value) {
  return value.toISOString().slice(0, 10);
}

async function getTitlesByVariantIds(variantIds) {
  const uniqueIds = Array.from(new Set(variantIds.filter(Boolean)));
  if (!uniqueIds.length) return new Map();
  const rows = await query(
    inventoryPool,
    `SELECT bv.id::text AS variant_id, b.title FROM book_variants bv JOIN books b ON b.id = bv.book_id WHERE bv.id = ANY($1::uuid[])`,
    [uniqueIds],
  );
  return new Map(rows.map((row) => [row.variant_id, row.title]));
}

function parsePositiveInteger(value, defaultValue, maxValue, fieldName) {
  const parsed = Number(value || defaultValue);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maxValue) {
    throw createHttpError(400, `${fieldName} must be an integer from 1 to ${maxValue}`);
  }
  return parsed;
}

// budgetVnd is optional: absent means "no budget constraint", which must stay
// distinguishable from an explicit ?budgetVnd=0 (fund nothing).
function parseOptionalBudget(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw createHttpError(400, 'budgetVnd must be a non-negative number');
  }
  return parsed;
}

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const normalized = String(value).toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  throw createHttpError(400, 'includeLowDemand must be a boolean');
}

function parseReorderDateRanges(queryParams) {
  const daysParam = queryParams.days ?? 30;
  let days = parsePositiveInteger(daysParam, 30, 365, 'days');
  const leadTimeDays = parsePositiveInteger(queryParams.leadTimeDays, DEFAULT_LEAD_TIME_DAYS, 365, 'leadTimeDays');
  // Whether the caller actually asked for a lead time. Without this flag an explicit
  // ?leadTimeDays=14 is indistinguishable from the default, and per-item learned lead
  // times would silently override what the caller asked for.
  const to = queryParams.to ? new Date(String(queryParams.to)) : new Date();
  const from = queryParams.from ? new Date(String(queryParams.from)) : new Date(to.getTime() - days * DAY_MS);

  if (Number.isNaN(from.getTime())) {
    throw createHttpError(400, 'from must be a valid ISO date');
  }
  if (Number.isNaN(to.getTime())) {
    throw createHttpError(400, 'to must be a valid ISO date');
  }
  if (from > to) {
    throw createHttpError(400, 'from must be before or equal to to');
  }

  if (queryParams.from || queryParams.to) {
    days = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / DAY_MS));
  }

  return {
    from,
    to,
    previousFrom: new Date(from.getTime() - days * DAY_MS),
    previousTo: from,
    days,
    leadTimeDays,
    leadTimeDaysProvided: queryParams.leadTimeDays !== undefined && String(queryParams.leadTimeDays) !== '',
  };
}

function rowsToNumberMap(rows, keyField, valueField) {
  return new Map(rows.map((row) => [row[keyField], number(row[valueField])]));
}

async function getInventoryKpis() {
  const [titleRow, copiesRow, lowStockRow] = await Promise.all([
    queryOne(inventoryPool, 'SELECT COUNT(*) AS total_titles FROM books WHERE is_active = true'),
    queryOne(inventoryPool, 'SELECT COALESCE(SUM(on_hand_qty), 0) AS total_copies FROM stock_balances'),
    queryOne(
      inventoryPool,
      `
      SELECT COUNT(*) AS low_stock_variants
      FROM (
        SELECT
          sb.variant_id,
          SUM(sb.available_qty) AS available_qty,
          MAX(COALESCE(NULLIF(sb.reorder_point, 0), $1)) AS threshold
        FROM stock_balances sb
        JOIN book_variants bv ON bv.id = sb.variant_id
        WHERE bv.is_active = true
        GROUP BY sb.variant_id
        HAVING SUM(sb.available_qty) <= MAX(COALESCE(NULLIF(sb.reorder_point, 0), $1))
      ) low_stock
      `,
      [LOW_STOCK_THRESHOLD],
    ),
  ]);

  return {
    total_titles: number(titleRow.total_titles),
    total_copies: number(copiesRow.total_copies),
    low_stock_variants: number(lowStockRow.low_stock_variants),
  };
}

async function getBorrowKpis() {
  const [loanRow, overdueRow, reservationRows, pickupRow, fineRow, conversionRow] = await Promise.all([
    queryOne(
      borrowPool,
      `
      SELECT COUNT(*) AS active_loans
      FROM loan_transactions
      WHERE status IN ('BORROWED', 'OVERDUE')
      `,
    ),
    queryOne(
      borrowPool,
      `
      SELECT COUNT(DISTINCT lt.id) AS overdue_loans
      FROM loan_transactions lt
      LEFT JOIN loan_items li ON li.loan_id = lt.id
      WHERE lt.status = 'OVERDUE'
         OR (
           li.status IN ('BORROWED', 'OVERDUE')
           AND li.due_date < NOW()
           AND li.return_date IS NULL
         )
      `,
    ),
    query(
      borrowPool,
      `
      SELECT status, COUNT(*) AS count
      FROM loan_reservations
      WHERE status IN ('PENDING', 'CONFIRMED', 'READY_FOR_PICKUP')
      GROUP BY status
      `,
    ),
    queryOne(
      borrowPool,
      `
      SELECT COUNT(*) AS pickup_codes_expiring_soon
      FROM loan_reservations
      WHERE status = 'READY_FOR_PICKUP'
        AND pickup_code IS NOT NULL
        AND pickup_code_used_at IS NULL
        AND pickup_code_expires_at > NOW()
        AND pickup_code_expires_at <= NOW() + INTERVAL '24 hours'
      `,
    ),
    queryOne(
      borrowPool,
      `
      WITH payments AS (
        SELECT fine_id, COALESCE(SUM(amount), 0) AS paid_amount
        FROM fine_payments
        GROUP BY fine_id
      )
      SELECT COALESCE(SUM(GREATEST(f.amount - COALESCE(f.waived_amount, 0) - COALESCE(p.paid_amount, 0), 0)), 0) AS unpaid_fine_amount
      FROM fines f
      LEFT JOIN payments p ON p.fine_id = f.id
      `,
    ),
    queryOne(
      borrowPool,
      `
      SELECT
        COUNT(*) AS total_reservations,
        COUNT(*) FILTER (WHERE status = 'CONVERTED_TO_LOAN') AS converted_reservations
      FROM loan_reservations
      WHERE status IN ('PENDING', 'CONFIRMED', 'READY_FOR_PICKUP', 'CONVERTED_TO_LOAN', 'CANCELLED', 'EXPIRED')
      `,
    ),
  ]);

  const totalReservations = number(conversionRow.total_reservations);
  const convertedReservations = number(conversionRow.converted_reservations);

  return {
    active_loans: number(loanRow.active_loans),
    overdue_loans: number(overdueRow.overdue_loans),
    pending_reservations: statusCount(reservationRows, 'PENDING'),
    confirmed_reservations: statusCount(reservationRows, 'CONFIRMED'),
    ready_for_pickup_reservations: statusCount(reservationRows, 'READY_FOR_PICKUP'),
    pickup_codes_expiring_soon: number(pickupRow.pickup_codes_expiring_soon),
    unpaid_fine_amount: number(fineRow.unpaid_fine_amount),
    reservation_conversion_rate: totalReservations ? round((convertedReservations / totalReservations) * 100, 1) : 0,
  };
}

const getDashboardKpis = asyncHandler(async (_req, res) => {
  const [inventory, borrow] = await Promise.all([getInventoryKpis(), getBorrowKpis()]);
  res.json({ data: { ...inventory, ...borrow } });
});

const getBorrowTrends = asyncHandler(async (req, res) => {
  const { from, to } = parseDateRange(req.query);
  const granularity = parseGranularity(req.query.granularity);
  const interval = granularity === 'month' ? '1 month' : '1 day';

  const rows = await query(
    borrowPool,
    `
    WITH buckets AS (
      SELECT generate_series(
        date_trunc($3, $1::timestamptz),
        date_trunc($3, $2::timestamptz),
        $4::interval
      ) AS bucket
    ),
    loans AS (
      SELECT date_trunc($3, borrow_date) AS bucket, COUNT(*) AS count
      FROM loan_transactions
      WHERE borrow_date >= $1::timestamptz AND borrow_date <= $2::timestamptz
      GROUP BY 1
    ),
    returns AS (
      SELECT date_trunc($3, COALESCE(li.return_date, lt.closed_at)) AS bucket, COUNT(DISTINCT lt.id) AS count
      FROM loan_transactions lt
      JOIN loan_items li ON li.loan_id = lt.id
      WHERE COALESCE(li.return_date, lt.closed_at) >= $1::timestamptz
        AND COALESCE(li.return_date, lt.closed_at) <= $2::timestamptz
        AND COALESCE(li.return_date, lt.closed_at) IS NOT NULL
      GROUP BY 1
    ),
    reservations AS (
      SELECT date_trunc($3, reserved_at) AS bucket, COUNT(*) AS count
      FROM loan_reservations
      WHERE reserved_at >= $1::timestamptz AND reserved_at <= $2::timestamptz
      GROUP BY 1
    )
    SELECT
      buckets.bucket,
      COALESCE(loans.count, 0) AS loans,
      COALESCE(returns.count, 0) AS returns,
      COALESCE(reservations.count, 0) AS reservations
    FROM buckets
    LEFT JOIN loans ON loans.bucket = buckets.bucket
    LEFT JOIN returns ON returns.bucket = buckets.bucket
    LEFT JOIN reservations ON reservations.bucket = buckets.bucket
    ORDER BY buckets.bucket ASC
    `,
    [from, to, granularity, interval],
  );

  res.json({
    data: rows.map((row) => ({
      date: formatBucketDate(row.bucket, granularity),
      loans: number(row.loans),
      returns: number(row.returns),
      reservations: number(row.reservations),
    })),
  });
});

const getTopBooks = asyncHandler(async (req, res) => {
  const { from, to } = parseDateRange(req.query);
  const limit = parseLimit(req.query.limit, 10, 50);

  const borrowRows = await query(
    borrowPool,
    `
    SELECT li.variant_id::text AS variant_id, COUNT(*) AS borrow_count
    FROM loan_items li
    JOIN loan_transactions lt ON lt.id = li.loan_id
    WHERE lt.borrow_date >= $1::timestamptz AND lt.borrow_date <= $2::timestamptz
    GROUP BY li.variant_id
    ORDER BY COUNT(*) DESC
    LIMIT $3
    `,
    [from, to, limit],
  );

  if (!borrowRows.length) {
    return res.json({ data: [] });
  }

  const variantIds = borrowRows.map((row) => row.variant_id);
  const bookRows = await query(
    inventoryPool,
    `
    SELECT
      bv.id::text AS variant_id,
      b.id::text AS book_id,
      b.title
    FROM book_variants bv
    JOIN books b ON b.id = bv.book_id
    WHERE bv.id = ANY($1::uuid[])
    `,
    [variantIds],
  );

  const bookByVariant = new Map(bookRows.map((row) => [row.variant_id, row]));

  return res.json({
    data: borrowRows.map((row) => {
      const book = bookByVariant.get(row.variant_id) || {};
      return {
        variant_id: row.variant_id,
        book_id: book.book_id || null,
        title: book.title || `Variant ${row.variant_id.slice(0, 8)}`,
        borrow_count: number(row.borrow_count),
      };
    }),
  });
});

const getOverdueSummary = asyncHandler(async (_req, res) => {
  const rows = await query(
    borrowPool,
    `
    SELECT
      lt.id::text AS loan_id,
      lt.loan_number,
      lt.customer_id::text AS customer_id,
      c.full_name AS customer_name,
      MIN(li.due_date) AS due_date,
      MAX(GREATEST(DATE_PART('day', NOW() - li.due_date), 0)) AS overdue_days
    FROM loan_items li
    JOIN loan_transactions lt ON lt.id = li.loan_id
    LEFT JOIN customers c ON c.id = lt.customer_id
    WHERE li.status IN ('BORROWED', 'OVERDUE')
      AND li.return_date IS NULL
      AND li.due_date < NOW()
    GROUP BY lt.id, lt.loan_number, lt.customer_id, c.full_name
    ORDER BY overdue_days DESC, due_date ASC
    LIMIT 50
    `,
  );

  const totalItemsRow = await queryOne(
    borrowPool,
    `
    SELECT
      COUNT(*) AS total_overdue_items,
      COUNT(DISTINCT lt.id) AS total_overdue_loans,
      COALESCE(AVG(GREATEST(DATE_PART('day', NOW() - li.due_date), 0)), 0) AS average_overdue_days,
      COALESCE(MAX(GREATEST(DATE_PART('day', NOW() - li.due_date), 0)), 0) AS oldest_overdue_days
    FROM loan_items li
    JOIN loan_transactions lt ON lt.id = li.loan_id
    WHERE li.status IN ('BORROWED', 'OVERDUE')
      AND li.return_date IS NULL
      AND li.due_date < NOW()
    `,
  );

  res.json({
    data: {
      total_overdue_items: number(totalItemsRow.total_overdue_items),
      total_overdue_loans: number(totalItemsRow.total_overdue_loans),
      average_overdue_days: round(totalItemsRow.average_overdue_days, 1),
      oldest_overdue_days: number(totalItemsRow.oldest_overdue_days),
      items: rows.map((row) => ({
        loan_id: row.loan_id,
        loan_number: row.loan_number,
        customer_id: row.customer_id,
        customer_name: row.customer_name || 'Unknown customer',
        due_date: toIso(row.due_date),
        overdue_days: number(row.overdue_days),
      })),
    },
  });
});

const getFineSummary = asyncHandler(async (_req, res) => {
  const [summaryRow, typeRows] = await Promise.all([
    queryOne(
      borrowPool,
      `
      WITH payments AS (
        SELECT fine_id, COALESCE(SUM(amount), 0) AS paid_amount
        FROM fine_payments
        GROUP BY fine_id
      ),
      fine_totals AS (
        SELECT
          f.id,
          f.status,
          f.amount,
          COALESCE(f.waived_amount, 0) AS waived_amount,
          COALESCE(p.paid_amount, 0) AS paid_amount,
          GREATEST(f.amount - COALESCE(f.waived_amount, 0) - COALESCE(p.paid_amount, 0), 0) AS remaining_amount
        FROM fines f
        LEFT JOIN payments p ON p.fine_id = f.id
      )
      SELECT
        COALESCE(SUM(remaining_amount), 0) AS total_unpaid,
        COALESCE(SUM(paid_amount), 0) AS total_paid,
        COALESCE(SUM(waived_amount), 0) AS total_waived,
        COUNT(*) FILTER (WHERE remaining_amount > 0) AS unpaid_count,
        COUNT(*) FILTER (WHERE remaining_amount = 0 OR status = 'PAID') AS paid_count
      FROM fine_totals
      `,
    ),
    query(
      borrowPool,
      `
      SELECT fine_type, COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS count
      FROM fines
      GROUP BY fine_type
      ORDER BY amount DESC
      `,
    ),
  ]);

  res.json({
    data: {
      total_unpaid: number(summaryRow.total_unpaid),
      total_paid: number(summaryRow.total_paid),
      total_waived: number(summaryRow.total_waived),
      unpaid_count: number(summaryRow.unpaid_count),
      paid_count: number(summaryRow.paid_count),
      by_type: typeRows.map((row) => ({
        fine_type: row.fine_type,
        amount: number(row.amount),
        count: number(row.count),
      })),
    },
  });
});

function buildWarehouseRiskReasoning(row) {
  if (row.out_of_stock_variants > 0) {
    return `Có ${row.out_of_stock_variants} đầu sách đã hết hàng (available_qty ≤ 0) và ${row.low_stock_variants} đầu sách dưới ngưỡng tồn kho tối thiểu tại kho này; tồn khả dụng còn ${row.total_available_qty} bản trong khi đang giữ ${row.total_reserved_qty} bản cho đặt trước và ${row.total_borrowed_qty} bản đang cho mượn.`;
  }
  if (row.low_stock_variants > 0) {
    return `Có ${row.low_stock_variants} đầu sách dưới ngưỡng tồn kho tối thiểu (reorder point); chưa có đầu sách nào hết hàng hoàn toàn.`;
  }
  return 'Không có đầu sách nào dưới ngưỡng tồn kho tối thiểu tại kho này.';
}

const getWarehouseStockRisk = asyncHandler(async (_req, res) => {
  const rows = await query(
    inventoryPool,
    `
    SELECT
      w.id::text AS warehouse_id,
      w.name AS warehouse_name,
      COUNT(DISTINCT sb.variant_id) FILTER (
        WHERE sb.available_qty <= COALESCE(NULLIF(sb.reorder_point, 0), $1)
      ) AS low_stock_variants,
      COUNT(DISTINCT sb.variant_id) FILTER (WHERE sb.available_qty <= 0) AS out_of_stock_variants,
      COALESCE(SUM(sb.available_qty), 0) AS total_available_qty,
      COALESCE(SUM(sb.reserved_qty), 0) AS total_reserved_qty,
      COALESCE(SUM(sb.borrowed_qty), 0) AS total_borrowed_qty
    FROM warehouses w
    LEFT JOIN stock_balances sb ON sb.warehouse_id = w.id
    WHERE w.is_active = true
    GROUP BY w.id, w.name
    ORDER BY low_stock_variants DESC, out_of_stock_variants DESC, w.name ASC
    `,
    [LOW_STOCK_THRESHOLD],
  );

  res.json({
    data: rows.map((row) => {
      const normalized = {
        warehouse_id: row.warehouse_id,
        warehouse_name: row.warehouse_name,
        low_stock_variants: number(row.low_stock_variants),
        out_of_stock_variants: number(row.out_of_stock_variants),
        total_available_qty: number(row.total_available_qty),
        total_reserved_qty: number(row.total_reserved_qty),
        total_borrowed_qty: number(row.total_borrowed_qty),
      };
      return { ...normalized, reasoning: buildWarehouseRiskReasoning(normalized) };
    }),
  });
});

async function getBorrowDemandByVariant(from, to) {
  const rows = await query(
    borrowPool,
    `
    SELECT li.variant_id::text AS variant_id, COUNT(*) AS borrow_count
    FROM loan_items li
    JOIN loan_transactions lt ON lt.id = li.loan_id
    WHERE lt.borrow_date >= $1::timestamptz AND lt.borrow_date <= $2::timestamptz
    GROUP BY li.variant_id
    `,
    [from, to],
  );
  return rowsToNumberMap(rows, 'variant_id', 'borrow_count');
}

async function getYearlyBorrowCountByVariant(to) {
  const from = new Date(to.getTime() - YEAR_MS);
  return getBorrowDemandByVariant(from, to);
}

// Daily borrow-count series per variant (oldest -> newest, zero-filled) for the
// window [from, to]. Only variants with at least one borrow in the window are
// included; variants with no activity simply have no entry, and callers treat
// that as an empty series (forecast helpers already return 0 for []).
async function getDailyBorrowSeriesByVariant(from, to) {
  const rows = await query(
    borrowPool,
    `
    WITH buckets AS (
      SELECT generate_series(
        date_trunc('day', $1::timestamptz),
        date_trunc('day', $2::timestamptz),
        '1 day'::interval
      ) AS bucket
    ),
    variant_days AS (
      SELECT li.variant_id::text AS variant_id, date_trunc('day', lt.borrow_date) AS bucket, COUNT(*) AS count
      FROM loan_items li
      JOIN loan_transactions lt ON lt.id = li.loan_id
      WHERE lt.borrow_date >= $1::timestamptz AND lt.borrow_date <= $2::timestamptz
      GROUP BY 1, 2
    ),
    active_variants AS (
      SELECT DISTINCT variant_id FROM variant_days
    )
    SELECT
      active_variants.variant_id,
      buckets.bucket,
      COALESCE(variant_days.count, 0) AS count
    FROM active_variants
    CROSS JOIN buckets
    LEFT JOIN variant_days
      ON variant_days.variant_id = active_variants.variant_id
      AND variant_days.bucket = buckets.bucket
    ORDER BY active_variants.variant_id, buckets.bucket ASC
    `,
    [from, to],
  );

  const series = new Map();
  for (const row of rows) {
    const list = series.get(row.variant_id) || [];
    list.push(number(row.count));
    series.set(row.variant_id, list);
  }
  return series;
}

// Seasonal index per variant = (borrow count in the same calendar window last
// year) / (expected count for a window this size, based on the trailing-year
// average). Clamped to avoid wild swings on thin history, and left at neutral
// (no entry) for variants without enough trailing-year samples.
async function getSeasonalIndexByVariant(ranges) {
  const lastYearFrom = new Date(ranges.from.getTime() - YEAR_MS);
  const lastYearTo = new Date(ranges.to.getTime() - YEAR_MS);

  const [samePeriodLastYearByVariant, yearlyTotalByVariant] = await Promise.all([
    getBorrowDemandByVariant(lastYearFrom, lastYearTo),
    getYearlyBorrowCountByVariant(ranges.to),
  ]);

  const index = new Map();
  for (const [variantId, yearlyTotal] of yearlyTotalByVariant.entries()) {
    if (yearlyTotal < SEASONAL_MIN_SAMPLE_SIZE) continue;
    const expectedForWindow = (yearlyTotal / 365) * ranges.days;
    if (expectedForWindow <= 0) continue;
    const samePeriodLastYear = samePeriodLastYearByVariant.get(variantId) || 0;
    const raw = samePeriodLastYear / expectedForWindow;
    index.set(variantId, Math.min(SEASONAL_INDEX_MAX, Math.max(SEASONAL_INDEX_MIN, raw)));
  }
  return index;
}

async function getReservationDemandByVariant(from, to) {
  const rows = await query(
    borrowPool,
    `
    SELECT variant_id::text AS variant_id, COUNT(*) AS reservation_count
    FROM loan_reservations
    WHERE reserved_at >= $1::timestamptz
      AND reserved_at <= $2::timestamptz
      AND status IN ('PENDING', 'CONFIRMED', 'READY_FOR_PICKUP')
    GROUP BY variant_id
    `,
    [from, to],
  );
  return rowsToNumberMap(rows, 'variant_id', 'reservation_count');
}

async function getWishlistDemandByBook() {
  try {
    const rows = await query(
      borrowPool,
      `
      SELECT book_id::text AS book_id, COUNT(*) AS wishlist_count
      FROM book_wishlists
      GROUP BY book_id
      `,
    );
    return rowsToNumberMap(rows, 'book_id', 'wishlist_count');
  } catch (_error) {
    return new Map();
  }
}

async function getAvailabilityAlertDemandByBook() {
  try {
    const rows = await query(
      borrowPool,
      `
      SELECT book_id::text AS book_id, COUNT(*) AS availability_alert_count
      FROM availability_alerts
      WHERE status = 'ACTIVE'
      GROUP BY book_id
      `,
    );
    return rowsToNumberMap(rows, 'book_id', 'availability_alert_count');
  } catch (_error) {
    return new Map();
  }
}

// Real supplier lead times, measured from each purchase order's order_date to the
// received_at of the goods receipt that fulfilled it. Grouping by goods receipt id
// de-duplicates receipts that list the same variant on more than one line.
async function getLeadTimeHistory() {
  const [deliveryRows, supplierVariantRows] = await Promise.all([
    query(
      inventoryPool,
      `
      SELECT
        gri.variant_id::text AS variant_id,
        po.supplier_id::text AS supplier_id,
        EXTRACT(EPOCH FROM (gr.received_at - po.order_date::timestamptz)) / 86400 AS lead_time_days
      FROM goods_receipts gr
      JOIN purchase_orders po ON po.id = gr.purchase_order_id
      JOIN goods_receipt_items gri ON gri.goods_receipt_id = gr.id
      WHERE gr.received_at IS NOT NULL
        AND gr.cancelled_at IS NULL
        AND gr.received_at >= po.order_date::timestamptz
      GROUP BY gr.id, gri.variant_id, po.supplier_id, gr.received_at, po.order_date
      `,
    ),
    query(
      inventoryPool,
      `
      SELECT
        variant_id::text AS variant_id,
        supplier_id::text AS supplier_id,
        lead_time_days,
        is_preferred
      FROM supplier_variants
      ORDER BY is_preferred DESC
      `,
    ),
  ]);

  const observationsByVariant = new Map();
  const observationsBySupplier = new Map();
  for (const row of deliveryRows) {
    const days = number(row.lead_time_days);
    if (!Number.isFinite(days)) continue;
    if (!observationsByVariant.has(row.variant_id)) observationsByVariant.set(row.variant_id, []);
    observationsByVariant.get(row.variant_id).push(days);
    if (row.supplier_id) {
      if (!observationsBySupplier.has(row.supplier_id)) observationsBySupplier.set(row.supplier_id, []);
      observationsBySupplier.get(row.supplier_id).push(days);
    }
  }

  // Rows arrive preferred-first, so the first supplier seen for a variant is the
  // preferred one when there is one.
  const supplierByVariant = new Map();
  const declaredByVariant = new Map();
  for (const row of supplierVariantRows) {
    if (supplierByVariant.has(row.variant_id)) continue;
    supplierByVariant.set(row.variant_id, row.supplier_id);
    if (row.lead_time_days !== null && row.lead_time_days !== undefined) {
      declaredByVariant.set(row.variant_id, number(row.lead_time_days));
    }
  }

  return { observationsByVariant, observationsBySupplier, supplierByVariant, declaredByVariant };
}

async function getInventorySnapshot() {
  return query(
    inventoryPool,
    `
    SELECT
      bv.id::text AS variant_id,
      b.id::text AS book_id,
      b.title,
      COALESCE(author_row.full_name, '') AS author,
      COALESCE(category_row.name, '') AS category,
      COALESCE(bv.isbn13, bv.isbn10, bv.internal_barcode, bv.sku, '') AS isbn,
      COALESCE(SUM(sb.available_qty), 0) AS available_qty,
      COALESCE(SUM(sb.on_hand_qty), 0) AS on_hand_qty,
      COALESCE(SUM(sb.reserved_qty), 0) AS reserved_qty,
      COALESCE(SUM(sb.borrowed_qty), 0) AS borrowed_qty,
      COALESCE(MAX(sb.reorder_point), 0) AS reorder_point,
      bv.unit_cost
    FROM book_variants bv
    JOIN books b ON b.id = bv.book_id
    LEFT JOIN LATERAL (
      SELECT a.full_name
      FROM book_authors ba
      JOIN authors a ON a.id = ba.author_id
      WHERE ba.book_id = b.id
      ORDER BY ba.author_order ASC
      LIMIT 1
    ) author_row ON true
    LEFT JOIN LATERAL (
      SELECT c.name
      FROM book_categories bc
      JOIN categories c ON c.id = bc.category_id
      WHERE bc.book_id = b.id
      ORDER BY c.name ASC
      LIMIT 1
    ) category_row ON true
    LEFT JOIN stock_balances sb ON sb.variant_id = bv.id
    WHERE bv.is_active = true AND b.is_active = true
    GROUP BY
      bv.id,
      b.id,
      b.title,
      author_row.full_name,
      category_row.name,
      bv.isbn13,
      bv.isbn10,
      bv.internal_barcode,
      bv.sku,
      bv.unit_cost
    `,
  );
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

function calculateSuggestion(row, demand, ranges, seasonal = {}, series = [], leadTime = null) {
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
  const demandPace = ewma(series, EWMA_ALPHA);
  const dailyTrend = linearTrendSlope(series);
  const demandVolatility = stdDev(series);
  const forecast7d = projectedDemand(series, 7, seasonalIndex);
  const forecast30d = projectedDemand(series, 30, seasonalIndex);
  const demandTrendPct = previousBorrowCount > 0
    ? round(((borrowCount - previousBorrowCount) / previousBorrowCount) * 100, 1)
    : (borrowCount > 0 ? 100 : 0);
  const estimatedDaysUntilStockout = demandPace > 0 ? round(availableQty / demandPace, 1) : null;
  const hasDemandSignal = borrowCount > 0 || reservationCount > 0;
  const safetyStock = Math.max(
    reorderPoint,
    Math.ceil(SAFETY_STOCK_Z_SCORE * demandVolatility * Math.sqrt(leadTimeDays)),
    hasDemandSignal ? 2 : 0,
  );
  const expectedDemandDuringLeadTime = projectedDemand(series, leadTimeDays, seasonalIndex);
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

  if (priority === 'HIGH' && suggestedReorderQty < 5) {
    suggestedReorderQty = 5;
  }
  if (priority === 'MEDIUM' && suggestedReorderQty < 3) {
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

// An explicit ?leadTimeDays= is an instruction, not a hint: it overrides the
// learned value, and says so in lead_time_source so the answer stays honest
// about where the number came from.
function resolveItemLeadTime(variantId, history, ranges) {
  if (ranges.leadTimeDaysProvided) {
    return { days: ranges.leadTimeDays, source: 'REQUESTED', samples: 0 };
  }
  const supplierId = history.supplierByVariant.get(variantId) || null;
  return resolveLeadTime({
    variantObservations: history.observationsByVariant.get(variantId) || [],
    supplierObservations: supplierId ? history.observationsBySupplier.get(supplierId) || [] : [],
    declaredLeadTimeDays: history.declaredByVariant.get(variantId) ?? null,
    defaultLeadTimeDays: ranges.leadTimeDays,
  });
}

const getReorderSuggestions = asyncHandler(async (req, res) => {
  const ranges = parseReorderDateRanges(req.query);
  const limit = parseLimit(req.query.limit, 20, 100);
  const priority = String(req.query.priority || 'ALL').toUpperCase();
  const includeLowDemand = parseBoolean(req.query.includeLowDemand, false);
  const budgetVnd = parseOptionalBudget(req.query.budgetVnd);

  if (!REORDER_PRIORITIES.has(priority)) {
    throw createHttpError(400, 'priority must be one of ALL, HIGH, MEDIUM, LOW');
  }

  const [
    inventoryRows,
    borrowByVariant,
    previousBorrowByVariant,
    reservationByVariant,
    wishlistByBook,
    alertsByBook,
    seasonalIndexByVariant,
    dailySeriesByVariant,
    leadTimeHistory,
  ] = await Promise.all([
    getInventorySnapshot(),
    getBorrowDemandByVariant(ranges.from, ranges.to),
    getBorrowDemandByVariant(ranges.previousFrom, ranges.previousTo),
    getReservationDemandByVariant(ranges.from, ranges.to),
    getWishlistDemandByBook(),
    getAvailabilityAlertDemandByBook(),
    getSeasonalIndexByVariant(ranges),
    getDailyBorrowSeriesByVariant(ranges.from, ranges.to),
    getLeadTimeHistory(),
  ]);

  const seasonalEvent = findSeasonalEvent(ranges.to);

  const candidates = inventoryRows
    .map((row) => calculateSuggestion(row, {
      borrowCount: borrowByVariant.get(row.variant_id) || 0,
      previousBorrowCount: previousBorrowByVariant.get(row.variant_id) || 0,
      reservationCount: reservationByVariant.get(row.variant_id) || 0,
      wishlistCount: wishlistByBook.get(row.book_id) || 0,
      availabilityAlertCount: alertsByBook.get(row.book_id) || 0,
    }, ranges, {
      index: seasonalIndexByVariant.get(row.variant_id) ?? 1,
      event: seasonalEvent,
    }, dailySeriesByVariant.get(row.variant_id) || [], resolveItemLeadTime(row.variant_id, leadTimeHistory, ranges)))
    .filter((item) => {
      if (priority !== 'ALL' && item.priority !== priority) return false;
      if (includeLowDemand) return true;
      return item.borrow_count > 0
        || item.reservation_count > 0
        || item.wishlist_count > 0
        || item.availability_alert_count > 0
        || item.suggested_reorder_qty > 0;
    })
    .sort((a, b) => {
      const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      return rank[a.priority] - rank[b.priority]
        || b.demand_score - a.demand_score
        || b.suggested_reorder_qty - a.suggested_reorder_qty
        || a.title.localeCompare(b.title);
    });

  const summary = candidates.reduce((acc, item) => {
    acc.total_candidates += 1;
    acc.estimated_total_reorder_qty += item.suggested_reorder_qty;
    acc.estimated_total_cost = round(acc.estimated_total_cost + item.estimated_cost, 2);
    if (item.priority === 'HIGH') acc.high_priority += 1;
    if (item.priority === 'MEDIUM') acc.medium_priority += 1;
    if (item.priority === 'LOW') acc.low_priority += 1;
    return acc;
  }, {
    total_candidates: 0,
    high_priority: 0,
    medium_priority: 0,
    low_priority: 0,
    estimated_total_reorder_qty: 0,
    estimated_total_cost: 0,
  });

  // Budget is applied over the full sorted candidate set (not just the page
  // being returned) so within_budget reflects the real priority order, then
  // the same page slice is taken as usual.
  let resultItems = candidates;
  let budget = null;
  if (budgetVnd !== null) {
    const allocation = allocateBudget(candidates, budgetVnd);
    resultItems = allocation.items;
    budget = {
      budget_vnd: budgetVnd,
      funded_cost: allocation.funded_cost,
      remaining_vnd: allocation.remaining_vnd,
    };
  }

  res.json({
    data: {
      generated_at: new Date().toISOString(),
      range: {
        from: formatDateOnly(ranges.from),
        to: formatDateOnly(ranges.to),
        days: ranges.days,
        leadTimeDays: ranges.leadTimeDays,
      },
      summary,
      budget,
      items: resultItems.slice(0, limit),
    },
  });
});

// Makes rollingBacktest (forecast.js) a real reported number instead of dead
// code exercised only by test/forecast-backtest.test.js. Reuses
// getDailyBorrowSeriesByVariant verbatim - no new SQL.
const getForecastAccuracy = asyncHandler(async (req, res) => {
  const days = parsePositiveInteger(req.query.days, 180, 730, 'days');
  const horizonDays = parsePositiveInteger(req.query.horizonDays, 7, 30, 'horizonDays');
  const minTrainDays = parsePositiveInteger(req.query.minTrainDays, 30, 365, 'minTrainDays');
  const limit = parseLimit(req.query.limit, 20, 50);
  const variantId = req.query.variantId ? String(req.query.variantId) : null;

  const to = new Date();
  const from = new Date(to.getTime() - days * DAY_MS);
  const seriesByVariant = await getDailyBorrowSeriesByVariant(from, to);

  let variantIds = Array.from(seriesByVariant.keys());
  if (variantId) variantIds = variantIds.filter((id) => id === variantId);

  const backtests = variantIds
    .map((id) => ({ variant_id: id, backtest: rollingBacktest(seriesByVariant.get(id), { horizonDays, minTrainDays }) }))
    .filter((item) => item.backtest.status === 'OK');

  const windowSummary = { from: formatDateOnly(from), to: formatDateOnly(to), days, horizonDays, minTrainDays };

  if (!backtests.length) {
    return res.json({
      data: {
        generated_at: new Date().toISOString(),
        window: windowSummary,
        overall: { status: 'INSUFFICIENT_DATA', models: [], best_model: null },
        items: [],
      },
    });
  }

  const bookRows = await query(
    inventoryPool,
    `SELECT bv.id::text AS variant_id, b.title FROM book_variants bv JOIN books b ON b.id = bv.book_id WHERE bv.id = ANY($1::uuid[])`,
    [backtests.map((item) => item.variant_id)],
  );
  const titleByVariant = new Map(bookRows.map((row) => [row.variant_id, row.title]));

  // Sample-weighted average per model across every variant that had enough
  // history for a backtest - one table for "which forecast model performs
  // best across the whole catalog", not just for a single title.
  const modelNames = backtests[0].backtest.models.map((m) => m.model);
  const overallByModel = new Map(modelNames.map((name) => [name, {
    model: name, totalSamples: 0, weightedMae: 0, weightedRmse: 0, weightedWape: 0, weightedMape: 0, mapeSamples: 0,
  }]));
  const bestModelVotes = {};

  for (const item of backtests) {
    for (const modelResult of item.backtest.models) {
      const acc = overallByModel.get(modelResult.model);
      acc.totalSamples += modelResult.samples;
      acc.weightedMae += modelResult.mae * modelResult.samples;
      acc.weightedRmse += modelResult.rmse * modelResult.samples;
      if (modelResult.wape !== null) acc.weightedWape += modelResult.wape * modelResult.samples;
      if (modelResult.mape !== null) {
        acc.weightedMape += modelResult.mape * modelResult.mapeSamples;
        acc.mapeSamples += modelResult.mapeSamples;
      }
    }
    bestModelVotes[item.backtest.bestModel] = (bestModelVotes[item.backtest.bestModel] || 0) + 1;
  }

  const overallModels = Array.from(overallByModel.values())
    .map((acc) => ({
      model: acc.model,
      mae: acc.totalSamples ? round(acc.weightedMae / acc.totalSamples, 3) : null,
      rmse: acc.totalSamples ? round(acc.weightedRmse / acc.totalSamples, 3) : null,
      wape: acc.totalSamples ? round(acc.weightedWape / acc.totalSamples, 3) : null,
      mape: acc.mapeSamples ? round(acc.weightedMape / acc.mapeSamples, 3) : null,
      samples: acc.totalSamples,
    }))
    .sort((a, b) => a.mae - b.mae);

  res.json({
    data: {
      generated_at: new Date().toISOString(),
      window: windowSummary,
      overall: { status: 'OK', models: overallModels, best_model: overallModels[0]?.model || null, best_model_votes: bestModelVotes },
      items: backtests.slice(0, limit).map((item) => ({
        variant_id: item.variant_id,
        title: titleByVariant.get(item.variant_id) || null,
        status: item.backtest.status,
        models: item.backtest.models,
        best_model: item.backtest.bestModel,
      })),
    },
  });
});

// Shared SELECT/FROM/JOIN for both the late-return training query and the
// scoring query below - only the WHERE clause (and therefore which rows come
// back) differs, so the feature columns risk-features.js expects are defined
// in exactly one place.
const LATE_RETURN_ROW_SQL = `
  SELECT
    li.id::text AS loan_item_id,
    li.variant_id::text AS variant_id,
    c.full_name AS customer_name,
    lt.borrow_date,
    COALESCE(orig.old_due_date, li.due_date) AS original_due_date,
    li.due_date,
    li.return_date,
    lt.total_items AS items_in_loan,
    COALESCE(prior.prior_loans, 0) AS prior_loans,
    COALESCE(prior.prior_late_count, 0) AS prior_late_count,
    COALESCE(prior.prior_renewal_count, 0) AS prior_renewal_count,
    c.created_at AS customer_created_at,
    COALESCE(unpaid.amount, 0) AS unpaid_fines_at_checkout,
    mp.max_loan_days AS plan_max_loan_days,
    mp.fine_per_day AS plan_fine_per_day,
    (lt.source_reservation_id IS NOT NULL) AS from_reservation,
    (li.item_condition_on_checkout <> 'GOOD') AS condition_worn_at_checkout
  FROM loan_items li
  JOIN loan_transactions lt ON lt.id = li.loan_id
  JOIN customers c ON c.id = lt.customer_id
  LEFT JOIN LATERAL (
    SELECT cm.plan_id FROM customer_memberships cm
    WHERE cm.customer_id = c.id AND cm.start_date <= lt.borrow_date
    ORDER BY cm.start_date DESC LIMIT 1
  ) cm_at ON true
  LEFT JOIN membership_plans mp ON mp.id = cm_at.plan_id
  -- Original due date (pre-renewal) - see risk-features.js leakage rules.
  LEFT JOIN LATERAL (
    SELECT MIN(lr.old_due_date) AS old_due_date FROM loan_renewals lr WHERE lr.loan_item_id = li.id
  ) orig ON true
  -- Everything below is scoped to lt2.borrow_date < lt.borrow_date - only
  -- what the customer's history looked like strictly before THIS loan.
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) AS prior_loans,
      COUNT(*) FILTER (WHERE li2.return_date > li2.due_date) AS prior_late_count,
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM loan_renewals lr2 WHERE lr2.loan_item_id = li2.id)) AS prior_renewal_count
    FROM loan_items li2
    JOIN loan_transactions lt2 ON lt2.id = li2.loan_id
    WHERE lt2.customer_id = c.id AND lt2.borrow_date < lt.borrow_date AND li2.return_date IS NOT NULL
  ) prior ON true
  LEFT JOIN LATERAL (
    SELECT SUM(f.amount - f.waived_amount) AS amount FROM fines f
    WHERE f.customer_id = c.id AND f.status = 'UNPAID' AND f.issued_at < lt.borrow_date
  ) unpaid ON true
`;

async function getLateReturnTrainingRows() {
  return query(borrowPool, `${LATE_RETURN_ROW_SQL} WHERE li.return_date IS NOT NULL`, []);
}

async function getLateReturnScoringRows(dueWithinDays, limit) {
  const params = [limit];
  let where = `WHERE li.return_date IS NULL AND li.status IN ('BORROWED', 'OVERDUE')`;
  if (dueWithinDays !== null) {
    where += ` AND li.due_date <= now() + ($2 || ' days')::interval`;
    params.push(dueWithinDays);
  }
  return query(borrowPool, `${LATE_RETURN_ROW_SQL} ${where} ORDER BY li.due_date ASC LIMIT $1`, params);
}

async function trainLateReturnModel() {
  const rows = await getLateReturnTrainingRows();
  const samples = rows.map(toLateReturnSample).filter((sample) => sample.label !== null);
  return trainAndEvaluate(samples, { featureNames: LATE_RETURN_FEATURES });
}

function riskBand(score, evaluation) {
  const threshold = evaluation?.best_threshold?.threshold ?? 0.5;
  if (score >= threshold) return 'HIGH';
  if (score >= threshold / 2) return 'MEDIUM';
  return 'LOW';
}

const getLateReturnRisk = asyncHandler(async (req, res) => {
  const limit = parseLimit(req.query.limit, 50, 200);
  const dueWithinDays = req.query.dueWithinDays !== undefined
    ? parsePositiveInteger(req.query.dueWithinDays, 3, 90, 'dueWithinDays')
    : null;

  const trained = await getOrTrain('late_return', trainLateReturnModel);
  if (trained.status !== 'OK') {
    return res.json({ data: { generated_at: new Date().toISOString(), status: trained.status, reason: trained.reason, items: [] } });
  }

  const scoringRows = await getLateReturnScoringRows(dueWithinDays, limit);
  const scoredRows = scoreRows(trained.model, scoringRows, toLateReturnSample);
  const titleByVariant = await getTitlesByVariantIds(scoredRows.map((item) => item.variant_id));
  const scored = scoredRows
    .map((item) => ({
      loan_item_id: item.loan_item_id,
      customer_name: item.customer_name,
      title: titleByVariant.get(item.variant_id) || null,
      borrow_date: item.borrow_date,
      due_date: item.due_date,
      risk_score: item.risk_score,
      risk_band: riskBand(item.risk_score, trained.evaluation),
      top_factors: item.top_factors,
    }))
    .sort((a, b) => b.risk_score - a.risk_score);

  res.json({
    data: {
      generated_at: new Date().toISOString(),
      model: { feature_names: trained.model.feature_names, weights: trained.model.weights, bias: trained.model.bias, trained_at: new Date().toISOString(), train_size: trained.trainSize },
      evaluation: trained.evaluation,
      items: scored,
    },
  });
});

// Same shape as the late-return query above: shared row SQL, WHERE clause
// picks training vs. scoring rows. active_loans_at_reservation reads the
// loan's CURRENT status (not a point-in-time reconstruction) - an accepted
// approximation, since loan_transactions has no history table.
const NO_SHOW_ROW_SQL = `
  SELECT
    r.id::text AS reservation_id,
    r.variant_id::text AS variant_id,
    c.full_name AS customer_name,
    r.status,
    r.reserved_at,
    r.expires_at,
    r.pickup_code_issued_at,
    r.pickup_code_used_at,
    r.quantity,
    r.source_channel,
    c.created_at AS customer_created_at,
    COALESCE(prior.prior_reservations, 0) AS prior_reservations,
    COALESCE(prior.prior_no_show_count, 0) AS prior_no_show_count,
    COALESCE(unpaid.amount, 0) AS unpaid_fines_at_reservation,
    COALESCE(active.active_loans, 0) AS active_loans_at_reservation
  FROM loan_reservations r
  JOIN customers c ON c.id = r.customer_id
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) AS prior_reservations,
      COUNT(*) FILTER (WHERE r2.pickup_code_used_at IS NULL AND r2.status = 'EXPIRED') AS prior_no_show_count
    FROM loan_reservations r2
    WHERE r2.customer_id = r.customer_id AND r2.reserved_at < r.reserved_at
      AND r2.pickup_code_issued_at IS NOT NULL AND r2.status <> 'CANCELLED'
      AND (r2.pickup_code_used_at IS NOT NULL OR r2.status = 'EXPIRED')
  ) prior ON true
  LEFT JOIN LATERAL (
    SELECT SUM(f.amount - f.waived_amount) AS amount FROM fines f
    WHERE f.customer_id = r.customer_id AND f.status = 'UNPAID' AND f.issued_at < r.reserved_at
  ) unpaid ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS active_loans FROM loan_transactions lt
    WHERE lt.customer_id = r.customer_id AND lt.borrow_date < r.reserved_at AND lt.status IN ('BORROWED', 'OVERDUE')
  ) active ON true
`;

async function getNoShowTrainingRows() {
  return query(
    borrowPool,
    `${NO_SHOW_ROW_SQL} WHERE r.pickup_code_issued_at IS NOT NULL AND r.status <> 'CANCELLED'
       AND (r.pickup_code_used_at IS NOT NULL OR r.status = 'EXPIRED')`,
    [],
  );
}

async function getNoShowScoringRows(limit) {
  return query(
    borrowPool,
    `${NO_SHOW_ROW_SQL} WHERE r.status = 'READY_FOR_PICKUP' AND r.pickup_code_used_at IS NULL
       ORDER BY r.pickup_code_expires_at ASC LIMIT $1`,
    [limit],
  );
}

async function trainNoShowModel() {
  const rows = await getNoShowTrainingRows();
  const samples = rows.map(toNoShowSample).filter(Boolean);
  return trainAndEvaluate(samples, { featureNames: NO_SHOW_FEATURES });
}

const getReservationNoShowRisk = asyncHandler(async (req, res) => {
  const limit = parseLimit(req.query.limit, 50, 200);

  const trained = await getOrTrain('no_show', trainNoShowModel);
  if (trained.status !== 'OK') {
    return res.json({ data: { generated_at: new Date().toISOString(), status: trained.status, reason: trained.reason, items: [] } });
  }

  const scoringRows = await getNoShowScoringRows(limit);
  const scoredRows = scoreRows(trained.model, scoringRows, toNoShowSample);
  const titleByVariant = await getTitlesByVariantIds(scoredRows.map((item) => item.variant_id));
  const scored = scoredRows
    .map((item) => ({
      reservation_id: item.reservation_id,
      customer_name: item.customer_name,
      title: titleByVariant.get(item.variant_id) || null,
      reserved_at: item.reserved_at,
      expires_at: item.expires_at,
      risk_score: item.risk_score,
      risk_band: riskBand(item.risk_score, trained.evaluation),
      top_factors: item.top_factors,
    }))
    .sort((a, b) => b.risk_score - a.risk_score);

  res.json({
    data: {
      generated_at: new Date().toISOString(),
      model: { feature_names: trained.model.feature_names, weights: trained.model.weights, bias: trained.model.bias, trained_at: new Date().toISOString(), train_size: trained.trainSize },
      evaluation: trained.evaluation,
      items: scored,
    },
  });
});

const getBookTurnover = asyncHandler(async (req, res) => {
  const days = parsePositiveInteger(req.query.days, 90, 365, 'days');
  const to = new Date();
  const from = new Date(to.getTime() - days * DAY_MS);

  const borrowByVariant = await getBorrowDemandByVariant(from, to);

  res.json({
    data: {
      generated_at: new Date().toISOString(),
      days,
      items: Array.from(borrowByVariant.entries()).map(([variant_id, borrow_count]) => ({ variant_id, borrow_count })),
    },
  });
});

const getAgingInventory = asyncHandler(async (req, res) => {
  const days = parsePositiveInteger(req.query.days, 90, 365, 'days');
  const limit = parseLimit(req.query.limit, 50, 200);
  const cutoff = new Date(Date.now() - days * DAY_MS);

  const [stockRows, lastBorrowRows, lastMovementRows] = await Promise.all([
    query(
      inventoryPool,
      `
      SELECT
        sb.variant_id::text AS variant_id,
        sb.warehouse_id::text AS warehouse_id,
        b.id::text AS book_id,
        b.title,
        w.name AS warehouse_name,
        SUM(sb.on_hand_qty) AS on_hand_qty
      FROM stock_balances sb
      JOIN book_variants bv ON bv.id = sb.variant_id
      JOIN books b ON b.id = bv.book_id
      JOIN warehouses w ON w.id = sb.warehouse_id
      WHERE bv.is_active = true AND b.is_active = true
      GROUP BY sb.variant_id, sb.warehouse_id, b.id, b.title, w.name
      HAVING SUM(sb.on_hand_qty) > 0
      `,
    ),
    query(
      borrowPool,
      `
      SELECT li.variant_id::text AS variant_id, lt.warehouse_id::text AS warehouse_id, MAX(lt.borrow_date) AS last_borrowed_at
      FROM loan_items li
      JOIN loan_transactions lt ON lt.id = li.loan_id
      GROUP BY li.variant_id, lt.warehouse_id
      `,
    ),
    query(
      inventoryPool,
      `
      SELECT variant_id::text AS variant_id, warehouse_id::text AS warehouse_id, MAX(created_at) AS last_movement_at
      FROM stock_movements
      GROUP BY variant_id, warehouse_id
      `,
    ),
  ]);

  // Keyed by variant+warehouse, not variant alone - a borrow fulfilled from
  // warehouse A must not mask warehouse B's copy of the same title as
  // "recently active" when it has sat untouched.
  const lastBorrowByVariantWarehouse = new Map(
    lastBorrowRows.map((row) => [`${row.variant_id}:${row.warehouse_id}`, row.last_borrowed_at]),
  );
  const lastMovementByVariantWarehouse = new Map(
    lastMovementRows.map((row) => [`${row.variant_id}:${row.warehouse_id}`, row.last_movement_at]),
  );

  const items = stockRows
    .map((row) => {
      const lastBorrowedAt = lastBorrowByVariantWarehouse.get(`${row.variant_id}:${row.warehouse_id}`) || null;
      const lastMovementAt = lastMovementByVariantWarehouse.get(`${row.variant_id}:${row.warehouse_id}`) || null;
      const lastActivityAt = [lastBorrowedAt, lastMovementAt]
        .filter(Boolean)
        .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null;
      const daysSinceLastActivity = lastActivityAt
        ? Math.floor((Date.now() - new Date(lastActivityAt).getTime()) / DAY_MS)
        : null;

      return {
        variant_id: row.variant_id,
        book_id: row.book_id,
        title: row.title,
        warehouse_id: row.warehouse_id,
        warehouse_name: row.warehouse_name,
        on_hand_qty: number(row.on_hand_qty),
        last_activity_at: toIso(lastActivityAt),
        days_since_last_activity: daysSinceLastActivity,
      };
    })
    .filter((item) => item.days_since_last_activity === null || item.days_since_last_activity >= days)
    .sort((a, b) => (b.days_since_last_activity ?? Infinity) - (a.days_since_last_activity ?? Infinity));

  res.json({
    data: {
      generated_at: new Date().toISOString(),
      threshold_days: days,
      cutoff: cutoff.toISOString(),
      items: items.slice(0, limit),
    },
  });
});

// Weeding (liquidation) candidates: same "no activity" signal as aging
// inventory, plus unit_cost to size the value tied up and a per-book demand
// check so a copy that is merely misallocated (another warehouse/variant of
// the same title is still moving) is flagged for REDISTRIBUTE rather than
// LIQUIDATE. Deliberately a separate query from getAgingInventory - the two
// endpoints answer different questions and evolve independently.
const getWeedingSuggestions = asyncHandler(async (req, res) => {
  const days = parsePositiveInteger(req.query.days, 180, 365, 'days');
  const limit = parseLimit(req.query.limit, 50, 200);
  const cutoff = new Date(Date.now() - days * DAY_MS);
  const now = new Date();

  const [stockRows, lastBorrowRows, lastMovementRows, inventorySnapshot, borrowByVariantInWindow] = await Promise.all([
    query(
      inventoryPool,
      `
      SELECT
        sb.variant_id::text AS variant_id,
        sb.warehouse_id::text AS warehouse_id,
        b.id::text AS book_id,
        b.title,
        w.name AS warehouse_name,
        SUM(sb.on_hand_qty) AS on_hand_qty,
        bv.unit_cost
      FROM stock_balances sb
      JOIN book_variants bv ON bv.id = sb.variant_id
      JOIN books b ON b.id = bv.book_id
      JOIN warehouses w ON w.id = sb.warehouse_id
      WHERE bv.is_active = true AND b.is_active = true
      GROUP BY sb.variant_id, sb.warehouse_id, b.id, b.title, w.name, bv.unit_cost
      HAVING SUM(sb.on_hand_qty) > 0
      `,
    ),
    query(
      borrowPool,
      `
      SELECT li.variant_id::text AS variant_id, lt.warehouse_id::text AS warehouse_id, MAX(lt.borrow_date) AS last_borrowed_at
      FROM loan_items li
      JOIN loan_transactions lt ON lt.id = li.loan_id
      GROUP BY li.variant_id, lt.warehouse_id
      `,
    ),
    query(
      inventoryPool,
      `
      SELECT variant_id::text AS variant_id, warehouse_id::text AS warehouse_id, MAX(created_at) AS last_movement_at
      FROM stock_movements
      GROUP BY variant_id, warehouse_id
      `,
    ),
    getInventorySnapshot(),
    getBorrowDemandByVariant(cutoff, now),
  ]);

  // A book_id's total borrow count across all its variants/warehouses in the
  // window. Because last-borrowed-at below is scoped per warehouse, a
  // candidate row's own (variant, warehouse) is guaranteed 0 here - so any
  // count above 0 means the same title is moving at a different variant or
  // warehouse, which is exactly the REDISTRIBUTE signal.
  const bookIdByVariant = new Map(inventorySnapshot.map((row) => [row.variant_id, row.book_id]));
  const borrowCountByBook = new Map();
  for (const [variantId, count] of borrowByVariantInWindow.entries()) {
    const bookId = bookIdByVariant.get(variantId);
    if (!bookId) continue;
    borrowCountByBook.set(bookId, (borrowCountByBook.get(bookId) || 0) + count);
  }

  // Keyed by variant+warehouse, not variant alone - a borrow fulfilled from
  // warehouse A must not mask warehouse B's copy of the same title as
  // "recently active" when it has sat untouched (see getAgingInventory).
  const lastBorrowByVariantWarehouse = new Map(
    lastBorrowRows.map((row) => [`${row.variant_id}:${row.warehouse_id}`, row.last_borrowed_at]),
  );
  const lastMovementByVariantWarehouse = new Map(
    lastMovementRows.map((row) => [`${row.variant_id}:${row.warehouse_id}`, row.last_movement_at]),
  );

  const items = stockRows
    .map((row) => {
      const lastBorrowedAt = lastBorrowByVariantWarehouse.get(`${row.variant_id}:${row.warehouse_id}`) || null;
      const lastMovementAt = lastMovementByVariantWarehouse.get(`${row.variant_id}:${row.warehouse_id}`) || null;
      const lastActivityAt = [lastBorrowedAt, lastMovementAt]
        .filter(Boolean)
        .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null;
      const daysSinceLastActivity = lastActivityAt
        ? Math.floor((Date.now() - new Date(lastActivityAt).getTime()) / DAY_MS)
        : null;

      const classification = classifyWeedingCandidate({
        daysSinceLastActivity,
        thresholdDays: days,
        onHandQty: number(row.on_hand_qty),
        unitCost: number(row.unit_cost),
        hasDemandElsewhere: (borrowCountByBook.get(row.book_id) || 0) > 0,
      });
      if (!classification) return null;

      return {
        variant_id: row.variant_id,
        book_id: row.book_id,
        title: row.title,
        warehouse_id: row.warehouse_id,
        warehouse_name: row.warehouse_name,
        on_hand_qty: number(row.on_hand_qty),
        unit_cost: number(row.unit_cost),
        last_activity_at: toIso(lastActivityAt),
        days_since_last_activity: daysSinceLastActivity,
        ...classification,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.tied_up_value - a.tied_up_value);

  const summary = items.reduce((acc, item) => {
    acc.total_items += 1;
    acc.total_tied_up_value = round(acc.total_tied_up_value + item.tied_up_value, 2);
    if (item.severity === 'CRITICAL') acc.critical_count += 1;
    if (item.severity === 'HIGH') acc.high_count += 1;
    if (item.suggested_action === 'REDISTRIBUTE') acc.redistribute_count += 1;
    if (item.suggested_action === 'LIQUIDATE') acc.liquidate_count += 1;
    return acc;
  }, {
    total_items: 0,
    total_tied_up_value: 0,
    critical_count: 0,
    high_count: 0,
    redistribute_count: 0,
    liquidate_count: 0,
  });

  res.json({
    data: {
      generated_at: new Date().toISOString(),
      threshold_days: days,
      cutoff: cutoff.toISOString(),
      summary,
      items: items.slice(0, limit),
    },
  });
});

const getReservationFunnel = asyncHandler(async (_req, res) => {
  const rows = await query(
    borrowPool,
    `
    SELECT status, COUNT(*) AS count
    FROM loan_reservations
    WHERE status IN ('PENDING', 'CONFIRMED', 'READY_FOR_PICKUP', 'CONVERTED_TO_LOAN', 'CANCELLED', 'EXPIRED')
    GROUP BY status
    `,
  );

  const data = {
    total: rows.reduce((sum, row) => sum + number(row.count), 0),
    pending: statusCount(rows, 'PENDING'),
    confirmed: statusCount(rows, 'CONFIRMED'),
    ready_for_pickup: statusCount(rows, 'READY_FOR_PICKUP'),
    converted_to_loan: statusCount(rows, 'CONVERTED_TO_LOAN'),
    cancelled: statusCount(rows, 'CANCELLED'),
    expired: statusCount(rows, 'EXPIRED'),
    conversion_rate: 0,
  };
  data.conversion_rate = data.total ? round((data.converted_to_loan / data.total) * 100, 1) : 0;

  res.json({ data });
});

module.exports = {
  getDashboardKpis,
  getBorrowTrends,
  getTopBooks,
  getOverdueSummary,
  getFineSummary,
  getWarehouseStockRisk,
  getReorderSuggestions,
  getReservationFunnel,
  getAgingInventory,
  getBookTurnover,
  getWeedingSuggestions,
  getForecastAccuracy,
  getLateReturnRisk,
  getReservationNoShowRisk,
  // Exported for unit tests: resolves one variant's lead time from the
  // delivery history maps built by getLeadTimeHistory().
  resolveItemLeadTime,
};
