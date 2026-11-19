const { ReturnRequestError } = require('./return-request.service');
// Claim the request key before contacting another service. Inventory's per-copy
// keys cannot by themselves prevent two different batches sharing a parent key.
async function claimReturnOperation(prisma, { loanId, key, fingerprint }) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const result = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`return-key:${key}`}, 0))`;
      const existing = await tx.loan_return_requests.findUnique({ where: { idempotency_key: key } });
      if (existing) {
        const state = existing;
        if (existing.loan_id !== loanId || state.fingerprint !== fingerprint) throw new ReturnRequestError('Idempotency-Key đã được dùng cho yêu cầu trả sách khác', 409);
        if (state.status === 'COMPLETED') return { id: existing.id, replay: state.response };
        // Bound leases exceed the maximum100 sequential10-second remote calls.
        if (state.status === 'PROCESSING' && Date.now() - Date.parse(state.started_at) < 30 * 60 * 1000) return { pending: true };
        await tx.loan_return_requests.update({ where: { id: existing.id }, data: {
          status: 'PROCESSING', started_at: new Date(), updated_at: new Date(),
        } });
        return { id: existing.id };
      }
      const record = await tx.loan_return_requests.create({ data: { loan_id: loanId, idempotency_key: key, fingerprint } });
      return { id: record.id };
    });
    if (!result.pending) return result;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new ReturnRequestError('Yêu cầu trả sách cùng key đang được xử lý; vui lòng thử lại', 409);
}
async function finishReturnOperation(db, id, { response, unresolvedIds = [] }) {
  if (!id) return;
  await db.loan_return_requests.update({ where: { id }, data: {
    status: response ? 'COMPLETED' : 'RETRYABLE', updated_at: new Date(),
    ...(response ? { response: JSON.parse(JSON.stringify(response)) } : { unresolved_item_ids: unresolvedIds }),
  } });
}
module.exports = { claimReturnOperation, finishReturnOperation };
