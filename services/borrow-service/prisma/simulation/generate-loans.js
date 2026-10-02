// Loan -> (renewal) -> return -> (fine) -> (review) chain for one checkout.
//
// Everything that happens to the loan is decided at checkout from the
// customer's latent profile and the situation AT CHECKOUT (point-in-time
// unpaid fines, plan, loan size) - then written with timestamps in the future
// of the checkout. Nothing about the future feeds back into checkout-time
// quantities, which is what keeps the late-return labels causal.

const { READING, RENEWAL, PLACEHOLDER_STAFF_ID, PREFIX, WISHLIST } = require('./config');
const { DAY_MS, HOUR_MS, localDayStart, sampleLocalHour, atLocalHour } = require('./temporal-model');
const { lateProbability, renewalProbability } = require('./behavior-model');
const { unpaidAt, issueFine } = require('./generate-fines');
const { maybeReview } = require('./generate-reviews');

// Move a timestamp onto a plausible counter hour of the same local day.
function onCounterHour(rng, customer, t) {
  return atLocalHour(localDayStart(t), sampleLocalHour(rng, customer.temporal, { walkIn: true }));
}

function planRenewals(ctx, customer, borrowAt, originalDue, readingDays) {
  const { rng, end } = ctx;
  const plan = customer.plan;
  const renewals = [];
  let due = originalDue;
  const maxRenewals = Math.min(plan.max_renewal_count, 2);
  for (let n = 1; n <= maxRenewals; n += 1) {
    const loanDays = (due.getTime() - borrowAt.getTime()) / DAY_MS;
    let p = renewalProbability({
      renewalTendency: customer.traits.renewal_tendency,
      readingDays,
      loanDays,
      punctuality: customer.traits.punctuality,
    });
    if (n > 1) p *= RENEWAL.secondRenewalShare;
    if (!rng.chance(p)) break;
    const renewedAt = new Date(Math.max(borrowAt.getTime() + HOUR_MS, due.getTime() - rng.range(1, 3) * DAY_MS));
    if (renewedAt.getTime() > end.getTime()) break; // has not happened yet at export time
    const newDue = new Date(due.getTime() + ctx.rng.int(RENEWAL.extensionDays[0], RENEWAL.extensionDays[1]) * DAY_MS);
    renewals.push({ renewed_at: renewedAt, old_due_date: due, new_due_date: newDue, renewal_count: n });
    due = newDue;
  }
  return { renewals, finalDue: due };
}

/**
 * @param entries [{ book, variant }]
 * @param opts { reservationId?, warehouseId? }
 */
