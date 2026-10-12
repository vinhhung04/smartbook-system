// Discrete-event engine for the persona-conditioned behavioural simulation.
//
//   Persona -> latent traits -> preferences -> temporal activity
//           -> behavioural events (sessions, discoveries, pickups, alerts)
//           -> rows for borrow_db
//
// Events are processed in strict time order through one min-heap, so any
// quantity read at time t (copies on the shelf, unpaid fines, prior no-shows,
// open loans) only reflects events that happened before t.
//
// generateDataset() runs the population twice with identical seeds: a pilot
// with unlimited stock measures how many copies each variant keeps busy, the
// real run then gives each variant ~ usage * STOCK.copyFactor copies - so
// popular titles are occasionally unavailable (driving wishlists, alerts and
// reservations) while the long tail always is.

const {
  DEFAULTS, ACTIVITY, TENURE, STOCK, SELECTION, FALLBACK_PLANS, OPENING_HOURS, ALERT,
} = require('./config');
const { createRng } = require('./random');
const { buildCatalog } = require('./catalog');
const { Stock } = require('./stock');
const { sessionsPerYear, reserveProbability } = require('./behavior-model');
const {
  DAY_MS, dayOfWeekFactor, seasonalFactor, localDayStart, localParts, sampleLocalHour, atLocalHour,
} = require('./temporal-model');
const { chooseBook } = require('./preferences');
const { buildPopulation, customerRows, membershipRows } = require('./generate-customers');
const { createLoan, activeItemCount } = require('./generate-loans');
const { createReservation } = require('./generate-reservations');
const { discover, discoveriesPerDay, wishlistRows } = require('./generate-wishlists');
const { onUnavailable, runAlertCheck, isCounterOpen } = require('./generate-alerts');
const { payAtCounter, fineRows } = require('./generate-fines');
const { PERSONAS } = require('./personas');

class EventHeap {
  constructor() { this.items = []; this.seq = 0; }

  push(event) {
    const e = { ...event, seq: this.seq += 1 };
    const a = this.items;
    a.push(e);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!EventHeap.less(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }

  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && EventHeap.less(a[l], a[m])) m = l;
        if (r < a.length && EventHeap.less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }

  peek() { return this.items[0]; }

  static less(x, y) {
    const d = x.time.getTime() - y.time.getTime();
    return d < 0 || (d === 0 && x.seq < y.seq);
  }
}

function drawItemCount(rng, persona) {
  return Number(rng.weightedKey(PERSONAS[persona].items));
}

// One borrowing intent: pick books from the reader's taste, then walk in,
// reserve online, or - if no copy is free - wishlist / set an alert / substitute.
function handleSession(ctx, customer, t) {
  const { rng, stock, catalog } = ctx;
  const cap = customer.plan.max_active_loans - activeItemCount(customer, t);
  if (cap <= 0) { ctx.counters.blockedSessions += 1; return; }
  payAtCounter(ctx, customer, t);

  const wanted = Math.min(drawItemCount(rng, customer.persona), cap);
  const exclude = new Set();
  const walkIn = [];
  let retries = 0;
  for (let slot = 0; slot < wanted; slot += 1) {
    const pick = chooseBook(rng, customer, {
      catalog, now: t.getTime(), exclude, isAvailable: (b) => stock.availableVariant(b, t) !== null,
    });
    if (!pick) break;
    exclude.add(pick.book.id);
    ctx.counters.choices += 1;
    if (pick.explored) ctx.counters.exploredChoices += 1;
    const variant = stock.availableVariant(pick.book, t);
    if (!variant) {
      ctx.counters.unavailableChoices += 1;
      onUnavailable(ctx, customer, pick.book, t);
      if (retries < 1 && rng.chance(SELECTION.substituteWhenUnavailable)) { retries += 1; slot -= 1; }
      continue;
    }
    if (rng.chance(reserveProbability(customer.traits))) {
      createReservation(ctx, customer, t, pick.book, variant);
    } else {
      // Claim the copy now so a second slot cannot double-book it.
      walkIn.push({ book: pick.book, variant });
      stock.hold(variant.id, t, new Date(t.getTime() + 1), ctx.end);
    }
  }
  if (walkIn.length) createLoan(ctx, customer, t, walkIn);
}

