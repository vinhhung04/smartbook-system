// Operator tool. Listing is read-only; changes require explicit record/operator/
// reason/evidence arguments and are audited in the same database transaction.
const { PrismaClient } = require('@prisma/client');
const { getQueueState, reviewReconciliation } = require('../src/services/reconciliation-queue.service');
async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Explicit DATABASE_URL required');
  const [action = 'list', id, actorId, note, evidence] = process.argv.slice(2);
  const db = new PrismaClient();
  try {
    if (action === 'list') {
      const state = await getQueueState(db);
      const records = await db.integration_outbox.findMany({ where: { status: { in: ['PENDING', 'FAILED', 'MANUAL_REVIEW', 'PROCESSING'] } }, orderBy: [{ occurred_at: 'asc' }, { id: 'asc' }], take: 100, select: { id: true, event_type: true, status: true, retry_count: true, occurred_at: true, next_attempt_at: true, last_error_code: true } });
      console.log(JSON.stringify({ state, records }, null, 2));
    } else {
      console.log(JSON.stringify(await reviewReconciliation(db, { action, id, actorId, note, evidence })));
    }
  } finally { await db.$disconnect(); }
}
main().catch(() => { console.error('Reconciliation command failed; verify target, record state and required arguments. No success recorded.'); process.exitCode = 1; });
