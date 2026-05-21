const { inventoryPool, borrowPool, query, queryOne } = require('../lib/db');
const {
  createHttpError,
  formatBucketDate,
  parseDateRange,
  parseGranularity,
  parseLimit,
  round,
} = require('../utils/date-range');

const LOW_STOCK_THRESHOLD = Number(process.env.LOW_STOCK_THRESHOLD || 5);
const DAY_MS = 24 * 60 * 60 * 1000;
const REORDER_PRIORITIES = new Set(['ALL', 'HIGH', 'MEDIUM', 'LOW']);

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

function parsePositiveInteger(value, defaultValue, maxValue, fieldName) {
  const parsed = Number(value || defaultValue);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maxValue) {
    throw createHttpError(400, `${fieldName} must be an integer from 1 to ${maxValue}`);
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
  const leadTimeDays = parsePositiveInteger(queryParams.leadTimeDays, 14, 365, 'leadTimeDays');
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
    data: rows.map((row) => ({
      warehouse_id: row.warehouse_id,
      warehouse_name: row.warehouse_name,
      low_stock_variants: number(row.low_stock_variants),
      out_of_stock_variants: number(row.out_of_stock_variants),
      total_available_qty: number(row.total_available_qty),
      total_reserved_qty: number(row.total_reserved_qty),
      total_borrowed_qty: number(row.total_borrowed_qty),
    })),
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
      COALESCE(MAX(sb.reorder_point), 0) AS reorder_point
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
      bv.sku
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
  if (item.suggested_reorder_qty > 0) {
    parts.push(`Đề xuất nhập thêm ${item.suggested_reorder_qty} bản để đáp ứng nhu cầu trong thời gian chờ nhập hàng ${leadTimeDays} ngày.`);
  } else {
    parts.push('Chưa cần nhập thêm ngay, nhưng nên tiếp tục theo dõi nhu cầu.');
  }

  return parts.join(' ');
}

function calculateSuggestion(row, demand, ranges) {
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
  const avgDailyDemand = borrowCount / ranges.days;
  const forecast7d = Math.ceil(avgDailyDemand * 7);
  const forecast30d = Math.ceil(avgDailyDemand * 30);
  const demandTrendPct = previousBorrowCount > 0
    ? round(((borrowCount - previousBorrowCount) / previousBorrowCount) * 100, 1)
    : (borrowCount > 0 ? 100 : 0);
  const estimatedDaysUntilStockout = avgDailyDemand > 0 ? round(availableQty / avgDailyDemand, 1) : null;
  const hasDemandSignal = borrowCount > 0 || reservationCount > 0;
  const safetyStock = Math.max(reorderPoint, Math.ceil(avgDailyDemand * 7), hasDemandSignal ? 2 : 0);
  const expectedDemandDuringLeadTime = Math.ceil(avgDailyDemand * ranges.leadTimeDays);
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
    leadTimeDays: ranges.leadTimeDays,
  });

  if (priority === 'HIGH' && suggestedReorderQty < 5) {
    suggestedReorderQty = 5;
  }
  if (priority === 'MEDIUM' && suggestedReorderQty < 3) {
    suggestedReorderQty = 3;
  }

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
    forecast_7d: forecast7d,
    forecast_30d: forecast30d,
    estimated_days_until_stockout: estimatedDaysUntilStockout,
    demand_trend_pct: demandTrendPct,
    demand_score: demandScore,
    priority,
    suggested_reorder_qty: suggestedReorderQty,
  };

  return {
    ...item,
    reason: buildReason(item, ranges.days, ranges.leadTimeDays),
  };
}

const getReorderSuggestions = asyncHandler(async (req, res) => {
  const ranges = parseReorderDateRanges(req.query);
  const limit = parseLimit(req.query.limit, 20, 100);
  const priority = String(req.query.priority || 'ALL').toUpperCase();
  const includeLowDemand = parseBoolean(req.query.includeLowDemand, false);

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
  ] = await Promise.all([
    getInventorySnapshot(),
    getBorrowDemandByVariant(ranges.from, ranges.to),
    getBorrowDemandByVariant(ranges.previousFrom, ranges.previousTo),
    getReservationDemandByVariant(ranges.from, ranges.to),
    getWishlistDemandByBook(),
    getAvailabilityAlertDemandByBook(),
  ]);

  const candidates = inventoryRows
    .map((row) => calculateSuggestion(row, {
      borrowCount: borrowByVariant.get(row.variant_id) || 0,
      previousBorrowCount: previousBorrowByVariant.get(row.variant_id) || 0,
      reservationCount: reservationByVariant.get(row.variant_id) || 0,
      wishlistCount: wishlistByBook.get(row.book_id) || 0,
      availabilityAlertCount: alertsByBook.get(row.book_id) || 0,
    }, ranges))
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
  });

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
      items: candidates.slice(0, limit),
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
};