function handleFollowUp(ctx, event) {
  const { customer, book, time: t } = event;
  if ((customer.held.get(book.id) || 0) > t.getTime()) return;
  const variant = ctx.stock.availableVariant(book, t);
  if (!variant) return;
  if (!isCounterOpen(t) || ctx.rng.chance(0.75)) {
    createReservation(ctx, customer, t, book, variant, { viaAlert: true });
  } else if (activeItemCount(customer, t) < customer.plan.max_active_loans) {
    createLoan(ctx, customer, t, [{ book, variant }]);
  }
}

function dailyRate(ctx, customer, dayStart) {
  const { dow, month, year } = localParts(dayStart);
  // Mean-one engagement multiplier redrawn each calendar month (burstiness).
  const key = year * 12 + month;
  if (customer.burstMonth !== key) {
    customer.burstMonth = key;
    customer.burst = ctx.rng.gamma(ACTIVITY.monthlyBurstShape) / ACTIVITY.monthlyBurstShape;
  }
  let rate = (sessionsPerYear(customer.traits.activity_level) / 365)
    * seasonalFactor(customer.temporal.life_stage, month)
    * dayOfWeekFactor(customer.traits.weekend_affinity, dow)
    * customer.burst;
  if (dayStart.getTime() - customer.created_at.getTime() < TENURE.newMemberBoostDays * DAY_MS) rate *= TENURE.newMemberBoost;
  if (customer.churnAt && dayStart.getTime() >= customer.churnAt) rate *= 0.08;
  return Math.min(rate, ACTIVITY.maxDailyProbability);
}

function runSimulation({ seed, customerCount, windowStart, end, plans, catalog, copies }) {
  const ctx = {
    rng: createRng(seed),
    idRng: createRng((seed ^ 0x1d5eed) >>> 0),
    windowStart,
    end,
    catalog,
    stock: new Stock(copies),
    heap: new EventHeap(),
    tables: { loan_transactions: [], loan_items: [], loan_renewals: [], loan_reservations: [], book_reviews: [] },
    fines: [],
    alerts: new Map(),
    pendingWants: [],
    samples: { late: [], noShow: [] },
    counters: { loan: 0, reservation: 0, choices: 0, exploredChoices: 0, unavailableChoices: 0, blockedSessions: 0 },
  };
  ctx.schedule = (event) => { if (event.time.getTime() <= end.getTime()) ctx.heap.push(event); };
  ctx.warehouseFor = (customer) => {
    const ids = catalog.warehouseIds;
    return ctx.rng.chance(0.85) ? ids[customer.homeWarehouse % ids.length] : ctx.rng.pick(ids);
  };
  ctx.customers = buildPopulation(ctx, { count: customerCount, plans });

  const firstDay = localDayStart(windowStart);
  for (let dayStart = firstDay; dayStart.getTime() < end.getTime(); dayStart = new Date(dayStart.getTime() + DAY_MS)) {
    const dayEnd = dayStart.getTime() + DAY_MS;
    ctx.schedule({ time: atLocalHour(dayStart, ALERT.notifyLocalHour), type: 'alertCheck' });
    for (const customer of ctx.customers) {
      if (customer.created_at.getTime() >= dayEnd) continue;
      if (ctx.rng.chance(dailyRate(ctx, customer, dayStart))) {
        const t = atLocalHour(dayStart, sampleLocalHour(ctx.rng, customer.temporal, { walkIn: true }));
        if (t.getTime() > customer.created_at.getTime()) ctx.schedule({ time: t, type: 'session', customer });
      }
      if (ctx.rng.chance(discoveriesPerDay(customer) * (customer.churnAt && dayStart.getTime() >= customer.churnAt ? 0.1 : 1))) {
        const t = atLocalHour(dayStart, sampleLocalHour(ctx.rng, customer.temporal, { walkIn: false }));
        if (t.getTime() > customer.created_at.getTime()) ctx.schedule({ time: t, type: 'discover', customer });
      }
    }
    while (ctx.heap.peek() && ctx.heap.peek().time.getTime() < dayEnd) {
      const event = ctx.heap.pop();
      if (event.time.getTime() > end.getTime()) continue;
      switch (event.type) {
        case 'session': handleSession(ctx, event.customer, event.time); break;
        case 'discover': discover(ctx, event.customer, event.time); break;
        case 'alertCheck': runAlertCheck(ctx, event.time); break;
        case 'followUp': handleFollowUp(ctx, event); break;
        case 'pickup':
          createLoan(ctx, event.customer, event.time, [{ book: event.book, variant: event.variant }], {
            reservationId: event.reservation.id, warehouseId: event.reservation.warehouse_id,
          });
          break;
        default: throw new Error(`unknown event ${event.type}`);
      }
    }
  }
  return ctx;
}

