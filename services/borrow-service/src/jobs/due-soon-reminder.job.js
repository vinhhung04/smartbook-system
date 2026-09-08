// Sends a "your loan is due soon" reminder (LOAN_DUE_REMINDER), prioritized
// by the late-return risk score from analytics-service. Same job shape as
// overdue.job.js (setInterval + unref + running guard, ENABLE_* env gate)
// and the same fetch-with-internal-key shape as
// inventory-service/src/jobs/aging-inventory.job.js.
//
// Both LOAN_DUE_REMINDER's email template (src/lib/email-sender.js) and its
// notification-event mapping (src/lib/notifications.js) already existed but
// were dead code - nothing ever created a notification with this
// template_code before this job.
const { prisma } = require('../lib/prisma');
const { createNotificationRecord } = require('../lib/notifications');

const ANALYTICS_SERVICE_URL = String(process.env.ANALYTICS_SERVICE_URL || 'http://analytics-service:3006').replace(/\/$/, '');
const INTERNAL_SERVICE_KEY = String(process.env.INTERNAL_SERVICE_KEY || 'smartbook_internal_key').trim();
const WINDOW_DAYS = Number(process.env.DUE_SOON_REMINDER_WINDOW_DAYS || 3);
const BATCH_SIZE = Math.min(200, Math.max(1, Number(process.env.DUE_SOON_REMINDER_BATCH_SIZE || 100)));

let timer = null;
let running = false;

/** Risk-ranked open items due within WINDOW_DAYS. Empty array (not a throw) on failure - the caller degrades. */
async function fetchRiskRankedDueSoonItems() {
  const response = await fetch(
    `${ANALYTICS_SERVICE_URL}/analytics/late-return-risk?dueWithinDays=${WINDOW_DAYS}&limit=200`,
    { signal: AbortSignal.timeout(15000), headers: { 'x-internal-service-key': INTERNAL_SERVICE_KEY } },
  );
  if (!response.ok) {
    throw new Error(`analytics-service responded ${response.status}`);
  }
  const body = await response.json();
  return (body?.data?.items || []).map((item) => ({
    loan_item_id: item.loan_item_id,
    risk_score: item.risk_score,
    risk_band: item.risk_band,
  }));
}

/** Fallback when analytics-service is unreachable: due-date order, no risk score. */
async function fetchDueSoonItemsByDueDate() {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const items = await prisma.loan_items.findMany({
    where: { status: { in: ['BORROWED', 'OVERDUE'] }, return_date: null, due_date: { gte: now, lte: windowEnd } },
    orderBy: [{ due_date: 'asc' }],
    take: 200,
    select: { id: true },
  });
  return items.map((item) => ({ loan_item_id: item.id, risk_score: null, risk_band: null }));
}

async function sendReminderIfNeeded(candidate) {
  const existing = await prisma.customer_notifications.findFirst({
    where: { template_code: 'LOAN_DUE_REMINDER', reference_type: 'LOAN_ITEM', reference_id: candidate.loan_item_id },
    select: { id: true },
  });
  if (existing) return 'skipped_duplicate';

  const item = await prisma.loan_items.findUnique({
    where: { id: candidate.loan_item_id },
    include: { loan_transactions: { include: { customers: true } } },
  });
  const loan = item?.loan_transactions;
  const customer = loan?.customers;
  // The item may have been returned or the loan closed between fetching the
  // candidate list and processing it here - nothing to remind about anymore.
  if (!item || !loan || !customer || item.return_date) return 'skipped_stale';

  await prisma.$transaction(async (tx) => {
    await createNotificationRecord(tx, {
      customer_id: customer.id,
      channel: 'IN_APP',
      template_code: 'LOAN_DUE_REMINDER',
      subject: 'Sách sắp đến hạn trả',
      body: `Phiếu mượn ${loan.loan_number} sẽ đến hạn trả vào ${item.due_date.toISOString().slice(0, 10)}.`,
      reference_type: 'LOAN_ITEM',
      reference_id: item.id,
      metadata: { risk_score: candidate.risk_score, risk_band: candidate.risk_band, due_date: item.due_date },
      email: customer.email || null,
      email_data: { customer_name: customer.full_name, loan_number: loan.loan_number, due_date: item.due_date.toISOString().slice(0, 10) },
    });
  });
  return 'sent';
}

async function executeDueSoonReminderSweep() {
  if (running) return;
  running = true;
  const result = { scanned: 0, sent: 0, skipped_duplicate: 0, skipped_stale: 0, failed: 0, degraded: false };
  try {
    let candidates;
    try {
      candidates = await fetchRiskRankedDueSoonItems();
    } catch (error) {
      console.error('[borrow-service][job] due-soon reminder: analytics-service unavailable, falling back to due-date order', error.message);
      result.degraded = true;
      candidates = await fetchDueSoonItemsByDueDate();
    }

    const batch = candidates.slice(0, BATCH_SIZE);
    result.scanned = batch.length;

    for (const candidate of batch) {
      try {
        const outcome = await sendReminderIfNeeded(candidate);
        result[outcome] = (result[outcome] || 0) + 1;
      } catch (error) {
        result.failed += 1;
        console.error('[borrow-service][job] due-soon reminder item failed', candidate.loan_item_id, error.message);
      }
    }

    console.log('[borrow-service][job] due-soon reminder sweep result', result);
  } catch (error) {
    console.error('[borrow-service][job] due-soon reminder sweep failed', error);
  } finally {
    running = false;
  }
}

function startDueSoonReminderJob() {
  const enabled = String(process.env.ENABLE_DUE_SOON_REMINDER_JOB || 'true').toLowerCase() === 'true';
  if (!enabled) {
    console.log('[borrow-service][job] due-soon reminder disabled by env');
    return;
  }

  const intervalMs = Math.max(60_000, Number(process.env.DUE_SOON_REMINDER_INTERVAL_MS || 6 * 60 * 60_000));
  timer = setInterval(() => {
    void executeDueSoonReminderSweep();
  }, intervalMs);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  console.log('[borrow-service][job] due-soon reminder started', { intervalMs, windowDays: WINDOW_DAYS });
  void executeDueSoonReminderSweep();
}

function stopDueSoonReminderJob() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = {
  startDueSoonReminderJob,
  stopDueSoonReminderJob,
  executeDueSoonReminderSweep,
};
