// Unavailable-book chain:  want -> (wishlist) -> availability alert ->
// copy returned -> alert NOTIFIED -> follow-up reservation / walk-in loan.
//
// An alert is only ever created for a book that had no free copy at that
// moment. The notification job runs each morning (ALERT.notifyLocalHour) -
// a simplifying assumption about how the real notifier batches.

const { ALERT, WISHLIST, OPENING_HOURS, LOCAL_TZ_OFFSET_HOURS } = require('./config');
const { DAY_MS, HOUR_MS } = require('./temporal-model');
const { tasteMatch } = require('./preferences');
const { addWishlist } = require('./generate-wishlists');

function onUnavailable(ctx, customer, book, t) {
  const { rng } = ctx;
  const desire = tasteMatch(customer, book);
  const tr = customer.traits;
  if (rng.chance(WISHLIST.onUnavailable * tr.wishlist_tendency)) addWishlist(customer, book, t);
  if (!rng.chance(ALERT.onUnavailable * (0.3 + 0.7 * tr.digital_affinity) * desire)) return;

  const key = `${customer.id}|${book.id}`;
  const existing = ctx.alerts.get(key);
  if (existing) {
    // Same semantics as wishlist.controller.js's upsert: re-arm, keep created_at.
    existing.status = 'ACTIVE';
    existing.notified_at = null;
  } else {
    ctx.alerts.set(key, { id: ctx.idRng.uuid(), customer_id: customer.id, book_id: book.id, status: 'ACTIVE', notified_at: null, created_at: t });
  }
  ctx.pendingWants.push({ customer, book, since: t.getTime(), desire, key });
}

function runAlertCheck(ctx, t) {
  const { rng, stock } = ctx;
  const now = t.getTime();
  const remaining = [];
  for (const want of ctx.pendingWants) {
    if (now - want.since > ALERT.wantTtlDays * DAY_MS) continue; // gave up; alert stays ACTIVE
    if (!stock.availableVariant(want.book, t)) { remaining.push(want); continue; }
    const alert = ctx.alerts.get(want.key);
    const notifiedAt = new Date(now + rng.range(1, 30) * 60 * 1000);
    alert.status = 'NOTIFIED';
    alert.notified_at = notifiedAt;
    const tr = want.customer.traits;
    if (rng.chance(ALERT.followUpBase + ALERT.followUpDesire * want.desire * (0.5 + 0.5 * tr.activity_level))) {
      const at = new Date(notifiedAt.getTime() + rng.range(0.5, ALERT.followUpMaxDelayHours) * HOUR_MS);
      ctx.schedule({ time: at, type: 'followUp', customer: want.customer, book: want.book });
    }
  }
  ctx.pendingWants = remaining;
}

function isCounterOpen(t) {
  const localHour = (((t.getTime() / HOUR_MS + LOCAL_TZ_OFFSET_HOURS) % 24) + 24) % 24;
  return localHour >= OPENING_HOURS.open && localHour < OPENING_HOURS.close;
}

module.exports = { onUnavailable, runAlertCheck, isCounterOpen };