function calibrateCopies(pilot, catalog, windowStart, end, seed) {
  const rng = createRng((seed ^ 0xc0b1e5) >>> 0);
  const windowMs = end.getTime() - windowStart.getTime();
  const copies = new Map();
  for (const book of catalog.books) {
    for (const v of book.variants) {
      const avgConcurrent = (pilot.stock.usageMs.get(v.id) || 0) / windowMs;
      const n = Math.round(avgConcurrent * STOCK.copyFactor * Math.exp(rng.gaussian(0, STOCK.copyNoiseSd)));
      copies.set(v.id, Math.max(STOCK.minCopies, n));
    }
  }
  return copies;
}

/**
 * Pure: no DB, no filesystem. Same options -> identical output (ids included).
 * @param {object} [options] { seed, customerCount, months, end, plans, catalog }
 */
function generateDataset(options = {}) {
  const seed = options.seed ?? DEFAULTS.seed;
  const customerCount = options.customerCount ?? DEFAULTS.customerCount;
  const months = options.months ?? DEFAULTS.months;
  const end = options.end ?? DEFAULTS.end;
  const windowStart = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - months, end.getUTCDate()));
  const plans = (options.plans ?? FALLBACK_PLANS.map((p) => ({ id: `FALLBACK-${p.code}`, ...p })))
    .map((p) => ({ ...p, fine_per_day: Number(p.fine_per_day) }));
  const catalog = options.catalog ?? buildCatalog(seed);

  const pilot = runSimulation({ seed, customerCount, windowStart, end, plans, catalog, copies: null });
  const copies = calibrateCopies(pilot, catalog, windowStart, end, seed);
  const ctx = runSimulation({ seed, customerCount, windowStart, end, plans, catalog, copies });

  const { fines, payments } = fineRows(ctx);
  const tables = {
    customers: customerRows(ctx.customers, end),
    customer_memberships: membershipRows(ctx, ctx.customers),
    loan_transactions: ctx.tables.loan_transactions,
    loan_items: ctx.tables.loan_items,
    loan_renewals: ctx.tables.loan_renewals,
    loan_reservations: ctx.tables.loan_reservations,
    fines,
    fine_payments: payments,
    book_wishlists: wishlistRows(ctx),
    book_reviews: ctx.tables.book_reviews,
    availability_alerts: Array.from(ctx.alerts.values()),
  };
  return {
    meta: { seed, customerCount, months, windowStart, end, openingHours: OPENING_HOURS },
    tables,
    customers: ctx.customers,
    catalog,
    copies,
    samples: ctx.samples,
    counters: ctx.counters,
  };
}

module.exports = { generateDataset, runSimulation, calibrateCopies, EventHeap };
