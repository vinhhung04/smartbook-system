import { canRequestRenewal, getLoanStatusDisplay } from './loanStatus';

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
