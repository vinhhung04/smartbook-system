async function claimSubmittedAuditForApproval(tx, auditId, reviewerId, completedAt = new Date()) {
  const result = await tx.stock_audits.updateMany({
    where: { id: auditId, status: 'SUBMITTED' },
    data: {
      status: 'COMPLETED',
      reviewed_by_user_id: reviewerId,
      completed_at: completedAt,
      updated_at: completedAt,
    },
  });

  return result.count === 1;
}

module.exports = { claimSubmittedAuditForApproval };
