// Borrow trends bucketed by calendar day/month in the library's business time
// zone (BUSINESS_TIME_ZONE, default Asia/Ho_Chi_Minh), not the database
// session's (UTC): a loan at 00:30 on 1 Oct in Vietnam is 17:30 on 30 Sep in
// UTC and used to be counted in September. Labels are formatted in SQL from the
// local bucket, so the Node process time zone plays no part either. The
// from/to filter still compares instants, so no event is lost or counted twice
// at a boundary. Kept in its own module so the SQL can be regression-tested
// against a real Postgres (test/borrow-trends-timezone.test.js).
const BUSINESS_TIME_ZONE = process.env.BUSINESS_TIME_ZONE || 'Asia/Ho_Chi_Minh';

const BORROW_TRENDS_SQL = `
    WITH buckets AS (
      SELECT generate_series(
        date_trunc($3, $1::timestamptz AT TIME ZONE $5),
        date_trunc($3, $2::timestamptz AT TIME ZONE $5),
        $4::interval
      ) AS bucket
    ),
    loans AS (
      SELECT date_trunc($3, borrow_date AT TIME ZONE $5) AS bucket, COUNT(*) AS count
      FROM loan_transactions
      WHERE borrow_date >= $1::timestamptz AND borrow_date <= $2::timestamptz
      GROUP BY 1
    ),
    returns AS (
      SELECT date_trunc($3, COALESCE(li.return_date, lt.closed_at) AT TIME ZONE $5) AS bucket, COUNT(DISTINCT lt.id) AS count
      FROM loan_transactions lt
      JOIN loan_items li ON li.loan_id = lt.id
      WHERE COALESCE(li.return_date, lt.closed_at) >= $1::timestamptz
        AND COALESCE(li.return_date, lt.closed_at) <= $2::timestamptz
        AND COALESCE(li.return_date, lt.closed_at) IS NOT NULL
      GROUP BY 1
    ),
    reservations AS (
      SELECT date_trunc($3, reserved_at AT TIME ZONE $5) AS bucket, COUNT(*) AS count
      FROM loan_reservations
      WHERE reserved_at >= $1::timestamptz AND reserved_at <= $2::timestamptz
      GROUP BY 1
    )
    SELECT
      to_char(buckets.bucket, $6) AS label,
      COALESCE(loans.count, 0) AS loans,
      COALESCE(returns.count, 0) AS returns,
      COALESCE(reservations.count, 0) AS reservations
    FROM buckets
    LEFT JOIN loans ON loans.bucket = buckets.bucket
    LEFT JOIN returns ON returns.bucket = buckets.bucket
    LEFT JOIN reservations ON reservations.bucket = buckets.bucket
    ORDER BY buckets.bucket ASC
    `;

function borrowTrendsParams({ from, to, granularity }) {
  const interval = granularity === 'month' ? '1 month' : '1 day';
  const labelFormat = granularity === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD';
  return [from, to, granularity, interval, BUSINESS_TIME_ZONE, labelFormat];
}

module.exports = { BORROW_TRENDS_SQL, BUSINESS_TIME_ZONE, borrowTrendsParams };
