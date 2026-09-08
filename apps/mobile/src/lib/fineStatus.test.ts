import { canPayFine, getFineStatusDisplay } from './fineStatus';

describe('getFineStatusDisplay', () => {
  it('maps UNPAID to a danger tone', () => {
    expect(getFineStatusDisplay('UNPAID').tone).toBe('danger');
  });

  it('maps PAID to a success tone', () => {
    expect(getFineStatusDisplay('PAID').tone).toBe('success');
  });
});

describe('canPayFine', () => {
  it('allows paying while unpaid or partially paid', () => {
    expect(canPayFine('UNPAID')).toBe(true);
    expect(canPayFine('PARTIALLY_PAID')).toBe(true);
  });

  it('blocks paying once paid or waived', () => {
    expect(canPayFine('PAID')).toBe(false);
    expect(canPayFine('WAIVED')).toBe(false);
  });
});
