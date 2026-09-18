async function claimApprovedOrderForDispatch(tx, poId, dispatchedAt = new Date()) {
  const result = await tx.purchase_orders.updateMany({
    where: { id: poId, status: 'APPROVED' },
    data: {
      status: 'SENT_TO_SUPPLIER',
      updated_at: dispatchedAt,
    },
  });

  return result.count === 1;
}

module.exports = { claimApprovedOrderForDispatch };
