// Shared lock order for every fine writer: customer, then loan/item/deposit,
// fine advisory/row, and wallet. Lock before changing money or reading totals.
async function lockCustomerFineBalance(tx, customerId) {
  await tx.$executeRaw`SELECT id FROM customers WHERE id = ${customerId}::uuid FOR UPDATE`;
}

async function lockFineCustomer(tx, fineId) {
  const fine = await tx.fines.findUnique({ where: { id: fineId }, select: { customer_id: true } });
  if (fine?.customer_id) await lockCustomerFineBalance(tx, fine.customer_id);
  return fine?.customer_id || null;
}

module.exports = { lockCustomerFineBalance, lockFineCustomer };
