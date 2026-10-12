// Shared query helpers for the staff list endpoints (loans, reservations, fines, customers).

// `status` accepts one value or a comma-separated list ("BORROWED,OVERDUE") so a page tab can
// cover several statuses in one request. Returns undefined when no filter was given.
function parseStatusFilter(value) {
  const statuses = String(value || '')
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
  if (statuses.length === 0) return undefined;
  return statuses.length === 1 ? statuses[0] : { in: statuses };
}

function searchTerm(query) {
  return String(query?.q || '').trim();
}

// Count rows per status for the given filter. Callers pass the filter WITHOUT the status
// condition, so every tab of a page can show its own total for the current search.
async function countByStatus(delegate, where) {
  const rows = await delegate.groupBy({ by: ['status'], where, _count: { _all: true } });
  return Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
}

module.exports = { parseStatusFilter, searchTerm, countByStatus };
