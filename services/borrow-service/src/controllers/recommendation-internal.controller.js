const { prisma } = require('../lib/prisma');

// Service-to-service feed for ai-service Recommendation V2: the library-wide
// interaction history that popularity, trend and item-item collaborative
// filtering are computed from. Customers are replaced by a per-response index
// (no ids, names or contact data leave this service); only the ai-service,
// holding INTERNAL_SERVICE_KEY, can call it, and the gateway does not proxy
// /internal. Three batched queries, independent of catalog size.

const DEFAULT_SINCE_DAYS = 730;
const MAX_SINCE_DAYS = 1825;
const DAY_MS = 24 * 60 * 60 * 1000;

function sinceDate(raw, now = Date.now()) {
  const days = Number(raw);
  const value = Number.isFinite(days) && days > 0 ? Math.min(days, MAX_SINCE_DAYS) : DEFAULT_SINCE_DAYS;
  return new Date(now - value * DAY_MS);
}

function toEvents(loanItems, wishlists, reviews) {
  const customerIds = new Set();
  for (const i of loanItems) customerIds.add(i.loan_transactions.customer_id);
  for (const w of wishlists) customerIds.add(w.customer_id);
  for (const r of reviews) customerIds.add(r.customer_id);
  const index = new Map(Array.from(customerIds).sort().map((id, n) => [id, n]));
  const iso = (d) => (d ? new Date(d).toISOString() : null);
  return [
    ...loanItems.map((i) => ({
      kind: 'LOAN', u: index.get(i.loan_transactions.customer_id), variant_id: i.variant_id,
      at: iso(i.loan_transactions.borrow_date), until: iso(i.return_date),
    })),
    ...wishlists.map((w) => ({ kind: 'WISHLIST', u: index.get(w.customer_id), book_id: w.book_id, at: iso(w.created_at) })),
    ...reviews.map((r) => ({ kind: 'REVIEW', u: index.get(r.customer_id), book_id: r.book_id, rating: r.rating, at: iso(r.created_at) })),
  ];
}

async function getRecommendationInteractions(req, res) {
  const internalKey = String(process.env.INTERNAL_SERVICE_KEY || '').trim();
  if (!internalKey || req.headers['x-internal-service-key'] !== internalKey) {
    return res.status(403).json({ message: 'Forbidden' });
  }
  const since = sinceDate(req.query?.since_days);
  try {
    const [loanItems, wishlists, reviews] = await Promise.all([
      prisma.loan_items.findMany({
        where: { loan_transactions: { borrow_date: { gte: since } } },
        select: { variant_id: true, return_date: true, loan_transactions: { select: { customer_id: true, borrow_date: true } } },
      }),
      prisma.book_wishlists.findMany({
        where: { created_at: { gte: since } },
        select: { customer_id: true, book_id: true, created_at: true },
      }),
      prisma.book_reviews.findMany({
        where: { status: 'VISIBLE', created_at: { gte: since } },
        select: { customer_id: true, book_id: true, rating: true, created_at: true },
      }),
    ]);
    const events = toEvents(loanItems, wishlists, reviews);
    return res.json({ generated_at: new Date().toISOString(), since: since.toISOString(), count: events.length, events });
  } catch (err) {
    console.error('[getRecommendationInteractions] error:', err.message);
    return res.status(500).json({ message: 'Internal error' });
  }
}

module.exports = { getRecommendationInteractions, toEvents, sinceDate };
