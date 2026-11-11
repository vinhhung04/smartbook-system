import { decidePayment, describePaymentStatus, forgetPayment, loadStoredPayments, rememberPayment } from './pendingPayment';

// jest.mock calls are hoisted above the imports by babel-jest.
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key: string) => store.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => { store.set(key, value); }),
    },
  };
});

const NOW = Date.parse('2026-10-27T10:00:00Z');
const inFuture = new Date(NOW + 10 * 60_000).toISOString();
const inPast = new Date(NOW - 60_000).toISOString();

describe('decidePayment', () => {
  it('allows paying when nothing is pending', () => {
    expect(decidePayment({ id: 'f1', pending_payment: null }, 1000, null, NOW)).toEqual({ kind: 'pay' });
  });

  it('blocks a second link while the server still has one pending', () => {
    const decision = decidePayment({ id: 'f1', pending_payment: { txn_ref: 'T1', status: 'PENDING', amount: 1000, expires_at: inFuture } }, 1000, null, NOW);
    expect(decision).toEqual({ kind: 'wait', txnRef: 'T1', until: inFuture });
  });

  it('blocks while a locally remembered link has not expired (e.g. app reopened)', () => {
    const stored = { txn_ref: 'T2', fine_id: 'f1', amount: 1000, expires_at: inFuture, started_at: inPast };
    expect(decidePayment({ id: 'f1', pending_payment: null }, 1000, stored, NOW).kind).toBe('wait');
  });

  it('ignores expired links and links of other fines', () => {
    const expired = { txn_ref: 'T3', fine_id: 'f1', amount: 1000, expires_at: inPast, started_at: inPast };
    const other = { txn_ref: 'T4', fine_id: 'f2', amount: 1000, expires_at: inFuture, started_at: inPast };
    expect(decidePayment({ id: 'f1', pending_payment: null }, 1000, expired, NOW).kind).toBe('pay');
    expect(decidePayment({ id: 'f1', pending_payment: null }, 1000, other, NOW).kind).toBe('pay');
  });

  it('says settled when nothing is owed', () => {
    expect(decidePayment({ id: 'f1', pending_payment: null }, 0, null, NOW)).toEqual({ kind: 'settled' });
  });
});

describe('describePaymentStatus', () => {
  it('only SUCCESS counts as paid', () => {
    expect(describePaymentStatus('SUCCESS')).toMatchObject({ final: true, settled: true });
    expect(describePaymentStatus('PENDING')).toMatchObject({ final: false, settled: false });
    expect(describePaymentStatus('FAILED')).toMatchObject({ final: true, settled: false });
    expect(describePaymentStatus('EXPIRED')).toMatchObject({ final: true, settled: false });
    expect(describePaymentStatus('UNKNOWN')).toMatchObject({ final: false, settled: false });
  });
});

describe('stored payments', () => {
  it('are kept per user and replaced per fine', async () => {
    const base = { amount: 1000, expires_at: inFuture, started_at: inPast };
    await rememberPayment('u1', { ...base, txn_ref: 'A', fine_id: 'f1' });
    await rememberPayment('u1', { ...base, txn_ref: 'B', fine_id: 'f1' });
    await rememberPayment('u2', { ...base, txn_ref: 'C', fine_id: 'f9' });
    expect((await loadStoredPayments('u1')).map((p) => p.txn_ref)).toEqual(['B']);
    expect((await loadStoredPayments('u2')).map((p) => p.txn_ref)).toEqual(['C']);
    await forgetPayment('u1', 'B');
    expect(await loadStoredPayments('u1')).toEqual([]);
  });
});
