import { canPayFine, getFineStatusDisplay, getFineTypeLabel } from './fineStatus';

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

describe('getFineTypeLabel', () => {
  it('shows Vietnamese labels, the same wording as the web', () => {
    expect(getFineTypeLabel('OVERDUE')).toBe('Trả trễ');
    expect(getFineTypeLabel('LOST')).toBe('Mất sách');
    expect(getFineTypeLabel('DAMAGED')).toBe('Hư hỏng');
    expect(getFineTypeLabel('DAMAGE')).toBe('Hư hỏng');
  });

  it('falls back to the raw code for an unknown type', () => {
    expect(getFineTypeLabel('OTHER')).toBe('OTHER');
  });
});
