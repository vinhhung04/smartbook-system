import { fineRemaining, formatVnd, toMoney } from './money';

describe('toMoney', () => {
  it('parses Decimal strings and guards garbage', () => {
    expect(toMoney('5000.00')).toBe(5000);
    expect(toMoney(12)).toBe(12);
    expect(toMoney('abc')).toBe(0);
    expect(toMoney(null)).toBe(0);
  });
});

describe('fineRemaining', () => {
  it('prefers the server-computed remaining amount', () => {
    expect(fineRemaining({ amount: '50000.00', waived_amount: '0', fine_payments: [], remaining_amount: 12000 })).toBe(12000);
  });

  it('falls back to amount - waived - payments without concatenating strings', () => {
    const fine = {
      amount: '50000.00',
      waived_amount: '5000.00',
      fine_payments: [{ amount: '10000.00' }, { amount: '5000.00' }] as never,
    };
    expect(fineRemaining(fine)).toBe(30000);
  });

  it('never goes negative', () => {
    expect(fineRemaining({ amount: '1000', waived_amount: '2000', fine_payments: [] })).toBe(0);
  });
});

describe('formatVnd', () => {
  it('formats Vietnamese dong', () => {
    expect(formatVnd('30000.00')).toMatch(/^30[.,]000 đ$/);
  });
});
