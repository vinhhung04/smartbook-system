async function claimDraftReceiptForPosting(tx, receiptId, postedAt = new Date()) {
  const result = await tx.goods_receipts.updateMany({
    where: { id: receiptId, status: 'DRAFT' },
    data: {
      status: 'POSTED',
      received_at: postedAt,
      updated_at: postedAt,
    },
  });

  return result.count === 1;
}

module.exports = { claimDraftReceiptForPosting };
