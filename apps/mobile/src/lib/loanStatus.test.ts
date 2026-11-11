import { canRequestRenewal, getDueState, getLoanStatusDisplay, getRenewalView } from './loanStatus';

describe('getLoanStatusDisplay', () => {
  it('maps OVERDUE to a danger tone', () => {
    expect(getLoanStatusDisplay('OVERDUE').tone).toBe('danger');
  });

  it('maps RETURNED to a success tone', () => {
    expect(getLoanStatusDisplay('RETURNED').tone).toBe('success');
  });
});

describe('canRequestRenewal', () => {
  it('allows renewal while borrowed or overdue', () => {
    expect(canRequestRenewal('BORROWED')).toBe(true);
    expect(canRequestRenewal('OVERDUE')).toBe(true);
  });

  it('blocks renewal for every other status', () => {
    expect(canRequestRenewal('RESERVED')).toBe(false);
    expect(canRequestRenewal('RETURNED')).toBe(false);
    expect(canRequestRenewal('LOST')).toBe(false);
    expect(canRequestRenewal('DAMAGED')).toBe(false);
    expect(canRequestRenewal('CANCELLED')).toBe(false);
  });
});

describe('getDueState', () => {
  const now = new Date('2026-10-27T09:00:00').getTime();
  it('counts calendar days and flags soon / overdue', () => {
    expect(getDueState('2026-11-10T00:00:00', 'BORROWED', now)).toMatchObject({ kind: 'ok', daysLeft: 14 });
    expect(getDueState('2026-10-29T23:00:00', 'BORROWED', now)).toMatchObject({ kind: 'soon', daysLeft: 2, label: 'Còn 2 ngày' });
    expect(getDueState('2026-10-27T23:59:00', 'BORROWED', now)).toMatchObject({ kind: 'soon', label: 'Hết hạn hôm nay' });
    expect(getDueState('2026-10-24T10:00:00', 'BORROWED', now)).toMatchObject({ kind: 'overdue', label: 'Quá hạn 3 ngày' });
  });

  it('trusts an OVERDUE status even on the due day', () => {
    expect(getDueState('2026-10-27T23:00:00', 'OVERDUE', now).kind).toBe('overdue');
  });

  it('is closed for returned loans', () => {
    expect(getDueState('2026-10-01T00:00:00', 'RETURNED', now).kind).toBe('closed');
  });
});

describe('getRenewalView', () => {
  it('hides the button while a request is pending', () => {
    expect(getRenewalView('BORROWED', { pending: true, requested_at: null, request_count: 1, last_decision: null })).toEqual({
      canRequest: false,
      note: 'Đã gửi yêu cầu gia hạn — đang chờ thư viện duyệt.',
    });
  });

  it('offers renewal for an active loan without a pending request', () => {
    expect(getRenewalView('OVERDUE', undefined)).toEqual({ canRequest: true, note: null });
    expect(getRenewalView('RETURNED', undefined).canRequest).toBe(false);
  });
});
