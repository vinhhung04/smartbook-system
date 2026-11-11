import { parseOptionalQuantity, parseWholeQuantity, sanitizeQuantityInput } from './quantity';

describe('parseWholeQuantity', () => {
  it('accepts whole numbers within range', () => {
    expect(parseWholeQuantity('3', { max: 5 })).toEqual({ ok: true, value: 3 });
    expect(parseWholeQuantity(' 5 ', { max: 5 })).toEqual({ ok: true, value: 5 });
  });

  it.each(['1.5', '2,0', '-1', '1e2', 'NaN', 'Infinity', 'abc', '0x10', '+3'])('rejects %s', (raw) => {
    expect(parseWholeQuantity(raw).ok).toBe(false);
  });

  it('rejects empty input', () => {
    expect(parseWholeQuantity('')).toEqual({ ok: false, error: 'Vui lòng nhập số lượng' });
  });

  it('enforces the minimum (default 1)', () => {
    expect(parseWholeQuantity('0').ok).toBe(false);
    expect(parseWholeQuantity('0', { min: 0 })).toEqual({ ok: true, value: 0 });
  });

  it('enforces the maximum with a readable reason', () => {
    const result = parseWholeQuantity('6', { max: 5, maxLabel: 'còn lại' });
    expect(result).toEqual({ ok: false, error: 'Số lượng không được vượt quá 5 (còn lại)' });
  });

  it('rejects numbers beyond safe integer range', () => {
    expect(parseWholeQuantity('99999999999999999999').ok).toBe(false);
  });
});

describe('parseOptionalQuantity', () => {
  it('treats blank as not given', () => {
    expect(parseOptionalQuantity('  ')).toEqual({ ok: true, value: undefined });
  });

  it('validates a given value, allowing zero', () => {
    expect(parseOptionalQuantity('0')).toEqual({ ok: true, value: 0 });
    expect(parseOptionalQuantity('2.5').ok).toBe(false);
  });
});

describe('sanitizeQuantityInput', () => {
  it('strips everything but digits', () => {
    expect(sanitizeQuantityInput('1.5')).toBe('15');
    expect(sanitizeQuantityInput('-3')).toBe('3');
    expect(sanitizeQuantityInput('12')).toBe('12');
  });
});
