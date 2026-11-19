const { Prisma } = require('@prisma/client');

// Fines and their payment allocations are the source of truth. This detector
// never rewrites the admission-control cache or changes settled history.
async function auditFineBalances(db, { customerIds, limit = 100 } = {}) {
  const pageSize = Math.max(1, Math.min(1000, Math.trunc(Number(limit) || 100)));
  if (customerIds && (!Array.isArray(customerIds) || customerIds.some(id => !/^[0-9a-f-]{36}$/i.test(id)))) {
    throw new TypeError('customerIds must contain UUIDs');
  }
  if (customerIds?.length === 0) return { count: 0, items: [] };
  const scope = customerIds
    ? Prisma.sql`WHERE c.id IN (${Prisma.join(customerIds.map(id => Prisma.sql`${id}::uuid`))})`
    : Prisma.empty;
  const rows = await db.$queryRaw`
    WITH paid AS (
      SELECT fine_id, sum(amount) AS amount FROM fine_payments GROUP BY fine_id
    ), debt AS (
      SELECT c.id AS customer_id, c.total_fine_balance AS cached_balance,
        coalesce(sum(CASE WHEN f.id IS NULL OR f.status IN ('PAID','WAIVED') THEN 0
          ELSE greatest(0, f.amount-coalesce(f.waived_amount,0)-coalesce(p.amount,0)) END),0) AS computed_balance
      FROM customers c LEFT JOIN fines f ON f.customer_id=c.id
      LEFT JOIN paid p ON p.fine_id=f.id
      ${scope}
      GROUP BY c.id
    ), mismatch AS (
      SELECT * FROM debt WHERE cached_balance<>computed_balance
    )
    SELECT customer_id,cached_balance,computed_balance,count(*) OVER() AS total_count
    FROM mismatch ORDER BY customer_id LIMIT ${pageSize}`;
  return {
    count: Number(rows[0]?.total_count || 0),
    items: rows.map(row => ({ customer_id: row.customer_id, cached_balance: Number(row.cached_balance), computed_balance: Number(row.computed_balance) })),
  };
}

module.exports = { auditFineBalances };
