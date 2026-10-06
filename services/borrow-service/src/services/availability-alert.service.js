// "Báo khi có sách" dispatch. Inventory publishes every stock mutation through
// its transactional outbox (inventory.stock.changed for receiving, putaway,
// stock-audit adjustments and loan returns; inventory.reservation.released when
// a held copy goes back on the shelf). Each event is only a hint: the decision
// is made on inventory's live public availability for the book, which applies
// the one pickup rule (BRANCH/LIBRARY only, shelf stock only) — so stock that
// lands in an internal WAREHOUSE, or a book still at 0 copies, never fires.
//
// Exactly-once per alert: each alert is claimed with a conditional update
// (status ACTIVE + notified_at NULL -> NOTIFIED + notified_at) inside the same
// transaction that writes the notification. A redelivered or concurrently
// processed event finds nothing left to claim, and a failed transaction rolls
// back both, so a retry neither loses nor duplicates the notification.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALERT_TRIGGER_EVENTS = ['inventory.stock.changed', 'inventory.reservation.released'];

/** Whether an inventory event could have put a copy back on a shelf. */
function isPotentialRestock(envelope) {
  const payload = envelope?.payload || {};
  if (!ALERT_TRIGGER_EVENTS.includes(envelope?.event_type)) return false;
  if (!UUID_PATTERN.test(String(payload.variant_id || ''))) return false;
  if (envelope.event_type === 'inventory.stock.changed') return Number(payload.delta_qty) > 0;
  return true;
}

function publicBranchesWithStock(availability) {
  return (availability?.pickup_branches || []).filter((branch) => Number(branch.available_quantity) > 0);
}

function buildAlertNotification(availability, branches) {
  const where = branches
    .map((branch) => `${branch.warehouse_name} (còn ${branch.available_quantity} cuốn)`)
    .join(', ');
  return {
    subject: 'Sách bạn chờ đã có thể đặt mượn',
    body: `"${availability.title}" đã có lại tại ${where}. Hãy đặt trước để giữ sách.`,
  };
}

async function dispatchAvailabilityAlerts(envelope, { prisma, getAvailability, createNotification, now = () => new Date() }) {
  if (!isPotentialRestock(envelope)) return { skipped: 'not_a_restock' };

  const availability = await getAvailability(envelope.payload.variant_id);
  const branches = publicBranchesWithStock(availability);
  if (!availability || Number(availability.available_quantity) <= 0 || branches.length === 0) {
    return { skipped: 'no_public_stock' };
  }

  const alerts = await prisma.availability_alerts.findMany({
    where: { book_id: availability.book_id, status: 'ACTIVE', notified_at: null },
    select: { id: true, customer_id: true },
    orderBy: [{ created_at: 'asc' }],
  });

  const message = buildAlertNotification(availability, branches);
  let notified = 0;
  for (const alert of alerts) {
    const sent = await prisma.$transaction(async (tx) => {
      const claim = await tx.availability_alerts.updateMany({
        where: { id: alert.id, status: 'ACTIVE', notified_at: null },
        data: { status: 'NOTIFIED', notified_at: now() },
      });
      if (claim.count !== 1) return false;

      await createNotification(tx, {
        customer_id: alert.customer_id,
        channel: 'IN_APP',
        template_code: 'AVAILABILITY_ALERT',
        subject: message.subject,
        body: message.body,
        reference_type: 'BOOK',
        reference_id: availability.book_id,
        metadata: {
          availability_alert_id: alert.id,
          event_id: envelope.event_id || null,
          pickup_branches: branches.map((branch) => ({
            warehouse_id: branch.warehouse_id,
            warehouse_name: branch.warehouse_name,
            available_quantity: branch.available_quantity,
          })),
        },
      });
      return true;
    });
    if (sent) notified += 1;
  }

  return { book_id: availability.book_id, candidates: alerts.length, notified };
}

module.exports = {
  ALERT_TRIGGER_EVENTS,
  buildAlertNotification,
  dispatchAvailabilityAlerts,
  isPotentialRestock,
};
