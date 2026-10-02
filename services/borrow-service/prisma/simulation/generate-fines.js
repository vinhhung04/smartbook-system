// Overdue fines and payment behaviour. A fine is issued at the (late) return;
// whether and when it is paid depends on the latent payment_reliability
// (quadratically: reliable payers settle promptly, unreliable ones let fines sit).
// unpaidAt() is point-in-time: it only sees fines issued strictly before t and
// not yet paid at t - the same information a librarian has at checkout.

const { FINES } = require('./config');
const { DAY_MS } = require('./temporal-model');

function remoteMethod(rng, digital) {
  if (rng.chance(digital)) return rng.pick(['VNPAY', 'EWALLET', 'TRANSFER']);
  return 'CASH';
}

function issueFine(ctx, customer, loanItemId, issuedAt, daysLate) {
  const { rng, idRng, end } = ctx;
  const amount = daysLate * Number(customer.plan.fine_per_day);
  const r = customer.traits.payment_reliability;
  let paidAt = null;
  if (rng.chance(r ** 2)) {
    paidAt = new Date(issuedAt.getTime() + rng.exponential(FINES.quickPayMeanDays + 5 * (1 - r)) * DAY_MS);
  } else if (rng.chance(FINES.slowPayShare)) {
    paidAt = new Date(issuedAt.getTime() + rng.range(FINES.slowPayDays[0], FINES.slowPayDays[1]) * DAY_MS);
  }
  const fine = {
    id: idRng.uuid(),
    customer_id: customer.id,
    loan_item_id: loanItemId,
    amount,
    issued_at: issuedAt,
    paid_at: paidAt && paidAt.getTime() <= end.getTime() ? paidAt : null,
    method: paidAt ? remoteMethod(rng, customer.traits.digital_affinity) : null,
  };
  customer.fines.push(fine);
  ctx.fines.push(fine);
  return amount;
}

function unpaidAt(customer, t) {
  const now = t.getTime();
  return customer.fines.some((f) => f.issued_at.getTime() < now && (!f.paid_at || f.paid_at.getTime() > now));
}

// At a library visit, outstanding fines may be settled at the counter.
function payAtCounter(ctx, customer, t) {
  const now = t.getTime();
  const outstanding = customer.fines.filter((f) => f.issued_at.getTime() < now && (!f.paid_at || f.paid_at.getTime() > now));
  if (!outstanding.length) return;
  const p = FINES.counterPaymentBase + FINES.counterPaymentReliability * customer.traits.payment_reliability ** 2;
  if (!ctx.rng.chance(p)) return;
  const paidAt = new Date(now + 2 * 60 * 1000); // right after the checkout it accompanies
  const method = ctx.rng.chance(customer.traits.digital_affinity) ? 'CARD' : 'CASH';
  for (const f of outstanding) {
    f.paid_at = paidAt;
    f.method = method;
  }
}

function fineRows(ctx) {
  const fines = [];
  const payments = [];
  for (const f of ctx.fines) {
    fines.push({
      id: f.id,
      customer_id: f.customer_id,
      loan_item_id: f.loan_item_id,
      fine_type: 'OVERDUE',
      amount: f.amount,
      waived_amount: 0,
      status: f.paid_at ? 'PAID' : 'UNPAID',
      issued_at: f.issued_at,
      paid_at: f.paid_at,
    });
    if (f.paid_at) {
      payments.push({ id: ctx.idRng.uuid(), fine_id: f.id, payment_method: f.method, amount: f.amount, paid_at: f.paid_at });
    }
  }
  return { fines, payments };
}

module.exports = { issueFine, unpaidAt, payAtCounter, fineRows };
