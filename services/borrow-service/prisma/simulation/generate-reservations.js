// Reservation -> pickup code -> pickup (loan) | no-show | cancel chain.
//
// The no-show label is drawn from the published logistic process in
// behavior-model.js using only what is known when the reservation is made:
// latent punctuality, lead/hold hours, channel, the customer's prior no-show
// rate over reservations whose outcome was ALREADY KNOWN at reserved_at, and
// the loans open at reserved_at. A converted reservation becomes a real loan
// (source_reservation_id) at pickup time via a scheduled 'pickup' task.

const { RESERVATION, PREFIX } = require('./config');
const { HOUR_MS } = require('./temporal-model');
const { noShowProbability, webProbability } = require('./behavior-model');

function priorNoShowRate(customer, t) {
  const now = t.getTime();
  let n = 0;
  let noShows = 0;
  for (const o of customer.reservationOutcomes) {
    if (o.at < now) { n += 1; noShows += o.noShow; }
  }
  return n ? noShows / n : 0;
}

function openLoans(customer, t) {
  const now = t.getTime();
  return customer.loanEnds.filter((endAt) => endAt > now).length;
}

function createReservation(ctx, customer, reservedAt, book, variant, { viaAlert = false } = {}) {
  const { rng, idRng, end, stock } = ctx;
  const t = customer.traits;
  const holdHours = customer.plan.reservation_hold_hours;
  const expiresAt = new Date(reservedAt.getTime() + holdHours * HOUR_MS);
  const channelWeb = rng.chance(Math.min(0.98, webProbability(t.digital_affinity) + (viaAlert ? 0.15 : 0)));

  ctx.counters.reservation += 1;
  const n = ctx.counters.reservation;
  const row = {
    id: idRng.uuid(),
    reservation_number: `${PREFIX.reservation}${String(n).padStart(6, '0')}`,
    customer_id: customer.id,
    variant_id: variant.id,
    warehouse_id: ctx.warehouseFor(customer),
    quantity: 1,
    source_channel: channelWeb ? 'WEB' : 'STAFF',
    status: 'PENDING',
    reserved_at: reservedAt,
    expires_at: expiresAt,
    pickup_code: null,
    pickup_code_issued_at: null,
    pickup_code_expires_at: null,
    pickup_code_used_at: null,
    updated_at: reservedAt,
  };
  ctx.tables.loan_reservations.push(row);

  let outcomeAt;
  if (rng.chance(RESERVATION.cancelBase + RESERVATION.cancelLowPunctuality * (1 - t.punctuality))) {
    outcomeAt = new Date(reservedAt.getTime() + rng.range(0.5, Math.max(1, holdHours * 0.5)) * HOUR_MS);
    if (outcomeAt.getTime() <= end.getTime()) row.status = 'CANCELLED';
  } else if (rng.chance(RESERVATION.codeNeverIssued)) {
    outcomeAt = expiresAt;
    if (outcomeAt.getTime() <= end.getTime()) row.status = 'EXPIRED';
  } else {
    const leadHours = rng.range(0.5, Math.max(1, holdHours * 0.6));
    const issuedAt = new Date(reservedAt.getTime() + leadHours * HOUR_MS);
    const pNoShow = noShowProbability({
      punctuality: t.punctuality,
      leadHours,
      holdHours,
      channelWeb,
      priorNoShowRate: priorNoShowRate(customer, reservedAt),
      activeLoans: openLoans(customer, reservedAt),
    });
    const noShow = rng.chance(pNoShow);
    const pickupAt = new Date(issuedAt.getTime() + rng.range(0.2, holdHours * 0.5) * HOUR_MS);
    outcomeAt = noShow ? expiresAt : pickupAt;

    if (issuedAt.getTime() <= end.getTime()) {
      row.pickup_code = `${PREFIX.pickupCode}${String(n).padStart(6, '0')}`;
      row.pickup_code_issued_at = issuedAt;
      row.pickup_code_expires_at = expiresAt;
      row.status = 'READY_FOR_PICKUP';
    }
    if (outcomeAt.getTime() <= end.getTime()) {
      // Terminal outcome observed inside the window -> labelled sample.
      ctx.samples.noShow.push({ label: noShow ? 1 : 0, trueProb: pNoShow });
      customer.reservationOutcomes.push({ at: outcomeAt.getTime(), noShow: noShow ? 1 : 0 });
      if (noShow) {
        row.status = 'EXPIRED';
      } else {
        row.status = 'CONVERTED_TO_LOAN';
        row.pickup_code_used_at = pickupAt;
        ctx.schedule({ time: pickupAt, type: 'pickup', customer, book, variant, reservation: row });
      }
    }
  }
  if (outcomeAt.getTime() <= end.getTime()) row.updated_at = outcomeAt;
  stock.hold(variant.id, reservedAt, outcomeAt, end);
  customer.held.set(book.id, outcomeAt.getTime());
  return row;
}

module.exports = { createReservation, priorNoShowRate, openLoans };