function createLoan(ctx, customer, borrowAt, entries, opts = {}) {
  const { rng, idRng, end, stock } = ctx;
  const plan = customer.plan;
  const originalDue = new Date(borrowAt.getTime() + plan.max_loan_days * DAY_MS);
  const pLate = lateProbability({
    punctuality: customer.traits.punctuality,
    planCode: plan.code,
    maxLoanDays: plan.max_loan_days,
    itemsInLoan: entries.length,
    unpaidFineFlag: unpaidAt(customer, borrowAt),
  });
  const isLate = rng.chance(pLate);

  ctx.counters.loan += 1;
  const loanNo = ctx.counters.loan;
  const loanId = idRng.uuid();
  const warehouseId = opts.warehouseId || ctx.warehouseFor(customer);

  // Per-item plan: renewals, final due, intended return.
  let cumulativeReading = 0;
  const together = rng.chance(READING.returnTogetherShare);
  const sharedDaysLate = 1 + Math.floor(rng.exponential(READING.meanDaysLate));
  const planned = entries.map(({ book, variant }) => {
    cumulativeReading += (book.page_count / customer.traits.reading_speed) * Math.exp(rng.gaussian(0, 0.3));
    const { renewals, finalDue } = planRenewals(ctx, customer, borrowAt, originalDue, cumulativeReading);
    let returnAt;
    if (isLate) {
      const daysLate = Math.min(READING.maxDaysLate, together ? sharedDaysLate : 1 + Math.floor(rng.exponential(READING.meanDaysLate)));
      returnAt = onCounterHour(rng, customer, new Date(finalDue.getTime() + daysLate * DAY_MS));
      if (returnAt.getTime() <= finalDue.getTime()) returnAt = new Date(finalDue.getTime() + rng.range(1, 6) * HOUR_MS);
    } else {
      const target = new Date(borrowAt.getTime() + (cumulativeReading * rng.range(0.8, 1.2) + rng.range(0, 3)) * DAY_MS);
      returnAt = onCounterHour(rng, customer, target);
    }
    return { book, variant, renewals, finalDue, returnAt };
  });
  if (!isLate && together) {
    const common = Math.max(...planned.map((p) => p.returnAt.getTime()));
    for (const p of planned) p.returnAt = new Date(common);
  }
  for (const p of planned) {
    if (!isLate) {
      // On time means on or before the (final) due date, and after checkout.
      const latest = p.finalDue.getTime() - rng.range(0.5, 6) * HOUR_MS;
      p.returnAt = new Date(Math.max(borrowAt.getTime() + 2 * HOUR_MS, Math.min(p.returnAt.getTime(), latest)));
    }
  }

  let allReturned = true;
  let closedAt = null;
  planned.forEach((p, index) => {
    const itemId = idRng.uuid();
    const returned = p.returnAt.getTime() <= end.getTime();
    for (const r of p.renewals) {
      ctx.tables.loan_renewals.push({
        id: idRng.uuid(), loan_item_id: itemId, renewed_by_user_id: PLACEHOLDER_STAFF_ID,
        renewed_at: r.renewed_at, old_due_date: r.old_due_date, new_due_date: r.new_due_date,
        renewal_count: r.renewal_count, reason: 'SIM simulated renewal',
      });
    }
    stock.hold(p.variant.id, borrowAt, p.returnAt, end);
    customer.held.set(p.book.id, p.returnAt.getTime());
    customer.borrowed.add(p.book.id);
    customer.recentCategories.push(p.book.categories[0]);
    if (customer.recentCategories.length > 10) customer.recentCategories.shift();
    const wish = customer.wishlist.get(p.book.id);
    if (wish && !wish.removed && rng.chance(WISHLIST.removeOnBorrow)) {
      // removed_at is kept in memory only (the DB hard-deletes the row); the
      // offline recommendation eval needs it to rebuild the wishlist as it
      // stood at a past cutoff instead of the end-of-window survivors.
      wish.removed = true;
      wish.removed_at = borrowAt;
    }

    const row = {
      id: itemId, loan_id: loanId, variant_id: p.variant.id,
      item_barcode: `${PREFIX.barcode}${loanNo}-${index}`,
      due_date: p.finalDue, return_date: null,
      item_condition_on_checkout: 'GOOD', item_condition_on_return: null,
      status: p.finalDue.getTime() < end.getTime() ? 'OVERDUE' : 'BORROWED',
      fine_amount: 0, lost_fee_amount: 0,
    };
    if (returned) {
      const late = p.returnAt.getTime() > p.finalDue.getTime();
      row.return_date = p.returnAt;
      row.status = 'RETURNED';
      row.item_condition_on_return = rng.chance(READING.damagedOnReturn) ? 'DAMAGED' : 'GOOD';
      if (late) {
        const daysLate = Math.ceil((p.returnAt.getTime() - p.finalDue.getTime()) / DAY_MS);
        row.fine_amount = issueFine(ctx, customer, itemId, p.returnAt, daysLate);
      }
      ctx.samples.late.push({ label: late ? 1 : 0, trueProb: pLate });
      maybeReview(ctx, customer, p.book, p.returnAt);
      if (!closedAt || p.returnAt.getTime() > closedAt.getTime()) closedAt = p.returnAt;
    } else {
      allReturned = false;
    }
    ctx.tables.loan_items.push(row);
  });

  customer.loanEnds.push(allReturned ? closedAt.getTime() : Infinity);
  ctx.tables.loan_transactions.push({
    id: loanId,
    loan_number: `${PREFIX.loan}${String(loanNo).padStart(6, '0')}`,
    customer_id: customer.id,
    warehouse_id: warehouseId,
    handled_by_user_id: PLACEHOLDER_STAFF_ID,
    source_reservation_id: opts.reservationId || null,
    borrow_date: borrowAt,
    due_date: originalDue,
    closed_at: allReturned ? closedAt : null,
    status: allReturned ? 'RETURNED' : (originalDue.getTime() < end.getTime() ? 'OVERDUE' : 'BORROWED'),
    total_items: entries.length,
    created_at: borrowAt,
    updated_at: allReturned ? closedAt : borrowAt,
  });
  return loanId;
}

function activeItemCount(customer, t) {
  const now = t.getTime();
  let n = 0;
  for (const [bookId, until] of customer.held) {
    if (until > now) n += 1; else customer.held.delete(bookId);
  }
  return n;
}

module.exports = { createLoan, activeItemCount };
