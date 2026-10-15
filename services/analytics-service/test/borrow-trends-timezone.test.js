// Regression test for borrow-trend buckets at day/month boundaries in Vietnam
// time, against a REAL Postgres (date_trunc / AT TIME ZONE behaviour is the
// thing under test). Runs only with ANALYTICS_TEST_PG_URL set, e.g. inside the
// analytics container:
//   ANALYTICS_TEST_PG_URL=$BORROW_DATABASE_URL node --test test/borrow-trends-timezone.test.js
// It creates TEMP tables (they shadow the real ones for this session only) in a
// transaction that is rolled back: no business data is read or written.
const test = require('node:test');
const assert = require('node:assert/strict');
const { BORROW_TRENDS_SQL, borrowTrendsParams } = require('../src/lib/borrow-trends-query');

const URL = process.env.ANALYTICS_TEST_PG_URL;

async function withFixture(fn) {
  const { Client } = require('pg');
  const client = new Client({ connectionString: URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    // The session zone is irrelevant by design: run as if the server were UTC.
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query('CREATE TEMP TABLE loan_transactions (id int PRIMARY KEY, borrow_date timestamptz, closed_at timestamptz) ON COMMIT DROP');
    await client.query('CREATE TEMP TABLE loan_items (loan_id int, return_date timestamptz) ON COMMIT DROP');
    await client.query('CREATE TEMP TABLE loan_reservations (reserved_at timestamptz) ON COMMIT DROP');
    await client.query(`INSERT INTO loan_transactions (id, borrow_date) VALUES
      (1, '2026-09-30T16:59:59Z'),  -- 23:59:59 30/09 VN -> September
      (2, '2026-09-30T17:00:00Z'),  -- 00:00:00 01/10 VN -> October (was September in UTC buckets)
      (3, '2026-09-30T17:30:00Z'),  -- 00:30 01/10 VN -> October
      (4, '2026-10-31T16:59:59Z'),  -- 23:59:59 31/10 VN -> October
      (5, '2026-10-31T17:00:00Z')   -- 00:00 01/11 VN -> November`);
    await client.query(`INSERT INTO loan_items (loan_id, return_date) VALUES (1, '2026-09-30T17:15:00Z')`);
    await client.query(`INSERT INTO loan_reservations (reserved_at) VALUES ('2026-10-31T17:05:00Z')`);
    return await fn(client);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  }
}

const run = (client, from, to, granularity) =>
  client.query(BORROW_TRENDS_SQL, borrowTrendsParams({ from: new Date(from), to: new Date(to), granularity })).then((r) => r.rows);

test('month buckets follow Vietnam time at month boundaries', { skip: !URL && 'ANALYTICS_TEST_PG_URL not set' }, async () => {
  await withFixture(async (client) => {
    const rows = await run(client, '2026-09-01T00:00:00+07:00', '2026-11-30T23:59:59+07:00', 'month');
    assert.deepEqual(rows.map((r) => [r.label, Number(r.loans)]), [['2026-09', 1], ['2026-10', 3], ['2026-11', 1]]);
    // nothing lost or counted twice: bucket total = source rows in range
    assert.equal(rows.reduce((s, r) => s + Number(r.loans), 0), 5);
    assert.equal(Number(rows.find((r) => r.label === '2026-10').returns), 1); // returned 00:15 01/10 VN
    assert.equal(Number(rows.find((r) => r.label === '2026-11').reservations), 1);
  });
});

test('day buckets: 00:00-00:59 Vietnam time is the new day', { skip: !URL && 'ANALYTICS_TEST_PG_URL not set' }, async () => {
  await withFixture(async (client) => {
    const rows = await run(client, '2026-09-30T00:00:00+07:00', '2026-10-01T23:59:59+07:00', 'day');
    assert.deepEqual(rows.map((r) => [r.label, Number(r.loans)]), [['2026-09-30', 1], ['2026-10-01', 2]]);
  });
});

test('a range boundary at local midnight neither drops nor double-counts', { skip: !URL && 'ANALYTICS_TEST_PG_URL not set' }, async () => {
  await withFixture(async (client) => {
    const sept = await run(client, '2026-09-01T00:00:00+07:00', '2026-09-30T23:59:59.999+07:00', 'month');
    const oct = await run(client, '2026-10-01T00:00:00+07:00', '2026-10-31T23:59:59.999+07:00', 'month');
    assert.deepEqual(sept.map((r) => [r.label, Number(r.loans)]), [['2026-09', 1]]);
    assert.deepEqual(oct.map((r) => [r.label, Number(r.loans)]), [['2026-10', 3]]);
  });
});
