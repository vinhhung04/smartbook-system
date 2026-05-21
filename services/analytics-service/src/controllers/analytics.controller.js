const { inventoryPool, borrowPool, query, queryOne } = require('../lib/db');
const {
  formatBucketDate,
  parseDateRange,
  parseGranularity,
  parseLimit,
  round,
} = require('../utils/date-range');

const LOW_STOCK_THRESHOLD = Number(process.env.LOW_STOCK_THRESHOLD || 5);

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
  getReservationFunnel,
};
