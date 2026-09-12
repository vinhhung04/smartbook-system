const assert = require('node:assert/strict');
const test = require('node:test');
const { finalizeVnpayPayment } = require('../src/services/vnpay-payment.service');

function makeFakePrisma({ intent, fine, customer }) {
  const state = { intent: { ...intent }, fine: { ...fine }, customer: { ...customer }, payments: [], notifications: [], audits: [] };
  const tx = {
    fine_payment_intents: {
      findUnique: async ({ where }) => (where.txn_ref === state.intent.txn_ref ? state.intent : null),
      update: async ({ data }) => { Object.assign(state.intent, data); return state.intent; },
    },
    fines: {
      findUnique: async () => ({ ...state.fine, fine_payments: state.payments }),
      findMany: async () => [{ ...state.fine, fine_payments: state.payments }],
      update: async ({ data }) => { Object.assign(state.fine, data); return state.fine; },
    },
    fine_payments: {
      create: async ({ data }) => { const row = { id: `payment-${state.payments.length + 1}`, ...data }; state.payments.push(row); return row; },
    },
    customers: {
      update: async ({ data }) => { Object.assign(state.customer, data); return state.customer; },
    },
    customer_notifications: {
      create: async ({ data }) => { state.notifications.push(data); return { id: 'n1', created_at: new Date(), ...data }; },
    },
    borrow_audit_logs: {
      create: async ({ data }) => { state.audits.push(data); return data; },
    },
  };
  return { $transaction: async (fn) => fn(tx), _state: state };
}

function baseFixtures() {
  return {
    intent: { id: 'intent-1', fine_id: 'fine-1', customer_id: 'cust-1', txn_ref: 'TXN1', amount: 50000, status: 'PENDING', expires_at: new Date(Date.now() + 60000) },
    fine: { id: 'fine-1', customer_id: 'cust-1', amount: 50000, waived_amount: 0, status: 'UNPAID' },
    customer: { id: 'cust-1', total_fine_balance: 50000 },
  };
}

test('finalizeVnpayPayment creates a fine_payments row and marks the intent SUCCESS on a 00 response', async () => {
  const fakePrisma = makeFakePrisma(baseFixtures());
  const result = await finalizeVnpayPayment(fakePrisma, {
    vnp_TxnRef: 'TXN1', vnp_ResponseCode: '00', vnp_Amount: '5000000', vnp_TransactionNo: 'VNP123',
  });
  assert.equal(result.outcome, 'SUCCESS');
  assert.equal(fakePrisma._state.payments.length, 1);
  assert.equal(fakePrisma._state.payments[0].payment_method, 'VNPAY');
  assert.equal(fakePrisma._state.fine.status, 'PAID');
  assert.equal(fakePrisma._state.intent.status, 'SUCCESS');
});

test('finalizeVnpayPayment is idempotent: a second call with the same txn_ref does not double-create a fine_payments row', async () => {
  const fakePrisma = makeFakePrisma(baseFixtures());
  const params = { vnp_TxnRef: 'TXN1', vnp_ResponseCode: '00', vnp_Amount: '5000000', vnp_TransactionNo: 'VNP123' };
  await finalizeVnpayPayment(fakePrisma, params);
  const second = await finalizeVnpayPayment(fakePrisma, params);
  assert.equal(second.outcome, 'ALREADY_FINALIZED');
  assert.equal(fakePrisma._state.payments.length, 1, 'must not double-create a fine_payments row');
});

test('finalizeVnpayPayment marks the intent FAILED (not SUCCESS) on a non-00 response, without creating a fine_payments row', async () => {
  const fakePrisma = makeFakePrisma(baseFixtures());
  const result = await finalizeVnpayPayment(fakePrisma, { vnp_TxnRef: 'TXN1', vnp_ResponseCode: '24', vnp_Amount: '5000000' });
  assert.equal(result.outcome, 'PAYMENT_FAILED');
  assert.equal(fakePrisma._state.payments.length, 0);
  assert.equal(fakePrisma._state.intent.status, 'FAILED');
});

test('finalizeVnpayPayment rejects when vnp_Amount does not match the locked intent amount x100', async () => {
  const fakePrisma = makeFakePrisma(baseFixtures());
  const result = await finalizeVnpayPayment(fakePrisma, { vnp_TxnRef: 'TXN1', vnp_ResponseCode: '00', vnp_Amount: '9999999' });
  assert.equal(result.outcome, 'AMOUNT_MISMATCH');
  assert.equal(fakePrisma._state.payments.length, 0);
});

test('finalizeVnpayPayment returns NOT_FOUND for an unknown txn_ref instead of throwing', async () => {
  const fakePrisma = makeFakePrisma(baseFixtures());
  const result = await finalizeVnpayPayment(fakePrisma, { vnp_TxnRef: 'DOES-NOT-EXIST', vnp_ResponseCode: '00', vnp_Amount: '5000000' });
  assert.equal(result.outcome, 'NOT_FOUND');
});

test('finalizeVnpayPayment fails safe when the fine was already settled another way before VNPay confirmed', async () => {
  const fixtures = baseFixtures();
  fixtures.fine.status = 'PAID';
  const fakePrisma = makeFakePrisma(fixtures);
  // Simulate a staff counter payment already covering the fine before this transaction's payments are visible here.
  fakePrisma._state.payments.push({ id: 'staff-payment', fine_id: 'fine-1', amount: 50000, payment_method: 'CASH' });
  const result = await finalizeVnpayPayment(fakePrisma, { vnp_TxnRef: 'TXN1', vnp_ResponseCode: '00', vnp_Amount: '5000000' });
  assert.equal(result.outcome, 'STALE_REMAINING_BALANCE');
  assert.equal(fakePrisma._state.payments.length, 1, 'must not add a second fine_payments row on top of the already-settled balance');
});
